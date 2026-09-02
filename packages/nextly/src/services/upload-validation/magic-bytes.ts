/**
 * Upload Validation — Magic-Byte Sniff with SVG Equivalence Rule
 *
 * `file-type` recognizes SVG as `application/xml`, not `image/svg+xml`.
 * Naive string-equality on sniffed vs claimed would always reject legitimate
 * SVG uploads, so this module handles it as a two-way special case:
 *
 * - Claim `image/svg+xml` requires an actual `<svg>` root in the first 2KB
 *   — closes the bypass where an attacker would claim SVG MIME with non-SVG
 *   bytes to skip the sanitizer.
 * - A non-SVG claim with XML-sniffed bytes is rejected (reverse polyglot).
 *
 * @module services/upload-validation/magic-bytes
 */

import { isSvgMimeType } from "../../storage/svg-security";

import { matchesWebFontSignature } from "./web-fonts";

export type MagicByteResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "svg-claim-without-svg-content"
        | "font-claim-without-font-content"
        | "xml-content-non-svg-claim"
        | "general-mismatch";
      sniffedMime?: string;
    };

function looksLikeSvg(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 2048).toString("utf8");
  return (
    /^<\?xml[\s\S]*?<svg[\s>]/.test(head) || /^<svg[\s>]/.test(head.trimStart())
  );
}

/**
 * Sniff the buffer's actual format and compare against the claimed MIME.
 * Lazy-imports `file-type` (~half a meg of regex tables) so consumers that
 * never call this don't pay the cost.
 */
export async function detectAndCompareMime(
  buffer: Buffer,
  claimedMime: string
): Promise<MagicByteResult> {
  if (isSvgMimeType(claimedMime)) {
    return looksLikeSvg(buffer)
      ? { ok: true }
      : { ok: false, reason: "svg-claim-without-svg-content" };
  }

  /*
   * Checked against the signature directly, because `file-type` recognises
   * neither WOFF nor WOFF2 — so an unidentified buffer below is trusted, and a
   * font claim would be the one claim that reaches the store unverified. It is
   * also the claim most worth verifying: the public byte route serves these
   * types to anonymous callers, and the type itself may have been inferred
   * from a filename rather than sent by anyone.
   */
  if (!matchesWebFontSignature(buffer, claimedMime)) {
    return { ok: false, reason: "font-claim-without-font-content" };
  }

  const { fileTypeFromBuffer } = await import("file-type");
  const detected = await fileTypeFromBuffer(buffer);

  // Text-y formats with no magic bytes (CSV, plain JSON) — trust the claim;
  // the extension blocklist already rejected the dangerous text cases.
  if (!detected) return { ok: true };

  const sniffed = detected.mime.toLowerCase();

  if (sniffed === "application/xml" || sniffed === "text/xml") {
    return {
      ok: false,
      reason: "xml-content-non-svg-claim",
      sniffedMime: sniffed,
    };
  }

  const claimed = claimedMime.toLowerCase().trim();
  if (claimed === sniffed) return { ok: true };
  // `image/jpg` vs `image/jpeg` — browsers and some clients still emit `jpg`
  // even though the IANA name is `jpeg`.
  if (
    (claimed === "image/jpg" && sniffed === "image/jpeg") ||
    (claimed === "image/jpeg" && sniffed === "image/jpg")
  ) {
    return { ok: true };
  }

  return { ok: false, reason: "general-mismatch", sniffedMime: sniffed };
}
