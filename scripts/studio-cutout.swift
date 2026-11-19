// macOS 14+: on-device foreground segmentation. No network or model downloads.
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

private enum CutoutError: Error { case unreadable, noForeground, unusableMask, encoding }

// Remove small, pale matte slivers connected to a cutout boundary. Only do this
// on predominantly dark studio renders, never on the original photo path.
private func cleanStudioEdge(_ image: CIImage, context: CIContext, color: CGColorSpace, width: Int, height: Int) -> CIImage {
    guard max(width, height) <= 1536 else { return image }
    let count = width * height
    var rgba = [UInt8](repeating: 0, count: count * 4)
    rgba.withUnsafeMutableBytes { dst in
        context.render(image, toBitmap: dst.baseAddress!, rowBytes: width * 4, bounds: image.extent, format: .RGBA8, colorSpace: color)
    }
    var opaque = 0, dark = 0
    var candidate = [UInt8](repeating: 0, count: count)
    for i in 0..<count {
        let j = i * 4
        let a = Int(rgba[j + 3])
        guard a > 20 else { continue }
        // Core Image's bytes are premultiplied. Compare the actual edge color.
        let low = Int(min(rgba[j], rgba[j + 1], rgba[j + 2])) * 255 / a
        let high = Int(max(rgba[j], rgba[j + 1], rgba[j + 2])) * 255 / a
        if a >= 245 {
            opaque += 1
            if high <= 139 { dark += 1 }
        }
        if low >= 106 && high - low <= 42 { candidate[i] = low >= 132 ? 2 : 1 }
    }
    guard opaque > 0, dark * 100 >= opaque * 88 else { return image }

    var group = [Int]()
    var removed = false
    let maxArea = max(40, opaque / 280)
    for start in 0..<count where candidate[start] > 0 {
        group.removeAll(keepingCapacity: true)
        group.append(start)
        var hasBrightPixel = candidate[start] == 2
        candidate[start] = 0
        var nearBackground = 0, cursor = 0
        var minX = width, maxX = 0, minY = height, maxY = 0
        while cursor < group.count {
            let i = group[cursor]
            cursor += 1
            let x = i % width, y = i / width
            minX = min(minX, x); maxX = max(maxX, x)
            minY = min(minY, y); maxY = max(maxY, y)
            var touchesClear = false
            for yy in max(0, y - 2)...min(height - 1, y + 2) {
                for xx in max(0, x - 2)...min(width - 1, x + 2) {
                    let j = yy * width + xx
                    if rgba[j * 4 + 3] < 32 { touchesClear = true }
                    if abs(xx - x) + abs(yy - y) == 1 && candidate[j] > 0 {
                        hasBrightPixel = hasBrightPixel || candidate[j] == 2
                        candidate[j] = 0
                        group.append(j)
                    }
                }
            }
            if touchesClear { nearBackground += 1 }
        }
        let narrow = min(maxX - minX + 1, maxY - minY + 1) <= 10
        guard hasBrightPixel, nearBackground > 0, nearBackground * 12 >= group.count,
              group.count <= maxArea, narrow || group.count <= 24 else { continue }
        for i in group {
            let j = i * 4
            rgba[j] = 0; rgba[j + 1] = 0; rgba[j + 2] = 0; rgba[j + 3] = 0
        }
        removed = true
    }
    guard removed,
          let provider = CGDataProvider(data: Data(rgba) as CFData),
          let cg = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
                           bytesPerRow: width * 4, space: color,
                           bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue).union(.byteOrder32Big),
                           provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    else { return image }
    return CIImage(cgImage: cg)
}

private func cutout(input: URL, full: URL, thumb: URL, cleanEdge: Bool) throws {
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
    var foregroundImage: CIImage
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
        let visionMask = CIImage(cvPixelBuffer: buffer)
        guard visionMask.extent == image.extent else { throw CutoutError.unusableMask }
        // Pull the feathered mask in by one pixel so the grey studio background
        // doesn't leave a bright fringe when the garment is displayed on dark blue.
        let mask = visionMask.clampedToExtent()
            .applyingFilter("CIMorphologyMinimum", parameters: [kCIInputRadiusKey: 1])
            .cropped(to: image.extent)
        readMask(mask, .R8)
        foregroundImage = image.applyingFilter("CIBlendWithMask", parameters: [
            kCIInputBackgroundImageKey: clear.cropped(to: image.extent), kCIInputMaskImageKey: mask
        ])
    }
    if cleanEdge {
        foregroundImage = cleanStudioEdge(foregroundImage, context: context, color: color, width: width, height: height)
        readMask(foregroundImage, .A8)
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

let cleanEdge = CommandLine.arguments.last == "--clean-edge"
guard CommandLine.arguments.count == (cleanEdge ? 5 : 4) else { exit(64) }
do {
    let args = CommandLine.arguments.dropFirst().prefix(3).map { URL(fileURLWithPath: $0) }
    try cutout(input: args[0], full: args[1], thumb: args[2], cleanEdge: cleanEdge)
} catch {
    FileHandle.standardError.write(Data(("Studio cutout: \(error)\n").utf8))
    exit(74)
}
