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

/**
 * The line a message points at, as it is shown: at most `EXCERPT_REACH` characters either side of
 * the place, marked with `…` where it was cut, since a generated file's single line can run to
 * thousands. Every string on it is masked, and what is left redacted (`redactCredentialsInText`):
 * a configuration may hold a credential under any name, on a line that does not say what it is,
 * and a syntax error is about the code's shape, which the masked line still shows.
 */
function shownLine(lineText: string, column: number): string {
  const from = Math.max(0, column - 1 - EXCERPT_REACH);
  const to = Math.min(lineText.length, column - 1 + EXCERPT_REACH);
  const excerpt = `${from > 0 ? "…" : ""}${lineText.slice(from, to)}${
    to < lineText.length ? "…" : ""
  }`;
  return redactCredentialsInText(
    excerpt.replace(STRING_LITERAL, (_, quote: string) => `${quote}…${quote}`)
  );
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
