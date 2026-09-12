/**
 * A plugin's widget source through a real boot.
 *
 * The unit tests around the fold and the executor each cover one seam with the
 * other stubbed. What neither can show is the thing that actually broke: the
 * resolver reaching DATA. A plugin's services are reachable only through its
 * `PluginContext`, that context does not exist when the widget stores are
 * reset, and a resolver holding `(query, caller)` alone could answer from
 * constants and nothing else -- which every mocked test would have reported as
 * working perfectly.
 *
 * So this boots an instance with a plugin that contributes a source, and reads
 * rows through it. Nothing here stubs the context, the registry or the read.
 *
 * @module domains/widgets/__tests__/plugin-widget-source.integration.test
 */

process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import type { PluginContext } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { executeWidgetQuery } from "../execute";
import { validateWidgetQuery } from "../query";
import { getSource } from "../sources";

const NOTES = "notes";
const SOURCE_ID = "plugin:acme/note-count";

/** An admin caller, the reader a dashboard actually meets. */
const admin: ReadCaller = { user: { id: "admin-1", roles: ["admin"] } };

let current: TestNextly | undefined;
/** What the resolver was handed, captured so the assertions can read it. */
let handed: { ctx?: PluginContext; caller?: ReadCaller } = {};

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  handed = {};
});

/**
 * A plugin contributing one source whose resolver COUNTS ROWS.
 *
 * Counting is the point: it can only be done through `ctx.services`, so a
 * resolver that never received a usable context cannot produce this number at
 * all.
 */
function acmePlugin(): unknown {
  return {
    name: "@acme/notes",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      widgetSources: [
        {
          source: {
            id: SOURCE_ID,
            label: "Notes",
            kind: "plugin",
            supports: ["count"],
            fields: [{ name: "total", type: "number" }],
          },
          resolve: async (
            _query: unknown,
            caller: ReadCaller,
            ctx: PluginContext
          ) => {
            handed = { ctx, caller };
            const services = ctx.services as unknown as {
              collections: {
                count: (
                  slug: string,
                  args: unknown,
                  opts: unknown
                ) => Promise<{ total: number } | number>;
              };
            };
            const counted = await services.collections.count(
              NOTES,
              {},
              {
                as: "user",
                user: caller.user,
                // The key's own stamped scope travels too. Without it a key
                // would be judged on the roles of whoever minted it, which is
                // the defect this whole read path is shaped to avoid.
                authenticatedScope: caller.authenticatedScope,
              }
            );
            const total = typeof counted === "number" ? counted : counted.total;
            return { op: "count" as const, total };
          },
        },
      ],
    },
  };
}

async function boot(plugins: unknown[]): Promise<TestNextly> {
  const t = await createTestNextly({
    collections: [
      defineCollection({
        slug: NOTES,
        access: { read: () => true, create: () => true, update: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
    plugins: plugins as never,
  });
  current = t;
  return t;
}

async function write(t: TestNextly, title: string): Promise<void> {
  const handler = t.getService("collectionsHandler") as unknown as {
    createEntry: (
      p: Record<string, unknown>,
      data: Record<string, unknown>
    ) => Promise<{ success: boolean }>;
  };
  const result = await handler.createEntry(
    { collectionName: NOTES, overrideAccess: true },
    { title }
  );
  // A failed insert would leave the count at zero, which is the state the
  // assertion is trying to move away from -- so a broken fixture would report
  // the resolver working perfectly.
  expect(result.success).toBe(true);
}

describe("a plugin's widget source, booted", () => {
  it("is registered and answers a query with rows it read itself", async () => {
    const t = await boot([acmePlugin()]);
    await write(t, "first");
    await write(t, "second");

    // Registered by the boot, not by this test.
    expect(getSource(SOURCE_ID)).toBeDefined();

    const result = await executeWidgetQuery(
      validateWidgetQuery({ source: SOURCE_ID, op: "count" }),
      admin
    );

    // 🔴 The number is the evidence. It could not have been produced without a
    // context that reaches the collection service, so this fails outright on
    // the two-argument resolver the contract shipped with.
    expect(result).toEqual({ op: "count", total: 2 });
  });

  it("hands the resolver its OWN plugin's context, and the caller unchanged", async () => {
    const t = await boot([acmePlugin()]);
    await write(t, "only");

    await executeWidgetQuery(
      validateWidgetQuery({ source: SOURCE_ID, op: "count" }),
      admin
    );

    expect(handed.caller).toBe(admin);
    // `ctx.self` is what makes a context this plugin's OWN rather than some
    // shared one: bound wrongly, every plugin would read the first plugin's
    // entities while believing they were its own.
    expect((handed.ctx as unknown as { self?: unknown }).self).toBeDefined();
    expect(handed.ctx?.services).toBeDefined();
  });

  it("publishes nothing for a DISABLED plugin", async () => {
    // The boot skips a disabled plugin's context entirely, so its resolver
    // would have nothing to be bound to. Asserted through the source store
    // rather than the fold, because this is the seam where the two agree.
    await boot([{ ...(acmePlugin() as object), enabled: false }]);

    expect(getSource(SOURCE_ID)).toBeUndefined();
  });

  it("refuses a boot whose plugin claims a reserved namespace", async () => {
    // A `collection:` id would put a resolver where the access-controlled
    // Direct API is supposed to answer. The refusal is the BOOT's, so the
    // instance never comes up -- which is the outcome that gets noticed.
    const shadow = {
      name: "@acme/shadow",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        widgetSources: [
          {
            source: {
              id: `collection:${NOTES}`,
              label: "Not notes",
              kind: "plugin",
              supports: ["count"],
              fields: [{ name: "total", type: "number" }],
            },
            resolve: () => Promise.resolve({ op: "count" as const, total: 0 }),
          },
        ],
      },
    };

    await expect(boot([shadow])).rejects.toThrow(/reserved/);
  });
});
