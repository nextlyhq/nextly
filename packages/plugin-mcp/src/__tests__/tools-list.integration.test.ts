/**
 * The tools an agent is offered, as `tools/list` answers a key: exactly the reads of review
 * state and one submit for review, and nothing that approves, requests changes, publishes,
 * assigns, takes another step or changes a workflow.
 *
 * The set is asserted whole, so a tool added later fails here and its addition is a decision
 * someone makes on purpose. The name and input guards below stand beside it for the case where
 * the set is changed deliberately: a renamed or added tool must still not be one of those, and no
 * input may reach a way past review or past the access check.
 *
 * SQLite only: which tools a server registers does not depend on the database.
 */
import type { TestNextly } from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  bearer,
  bootReview,
  keyGranting,
  listTools,
  type ListedTool,
} from "./helpers";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The tools listed to a key holding every grant the review tools ask about. */
async function listed(): Promise<ListedTool[]> {
  const { handle, handlers } = await bootReview("sqlite");
  current = handle;
  const { key } = await keyGranting(handle, "all", [
    "read-posts",
    "update-posts",
    "sign-off-posts",
  ]);
  return listTools(handlers, bearer(key));
}

/** What a name must never say: a step the agent may not take, or a change it may not make. */
const FORBIDDEN_NAME =
  /approve|request.?changes|publish|assign|settings|take.?step|definition/i;

/** Inputs that would reach a way past review, past the access check, or name another caller. */
const BYPASS_KEYS = [
  "withoutReview",
  "overrideAccess",
  "trusted",
  "apiKeyId",
  "as",
];

/** Every property name declared anywhere in a JSON Schema, however deeply nested. */
function propertyNames(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(propertyNames);
  if (typeof schema !== "object" || schema === null) return [];
  const record = schema as Record<string, unknown>;
  const own =
    typeof record.properties === "object" && record.properties !== null
      ? Object.keys(record.properties)
      : [];
  return [...own, ...Object.values(record).flatMap(propertyNames)];
}

describe("tools/list", () => {
  it("lists exactly the five tools", async () => {
    const names = (await listed()).map(tool => tool.name).sort();

    expect(names).toEqual([
      "get_initial_context",
      "get_review_state",
      "get_workflow",
      "list_waiting_for_review",
      "submit_for_review",
    ]);
  });

  it("lists no tool that approves, requests changes, publishes, assigns or changes a workflow", async () => {
    const tools = await listed();

    // The control: the guard below is vacuous over an empty listing.
    expect(tools.length).toBeGreaterThan(0);
    expect(
      tools.map(tool => tool.name).filter(n => FORBIDDEN_NAME.test(n))
    ).toEqual([]);
  });

  it("takes no input that reaches past review or the access check", async () => {
    const tools = await listed();
    // Every input each tool declares, nested ones included, named `<tool>.<input>`.
    const declared = tools.flatMap(tool =>
      propertyNames(tool.inputSchema).map(name => `${tool.name}.${name}`)
    );

    // The control, over the tools that do take inputs: the walk finds the one that writes'
    // own inputs, and one nested inside its document's alternatives, which is as deep as a
    // bypass key could hide. Finding none of the keys below is then not a walk that sees nothing.
    expect(declared).toEqual(
      expect.arrayContaining([
        "submit_for_review.comment",
        "submit_for_review.seen",
        "submit_for_review.collection",
        "get_workflow.single",
      ])
    );
    expect(
      declared.filter(name => BYPASS_KEYS.includes(name.split(".")[1] ?? ""))
    ).toEqual([]);
  });

  it("marks the reads read-only, and the submit a write that destroys nothing and is not repeatable", async () => {
    const byName = new Map(
      (await listed()).map(tool => [tool.name, tool.annotations])
    );

    for (const read of [
      "get_workflow",
      "get_review_state",
      "list_waiting_for_review",
    ]) {
      expect(byName.get(read), read).toMatchObject({ readOnlyHint: true });
    }
    expect(byName.get("submit_for_review")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
  });
});
