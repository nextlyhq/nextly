/**
 * Types for the server-safe artifact gate, which is plain ESM so the build can run it as a script
 * and a Vitest suite can read its pure parts without a build step.
 */

/**
 * Every module specifier the built artifact still names, across both module formats.
 *
 * A specifier that is not a literal is returned as an `<unreadable specifier: ...>` marker rather
 * than dropped, so it fails an allow-list comparison instead of passing in silence.
 */
export function specifiersIn(source: string, fileName: string): string[];

/**
 * The package a specifier belongs to, or `null` when it names none — a relative path or a Node
 * builtin. A scoped name keeps both of its segments.
 */
export function packageOf(specifier: string): string | null;

/**
 * Every emitted file reachable from one artifact, following the relative specifiers between them.
 *
 * `read` returns the file's text, or null when it is absent. A split build puts an entry's
 * dependencies in a chunk beside it, so an entry alone does not name what it reaches.
 */
export function reachedFrom(
  entry: string,
  read: (file: string) => string | null
): Array<{ file: string; missing: boolean; specifiers: string[] }>;

/** The package an input path belongs to, or `null` when it is first-party source. */
export function packageOfInput(input: string): string | null;

/**
 * The packages BUNDLED into one artifact, read from the build's own record of its inputs.
 *
 * `null` when the metafile does not describe that artifact — a question left unanswered rather
 * than an empty result, since a bundled package leaves no import for the specifier scan to find.
 */
export function bundledPackages(
  metafile: { outputs?: Record<string, { inputs?: Record<string, unknown> }> },
  outputName: string
): string[] | null;

/**
 * The distinct specifiers reachable from one artifact that name a package outside the allow-list,
 * plus any file the walk could not read.
 */
export function disallowedSpecifiers(
  entry: string,
  read: (file: string) => string | null,
  allowed: Set<string>
): { offending: string[]; missing: string[] };

/**
 * The DOM-only globals present in `scope`, empty on a bare server.
 *
 * A non-empty result means the evaluation check would pass without asserting anything, so the gate
 * refuses to run rather than report it.
 */
export function domGlobalsPresent(scope?: Record<string, unknown>): string[];

/**
 * The post-floor globals present in `scope`, empty once the floor restriction has run.
 *
 * Asked between artifact imports: one that installs `navigator` or `WebSocket` puts it back for
 * everything evaluated afterwards.
 */
export function floorGlobalsPresent(scope?: Record<string, unknown>): string[];

/**
 * Take the environment down to the oldest supported Node before evaluating anything, so the
 * artifact is judged against the `engines` range rather than against the build machine.
 *
 * `stubborn` names the globals that could not be removed; a non-empty list means the evaluation
 * would prove less than it claims.
 */
export function restrictToSupportedFloor(scope?: Record<string, unknown>): {
  stubborn: string[];
  restore: () => void;
};
