/**
 * The first line a command prints, before its code loads.
 *
 * A command's work is loaded when it runs (`lazyAction`), and loading it takes
 * seconds: the database layer, the schema pipeline and the runtime. Until then
 * the terminal would show nothing. So each command declares the line it
 * starts with, and the program prints it as the run begins, once the
 * environment files are read and before any of the command's code is
 * imported:
 * - a command that uses a database names it, with the run's mode and where
 *   its URL came from (`Database: …`), the line it would otherwise print only
 *   once connected;
 * - a command that does not prints a short line saying what it is starting;
 * - a command that answers at once (its own code is light) prints its own
 *   first line, and declares so.
 *
 * Every command that runs an action declares one: a test holds the program
 * to it, so a new command cannot start silent.
 *
 * @module cli/first-line
 */
import type { Command } from "commander";

import { announceMode, announceStart } from "./environment";

/**
 * Whether a command that starts with its own line may reach a database: one
 * that may names it when it connects. Asked of every such command, so a new
 * one cannot leave it unsaid and go untimed to its connection.
 */
export type StartLineDatabase = "may connect" | "no database";

/** The line a command starts with. */
export type FirstLine =
  /** The `Database: …` line naming the database the run uses. */
  | { kind: "database" }
  /** A short line saying what the command is starting, and whether it may connect after it. */
  | { kind: "start"; line: string; database: StartLineDatabase }
  /**
   * The command's own first line, which it prints at once; `pattern` is what
   * that line says, so a warning printed while it loads is not taken for it.
   */
  | { kind: "own"; pattern: RegExp };

/** A command that uses a database starts by naming it. */
export const DATABASE_LINE: FirstLine = { kind: "database" };

/** A command whose own code is light starts with its own first line, one `pattern` matches. */
export function ownLine(pattern: RegExp): FirstLine {
  return { kind: "own", pattern };
}

/** A command that does not start by naming a database starts with `line`. */
export function startLine(
  line: string,
  database: StartLineDatabase
): FirstLine {
  return { kind: "start", line, database };
}

/** Whether a command that starts with `first` may connect to a database. */
export function mayConnect(first: FirstLine): boolean {
  return (
    first.kind === "database" ||
    (first.kind === "start" && first.database === "may connect")
  );
}

const DECLARED = new WeakMap<Command, FirstLine>();

/** Records that `command` starts with `first`, and returns it, for a declaration's chain. */
export function declareFirstLine<C extends Command>(
  command: C,
  first: FirstLine
): C {
  DECLARED.set(command, first);
  return command;
}

/** The line `command` declared it starts with, or `undefined` when it declared none. */
export function declaredFirstLine(command: Command): FirstLine | undefined {
  return DECLARED.get(command);
}

/**
 * Prints the first line `command` declared, through the writer the program set
 * for the run (nothing under `--quiet`). The database line is printed once a
 * run, so the command's own connection does not print it again.
 */
export function printFirstLine(command: Command): void {
  const first = DECLARED.get(command);
  if (first?.kind === "database") announceMode();
  else if (first?.kind === "start") announceStart(first.line);
}
