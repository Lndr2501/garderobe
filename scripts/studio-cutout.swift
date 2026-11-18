// macOS 14+: on-device foreground segmentation. No network or model downloads.
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

private enum CutoutError: Error { case unreadable, noForeground, unusableMask, encoding }

private func cutout(input: URL, full: URL, thumb: URL) throws {
    guard let decoded = CIImage(contentsOf: input, options: [.applyOrientationProperty: true]),
          decoded.extent.width >= 1, decoded.extent.height >= 1,
          max(decoded.extent.width, decoded.extent.height) <= 4096 else { throw CutoutError.unreadable }
    let image = decoded.transformed(by: CGAffineTransform(translationX: -decoded.extent.minX, y: -decoded.extent.minY))
    let context = CIContext()
    let color = CGColorSpace(name: CGColorSpace.sRGB)!
    let width = Int(image.extent.width)
    let height = Int(image.extent.height)
    var alpha = [UInt8](repeating: 0, count: width * height)
    func readMask(_ src: CIImage, _ format: CIFormat) {
        alpha.withUnsafeMutableBytes { bytes in
            context.render(src, toBitmap: bytes.baseAddress!, rowBytes: width, bounds: image.extent, format: format, colorSpace: nil)
        }
    }

    // Wardrobe photos may have been cut out already. Reuse their alpha rather than guessing again.
    readMask(image, .A8)
    let alreadyTransparent = alpha.lazy.filter { $0 < 16 }.count > width * height / 20
    let clear = CIImage(color: .clear)
    let foregroundImage: CIImage
    if alreadyTransparent {
        foregroundImage = image
    } else {
        let request = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(ciImage: image)
        try handler.perform([request])
        guard let result = request.results?.first, !result.allInstances.isEmpty else {
            throw CutoutError.noForeground
        }
        let buffer = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)
        let mask = CIImage(cvPixelBuffer: buffer)
        guard mask.extent == image.extent else { throw CutoutError.unusableMask }
        readMask(mask, .R8)
        foregroundImage = image.applyingFilter("CIBlendWithMask", parameters: [
            kCIInputBackgroundImageKey: clear.cropped(to: image.extent), kCIInputMaskImageKey: mask
        ])
    }
    var x0 = width, y0 = height, x1 = -1, y1 = -1, foreground = 0
    for y in 0..<height {
        for x in 0..<width where alpha[y * width + x] >= 128 {
            foreground += 1
            x0 = min(x0, x); x1 = max(x1, x)
            y0 = min(y0, y); y1 = max(y1, y)
        }
    }
    // Don't silently return an empty image or the entire original rectangle as a cutout.
    guard foreground > width * height / 100, foreground < width * height * 96 / 100
    else { throw CutoutError.unusableMask }

    let pad = CGFloat(max(4, Int(Double(max(x1 - x0, y1 - y0)) * 0.025)))
    // The bitmap is top-down, while Core Image crops from a bottom-left origin.
    let subject = CGRect(x: x0, y: height - 1 - y1, width: x1 - x0 + 1, height: y1 - y0 + 1)
    let bounds = subject.insetBy(dx: -pad, dy: -pad).integral
    let cut = foregroundImage.cropped(to: bounds).composited(over: clear.cropped(to: bounds)).cropped(to: bounds)
    let scale = min(1, 460 / max(bounds.width, bounds.height))
    let small = cut.transformed(by: CGAffineTransform(translationX: -bounds.minX, y: -bounds.minY))
        .applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: scale])
    func write(_ image: CIImage, rect: CGRect, to path: URL) throws {
        guard let cg = context.createCGImage(image, from: rect, format: .RGBA8, colorSpace: color),
              let out = CGImageDestinationCreateWithURL(path as CFURL, UTType.png.identifier as CFString, 1, nil)
        else { throw CutoutError.encoding }
        CGImageDestinationAddImage(out, cg, nil)
        guard CGImageDestinationFinalize(out) else { throw CutoutError.encoding }
    }
    try write(cut, rect: bounds, to: full)
    try write(small, rect: CGRect(origin: .zero, size: CGSize(width: (bounds.width * scale).rounded(), height: (bounds.height * scale).rounded())), to: thumb)
}

guard CommandLine.arguments.count == 4 else { exit(64) }
do {
    let args = CommandLine.arguments.dropFirst().map { URL(fileURLWithPath: $0) }
    try cutout(input: args[0], full: args[1], thumb: args[2])
} catch {
    FileHandle.standardError.write(Data(("Studio cutout: \(error)\n").utf8))
    exit(74)
}
