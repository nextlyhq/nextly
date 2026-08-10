/**
 * Development-time warnings for requirements the type system cannot express.
 *
 * Some contracts in this kit depend on runtime facts — a range slider needs one
 * accessible name per thumb, and how many thumbs there are is the length of an
 * array. TypeScript cannot see that, a doc comment is not checked by anything,
 * and the failure is silent: the control renders, looks finished, and is
 * unusable with a screen reader.
 *
 * **This follows the layer beneath us rather than inventing a policy.** Radix
 * Primitives warns when a Dialog is missing an accessible title or description;
 * React Aria warns for missing labels; React itself warns for missing keys. A
 * wrapper that stays silent about a defect the primitive underneath it reports
 * is less safe than the thing it wraps, and quietly removes a signal consumers
 * already had.
 *
 * The rules this module exists to enforce:
 *
 * - **Development only, proven rather than assumed.** The gate requires a
 *   POSITIVE development signal. Asking instead whether the environment is
 *   production fails open: this package publishes ESM that keeps the runtime
 *   check, and a browser bundle that neither defines nor shims `process`
 *   leaves the comparison false, so every warning would reach real users'
 *   consoles. Silence in an unidentifiable environment is the cheaper mistake
 *   of the two.
 * - **Once per message.** A control that re-renders through a drag would
 *   otherwise emit the same line on every frame, which trains people to ignore
 *   the console — the opposite of the point.
 * - **Never throws.** A missing label degrades; it must not take down the page
 *   that contains it.
 *
 * @module lib/dev-warn
 */

/**
 * Messages already emitted this session.
 *
 * Keyed by the message itself rather than by component instance: the same
 * defect repeated across twenty instances is one thing for the developer to
 * fix, and twenty identical lines make it harder to see, not easier.
 */
const emitted = new Set<string>();

/**
 * The one field this module reads, declared rather than pulled in with
 * `@types/node`.
 *
 * This package targets the browser and deliberately carries no Node types;
 * adding them to reach a single string would widen what every consumer's
 * type-check sees. Bundlers replace `process.env.NODE_ENV` at build time, and
 * `typeof` guards the case where nothing does.
 */
declare const process: { env?: { NODE_ENV?: string } | undefined } | undefined;

/**
 * The environments a warning is allowed to speak in.
 *
 * `test` is here alongside `development` because a suite asserting that a
 * warning fires is checking the same contract a developer relies on; leaving
 * it out would make every such test pass for the wrong reason.
 */
const SPEAKING_ENVIRONMENTS = new Set(["development", "test"]);

/**
 * Whether this runtime has positively identified itself as a development one.
 *
 * Deliberately not `!== "production"`. Bundlers replace `process.env.NODE_ENV`
 * at build time, but nothing obliges them to: a build that leaves `process`
 * undefined would answer "not production" and ship every warning to end users.
 * An unrecognized environment is treated as one to stay quiet in.
 */
function isDevelopmentRuntime(): boolean {
  if (typeof process === "undefined") return false;
  const env = process?.env?.NODE_ENV;
  return env !== undefined && SPEAKING_ENVIRONMENTS.has(env);
}

/**
 * Warn once, in development, about a requirement that is unmet.
 *
 * @param condition - The requirement. Nothing is emitted while this holds.
 * @param message - What is wrong and what to do about it. Written for the
 *   developer who will read it in a console with no other context.
 */
export function devWarnOnce(condition: boolean, message: string): void {
  if (condition) return;
  if (!isDevelopmentRuntime()) return;
  if (emitted.has(message)) return;
  emitted.add(message);
  console.warn(`[@nextlyhq/ui] ${message}`);
}

/**
 * Forget which messages have been emitted.
 *
 * For tests, which need each case to observe its own warning rather than
 * inheriting the suppression an earlier one caused.
 */
export function resetDevWarnings(): void {
  emitted.clear();
}
