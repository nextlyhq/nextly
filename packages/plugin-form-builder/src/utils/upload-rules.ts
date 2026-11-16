/**
 * What a form's file field accepts, read the one way the upload route and
 * anything judging an upload read it: the types it allows, how large a file
 * may be, and the name a file is stored under.
 *
 * @module utils/upload-rules
 */

/** A file field's own limits, as the form stores them. */
export interface FileFieldRules {
  accept?: unknown;
  maxFileSize?: unknown;
}

/** The plugin's upload settings (`uploads` in the plugin's options). */
export interface UploadSettings {
  maxFileSize: number;
  allowedMimeTypes: readonly string[];
}

/** The longest name a stored file keeps, before its extension is lost. */
const MAX_NAME_LENGTH = 200;

/**
 * The patterns a file has to match: the field's own `accept` (the HTML
 * attribute's spelling: `.pdf`, `image/*`, `application/pdf`), or the
 * plugin's allowed types when the field names none.
 */
export function acceptPatternsOf(
  field: FileFieldRules,
  settings: UploadSettings
): string[] {
  const own =
    typeof field.accept === "string"
      ? field.accept
          .split(",")
          .map(pattern => pattern.trim().toLowerCase())
          .filter(pattern => pattern !== "")
      : [];
  return own.length > 0
    ? own
    : settings.allowedMimeTypes.map(type => type.toLowerCase());
}

/** A media type without its parameters, in lower case. */
function bareType(type: string): string {
  return (type.split(";")[0] ?? "").trim().toLowerCase();
}

/** Whether one `accept` pattern takes a file of this name and type. */
function patternTakes(pattern: string, name: string, type: string): boolean {
  if (pattern === "*" || pattern === "*/*") return true;
  if (pattern.startsWith(".")) return name.toLowerCase().endsWith(pattern);
  if (pattern.endsWith("/*")) {
    return (
      type.startsWith(pattern.slice(0, -1)) && type.length > pattern.length - 1
    );
  }
  return type === pattern;
}

/**
 * Whether a file of this name and media type matches any of `patterns`, as
 * a browser reads an `accept` attribute: an extension matches the name, a
 * type or `type/*` matches the media type.
 */
export function fileMatchesAccept(
  file: { name: string; type: string },
  patterns: readonly string[]
): boolean {
  const type = bareType(file.type);
  return patterns.some(pattern => patternTakes(pattern, file.name, type));
}

/**
 * The largest file, in bytes, a field takes: its own limit, never more than
 * the plugin's, and the plugin's when the field sets none. A form's author
 * chooses a field's limit; the site's developer chooses how much any
 * visitor may store, and that bound holds whatever a form says.
 */
export function uploadLimitOf(
  field: FileFieldRules,
  settings: UploadSettings
): number {
  const own = field.maxFileSize;
  return typeof own === "number" && Number.isFinite(own) && own > 0
    ? Math.min(own, settings.maxFileSize)
    : settings.maxFileSize;
}

/** Whether a character is a control character (C0, or DEL). */
function isControl(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f;
}

/**
 * The name a visitor's file is stored under: its last path segment (some
 * browsers send `C:\fakepath\cv.pdf`), without control characters, and no
 * longer than the storage keeps. A name with nothing left is `upload`.
 */
export function safeUploadName(raw: string): string {
  const lastSegment = raw.split(/[\\/]/).pop() ?? "";
  // Control characters, the null byte among them, have no place in a name.
  const printable = Array.from(lastSegment)
    .filter(char => !isControl(char))
    .join("")
    .trim();
  const named = /^\.*$/.test(printable) ? "upload" : printable;
  if (named.length <= MAX_NAME_LENGTH) return named;
  const dot = named.lastIndexOf(".");
  const extension = dot > 0 && named.length - dot <= 16 ? named.slice(dot) : "";
  return named.slice(0, MAX_NAME_LENGTH - extension.length) + extension;
}

/** A byte count as a person reads it: `5 MB`, `512 KB`. */
export function readableBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** The media ids a file answer names: one id, or a list of them. */
export function mediaIdsOf(answer: unknown): string[] {
  if (typeof answer === "string") return answer === "" ? [] : [answer];
  if (!Array.isArray(answer)) return [];
  return answer.filter(
    (item): item is string => typeof item === "string" && item !== ""
  );
}
