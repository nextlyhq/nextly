/**
 * A text's SHA-256, as lowercase hex: one implementation for every place
 * that names content by its digest (a Layout copy's version, a site code
 * audit row).
 *
 * @module sha256-hex
 */

/** The SHA-256 of `text`'s UTF-8, as 64 lowercase hex characters. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}
