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

/** The distinct specifiers in one artifact that name a package outside the allow-list. */
export function disallowedSpecifiers(
  source: string,
  fileName: string,
  allowed: Set<string>
): string[];

/**
 * The DOM-only globals present in `scope`, empty on a bare server.
 *
 * A non-empty result means the evaluation check would pass without asserting anything, so the gate
 * refuses to run rather than report it.
 */
export function domGlobalsPresent(scope?: Record<string, unknown>): string[];

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
