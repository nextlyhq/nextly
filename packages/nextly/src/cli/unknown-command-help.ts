/**
 * A help flag after a command name the program does not define is refused as
 * the unknown command it is, never answered with the parent's help.
 *
 * Commander answers `--help` before it looks for the subcommand an argument
 * names. So on a release without `nextly events`, `nextly events abandon
 * --help` printed the program's help and exited 0, and on one without
 * `nextly plugins add`, `nextly plugins add --help` printed the plugins
 * group's: the reader saw a help screen, not the command they asked about,
 * and no word that it is missing. Without the flag the same line is refused
 * as an unknown command, with the nearest name suggested; with it, now too.
 *
 * @module cli/unknown-command-help
 */
import type { Command, ParseOptionsResult } from "commander";

/** The help flags, as Commander declares them on every command here. */
const HELP_FLAGS: ReadonlySet<string> = new Set(["-h", "--help"]);

/** Whether `command` is a group: subcommands, and no arguments of its own. */
function isGroup(command: Command): boolean {
  return (
    command.commands.length > 0 && command.registeredArguments.length === 0
  );
}

/**
 * Whether `operands`, read down from `command`, reach a group and then a name
 * it has no subcommand for. The path stops, answering no, at a command that
 * is not a group, whose next operand is its own argument, and at the help
 * command, which names a command itself.
 */
function namesUnknownCommand(
  command: Command,
  operands: readonly string[]
): boolean {
  let at = command;
  for (const name of operands) {
    if (!isGroup(at) || name === "help") return false;
    const child = at.commands.find(
      each => each.name() === name || each.aliases().includes(name)
    );
    if (child === undefined) return true;
    at = child;
  }
  return false;
}

/**
 * Makes every group under `command`, at any depth, refuse a name it has no
 * subcommand for when a help flag follows: the flag is left out of what the
 * group parsed, so Commander reaches its own unknown-command refusal, with
 * the nearest name suggested, and exit 1, as it does without the flag.
 *
 * The program reads every leading operand (`nextly plugins ad --help` gives
 * it `plugins` and `ad`), so the names are followed down from the group that
 * parsed them; a group reached later reads its own.
 *
 * Applied to the instances once every command is attached, rather than
 * through a subclass, so a command built on its own and attached afterwards
 * (`attachCommand`) is covered as one declared in place is.
 */
export function refuseHelpForUnknownCommands(command: Command): void {
  if (isGroup(command)) {
    const parseOptions = command.parseOptions.bind(command);
    command.parseOptions = (argv: string[]): ParseOptionsResult => {
      const parsed = parseOptions(argv);
      if (!namesUnknownCommand(command, parsed.operands)) return parsed;
      return {
        operands: parsed.operands,
        unknown: parsed.unknown.filter(arg => !HELP_FLAGS.has(arg)),
      };
    };
  }
  for (const child of command.commands) refuseHelpForUnknownCommands(child);
}
