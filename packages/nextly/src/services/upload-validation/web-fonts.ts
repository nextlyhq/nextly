/**
 * The web font formats this product handles, declared ONCE.
 *
 * Three boundaries need the same answer and each used to state it separately:
 * what an upload may contain, what the public byte route will serve, and what
 * the admin dropzone lets a browser send. Three lists that agree on the day
 * they are written and drift afterwards, silently — and the drift is not
 * symmetrical. A format added only to the serving set makes stored objects of
 * that type world readable; added only to the upload set, an author uploads
 * something nothing will serve.
 *
 * WOFF2 and WOFF only. Nothing here converts TTF or OTF, so accepting them
 * would store and send several times the bytes of the same face to every
 * visitor with nothing reporting it — a refusal a designer can act on beats a
 * cost they cannot see.
 *
 * @module services/upload-validation/web-fonts
 */

/** One web font format, in the two vocabularies the boundaries speak. */
export interface WebFontFormat {
  /** The IANA type, which is what an allowlist and a stored record carry. */
  readonly mimeType: string;
  /** The suffix a person sees on their own file, dot included. */
  readonly extension: string;
  /**
   * The keyword a `src` entry's `format()` takes for this type.
   *
   * Stated rather than derived from the extension, which it happens to equal
   * for both formats here and does not equal in general — the same table in a
   * product that carried TrueType would pair `.ttf` with `truetype`. A face
   * whose `format()` disagrees with its bytes is worse than one carrying no
   * hint at all, because a browser told the wrong format skips the source
   * without trying it.
   */
  readonly formatKeyword: string;
  /**
   * The four bytes the format begins with, as ASCII.
   *
   * Both formats carry a fixed signature the W3C specifies, which is what makes
   * a claim checkable at all: `file-type` does not recognise either of them, so
   * a font claim it cannot identify is indistinguishable from arbitrary bytes
   * unless something reads the signature directly.
   */
  readonly signature: string;
  /**
   * Older spellings a client may still report for this format.
   *
   * Some operating systems and multipart libraries carry the pre-IANA names,
   * and a claim wearing one is not generic — so nothing would fall back to the
   * filename, and the allowlist, which knows only the canonical name, refuses a
   * font the product accepts under its other spelling.
   */
  readonly aliases: readonly string[];
}

/** Every web font format this product accepts, serves and advertises. */
export const WEB_FONT_FORMATS: readonly WebFontFormat[] = [
  {
    mimeType: "font/woff2",
    extension: ".woff2",
    formatKeyword: "woff2",
    signature: "wOF2",
    aliases: ["application/font-woff2", "application/x-font-woff2"],
  },
  {
    mimeType: "font/woff",
    extension: ".woff",
    formatKeyword: "woff",
    signature: "wOFF",
    aliases: ["application/font-woff", "application/x-font-woff"],
  },
];

/** The same set as MIME types, for the allowlist and the serving gate. */
export const WEB_FONT_MIME_TYPES: readonly string[] = WEB_FONT_FORMATS.map(
  format => format.mimeType
);

/**
 * The font type a filename implies, if any.
 *
 * For the case a browser reports no type at all — which is the ordinary
 * outcome for a `.woff2` chosen from disk, since fonts are not in every
 * platform's type registry. The claim is still checked against the bytes
 * downstream, so inferring here narrows what a caller must send rather than
 * widening what is believed.
 *
 * @param filename - The uploaded name, whose extension is read case-insensitively
 * @returns The canonical MIME type, or `undefined` for anything else
 */
export function webFontMimeFromFilename(filename: string): string | undefined {
  const lower = filename.toLowerCase();
  return WEB_FONT_FORMATS.find(format => lower.endsWith(format.extension))
    ?.mimeType;
}

/**
 * The canonical name for a font type, whichever spelling arrived.
 *
 * @param mimeType - A lower-cased claim
 * @returns The IANA name, or `undefined` when this is not a web font at all
 */
export function canonicalWebFontMime(mimeType: string): string | undefined {
  return WEB_FONT_FORMATS.find(
    format => format.mimeType === mimeType || format.aliases.includes(mimeType)
  )?.mimeType;
}

/**
 * Whether a buffer actually begins as the font type it claims to be.
 *
 * The claim decides what an allowlist admits and what the public route will
 * serve, and a type inferred from a filename is a claim nobody made — so the
 * bytes have to answer for it. Without this, arbitrary content renamed to
 * `.woff2` is stored under a servable type and handed to any anonymous caller
 * as an immutable font.
 *
 * @param buffer - The uploaded bytes
 * @param mimeType - The claimed type; anything not a web font is not this
 *   function's question and answers `true`
 */
export function matchesWebFontSignature(
  buffer: Buffer,
  mimeType: string
): boolean {
  const format = WEB_FONT_FORMATS.find(
    candidate => candidate.mimeType === mimeType.toLowerCase().trim()
  );
  if (format === undefined) return true;
  return (
    buffer.subarray(0, format.signature.length).toString("ascii") ===
    format.signature
  );
}
