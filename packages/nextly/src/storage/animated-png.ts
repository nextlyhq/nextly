/**
 * Whether PNG bytes are an animated PNG (APNG).
 *
 * The image library reads an APNG as its first frame alone and reports one
 * page, so its own count cannot tell. An APNG says so itself: its animation
 * control chunk (`acTL`) comes before the first image data chunk (`IDAT`).
 *
 * @module storage/animated-png
 */

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Whether `bytes` are a PNG with an animation control chunk before its image
 * data. Reads chunk headers only, each step moving past one chunk, so it ends
 * within the bytes whatever lengths they claim. Bytes that are not a PNG, or
 * end early, are not animated here; the image library judges them.
 */
export function isAnimatedPng(bytes: Buffer): boolean {
  if (
    bytes.length < PNG_SIGNATURE.length ||
    !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return false;
  }
  // Each chunk: four bytes of length, four of type, the data, four of checksum.
  for (let at = PNG_SIGNATURE.length; at + 8 <= bytes.length; ) {
    const type = bytes.toString("latin1", at + 4, at + 8);
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    at += 12 + bytes.readUInt32BE(at);
  }
  return false;
}
