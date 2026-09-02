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
}

/** Every web font format this product accepts, serves and advertises. */
export const WEB_FONT_FORMATS: readonly WebFontFormat[] = [
  { mimeType: "font/woff2", extension: ".woff2" },
  { mimeType: "font/woff", extension: ".woff" },
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
 * The type an upload claims, filled in from its name where nothing was sent.
 *
 * ONE implementation, because four upload entry points needed the same answer
 * and three of them read the file's type under a different variable name — a
 * search for one spelling found some of them, which is exactly how a fix that
 * looks complete covers a subset.
 *
 * A browser reports no type for formats its platform does not register, which
 * fonts routinely are not, and several multipart clients send
 * `application/octet-stream` for the same reason. Both are refused by an
 * allowlist keyed on the type, whatever the allowlist contains.
 *
 * This NARROWS what a caller must send rather than widening what is believed:
 * only a name matching a declared font format resolves, everything else keeps
 * whatever arrived, and the resulting claim is still compared against the
 * file's own magic bytes downstream — so a renamed archive is refused exactly
 * as it was before.
 *
 * @param filename - The uploaded name
 * @param reportedType - The type the client sent, which may be empty
 * @returns The type to validate and store
 */
export function resolveClaimedMimeType(
  filename: string,
  reportedType: string
): string {
  const claimed = reportedType.trim();
  if (claimed !== "" && claimed !== "application/octet-stream") return claimed;
  return webFontMimeFromFilename(filename) ?? claimed;
}
