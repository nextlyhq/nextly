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
 * The action `load` resolves to, imported on the first call and given every
 * argument Commander passes (the arguments, the options, the command).
 */
export function lazyAction<Args extends unknown[]>(
  load: () => Promise<(...args: Args) => unknown>
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    const action = await load();
    await action(...args);
  };
}
