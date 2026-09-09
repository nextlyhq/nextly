/**
 * What `parseTurboPlan` has to survive: a stream carrying something other than
 * the plan.
 *
 * The case that reached CI is first. `pnpm --silent` removes the reporter's
 * preamble but not a warning raised while READING configuration, and that
 * warning quotes the variable it could not resolve — so the first `{` in the
 * stream sits inside `${NODE_AUTH_TOKEN}` rather than opening the document.
 */

import { describe, expect, it } from "vitest";

import { parseTurboPlan } from "./turbo-plan.mjs";

const PLAN = '{\n  "id": "abc",\n  "turboVersion": "2.9.18",\n  "tasks": []\n}';

/** Verbatim from the run that failed, minus the path. */
const NPMRC_WARNING =
  ' WARN  Issue while reading "/home/runner/work/_temp/.npmrc". ' +
  "Failed to replace env in config: ${NODE_AUTH_TOKEN}";

describe("parseTurboPlan", () => {
  it("reads a plan that arrives on its own", () => {
    expect(parseTurboPlan(PLAN, "probe")).toEqual({
      id: "abc",
      turboVersion: "2.9.18",
      tasks: [],
    });
  });

  it("reads the plan out from under a warning that contains a brace", () => {
    // The regression. Scanning for the first `{` anywhere starts the parse at
    // `{NODE_AUTH_TOKEN}` and fails at position 1, which is what the runner
    // reported while the same command was clean on a laptop.
    expect(NPMRC_WARNING).toContain("{");
    expect(parseTurboPlan(`${NPMRC_WARNING}\n${PLAN}`, "probe")).toEqual({
      id: "abc",
      turboVersion: "2.9.18",
      tasks: [],
    });
  });

  it("reads the plan out from under several noisy lines", () => {
    const noisy = [NPMRC_WARNING, "turbo 2.9.18", "", PLAN].join("\n");
    expect(parseTurboPlan(noisy, "probe").tasks).toEqual([]);
  });

  it("names the command when nothing in the output opens a document", () => {
    expect(() =>
      parseTurboPlan(`${NPMRC_WARNING}\n`, "`pnpm lane:test`")
    ).toThrow(/`pnpm lane:test` did not produce a turbo plan/);
  });

  it("names the command when the document is there but broken", () => {
    // A `SyntaxError` alone describes the text and not where it came from,
    // which is what costs a CI round trip to diagnose.
    expect(() =>
      parseTurboPlan(`${NPMRC_WARNING}\n{ "tasks": [`, "`pnpm lane:test`")
    ).toThrow(/`pnpm lane:test` did not produce a turbo plan/);
  });

  it("does not treat an indented brace as the start of the document", () => {
    // turbo pretty-prints from column zero. An indented brace belongs to
    // something else, and starting there yields a fragment that parses into
    // the wrong shape rather than failing loudly.
    expect(() => parseTurboPlan('  { "not": "the plan" }\n', "probe")).toThrow(
      /did not produce a turbo plan.*opens a JSON document/s
    );
  });
});
