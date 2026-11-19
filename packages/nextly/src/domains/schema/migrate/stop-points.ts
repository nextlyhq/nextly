/**
 * Named points in a `nextly migrate` run where a test stops it, to prove what a run stopped there
 * leaves behind: before and after each statement of a file, once a file is recorded applied, and
 * after each kind of a dropped entity's rows is removed.
 *
 * A test stops a run in one of two ways. In process, through the run's dependencies
 * (`MigrateCoreDeps.stopAt`), installed for that run alone, which may throw to fail the run there.
 * As a real process, with {@link KILL_AT_VARIABLE} naming the point, where the process kills
 * itself the moment it reaches it. The variable is honoured only while `NODE_ENV` is `test`, so a
 * stray one can never stop a production run.
 *
 * @module domains/schema/migrate/stop-points
 */

/** What a test runs at each point a run reaches; one that throws fails the run there. */
export type StopPointHook = (point: string) => void | Promise<void>;

/** The variable naming the point where a `nextly migrate` process run by a test kills itself. */
export const KILL_AT_VARIABLE = "NEXTLY_TEST_KILL_AT";

let installed: StopPointHook | undefined;

/** Runs `run` with `hook` called at each stop point it reaches, and the earlier hook back after. */
export async function withStopPoints<T>(
  hook: StopPointHook | undefined,
  run: () => Promise<T>
): Promise<T> {
  if (hook === undefined) return run();
  const earlier = installed;
  installed = hook;
  try {
    return await run();
  } finally {
    installed = earlier;
  }
}

/**
 * Marks that the run has reached `point`: the installed hook runs, and a test's process naming the
 * point in {@link KILL_AT_VARIABLE} kills itself here.
 */
export async function reachStopPoint(
  point: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  await installed?.(point);
  if (env.NODE_ENV === "test" && env[KILL_AT_VARIABLE] === point) {
    process.kill(process.pid, "SIGKILL");
  }
}
