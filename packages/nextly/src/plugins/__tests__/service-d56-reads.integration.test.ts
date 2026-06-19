/**
 * D56 reads/writes end-to-end through `ctx.services.collections`, enabled by the
 * P7b harness hook-registry fix.
 *
 * Before P7b, `createTestNextly` called `registerServices` WITHOUT a
 * `hookRegistry`, so the collection services got `hookRegistry: undefined` and
 * the facade read/single-write paths threw `executeBeforeOperation is not a
 * function` (P7a documented this as a harness limitation, covering those via
 * unit tests). Now the harness wires the (freshly reset) global registry, so
 * `listEntries` (where/sort) and single `createEntry` run end-to-end via the
 * ServiceOpts wrapper. (Bulk `createMany` has a separate, pre-existing
 * column-mapping issue in the bulk path — out of scope; P7a follow-up.)
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
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
    fields: [text({ name: "title" }), text({ name: "kind" })],
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function boot(): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let services: any;
  const probe = definePlugin({
    name: "@test/d56-reads",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init: c => {
      services = c.services;
    },
  });
  current = await createTestNextly({
    collections: [widgets()],
    plugins: [probe],
  });
  return services;
}

describe("ctx.services.collections reads/writes (D56, harness hook-wired)", () => {
  it("listEntries applies where + sort end-to-end via {as:'system'}", async () => {
    const services = await boot();
    for (const w of [
      { title: "b", kind: "a" },
      { title: "a", kind: "a" },
      { title: "c", kind: "z" },
    ]) {
      await current!.nextly.create({ collection: "widgets", data: w });
    }

    const list = await services.collections.listEntries(
      "widgets",
      {
        where: { kind: { equals: "a" } },
        sort: { field: "title", direction: "asc" },
      },
      { as: "system" }
    );
    expect(list.data.map((e: { title: string }) => e.title)).toEqual([
      "a",
      "b",
    ]);
  });

  it("single createEntry persists via {as:'system'}", async () => {
    const services = await boot();
    const created = await services.collections.createEntry(
      "widgets",
      { title: "x", kind: "q" },
      { as: "system" }
    );
    expect((created as { id: string }).id).toBeDefined();
    expect(
      await services.collections.count("widgets", {}, { as: "system" })
    ).toBe(1);
  });
});
