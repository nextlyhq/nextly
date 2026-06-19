/**
 * D56 (P7a) end-to-end — the new `ctx.services.collections` surface (the
 * ServiceOpts-wrapped facade) against a live in-memory SQLite boot.
 *
 * Harness scope (mirrors the P3-D35/P4 posture): the in-memory `createTestNextly`
 * boot wires the high-level `nextly.create` path but NOT the lower entry-service
 * hook seam that the facade's doc-read (`listEntries`) and bulk-create
 * (`createMany`) paths call — both surface `hookRegistry.executeBeforeOperation
 * is not a function` / an INTERNAL_ERROR there. That is a pre-existing harness
 * limitation, not a P7a regression (a plain `listEntries` fails identically).
 * So those two are covered by the focused facade/wrapper UNIT tests
 * (`collection-service-d56.test.ts`, `service-opts-wrapper.test.ts`).
 *
 * What this file proves end-to-end through the wrapper:
 *  - `count` with a `where` filter actually reaches the query layer (the filter
 *    the facade used to DROP), under `{as:'system'}` elevation; and
 *  - secure-by-default: `{as:'user'}` enforces RBAC (permission-less user denied)
 *    and a missing user is rejected before any query (D35).
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
type Services = any;

async function bootWithServices(): Promise<Services> {
  let services: Services;
  const probe = definePlugin({
    name: "@test/d56",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init: ctx => {
      services = ctx.services;
    },
  });
  current = await createTestNextly({
    collections: [widgets()],
    plugins: [probe],
  });
  return services;
}

describe("ctx.services.collections D56 surface (D56/D35)", () => {
  it("count threads its `where` filter through {as:'system'} end-to-end", async () => {
    const services = await bootWithServices();
    for (const w of [
      { title: "b", kind: "a" },
      { title: "a", kind: "a" },
      { title: "c", kind: "z" },
    ]) {
      await current!.nextly.create({ collection: "widgets", data: w });
    }

    // Unfiltered count, then a filtered count — the `where` clause is the exact
    // option the facade used to drop before reaching the query layer.
    expect(
      await services.collections.count("widgets", {}, { as: "system" })
    ).toBe(3);
    expect(
      await services.collections.count(
        "widgets",
        { where: { kind: { equals: "a" } } },
        { as: "system" }
      )
    ).toBe(2);
  });

  it("{as:'user'} enforces RBAC — a permission-less user is denied (secure-by-default)", async () => {
    const services = await bootWithServices();
    await expect(
      services.collections.count(
        "widgets",
        {},
        { as: "user", user: { id: "u1", email: "u@x.com" } }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("count as:'user' with no user rejects before any query (D35)", async () => {
    const services = await bootWithServices();
    await expect(
      services.collections.count("widgets", {}, { as: "user" })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
