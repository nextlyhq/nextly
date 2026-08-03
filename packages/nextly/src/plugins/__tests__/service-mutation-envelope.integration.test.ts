/**
 * A plugin write answers with the same envelope every other caller gets.
 *
 * `ctx.services.collections` returned the bare row, so a plugin was the one
 * caller of a write that could not see a post-commit hook failure: the REST
 * client gets `warnings` on the response, the Direct API gets it on
 * `MutationResult`, and the plugin facade dropped it because it never opened a
 * collector of its own.
 *
 * A plugin write is its own operation boundary -- `init` runs at boot, with no
 * request around it -- so the scope has to open at the facade or nothing
 * collects at all.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { NextlyError } from "../../errors/nextly-error";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const widgets = () =>
  defineCollection({
    slug: "widgets",
    fields: [text({ name: "title" })],
  });

/**
 * Boot with an optional failing post-commit hook.
 *
 * The hook is registered by the plugin under test rather than on the
 * collection, because the path being covered is a plugin observing a failure
 * its OWN write caused.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function boot(failAfter?: "create" | "update" | "delete"): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let services: any;
  const probe = definePlugin({
    name: "@test/mutation-envelope",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init: c => {
      services = c.services;
      if (!failAfter) return;
      const phase = `after${failAfter[0]!.toUpperCase()}${failAfter.slice(1)}`;
      // The registry's real signature. Registering through an indexed lookup
      // with optional chaining would no-op silently, and the test would then
      // prove only that a write with no failing hook reports no warnings.
      c.hooks.on(phase as "afterCreate", "widgets", () => {
        throw NextlyError.internal({
          logContext: { reason: "test-post-commit-failure" },
        });
      });
    },
  });
  current = await createTestNextly({
    collections: [widgets()],
    plugins: [probe],
  });
  return services;
}

describe("ctx.services.collections write envelope", () => {
  it("returns { message, item } from a create", async () => {
    const services = await boot();

    const result = await services.collections.createEntry(
      "widgets",
      { title: "x" },
      { as: "system" }
    );

    expect(result.message).toBe("Widgets created.");
    expect(result.item.title).toBe("x");
    expect(result.item.id).toBeDefined();
    // Absent, not empty: a plugin branching on presence must not be told about
    // a failure that did not happen.
    expect(result.warnings).toBeUndefined();
  });

  it("returns { message, item } from an update", async () => {
    const services = await boot();
    const created = await services.collections.createEntry(
      "widgets",
      { title: "x" },
      { as: "system" }
    );

    const result = await services.collections.updateEntry(
      "widgets",
      created.item.id,
      { title: "y" },
      { as: "system" }
    );

    expect(result.message).toBe("Widgets updated.");
    expect(result.item.title).toBe("y");
  });

  it("reports the deleted row by id, since there is none left to return", async () => {
    const services = await boot();
    const created = await services.collections.createEntry(
      "widgets",
      { title: "x" },
      { as: "system" }
    );

    const result = await services.collections.deleteEntry(
      "widgets",
      created.item.id,
      { as: "system" }
    );

    expect(result.message).toBe("Widgets deleted.");
    // The facade's delete resolves to `void`, so the id the caller passed is
    // the only thing that can identify what went.
    expect(result.item).toEqual({ id: created.item.id });
  });

  it("carries a post-commit failure the plugin's own write caused", async () => {
    const services = await boot("create");

    const result = await services.collections.createEntry(
      "widgets",
      { title: "x" },
      { as: "system" }
    );

    // The row IS written -- the hook ran after the commit -- so the call
    // resolves rather than rejecting, and the failure travels beside it.
    expect(result.item.title).toBe("x");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      phase: "afterCreate",
      collection: "widgets",
      code: "INTERNAL_ERROR",
    });
  });

  it("does not open a scope for reads", async () => {
    // The reads are deliberately untouched: nothing runs after them that could
    // fail without failing the read, so wrapping them would only add a
    // meaningless envelope to unwrap.
    const services = await boot();
    await services.collections.createEntry(
      "widgets",
      { title: "x" },
      { as: "system" }
    );

    const list = await services.collections.listEntries(
      "widgets",
      {},
      { as: "system" }
    );

    expect(list.message).toBeUndefined();
    expect(list.data).toHaveLength(1);
  });
});
