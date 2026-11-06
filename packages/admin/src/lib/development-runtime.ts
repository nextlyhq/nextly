/**
 * Whether this runtime has identified itself as a development one, the
 * question every development-only warning in the admin asks before it speaks.
 *
 * A module of its own rather than part of `lib/forms/label-landing`, whose
 * check is its first reader: a dashboard card asks only this, and importing it
 * from there carried the whole label check into every page that draws a card.
 *
 * @module lib/development-runtime
 */

/**
 * The environments a development warning is allowed to speak in.
 *
 * `test` sits beside `development` because a suite asserting that the warning
 * fires is exercising the same contract a developer relies on; omitting it
 * would make every such test pass for the wrong reason.
 */
const SPEAKING_ENVIRONMENTS = new Set(["development", "test"]);

/**
 * Whether this runtime has positively identified itself as a development one.
 *
 * Deliberately not `!== "production"`. Asking whether the environment is
 * production answers "no" when `NODE_ENV` is absent entirely, which would ship
 * every warning to real users' consoles. Silence in an environment that
 * cannot be identified is the cheaper of the two mistakes.
 */
export function isDevelopmentRuntime(): boolean {
  const env = process.env.NODE_ENV;
  return env !== undefined && SPEAKING_ENVIRONMENTS.has(env);
}
