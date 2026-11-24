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

import {
  DATABASE_LINE,
  declareFirstLine,
  startLine,
  type FirstLine,
} from "../first-line";

import { commandAt, commandPaths } from "./helpers/answer-only-invocations";
import { connectRunsOf, hasAction } from "./helpers/first-line-invocations";
// The list the start-up timing script loads, from the one module it loads it from.
import {
  codeLoadInvocations,
  commandPathOf,
  connectInvocations,
  createProgram,
  wrongFirstLine,
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

  it("decides the first line it is held to: its own, or its help", () => {
    declareFirstLine(parentWithAction, startLine("Syncing...", "no database"));
    const help = "Usage: nextly sync [options]";
    expect(wrongFirstLine(built, ["sync"], "Syncing...")).toBeUndefined();
    expect(wrongFirstLine(built, ["sync"], help)).toBeDefined();
    expect(wrongFirstLine(built, ["media"], help)).toBeUndefined();
    expect(wrongFirstLine(built, ["media"], "Syncing...")).toBeDefined();
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

describe("the runs timed to their connection", () => {
  const connect = connectInvocations(program);
  const timedNames = connect.timed.map(args =>
    commandPathOf(program, args).join(" ")
  );

  it("are the commands that name a database, and those that may connect after a line of their own", () => {
    expect(timedNames).toEqual(
      expect.arrayContaining([
        "migrate:status",
        "db:sync",
        "setup-token",
        "build",
      ])
    );
  });

  it("follow what each command declares, with no list of their own", () => {
    const built = new Command();
    const declare = (name: string, first: FirstLine) =>
      declareFirstLine(
        built.command(name).action(() => {}),
        first
      );
    // Named as the real commands are, for the arguments the table gives them.
    for (const name of named) {
      const [parent, child] = name.split(" ");
      if (child === undefined) declare(parent, startLine("...", "no database"));
    }
    const at = (name: string) => commandAt(built, [name]);
    declareFirstLine(at("init"), startLine("...", "may connect"));
    declareFirstLine(at("migrate"), DATABASE_LINE);

    const { timed: runs, untimed } = connectRunsOf(
      built,
      built.commands.map(command => [command.name()])
    );
    expect(runs.map(([name]) => name).sort()).toEqual(["init", "migrate"]);
    expect(untimed).toContain("setup-token");
  });

  it("leave out, by name, every other command, so none runs its work to the end", () => {
    // Scaffolding a project would do so.
    expect(connect.untimed).toEqual(
      expect.arrayContaining(["init", "generate:types"])
    );
    expect([...timedNames, ...connect.untimed].sort()).toEqual(
      [...named].sort()
    );
  });
});
