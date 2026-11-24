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
 * users; without it a run is unchanged.
 */
export const STARTUP_PROBE_ENV = "NEXTLY_STARTUP_PROBE";

/** The line a run under the start-up probe writes once its command's code has loaded. */
export const CODE_LOADED_LINE = "nextly: code loaded";

/**
 * The action `load` resolves to, imported on the first call and given every
 * argument Commander passes (the arguments, the options, the command).
 */
export function lazyAction<Args extends unknown[]>(
  load: () => Promise<(...args: Args) => unknown>
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    const action = await load();
    endAtProbe();
    await action(...args);
  };
}

/**
 * Under the start-up probe, says the command's code has loaded and ends the
 * run there, so a timed run does none of the command's work and the program's
 * after-action steps never start. Otherwise does nothing.
 */
function endAtProbe(): void {
  if (process.env[STARTUP_PROBE_ENV] !== "loaded") return;
  process.stderr.write(`${CODE_LOADED_LINE}\n`);
  process.exit(0);
}
