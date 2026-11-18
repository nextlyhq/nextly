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
