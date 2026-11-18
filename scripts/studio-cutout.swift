// macOS 14+: on-device foreground segmentation after FLUX. No network or model downloads.
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

private enum CutoutError: Error { case unreadable, noForeground, unusableMask, encoding }

private func cutout(input: URL, full: URL, thumb: URL) throws {
    guard let image = CIImage(contentsOf: input) else { throw CutoutError.unreadable }
    let request = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(ciImage: image)
    try handler.perform([request])
    guard let result = request.results?.first, !result.allInstances.isEmpty else {
        throw CutoutError.noForeground
    }

    let buffer = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)
    let mask = CIImage(cvPixelBuffer: buffer)
    let context = CIContext()
    let color = CGColorSpace(name: CGColorSpace.sRGB)!
    let width = Int(mask.extent.width)
    let height = Int(mask.extent.height)
    var alpha = [UInt8](repeating: 0, count: width * height)
    alpha.withUnsafeMutableBytes { bytes in
        context.render(mask, toBitmap: bytes.baseAddress!, rowBytes: width, bounds: mask.extent, format: .R8, colorSpace: nil)
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
    guard foreground > width * height / 100, foreground < width * height * 96 / 100,
          mask.extent == image.extent else { throw CutoutError.unusableMask }

    let pad = CGFloat(max(4, Int(Double(max(x1 - x0, y1 - y0)) * 0.025)))
    let subject = CGRect(x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1)
    let bounds = subject.insetBy(dx: -pad, dy: -pad).integral
    let clear = CIImage(color: .clear)
    let cut = image.applyingFilter("CIBlendWithMask", parameters: [
        kCIInputBackgroundImageKey: clear, kCIInputMaskImageKey: mask
    ]).cropped(to: bounds).composited(over: clear.cropped(to: bounds)).cropped(to: bounds)
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
