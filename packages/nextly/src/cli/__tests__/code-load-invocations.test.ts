/**
 * The runs the start-up timing stops once their command's code has loaded.
 *
 * Every command that runs an action is timed, so a command cannot ship with
 * its load untimed; a parent that only holds subcommands answers with its
 * help, loads nothing and ends with exit 1, so timing it would only fail the
 * check.
 *
 * What would separate a correct list from a broken one:
 * - a command that runs an action left out (its load never timed);
 * - a parent put in (a run that can only fail the check).
 */
import { describe, expect, it } from "vitest";

import { commandPaths } from "./helpers/answer-only-invocations";
import { runsAnAction } from "./helpers/first-line-invocations";
// The list the start-up timing script loads, from the one module it loads it from.
import {
  codeLoadInvocations,
  commandPathOf,
  createProgram,
} from "./helpers/startup-checks";

const program = createProgram();
const timed = codeLoadInvocations(program);
const named = timed.map(args => commandPathOf(program, args).join(" "));

describe("the runs timed to their code loaded", () => {
  it("time every command that runs an action", () => {
    const leaves = commandPaths(program)
      .filter(path => runsAnAction(program, path))
      .map(path => path.join(" "));
    expect(leaves.length).toBeGreaterThan(30);
    expect(leaves.filter(name => !named.includes(name))).toEqual([]);
  });

  it("time no parent, which only answers with its help", () => {
    const parents = commandPaths(program)
      .filter(path => !runsAnAction(program, path))
      .map(path => path.join(" "));
    // The program has parents, so their absence below is a choice, not an empty set.
    expect(parents).toContain("telemetry");
    expect(named.filter(name => parents.includes(name))).toEqual([]);
  });
});
