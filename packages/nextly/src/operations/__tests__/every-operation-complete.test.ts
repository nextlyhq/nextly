/**
 * Every operation in core's list is complete: each fact filled and each
 * example parsing against its input schema. The same check runs on fixtures
 * with one fact taken away at a time, so a check that reported nothing would
 * fail here rather than pass on core's list.
 */
import { describe, expect, it } from "vitest";

import { CORE_OPERATIONS } from "../core";
import type { OperationDefinition } from "../definition";
import { operationListProblems } from "../start-up-checks";

import { readOperation, writeOperation } from "./fixtures";

const CORE = { source: { kind: "core" }, operations: CORE_OPERATIONS } as const;

/** The facts every declaration must state, as the type requires them. */
const REQUIRED_FACTS = [
  "id",
  "command",
  "aliases",
  "summary",
  "description",
  "input",
  "output",
  "level",
  "effects",
  "doors",
  "permission",
  "dryRun",
  "long",
  "examples",
  "exitCodes",
  "source",
  "stability",
] as const satisfies readonly (keyof OperationDefinition)[];

/** `op` without `fact`, as plain JavaScript could declare it. */
function without(op: OperationDefinition, fact: string): OperationDefinition {
  return Object.fromEntries(
    Object.entries(op).filter(([key]) => key !== fact)
  ) as unknown as OperationDefinition;
}

describe("every core operation", () => {
  it("is complete, and each of its examples parses against its input schema", async () => {
    expect(await operationListProblems([CORE])).toEqual([]);
  });
});

describe("the completeness check", () => {
  it("passes a complete read and a complete write (control)", async () => {
    expect(
      await operationListProblems([
        {
          source: { kind: "core" },
          operations: [readOperation(), writeOperation()],
        },
      ])
    ).toEqual([]);
  });

  it.each(REQUIRED_FACTS)(
    "refuses a declaration without its %s",
    async fact => {
      const problems = await operationListProblems([
        {
          source: { kind: "core" },
          operations: [without(readOperation(), fact)],
        },
      ]);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.every(problem => problem.startsWith("Operation "))).toBe(
        true
      );
    }
  );

  it.each([
    ["an empty summary", { summary: " " }],
    ["an empty description", { description: "" }],
    ["no command words", { command: [] }],
    ["no doors", { doors: [] }],
    [
      "no examples",
      { examples: [] as unknown as OperationDefinition["examples"] },
    ],
    [
      "a permission with no name",
      { permission: { kind: "permission", name: "" } },
    ],
    [
      "no reason for needing no permission",
      { doors: ["local"], permission: { kind: "project", reason: "" } },
    ],
    [
      "an old name without its releases",
      {
        aliases: [{ command: ["posts", "ls"], addedIn: "", removableFrom: "" }],
      },
    ],
  ] satisfies [string, Partial<OperationDefinition>][])(
    "refuses %s",
    async (_case, change) => {
      const problems = await operationListProblems([
        { source: { kind: "core" }, operations: [readOperation(change)] },
      ]);
      expect(problems).toHaveLength(1);
    }
  );
});
