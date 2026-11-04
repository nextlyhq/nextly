/**
 * The invocations the CLI answers from itself alone, read from the program's
 * own command list, so a command is covered by being defined. Shared by the
 * test that holds them to reading nothing and the script that times them.
 */
import type { Command } from "commander";

/** A command the program does not define, which it refuses before any action. */
export const UNKNOWN_COMMAND = "no-such-command";

/** Every command under `command`, as the words that name it on the command line. */
export function commandPaths(
  command: Command,
  prefix: string[] = []
): string[][] {
  return command.commands.flatMap(child => {
    const path = [...prefix, child.name()];
    return [path, ...commandPaths(child, path)];
  });
}

/** The command `path` names under `program`, as `commandPaths` lists it. */
export function commandAt(program: Command, path: readonly string[]): Command {
  let command = program;
  for (const name of path) {
    const child = command.commands.find(each => each.name() === name);
    if (child === undefined) {
      throw new Error(`no command "${path.join(" ")}"`);
    }
    command = child;
  }
  return command;
}

/**
 * `--version`, `--help`, an unknown command and every command's `--help`,
 * each as the arguments after `nextly`.
 */
export function answerOnlyInvocations(program: Command): string[][] {
  return [
    ["--version"],
    ["--help"],
    [UNKNOWN_COMMAND],
    ...commandPaths(program).map(path => [...path, "--help"]),
  ];
}

/**
 * Why `run` is not the answer `args` asks for, or `undefined` when it is: the
 * unknown command refused; otherwise exit 0 with output on stdout, a
 * command's help naming that command in its usage line.
 */
export function wrongAnswer(
  args: readonly string[],
  run: { status: number | null; stdout: string; stderr: string }
): string | undefined {
  if (args[0] === UNKNOWN_COMMAND) {
    return run.status === 1 && run.stderr.includes("unknown command")
      ? undefined
      : `expected the unknown command refused, got exit ${String(run.status)}`;
  }
  if (run.status !== 0) {
    return `exit ${String(run.status)}: ${run.stderr.trim()}`;
  }
  if (run.stdout.trim() === "") return "printed nothing";
  const path = args.slice(0, -1);
  if (args.at(-1) === "--help" && path.length > 0) {
    const usage = `Usage: nextly ${path.join(" ")}`;
    if (!run.stdout.includes(usage)) return `no "${usage}" line`;
  }
  return undefined;
}
