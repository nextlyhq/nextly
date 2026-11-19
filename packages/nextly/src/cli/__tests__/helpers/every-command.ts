/**
 * Every command the CLI defines, as an invocation that runs its action and
 * changes nothing a test must put back: read from the program's own command
 * list, so a command is covered by being defined.
 *
 * Each is given a placeholder for every argument and option it requires, and
 * `--dry-run` where it offers one. A command with neither `--dry-run` nor
 * `--apply` only reads, and one with `--apply` previews unless given it.
 */
import type { Command } from "commander";

import { commandAt, commandPaths } from "./answer-only-invocations";

/** The arguments after `nextly` for each command that runs an action. */
export function everyCommandInvocation(program: Command): string[][] {
  return commandPaths(program)
    .filter(path => commandAt(program, path).commands.length === 0)
    .map(path => {
      const command = commandAt(program, path);
      return [
        ...path,
        ...command.registeredArguments
          .filter(argument => argument.required)
          .map(() => "x"),
        ...command.options.flatMap(option =>
          option.mandatory && option.long !== undefined
            ? [option.long, "x"]
            : []
        ),
        ...(command.options.some(option => option.long === "--dry-run")
          ? ["--dry-run"]
          : []),
        "--non-interactive",
      ];
    });
}

/** Runs `work` over `items`, at most `limit` at a time, keeping their order. */
export async function inTurns<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index] as T);
      }
    })
  );
  return results;
}
