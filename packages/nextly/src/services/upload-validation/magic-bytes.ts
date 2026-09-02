/**
 * Upload Validation — Magic-Byte Sniff with SVG Equivalence Rule
 *
 * The rule is that a claim naming a format with a signature must be backed by
 * that signature. Silence from the sniffer is evidence of absence only for the
 * formats it can read, so the two cases are separated by asking it what those
 * are rather than by keeping a list here.
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
 * A note on fixtures, because it decides what a passing test here means: a
 * four-byte magic followed by padding is not a file any of these formats
 * would produce, and the sniffer says so by declining to identify it. A WOFF2
 * carries its sfnt flavor at offset 4, a PNG its IHDR — a fixture stopping at
 * the magic exercises the unidentified branch below, never the branch that
 * compares a detected type against the claim.
 *
 * @module services/upload-validation/magic-bytes
 */

import { isSvgMimeType } from "../../storage/svg-security";

import { canonicalWebFontMime, matchesWebFontSignature } from "./web-fonts";

export type MagicByteResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "svg-claim-without-svg-content"
        | "font-claim-without-font-content"
        | "xml-content-non-svg-claim"
        | "signature-absent"
        | "general-mismatch";
      sniffedMime?: string;
    };

/**
 * The claim in the spelling the sniffer publishes. `image/jpg` and the legacy
 * font aliases name formats it knows under a different name, and a membership
 * test on the raw claim would read those as formats it cannot see — waiving
 * the evidence rule for exactly the claims an attacker chooses the spelling of.
 */
function canonicalForSniffer(claimed: string): string {
  if (claimed === "image/jpg") return "image/jpeg";
  return canonicalWebFontMime(claimed) ?? claimed;
}

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
   * A cheap magic-only pre-filter for the one family the public byte route
   * serves to anonymous callers, so an obviously bogus font claim is refused
   * with a reason that names the format — and without importing half a
   * megabyte of regex tables to learn it. The general rule below is what
   * actually proves the bytes; this only gets there sooner.
   */
  if (!matchesWebFontSignature(buffer, claimedMime)) {
    return { ok: false, reason: "font-claim-without-font-content" };
  }

  const claimed = claimedMime.toLowerCase().trim();
  const { fileTypeFromBuffer, supportedMimeTypes } = await import("file-type");
  const detected = await fileTypeFromBuffer(buffer);

  if (!detected) {
    /*
     * Nothing was recognised, which means two different things depending on
     * whether the sniffer could have recognised the claim in the first place.
     *
     * A format it knows and did not find is a format these bytes are not:
     * HTML named `payload.pdf` is unidentifiable, so trusting silence stored
     * live markup under `application/pdf` — past both blocklists, since the
     * dangerous spelling appears in neither the extension nor the type. That
     * holds however the claim arrived: inferred from the name when the client
     * sent nothing, or stated outright, since the attacker writes both.
     *
     * A format it can never recognise (CSV, JSON, plain text carry no magic)
     * keeps the documented allowance — there is no evidence to demand, and
     * the extension blocklist is their gate.
     *
     * Deriving the distinction from what the sniffer publishes rather than
     * from a list kept here means a format it learns to read becomes one this
     * refuses to take on trust, with nothing to edit. The dependency can only
     * ever move a type from unproven to proven, never the reverse.
     */
    return supportedMimeTypes.has(canonicalForSniffer(claimed))
      ? { ok: false, reason: "signature-absent" }
      : { ok: true };
  }

  const sniffed = detected.mime.toLowerCase();

  if (sniffed === "application/xml" || sniffed === "text/xml") {
    return {
      ok: false,
      reason: "xml-content-non-svg-claim",
      sniffedMime: sniffed,
    };
  }

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
