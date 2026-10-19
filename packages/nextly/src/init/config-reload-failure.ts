/**
 * What `next dev` says when a saved nextly.config.ts cannot be read.
 *
 * The reload keeps the previous config, so the message has to say what went
 * wrong and what to do: one fixed "fix the syntax error" sentence sent people
 * looking for a syntax error when a package was missing. The loader reports
 * three kinds of failure, told apart by their own structure: esbuild's build
 * errors, which carry a location; Node's missing-module error, which surfaces
 * when the compiled config is imported; and the loader's own refusal when it
 * cannot compile TypeScript at all.
 */

import { NextlyError } from "../errors/index";

const LEAD = "[Nextly HMR] Could not apply nextly.config.ts";
const KEPT = "The previous config stays in place.";

/** One of esbuild's build errors, as it reports them. */
type EsbuildMessage = {
  text: string;
  location?: {
    file: string;
    line: number;
    column: number;
    lineText?: string;
  } | null;
};

/** The build errors esbuild attached to a failure, if it was one. */
function esbuildErrors(cause: unknown): EsbuildMessage[] {
  if (!cause || typeof cause !== "object" || !("errors" in cause)) return [];
  const { errors } = cause;
  if (!Array.isArray(errors)) return [];
  return errors.filter(
    (entry): entry is EsbuildMessage =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as { text?: unknown }).text === "string"
  );
}

// esbuild counts a column in bytes from 0; an editor counts characters from 1.
// The line's own text turns the byte offset into characters, so a line with
// non-ASCII text before the error still points at the right place.
function where(message: EsbuildMessage): string {
  const at = message.location;
  if (!at) return "";
  const before =
    typeof at.lineText === "string"
      ? Buffer.from(at.lineText).subarray(0, at.column).toString().length
      : at.column;
  return ` (${at.file}:${at.line}:${before + 1})`;
}

/** The dev-log line for a config that could not be read. */
export function describeConfigReloadFailure(error: unknown): string {
  if (
    NextlyError.is(error) &&
    error.code === "NEXTLY_CONFIG_TOOLING_UNAVAILABLE"
  ) {
    return `${LEAD}: ${error.message} ${KEPT} Save the config again once it is installed.`;
  }

  const cause = error instanceof Error ? error.cause : undefined;

  const buildErrors = esbuildErrors(cause);
  const unresolved = buildErrors.find(entry =>
    entry.text.startsWith("Could not resolve ")
  );
  if (unresolved) {
    const target = /^Could not resolve "([^"]+)"/.exec(unresolved.text)?.[1];
    return (
      `${LEAD}: it imports ${target ? `"${target}"` : "a module"}, which could ` +
      `not be found${where(unresolved)}. ${KEPT} Install it or fix the import, ` +
      `then save again.`
    );
  }
  if (buildErrors.length > 0) {
    const first = buildErrors[0];
    return (
      `${LEAD}: syntax error${where(first)}: ${first.text}. ${KEPT} ` +
      `Fix it and save again.`
    );
  }

  // Node's error for a package the compiled config imports at runtime.
  const causeMessage = cause instanceof Error ? cause.message : "";
  const missing = /Cannot find (?:package|module) '([^']+)'/.exec(causeMessage);
  if (missing) {
    return (
      `${LEAD}: it imports "${missing[1]}", which is not installed. ${KEPT} ` +
      `Install it, then save again.`
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  const detail = causeMessage ? `${message} (cause: ${causeMessage})` : message;
  return `${LEAD}: ${detail}. ${KEPT} Fix the error and save again.`;
}
