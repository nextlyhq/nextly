/**
 * The CLI's help speaks to the person running it.
 *
 * A label such as "(D70)" names an entry in this project's own decision log,
 * which nobody running `nextly` can look up; three commands' help ended in one.
 * Every command's help is read as `nextly <command> --help` prints it, custom
 * help blocks included, so a label added to any description, option, argument
 * or extra help text is caught wherever it lands.
 *
 * @module cli/__tests__/help-has-no-internal-labels.test
 */
import type { Command } from "commander";
import { describe, expect, it } from "vitest";

import { createProgram } from "../program";

/**
 * A decision-log label inside parentheses, alone or among others: a letter or
 * two, a number, maybe a letter, as in "(D70)", "(C7/D16)", "(B3/T1, D35)" or
 * "(D56, harness hook-wired)".
 */
const LABEL = /\([^()]*?(?<![\w-])[A-Z]{1,2}-?\d+[a-z]?(?![\w-])[^()]*\)/;

/** Every command under `program`, itself included, with its full name. */
function everyCommand(program: Command, prefix = ""): [string, Command][] {
  const name = prefix ? `${prefix} ${program.name()}` : program.name();
  return [
    [name, program],
    ...program.commands.flatMap(child => everyCommand(child, name)),
  ];
}

/** What `--help` prints for a command: its help and any text added around it. */
function printedHelp(command: Command): string {
  let printed = "";
  command.configureOutput({
    writeOut: text => {
      printed += text;
    },
    writeErr: text => {
      printed += text;
    },
  });
  command.outputHelp();
  return printed;
}

describe("the label pattern", () => {
  it.each([
    "(D70)",
    "Drop it (D14)",
    "(P2b)",
    "(C7/D16)",
    "(B3/T1, D35)",
    "(D56, harness hook-wired)",
  ])("finds a label in %s", text => {
    expect(text).toMatch(LABEL);
  });

  it.each([
    "(default: false)",
    "(retained by default)",
    "(e.g. 3000)",
    "(UTF-8)",
  ])("finds none in %s", text => {
    expect(text).not.toMatch(LABEL);
  });
});

describe("the nextly CLI's help", () => {
  const commands = everyCommand(createProgram());

  it("covers the commands that carried a label", () => {
    // The population, by name: a walk that found nothing would pass the check below.
    const names = commands.map(([name]) => name);
    for (const expected of ["nextly add", "nextly plugins", "nextly prune"]) {
      expect(names).toContain(expected);
    }
  });

  it("reads the custom help text a command adds, not only its generated help", () => {
    // The root command adds an Examples block with addHelpText, which
    // helpInformation() leaves out.
    const [, root] = commands[0];
    expect(root.helpInformation()).not.toContain("Examples:");
    expect(printedHelp(root)).toContain("Examples:");
  });

  it.each(commands.map(([name, command]) => [name, command] as const))(
    "of `%s` names no internal decision label",
    (_name, command) => {
      expect(printedHelp(command)).not.toMatch(LABEL);
    }
  );
});
