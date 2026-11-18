/**
 * esbuild's build messages, as every surface that reports a configuration it could not compile
 * reads them: the CLI's error and the development server's log line.
 *
 * esbuild counts a column in bytes from 0; an editor counts characters from 1. Two readers that
 * converted it apart showed one error at two places, so the place is computed here alone.
 *
 * @module shared/lib/build-messages
 */

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

/** The build messages esbuild attached to `cause`, or none when it is no build failure. */
export function buildMessagesOf(cause: unknown): BuildMessage[] {
  if (typeof cause !== "object" || cause === null || !("errors" in cause)) {
    return [];
  }
  const { errors } = cause;
  if (!Array.isArray(errors)) return [];
  return errors.filter(
    (message): message is BuildMessage =>
      typeof message === "object" &&
      message !== null &&
      typeof (message as { text?: unknown }).text === "string"
  );
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

/**
 * Each message as `file:line:column: text` at the place an editor shows (`editorPlaceOf`),
 * followed by the line itself where esbuild kept it, one per line. Every surface that prints a
 * build failure renders it here, so the error's reason and its verbose context name one place.
 */
export function formatBuildMessages(messages: readonly BuildMessage[]): string {
  return messages
    .map(message => {
      const place = editorPlaceOf(message);
      if (place === undefined) return message.text;
      const at = `${place.file}:${place.line}:${place.column}: ${message.text}`;
      return place.lineText === undefined ? at : `${at}\n${place.lineText}`;
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
