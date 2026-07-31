/**
 * Hooks declared on a code-first collection actually run.
 *
 * `defineCollection({ hooks })` is the documented way to write collection
 * hooks — the collections guide's own worked example is a `beforeChange` that
 * generates a slug on create — but nothing registered them. Singles' hooks were
 * registered at boot and collections' were not, so the read and write paths
 * asked the registry for a collection's handlers and always got none. A declared
 * hook simply never ran, and the operation reported success.
 *
 * Asserted end to end through a booted instance rather than against a mocked
 * registry. The existing unit tests mock the registry and assert that the read
 * path CALLS it, which is true and was true throughout: they check the consumer,
 * and the missing half was the producer.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { resetHookRegistry } from "../../../hooks/hook-registry";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  // Hooks register into the process-wide registry; clear between tests so one
  // boot's handlers cannot answer for the next.
  resetHookRegistry();
});

describe("code-first collection hooks (integration)", () => {
  it("runs every declared lifecycle hook", async () => {
    const fired: string[] = [];
    const record =
      (name: string) =>
      async (ctx: { data?: unknown }): Promise<unknown> => {
        fired.push(name);
        return ctx.data;
      };

    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "cfhdocs",
          access: { create: () => true, read: () => true, update: () => true },
          hooks: {
            beforeChange: [record("beforeChange")],
            afterChange: [record("afterChange")],
            beforeRead: [record("beforeRead")],
            afterRead: [record("afterRead")],
          },
          fields: [text({ name: "title" })],
        }),
      ],
    });

    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "cfhdocs", overrideAccess: true },
      { title: "T" }
    );
    expect(created.success).toBe(true);
    expect(fired).toContain("beforeChange");
    expect(fired).toContain("afterChange");

    fired.length = 0;
    const read = await handler.getEntry({
      collectionName: "cfhdocs",
      entryId: (created.data as { id: string }).id,
      user: { id: "u1" },
      routeAuthorized: true,
    });
    expect(read.success).toBe(true);
    expect(fired).toContain("beforeRead");
    expect(fired).toContain("afterRead");
  });

  it("lets a beforeChange hook transform what is written", async () => {
    // The guide's own example: derive a value on create. A hook that only
    // "fires" without its return value being used would satisfy the test above
    // while still being useless.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "cfhdocs",
          access: { create: () => true, read: () => true },
          hooks: {
            beforeChange: [
              async ({ data }: { data?: Record<string, unknown> }) => ({
                ...data,
                title: `${String(data?.title ?? "")} (checked)`,
              }),
            ],
          },
          fields: [text({ name: "title" })],
        }),
      ],
    });

    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "cfhdocs", overrideAccess: true },
      { title: "Draft" }
    );

    expect(created.success).toBe(true);
    expect((created.data as { title?: string }).title).toBe("Draft (checked)");
  });

  it("does not run hooks from a collection a disabled plugin contributed", async () => {
    // A disabled plugin's contributions stay in the config so the schema stays
    // deterministic, but the lifecycle's behaviour-skip contract means its
    // runtime hooks must not fire — the same carve-out Singles registration
    // makes.
    const fired: string[] = [];

    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "cfhkept",
          access: { create: () => true, read: () => true },
          hooks: {
            beforeChange: [
              async ({ data }: { data?: unknown }) => {
                fired.push("cfhkept");
                return data;
              },
            ],
          },
          fields: [text({ name: "title" })],
        }),
      ],
      plugins: [
        definePlugin({
          name: "@test/disabled-hooks",
          version: "1.0.0",
          nextly: ">=0.0.0",
          enabled: false,
          // Declared through `contributes` rather than added in `setup`: that is
          // the shape the disabled-slug filter reads, for collections exactly as
          // for singles.
          contributes: {
            collections: [
              defineCollection({
                slug: "cfhfromdisabled",
                access: { create: () => true, read: () => true },
                hooks: {
                  beforeChange: [
                    async ({ data }: { data?: unknown }) => {
                      fired.push("from-disabled");
                      return data;
                    },
                  ],
                },
                fields: [text({ name: "title" })],
              }),
            ],
          },
        }),
      ],
    });

    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    await handler.createEntry(
      { collectionName: "cfhkept", overrideAccess: true },
      { title: "T" }
    );

    expect(fired).toEqual(["cfhkept"]);
  });
});
