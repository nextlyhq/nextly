/**
 * The CLI's help speaks to the person running it.
 *
 * A label such as "(D70)" names an entry in this project's own decision log,
 * which nobody running `nextly` can look up; three commands' help ended in one.
 * Every command's rendered help is read, as `nextly <command> --help` prints it,
 * so a label added to any description, option or argument is caught wherever
 * it lands.
 *
 * @module cli/__tests__/help-has-no-internal-labels.test
 */
import type { Command } from "commander";
import { describe, expect, it } from "vitest";

import { createProgram } from "../program";

/** A decision-log label in parentheses: a letter or two, a number, maybe a letter. */
const LABEL = /\((?:[A-Z]{1,2})-?\d+[a-z]?\)/;

/** Every command under `program`, itself included, with its full name. */
function everyCommand(program: Command, prefix = ""): [string, Command][] {
  const name = prefix ? `${prefix} ${program.name()}` : program.name();
  return [
    [name, program],
    ...program.commands.flatMap(child => everyCommand(child, name)),
  ];
}

describe("the nextly CLI's help", () => {
  const commands = everyCommand(createProgram());

  it("covers the commands that carried a label", () => {
    // The population, by name: a walk that found nothing would pass the check below.
    const names = commands.map(([name]) => name);
    for (const expected of ["nextly add", "nextly plugins", "nextly prune"]) {
      expect(names).toContain(expected);
    }
  });

  it.each(commands.map(([name, command]) => [name, command] as const))(
    "of `%s` names no internal decision label",
    (_name, command) => {
      expect(command.helpInformation()).not.toMatch(LABEL);
    }
  );
});
