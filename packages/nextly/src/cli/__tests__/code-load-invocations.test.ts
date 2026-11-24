/**
 * The runs the start-up timing stops once their command's code has loaded.
 *
 * Every command that runs an action is timed, so a command cannot ship with
 * its load untimed, a parent with an action of its own included; a parent
 * that only holds subcommands answers with its help, loads nothing and ends
 * with exit 1, so timing it would only fail the check.
 *
 * What would separate a correct list from a broken one:
 * - a command that runs an action left out (its load never timed), a parent
 *   with an action of its own among them, which the program has none of today
 *   and the first case below builds;
 * - a parent put in (a run that can only fail the check).
 */
import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { commandAt, commandPaths } from "./helpers/answer-only-invocations";
import { hasAction } from "./helpers/first-line-invocations";
// The list the start-up timing script loads, from the one module it loads it from.
import {
  codeLoadInvocations,
  commandPathOf,
  createProgram,
} from "./helpers/startup-checks";

const program = createProgram();
const timed = codeLoadInvocations(program);
const named = timed.map(args => commandPathOf(program, args).join(" "));

describe("whether a command has an action of its own", () => {
  // Built here rather than read from the program, which has no parent with an
  // action of its own: Commander runs such a parent's action, not its help.
  const built = new Command();
  const parentWithAction = built.command("sync").action(() => {});
  parentWithAction.command("status").action(() => {});
  const parentOnly = built.command("media");
  parentOnly.command("orphans").action(() => {});

  it("is told by the action, not by whether it holds subcommands", () => {
    expect(hasAction(parentWithAction)).toBe(true);
    expect(hasAction(parentOnly)).toBe(false);
    expect(hasAction(parentOnly.commands[0])).toBe(true);
  });
});

describe("the runs timed to their code loaded", () => {
  it("time every command with an action of its own", () => {
    const leaves = commandPaths(program)
      .filter(path => hasAction(commandAt(program, path)))
      .map(path => path.join(" "));
    expect(leaves.length).toBeGreaterThan(30);
    expect(leaves.filter(name => !named.includes(name))).toEqual([]);
  });

  it("time no parent without one, which only answers with its help", () => {
    const parents = commandPaths(program)
      .filter(path => !hasAction(commandAt(program, path)))
      .map(path => path.join(" "));
    // The program has parents, so their absence below is a choice, not an empty set.
    expect(parents).toContain("telemetry");
    expect(named.filter(name => parents.includes(name))).toEqual([]);
  });
});
