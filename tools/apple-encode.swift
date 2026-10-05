// Encodes raw BGRA frames (straight alpha) from stdin into Apple-native movies
// with transparency, using Apple's own encoders via AVAssetWriter:
//
//   apple-encode <width> <height> <fps> <prores.mov | -> <hevc.mov | ->
//
// Why not ffmpeg: AVFoundation (and so Final Cut, iMovie, iOS apps like
// Instagram Edits) decodes the alpha in ffmpeg-written ProRes as fully opaque.
// Files written here round-trip their alpha through both AVFoundation and ffmpeg.
// tools/render.mjs compiles this on first use (needs Xcode's swiftc).

import AVFoundation
import VideoToolbox

let args = CommandLine.arguments
guard args.count == 6, let width = Int(args[1]), let height = Int(args[2]), let fps = Double(args[3]), fps > 0 else {
  FileHandle.standardError.write("usage: apple-encode <width> <height> <fps> <prores.mov|-> <hevc.mov|->\n".data(using: .utf8)!)
  exit(2)
}

let bt709: [String: Any] = [
  AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
  AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
  AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
]

struct Output {
  let writer: AVAssetWriter
  let input: AVAssetWriterInput
  let adaptor: AVAssetWriterInputPixelBufferAdaptor
}

func makeOutput(path: String, codec: AVVideoCodecType, compression: [String: Any]?) throws -> Output {
  let url = URL(fileURLWithPath: path)
  try? FileManager.default.removeItem(at: url)
  var settings: [String: Any] = [AVVideoCodecKey: codec, AVVideoWidthKey: width, AVVideoHeightKey: height, AVVideoColorPropertiesKey: bt709]
  if let compression { settings[AVVideoCompressionPropertiesKey] = compression }
  let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
  let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
  input.expectsMediaDataInRealTime = false
  let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
  ])
  writer.add(input)
  guard writer.startWriting() else { throw writer.error ?? CocoaError(.fileWriteUnknown) }
  writer.startSession(atSourceTime: .zero)
  return Output(writer: writer, input: input, adaptor: adaptor)
}

var outputs: [Output] = []
do {
  if args[4] != "-" { outputs.append(try makeOutput(path: args[4], codec: .proRes4444, compression: nil)) }
  if args[5] != "-" {
    outputs.append(try makeOutput(path: args[5], codec: .hevcWithAlpha, compression: [
      AVVideoQualityKey: 0.92,
      kVTCompressionPropertyKey_TargetQualityForAlpha as String: 0.92,
      kVTCompressionPropertyKey_AlphaChannelMode as String: kVTAlphaChannelMode_StraightAlpha,
    ]))
  }
} catch {
  FileHandle.standardError.write("apple-encode: \(error)\n".data(using: .utf8)!)
  exit(1)
}

let frameBytes = width * height * 4
var frame = [UInt8](repeating: 0, count: frameBytes)

// Reads exactly one frame; false at a clean end of stream
func readFrame() -> Bool {
  var got = 0
  while got < frameBytes {
    let n = frame.withUnsafeMutableBytes { fread($0.baseAddress! + got, 1, frameBytes - got, stdin) }
    if n == 0 { break }
    got += n
  }
  if got != 0 && got != frameBytes {
    FileHandle.standardError.write("apple-encode: truncated frame (\(got) of \(frameBytes) bytes)\n".data(using: .utf8)!)
    exit(1)
  }
  return got == frameBytes
}

var index: Int64 = 0
while readFrame() {
  // 1000× timescale keeps fractional rates like 29.97 exact
  let time = CMTime(value: index * 1000, timescale: CMTimeScale((fps * 1000).rounded()))
  for out in outputs {
    while !out.input.isReadyForMoreMediaData { usleep(500) }
    var buffer: CVPixelBuffer?
    guard let pool = out.adaptor.pixelBufferPool, CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let pb = buffer else {
      FileHandle.standardError.write("apple-encode: no pixel buffer\n".data(using: .utf8)!)
      exit(1)
    }
    CVPixelBufferLockBaseAddress(pb, [])
    let dst = CVPixelBufferGetBaseAddress(pb)!.assumingMemoryBound(to: UInt8.self)
    let stride = CVPixelBufferGetBytesPerRow(pb)
    frame.withUnsafeBytes { src in
      for row in 0..<height {
        memcpy(dst + row * stride, src.baseAddress! + row * width * 4, width * 4)
      }
    }
    CVPixelBufferUnlockBaseAddress(pb, [])
    if !out.adaptor.append(pb, withPresentationTime: time) {
      FileHandle.standardError.write("apple-encode: \(out.writer.error.map { "\($0)" } ?? "append failed")\n".data(using: .utf8)!)
      exit(1)
    }
  }
  index += 1
}

for out in outputs {
  out.input.markAsFinished()
  let done = DispatchSemaphore(value: 0)
  out.writer.finishWriting { done.signal() }
  done.wait()
  if out.writer.status != .completed {
    FileHandle.standardError.write("apple-encode: \(out.writer.error.map { "\($0)" } ?? "write failed")\n".data(using: .utf8)!)
    exit(1)
  }
}
