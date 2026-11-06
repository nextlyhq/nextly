/**
 * A misspelt flag or command is refused with exit 1 and the nearest spelling
 * suggested, on every command the program defines, with the same pointer to
 * `--help` and the same sorted help as the program itself: a command attached
 * after it was built takes the program's settings too.
 *
 * Every case is parsed in-process with Commander's exit turned into a throw, so
 * no action runs and nothing is loaded.
 */
import { CommanderError, type Command } from "commander";
import { describe, expect, it } from "vitest";

import { createProgram } from "../program";

import { commandAt, commandPaths } from "./helpers/answer-only-invocations";

const HELP_HINT = "(use --help for available options)";

/** The program, every command throwing instead of exiting, and what it printed. */
function quietProgram(): { program: Command; printed: () => string } {
  const program = createProgram();
  let printed = "";
  const capture = (command: Command): void => {
    command.exitOverride().configureOutput({
      writeOut: text => {
        printed += text;
      },
      writeErr: text => {
        printed += text;
      },
    });
    command.commands.forEach(capture);
  };
  capture(program);
  return { program, printed: () => printed };
}

/** `nextly <args>`: the exit code Commander ended on, and what it printed. */
async function refused(
  args: string[]
): Promise<{ exitCode: number; printed: string }> {
  const { program, printed } = quietProgram();
  try {
    await program.parseAsync(args, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      return { exitCode: error.exitCode, printed: printed() };
    }
    throw error;
  }
  throw new Error(`nextly ${args.join(" ")} was not refused`);
}

/** `word` with one letter from its middle left out: one edit from it. */
function misspelt(word: string): string {
  const at = Math.floor(word.length / 2);
  return word.slice(0, at) + word.slice(at + 1);
}

const program = createProgram();
const paths = commandPaths(program);

/**
 * What `path` cannot run without: a value for each required argument and
 * mandatory option. Commander refuses their absence before an unknown option,
 * so a case without them would never reach the option it misspells.
 */
function requiredOf(path: string[]): string[] {
  const command = commandAt(program, path);
  return [
    ...command.registeredArguments
      .filter(argument => argument.required)
      .map(() => "x"),
    ...command.options.flatMap(option =>
      option.mandatory && option.long !== undefined ? [option.long, "x"] : []
    ),
  ];
}

/**
 * The flag each command is given misspelt: its first visible long option of
 * its own, or a global one for a command that declares none.
 */
function flagOf(path: string[]): string {
  const command = commandAt(program, path);
  const own = command
    .createHelp()
    .visibleOptions(command)
    .map(option => option.long)
    .find(long => long !== undefined && long !== "--help");
  return own ?? "--verbose";
}

describe("a misspelt flag", () => {
  it("is read from a command list that is there", () => {
    expect(paths.length).toBeGreaterThan(30);
  });

  it.each(paths.map(path => [path.join(" "), path] as const))(
    "nextly %s: refused, exit 1, the nearest flag suggested",
    async (_name, path) => {
      const flag = flagOf(path);
      const { exitCode, printed } = await refused([
        ...path,
        ...requiredOf(path),
        misspelt(flag),
      ]);
      expect(exitCode).toBe(1);
      expect(printed).toContain(
        `error: unknown option '${misspelt(flag)}'\n(Did you mean ${flag}?)`
      );
      expect(printed).toContain(HELP_HINT);
    }
  );
});

describe("a misspelt command", () => {
  it.each(paths.map(path => [path.join(" "), path] as const))(
    "nextly %s, misspelt: refused, exit 1, the command suggested",
    async (_name, path) => {
      const name = path.at(-1) ?? "";
      const { exitCode, printed } = await refused([
        ...path.slice(0, -1),
        misspelt(name),
      ]);
      expect(exitCode).toBe(1);
      expect(printed).toContain(
        `error: unknown command '${misspelt(name)}'\n(Did you mean ${name}?)`
      );
      expect(printed).toContain(HELP_HINT);
    }
  );
});

describe("every command takes the program's settings", () => {
  it.each(paths.map(path => [path.join(" "), path] as const))(
    "nextly %s sorts its help as the program does",
    (_name, path) => {
      expect(commandAt(program, path).configureHelp()).toEqual(
        program.configureHelp()
      );
    }
  );

  it("lists a command's subcommands sorted", () => {
    const media = commandAt(program, ["media"]);
    const listed = media
      .createHelp()
      .visibleCommands(media)
      .map(command => command.name())
      .filter(name => name !== "help");
    expect(listed).toEqual([...listed].sort());
    expect(listed).toContain("reindex-usage");
  });
});
