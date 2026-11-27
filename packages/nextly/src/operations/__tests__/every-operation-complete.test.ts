/**
 * Every operation in core's list is complete: each fact filled and each
 * example parsing against its input schema. The same check runs on fixtures
 * with one fact taken away at a time, so a check that reported nothing would
 * fail here rather than pass on core's list.
 */
import { describe, expect, it } from "vitest";

import { CORE_OPERATIONS } from "../core";
import type { OperationDefinition, RiskLevel } from "../definition";
import { operationListProblems } from "../start-up-checks";

import { readOperation, writeOperation } from "./fixtures";

const CORE = { source: { kind: "core" }, operations: CORE_OPERATIONS } as const;

/**
 * The facts every declaration must state, as the type requires them, each
 * with the words of the refusal its absence gets. Every problem reported must
 * carry those words, so a refusal for some other reason does not count.
 */
const REQUIRED_FACTS = {
  id: "its ID is not dotted",
  command: "its command has no words",
  aliases: "it does not list its old names",
  summary: "it has no summary",
  description: "it has no description for agents",
  input: "its input schema is not a Standard Schema",
  output: "its output schema is not a Standard Schema",
  level: "its level undefined is not one of",
  effects: "its effects do not say whether it",
  doors: "it names no doors",
  permission: "it does not say which permission it needs",
  dryRun: "it does not say whether it supports a dry run",
  long: "it does not say whether it is long-running",
  examples: "it has no example",
  exitCodes: "it does not list the exit codes it adds",
  source: "it says it comes from nowhere",
  stability: "its stability undefined is neither",
} satisfies Partial<Record<keyof OperationDefinition, string>>;

/** `op` without `fact`, as plain JavaScript could declare it. */
function without(op: OperationDefinition, fact: string): OperationDefinition {
  return Object.fromEntries(
    Object.entries(op).filter(([key]) => key !== fact)
  ) as unknown as OperationDefinition;
}

/** `op` with `fact` set to `value`, which its type would not allow. */
function withUntyped(
  op: OperationDefinition,
  fact: string,
  value: unknown
): OperationDefinition {
  return { ...op, [fact]: value } as unknown as OperationDefinition;
}

async function problemsOf(op: OperationDefinition): Promise<string[]> {
  return operationListProblems([
    { source: { kind: "core" }, operations: [op] },
  ]);
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

  it.each(Object.entries(REQUIRED_FACTS))(
    "refuses a declaration without its %s, for that reason alone",
    async (fact, refusal) => {
      const problems = await problemsOf(without(readOperation(), fact));
      expect(problems.length).toBeGreaterThan(0);
      for (const problem of problems) {
        expect(problem).toMatch(/^Operation "[^"]+" from core: /);
        expect(problem).toContain(refusal);
      }
    }
  );

  it.each([
    ["an empty summary", { summary: " " }, "it has no summary"],
    ["an empty description", { description: "" }, "it has no description"],
    ["no command words", { command: [] }, "its command has no words"],
    ["no doors", { doors: [] }, "it names no doors"],
    [
      "a level that is not one of the four",
      { level: "high" as unknown as RiskLevel, dryRun: true },
      'its level "high" is not one of read, draft, change, critical',
    ],
    [
      "no examples",
      { examples: [] as unknown as OperationDefinition["examples"] },
      "it has no example",
    ],
    [
      "a permission with no name",
      { permission: { kind: "permission", name: "" } },
      "its permission has no name",
    ],
    [
      "no reason for needing no permission",
      { doors: ["local"], permission: { kind: "project", reason: "" } },
      "it needs no permission (project) but gives no reason",
    ],
    [
      "an old name without its releases",
      {
        aliases: [{ command: ["posts", "ls"], addedIn: "", removableFrom: "" }],
      },
      "an old name does not say the release",
    ],
  ] satisfies [string, Partial<OperationDefinition>, string][])(
    "refuses %s",
    async (_case, change, refusal) => {
      const problems = await problemsOf(readOperation(change));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(refusal);
    }
  );
});

// A plugin's declaration can be plain JavaScript, so a malformed one is
// refused by name rather than stopping the check with a TypeError.
describe("a declaration plain JavaScript got wrong", () => {
  const noValidate = {
    "~standard": { version: 1, vendor: "handmade" },
  };

  it.each([
    ["raise", [null], "a raise rule is not an object"],
    ["raise", {}, "its raise rules are not a list"],
    ["exitCodes", [null], "an exit code entry is not an object"],
    ["input", noValidate, "its input schema is not a Standard Schema"],
    ["output", noValidate, "its output schema is not a Standard Schema"],
    ["chatExposed", "yes", 'its chat mark is "yes", not true or false'],
  ] satisfies [string, unknown, string][])(
    "refuses %s set to %j by name",
    async (fact, value, refusal) => {
      const problems = await problemsOf(
        withUntyped(readOperation(), fact, value)
      );
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(refusal);
    }
  );

  it.each([
    ["the operation's", "false"],
    ["the operation's", true],
  ])('refuses %s "Always allow" mark set to %j', async (_whose, mark) => {
    const critical = writeOperation({ level: "critical" });
    const problems = await problemsOf(
      withUntyped(critical, "alwaysAllow", mark)
    );
    expect(problems).toEqual([
      `Operation "posts.publish" from core: its "Always allow" mark is ${JSON.stringify(mark)}; it may only be false, or left out`,
    ]);
  });

  it('refuses a raise rule\'s "Always allow" mark set to "false"', async () => {
    const rule = {
      when: "always",
      level: "critical",
      alwaysAllow: "false",
      applies: () => true,
    };
    const problems = await problemsOf(
      withUntyped(writeOperation(), "raise", [rule])
    );
    expect(problems).toEqual([
      'Operation "posts.publish" from core: its raise rule "always" has the "Always allow" mark "false"; it may only be false, or left out',
    ]);
  });

  it("refuses doors given as text on a project operation, by name", async () => {
    const project = readOperation({
      doors: ["local"],
      permission: { kind: "project", reason: "Writes a file in the project." },
    });
    const problems = await problemsOf(withUntyped(project, "doors", "local"));
    expect(problems).toEqual([
      'Operation "posts.list" from core: it names no doors',
    ]);
  });

  it("refuses an entry that is not an operation, naming who registered it", async () => {
    const problems = await operationListProblems([
      {
        source: { kind: "plugin", name: "@acme/plugin-x" },
        operations: [null as unknown as OperationDefinition],
      },
    ]);
    expect(problems).toEqual([
      'An entry from plugin "@acme/plugin-x" is not an operation: null',
    ]);
  });
});
