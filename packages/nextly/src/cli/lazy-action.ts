/**
 * A command's action, loaded when the command runs.
 *
 * Each command is declared in a light module (its name, arguments, options and
 * help) and does its work in another, which imports the database layer, the
 * schema pipeline and the rest. Declaring every command must not load that
 * work: `--version`, `--help`, a command's `--help` and an unknown command
 * build the whole program and run no action, so they answer without it.
 *
 * @module cli/lazy-action
 */

/**
 * The variable that, set to `loaded`, stops a run once its command's code has
 * loaded: the start-up timing measures how long that takes. Not documented for
 * users beyond its exit code; without it a run is unchanged.
 */
export const STARTUP_PROBE_ENV = "NEXTLY_STARTUP_PROBE";

/** The line a run under the start-up probe writes once its command's code has loaded. */
export const CODE_LOADED_LINE = "nextly: code loaded";

/**
 * The code a run under the start-up probe exits with, used by no command for
 * anything else: a run stopped before its work never passes for one that did
 * it, so a probe variable left set where a command must really run fails it.
 */
export const STARTUP_PROBE_EXIT = 4;

/**
 * The action `load` resolves to, imported on the first call and given every
 * argument Commander passes (the arguments, the options, the command).
 */
export function lazyAction<Args extends unknown[]>(
  load: () => Promise<(...args: Args) => unknown>
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    const action = await load();
    await endAtProbe();
    await action(...args);
  };
}

/**
 * Under the start-up probe, says the command's code has loaded and ends the
 * run there with the probe's own code, so a timed run does none of the
 * command's work, the program's after-action steps never start, and the run
 * cannot pass for one that did its work. Otherwise does nothing.
 */
async function endAtProbe(): Promise<void> {
  if (process.env[STARTUP_PROBE_ENV] !== "loaded") return;
  // Standard error may be a pipe, whose writes finish later, and an exit drops
  // what is still pending: the run ends once the line is out.
  await new Promise<void>(resolve => {
    process.stderr.write(`${CODE_LOADED_LINE}\n`, () => resolve());
  });
  // STARTUP_PROBE_EXIT, written out: a status worked out at run time could be a
  // failure's 1, which a command may end with only through the error shape.
  process.exit(4);
}
