/**
 * What a command's exit status means, as the end of its `--help` says it: the
 * codes every command shares, then the codes that command adds. Each command's
 * own codes live here, by its full name, so its help and this list are one
 * thing.
 *
 * @module cli/exit-codes
 */
import type { Command } from "commander";

/** The codes every command ends with. */
const SHARED_EXIT_CODES =
  "0 done or nothing to do · 1 failed or refused · 130 interrupted";

/**
 * The codes a command adds to the shared ones, keyed by its name as typed after
 * `nextly` (a subcommand with its parent's name before it, as `media orphans`).
 */
export const COMMAND_EXIT_CODES: Readonly<Record<string, readonly string[]>> = {
  // `migrateExitCode`: an edited applied file is told apart from any other
  // failure.
  migrate: ["2 an applied migration file was edited since it ran"],
  // `COMPONENT_MAP_CHECK_EXIT`.
  "generate:types": [
    "with --check: 2 the component map is out of step with the config, 1 it could not be checked",
  ],
};

/** The block that ends a help: the shared codes, then `own`. */
function exitCodesHelp(own: readonly string[]): string {
  return [
    "",
    "Exit codes:",
    `  ${SHARED_EXIT_CODES}`,
    ...own.map(line => `  ${line}`),
  ].join("\n");
}

/** Ends the help of every command under `parent`, at any depth, with its exit codes. */
function addCommandsExitCodesHelp(
  parent: Command,
  prefix: readonly string[]
): void {
  for (const command of parent.commands) {
    const path = [...prefix, command.name()];
    command.addHelpText(
      "after",
      exitCodesHelp(COMMAND_EXIT_CODES[path.join(" ")] ?? [])
    );
    addCommandsExitCodesHelp(command, path);
  }
}

/**
 * Ends the program's help with the shared codes, and every command's, at any
 * depth, with its own. Run once every command is registered, so the block
 * comes after any help text the program or a command adds itself.
 */
export function addExitCodesHelp(program: Command): void {
  program.addHelpText("after", exitCodesHelp([]));
  addCommandsExitCodesHelp(program, []);
}
