/**
 * Development-time warnings for requirements nothing else can check.
 *
 * The editor's stylesheet supplements the design system's rather than restating
 * it, so the shell renders correctly only when the host has loaded BOTH. Nothing
 * at build time can see whether it did: the second sheet is a side-effect import
 * in the host's own application, and its absence produces a shell that mounts,
 * carries every class it should, and merely looks wrong — the most expensive
 * kind of failure to trace back to a missing import.
 *
 * `@nextlyhq/ui` has a module of the same shape and keeps it private, so this is
 * a second instance of the pattern rather than a second copy of an answer: the
 * two warn about different contracts and name different packages. The rules are
 * taken from it deliberately, because they are the ones that make a warning
 * useful rather than noise.
 *
 * - **Development only, proven rather than assumed.** The gate requires a
 *   POSITIVE development signal. Asking whether the environment is production
 *   fails open — a browser bundle that never defines `process` leaves that
 *   comparison false, and every warning would reach real users' consoles.
 * - **Once per message.** The shell re-renders on every panel drag; the same
 *   line on every frame trains people to ignore the console.
 * - **Never throws.** A missing stylesheet degrades the editor's appearance. It
 *   must not take down the page.
 *
 * @module dev-warn
 */

/** Messages already emitted this session, keyed by the message itself. */
const emitted = new Set<string>();

/**
 * The one field this module reads, declared rather than pulled in with
 * `@types/node`: this package targets the browser, and bundlers replace
 * `process.env.NODE_ENV` at build time.
 */
declare const process: { env?: { NODE_ENV?: string } | undefined } | undefined;

/**
 * The environments a warning may speak in.
 *
 * `test` sits alongside `development` so a suite asserting that a warning fires
 * is exercising the same path a developer relies on, rather than passing because
 * the gate silenced it.
 */
const SPEAKING_ENVIRONMENTS = new Set(["development", "test"]);

/** Whether this runtime has positively identified itself as a development one. */
function isDevelopmentRuntime(): boolean {
  if (typeof process === "undefined") return false;
  const env = process?.env?.NODE_ENV;
  return env !== undefined && SPEAKING_ENVIRONMENTS.has(env);
}

/**
 * Warn once, in development, about a requirement that is unmet.
 *
 * @param condition - The requirement. Nothing is emitted while this holds.
 * @param message - What is wrong and what to do about it, written for someone
 *   reading a console with no other context.
 */
export function devWarnOnce(condition: boolean, message: string): void {
  if (condition) return;
  if (!isDevelopmentRuntime()) return;
  if (emitted.has(message)) return;
  emitted.add(message);
  console.warn(`[@nextlyhq/builder] ${message}`);
}

/**
 * Forget which messages have been emitted.
 *
 * For tests, which need each case to observe its own warning rather than
 * inheriting an earlier one's suppression.
 */
export function resetDevWarnings(): void {
  emitted.clear();
}
