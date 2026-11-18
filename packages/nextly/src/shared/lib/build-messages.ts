/**
 * esbuild's build messages, as every surface that reports a configuration it could not compile
 * reads them: the CLI's error and the development server's log line.
 *
 * esbuild counts a column in bytes from 0; an editor counts characters from 1. Two readers that
 * converted it apart showed one error at two places, so the place is computed here alone.
 *
 * @module shared/lib/build-messages
 */

import { redactCredentialsInText } from "../../observability/mask-emails";

/** One of esbuild's build messages, as far as the readers here use it. */
export interface BuildMessage {
  text: string;
  location?: {
    file: string;
    line: number;
    column: number;
    lineText?: string;
  } | null;
}

/** Where a message points, as an editor shows it: line and column from 1, in characters. */
export interface EditorPlace {
  file: string;
  line: number;
  column: number;
  /** The line's own text, when esbuild kept it. */
  lineText?: string;
}

/**
 * The build messages esbuild attached to `cause`, or none when it is no build failure, each with
 * every credential in its text redacted (`redactCredentialsInText`): esbuild quotes what it could
 * not read, an import's specifier with its query among it, and every surface prints the text. The
 * line's own text is kept as written, since the column is counted in it; `formatBuildMessages`
 * redacts it where it is shown.
 */
export function buildMessagesOf(cause: unknown): BuildMessage[] {
  if (typeof cause !== "object" || cause === null || !("errors" in cause)) {
    return [];
  }
  const { errors } = cause;
  if (!Array.isArray(errors)) return [];
  return errors
    .filter(
      (message): message is BuildMessage =>
        typeof message === "object" &&
        message !== null &&
        typeof (message as { text?: unknown }).text === "string"
    )
    .map(message => ({
      ...message,
      text: redactCredentialsInText(message.text),
    }));
}

/**
 * Where `message` points as an editor shows it, or undefined when it names no place. The line's
 * own text turns esbuild's byte offset into characters, so a line with text outside ASCII before
 * the error still points at the right place.
 */
export function editorPlaceOf(message: BuildMessage): EditorPlace | undefined {
  const at = message.location;
  if (at === null || at === undefined) return undefined;
  const before =
    typeof at.lineText === "string"
      ? Buffer.from(at.lineText).subarray(0, at.column).toString().length
      : at.column;
  return {
    file: at.file,
    line: at.line,
    column: before + 1,
    ...(typeof at.lineText === "string" ? { lineText: at.lineText } : {}),
  };
}

/** How many characters of a line are shown either side of the place a message points at. */
const EXCERPT_REACH = 60;

/** A quoted string on a line: single, double or backtick quotes, a quote escaped inside it kept. */
const STRING_LITERAL = /(["'`])(?:\\.|(?!\1)[^\\])*\1/g;

/** A quote with nothing closing it before the line ends: a string the line does not finish. */
const UNFINISHED_STRING = /(["'`])[^"'`]*$/;

/**
 * Whether `code` is a C0 or C1 control character, or DEL: each acts on a terminal or a log rather
 * than showing. A tab is not among them: it shows, and no line holds a newline.
 */
function isControlCharacter(code: number): boolean {
  return (
    code <= 0x08 ||
    (code >= 0x0b && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f)
  );
}

/** `text` with each control character (`isControlCharacter`) written as its `\xNN` escape. */
function withControlCharactersEscaped(text: string): string {
  return Array.from(text, character => {
    const code = character.codePointAt(0) ?? 0;
    return isControlCharacter(code)
      ? `\\x${code.toString(16).padStart(2, "0")}`
      : character;
  }).join("");
}

/**
 * `lineText` with every string on it masked as `"…"`, and where the place at `index` (from 0) lies
 * in the masked line. Masked on the whole line, before any excerpt is cut: a string the cut
 * reached into would lose its opening quote and no longer read as one.
 */
function maskedStrings(
  lineText: string,
  index: number
): { masked: string; index: number } {
  let masked = "";
  let last = 0;
  let shrunk = 0;
  let inside: number | undefined;
  for (const match of lineText.matchAll(STRING_LITERAL)) {
    const start = match.index;
    const end = start + match[0].length;
    const replacement = `${match[1]}…${match[1]}`;
    masked += lineText.slice(last, start) + replacement;
    if (end <= index) shrunk += match[0].length - replacement.length;
    else if (start < index) inside = start - shrunk + 1;
    last = end;
  }
  // Only the text after the last whole string can open one the line does not finish: a masked
  // string's own closing quote is not an opening one.
  masked += lineText
    .slice(last)
    .replace(UNFINISHED_STRING, (_, quote: string) => `${quote}…`);
  return {
    masked,
    index: Math.min(masked.length, inside ?? index - shrunk),
  };
}

/**
 * The line a message points at, as it is shown. Every string on it is masked, on the whole line
 * (`maskedStrings`), and what is left redacted (`redactCredentialsInText`): a configuration may
 * hold a credential under any name, on a line that does not say what it is, and a syntax error
 * is about the code's shape, which the masked line still shows. Then at most `EXCERPT_REACH`
 * characters either side of the place are kept, marked with `…` where it was cut, since a
 * generated file's single line can run to thousands; and each control character is shown
 * escaped, so the line cannot act on the terminal or the log it is written to.
 */
function shownLine(lineText: string, column: number): string {
  const { masked, index } = maskedStrings(lineText, column - 1);
  const from = Math.max(0, index - EXCERPT_REACH);
  const to = Math.min(masked.length, index + EXCERPT_REACH);
  const excerpt = `${from > 0 ? "…" : ""}${masked.slice(from, to)}${
    to < masked.length ? "…" : ""
  }`;
  return withControlCharactersEscaped(redactCredentialsInText(excerpt));
}

/**
 * Each message as `file:line:column: text` at the place an editor shows (`editorPlaceOf`),
 * followed by the line itself where esbuild kept it (`shownLine`: an excerpt, its strings
 * masked), one per line. Every surface that prints a build failure renders it here, so the
 * error's reason and its verbose context name one place.
 */
export function formatBuildMessages(messages: readonly BuildMessage[]): string {
  return messages
    .map(message => {
      const place = editorPlaceOf(message);
      if (place === undefined) return message.text;
      const at = `${place.file}:${place.line}:${place.column}: ${message.text}`;
      return place.lineText === undefined
        ? at
        : `${at}\n${shownLine(place.lineText, place.column)}`;
    })
    .join("\n");
}

/**
 * A failure carrying `failure`'s build messages, its message rendered by `formatBuildMessages`.
 * esbuild's own message counts the column in bytes from 0, so a report that printed it, or chained
 * it as a cause, under the editor's place named one error at two places; the messages are all
 * kept, so nothing a reader of them needs is lost. Undefined when `failure` carries none.
 */
export function withEditorPlaces(failure: unknown): Error | undefined {
  const messages = buildMessagesOf(failure);
  if (messages.length === 0) return undefined;
  return Object.assign(
    new Error(`Build failed:\n${formatBuildMessages(messages)}`),
    { errors: messages }
  );
}
