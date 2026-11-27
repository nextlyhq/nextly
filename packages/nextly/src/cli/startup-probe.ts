/**
 * The start-up probe: a variable that ends a run at a named point, so the
 * start-up timing measures how long a command takes to get there.
 *
 * Two points, each with a value of the variable and a line of its own, so a
 * run stopped at one never goes on to the other: a command's code has loaded,
 * and a command has connected to its database. The second is what a lazy
 * import cannot hide: code a command loads after the first, on its way to the
 * database, is in the second's time. Not documented for users beyond the exit
 * code; without the variable a run is unchanged.
 *
 * @module cli/startup-probe
 */

/** The variable that names the point a run ends at. */
export const STARTUP_PROBE_ENV = "NEXTLY_STARTUP_PROBE";

/** A point a run can be ended at, as the variable's value. */
export type StartupProbePoint = "loaded" | "connected";

/** The line a run ended at each point writes there. */
export const STARTUP_PROBE_LINES: Readonly<Record<StartupProbePoint, string>> =
  {
    loaded: "nextly: code loaded",
    connected: "nextly: database connected",
  };

/**
 * The code a run under the start-up probe exits with, used by no command for
 * anything else: a run stopped before its work never passes for one that did
 * it, so a probe variable left set where a command must really run fails it.
 */
export const STARTUP_PROBE_EXIT = 4;

/**
 * Where the probe names `point`, gives up what the run holds (`release`), says
 * the run has come that far and ends it with the probe's own code, so a timed
 * run does none of the work that follows, the program's after-action steps
 * never start, and the run cannot pass for one that did its work. Otherwise
 * does nothing.
 */
export async function endAtProbe(
  point: StartupProbePoint,
  release?: () => Promise<void>
): Promise<void> {
  if (process.env[STARTUP_PROBE_ENV] !== point) return;
  // What cannot be given up goes with the process: the run ends all the same.
  await release?.().catch(() => {});
  // Standard error may be a pipe, whose writes finish later, and an exit drops
  // what is still pending: the run ends once the line is out.
  await new Promise<void>(resolve => {
    process.stderr.write(`${STARTUP_PROBE_LINES[point]}\n`, () => resolve());
  });
  // STARTUP_PROBE_EXIT, written out: a status worked out at run time could be a
  // failure's 1, which a command may end with only through the error shape.
  process.exit(4);
}
