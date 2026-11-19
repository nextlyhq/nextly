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
import {
  type BuildMessage,
  buildMessagesOf,
  editorPlaceOf,
} from "../shared/lib/build-messages";

const LEAD = "[Nextly HMR] Could not apply nextly.config.ts";
const KEPT = "The previous config stays in place.";

// The place as an editor shows it, computed where the CLI's error computes it
// (`editorPlaceOf`), so the two name one error at one place.
function where(message: BuildMessage): string {
  const place = editorPlaceOf(message);
  return place === undefined
    ? ""
    : ` (${place.file}:${place.line}:${place.column})`;
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

  const buildErrors = buildMessagesOf(cause);
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
