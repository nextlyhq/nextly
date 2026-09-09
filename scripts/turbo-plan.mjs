/**
 * Reading turbo's `--dry=json` plan out of a stream that may not be only the
 * plan.
 *
 * One module because two callers needed this and only one of them knew it.
 * `check-test-lanes.mjs` parsed the whole stream and `turbo-inputs.test.mjs`
 * located the document first; the second had already met the failure the first
 * then hit on CI, and nothing connected them. A shared reader is what stops a
 * lesson living in one file.
 *
 * @module scripts/turbo-plan
 */

/**
 * The plan turbo printed, ignoring whatever else shared the stream.
 *
 * 🔴 Located by the first line that OPENS the document, never by the first `{`
 * anywhere. pnpm's config warnings quote the variable they could not resolve —
 * `Failed to replace env in config: ${NODE_AUTH_TOKEN}` — so the first brace in
 * the stream can sit inside a sentence. Parsing from there yields
 * `{NODE_AUTH_TOKEN}` and a `SyntaxError` about position 1, which describes the
 * text and says nothing about where it came from.
 *
 * Silencing the runner is not enough on its own and is still worth doing.
 * `pnpm --silent` removes the package-and-command preamble, which is reporter
 * output; it does not remove a warning raised while READING configuration,
 * because that happens before there is a reporter to silence. A runner whose
 * `.npmrc` interpolates an unset token therefore prints one and a laptop does
 * not — the difference that made this look like an environment fault rather
 * than a parsing assumption.
 *
 * @param {string} raw - everything the command wrote to stdout.
 * @param {string} describeSource - how to name the command in a failure.
 * @returns {{ tasks?: Array<Record<string, unknown>> }} turbo's plan.
 */
export function parseTurboPlan(raw, describeSource) {
  const lines = raw.split("\n");
  const start = lines.findIndex(line => line.startsWith("{"));
  if (start === -1) {
    throw new Error(
      `${describeSource} did not produce a turbo plan. Nothing in its output ` +
        `opens a JSON document. It began: ${JSON.stringify(raw.slice(0, 200))}`
    );
  }

  const document = lines.slice(start).join("\n");
  try {
    return JSON.parse(document);
  } catch (cause) {
    // Never a bare parse error: what this was reading is the only thing that
    // explains it, and a `SyntaxError` alone costs a CI round trip to diagnose.
    throw new Error(
      `${describeSource} did not produce a turbo plan. ${cause.message}. ` +
        `The document began: ${JSON.stringify(document.slice(0, 200))}`,
      { cause }
    );
  }
}
