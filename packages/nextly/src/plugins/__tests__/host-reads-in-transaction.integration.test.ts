/**
 * A plugin reads a HOST collection or Single on a transaction it holds, on
 * every dialect, when that content holds a field of a type the plugin
 * registered.
 *
 * `ctx.services.ownCollections.listHostEntriesInTransaction`,
 * `findHostEntryByIdInTransaction` and `getHostSingleInTransaction` judge the
 * content at the call, from its schema as it stands, and read it as the own
 * reads do: on the transaction's connection, as the system, past its read
 * hooks.
 *
 * The separating properties are that the read sees what the transaction wrote
 * and has not committed (a pooled read cannot on PostgreSQL and MySQL, and the
 * escape guard in `src/__tests__/transaction-escapes` fails any test here
 * whose read, the eligibility lookup included, takes another connection), and
 * that content holding no field of the plugin's types is refused before the
 * service is reached. The pool-of-one case is
 * `host-reads-in-transaction-pool-of-one.integration.test.ts`.
 */
import { afterEach, expect, it, vi } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";
import { definePlugin, type PluginContext } from "../plugin-context";
import type { PluginCollectionTransaction } from "../service-opts";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

import { describeEachDialect } from "./helpers/dialect-matrix";

// Suite-local slugs: integration files share fixed system-table names.
const HOSTED = "hostread_pages";
const PLAIN = "hostread_posts";
const HOSTED_SINGLE = "hostread_home";
const PLAIN_SINGLE = "hostread_footer";
const HOSTED_SINGLE_KEY = `single:${HOSTED_SINGLE}`;

/** The field type the plugin registers. */
const HOST_DOC = "hostdoc";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

/**
 * Boot a plugin that registers a field type and declares no content, beside
 * a site whose collection and Single hold that type inside a group, and a
 * collection and Single that hold none.
 */
async function boot(dialect: TestDialect): Promise<PluginContext> {
  let captured: PluginContext | undefined;
  current = await createTestNextly({
    dialect,
    plugins: [
      definePlugin({
        name: "@test/host-reader",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          fieldTypes: [
            {
              type: HOST_DOC,
              storage: "json",
              component: "@test/host-reader/admin#Doc",
            },
          ],
        },
        init(ctx) {
          captured = ctx;
        },
      }),
    ],
    // Raw configs: the type is registered by the plugin at boot, after a
    // `defineCollection` call would have judged it.
    collections: [
      {
        slug: HOSTED,
        fields: [
          { name: "title", type: "text" },
          {
            name: "panel",
            type: "group",
            fields: [{ name: "body", type: HOST_DOC }],
          },
        ],
      } as unknown as CollectionConfig,
      {
        slug: PLAIN,
        fields: [{ name: "title", type: "text" }],
      } as unknown as CollectionConfig,
    ],
    singles: [
      {
        slug: HOSTED_SINGLE,
        fields: [
          { name: "headline", type: "text" },
          { name: "body", type: HOST_DOC },
        ],
      } as never,
      {
        slug: PLAIN_SINGLE,
        fields: [{ name: "headline", type: "text" }],
      } as never,
    ],
  });
  if (!captured) throw new Error("the plugin's init did not run");
  return captured;
}

function handle(): TestNextly {
  if (!current) throw new Error("not booted");
  return current;
}

/** What `run` rejected with, or a marker when it resolved. */
async function rejectionOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return "resolved";
}

describeEachDialect("a plugin's host reads on its transaction", dialect => {
  it("sees a row its withTransaction work wrote to a host collection holding its field type", async () => {
    const ctx = await boot(dialect);
    await handle().nextly.create({
      collection: HOSTED,
      data: { title: "committed", panel: { body: { v: 1 } } },
    });
    const { collections, ownCollections } = ctx.services;

    const seen = await collections.withTransaction(async tx => {
      const created = await collections.createEntryInTransaction(
        tx,
        HOSTED,
        { title: "uncommitted", panel: { body: { v: 2 } } },
        {}
      );
      const listed = await ownCollections.listHostEntriesInTransaction(
        tx,
        HOSTED,
        { sort: { field: "title", direction: "asc" } }
      );
      const found = await ownCollections.findHostEntryByIdInTransaction(
        tx,
        HOSTED,
        String(created.id),
        { lock: "update" }
      );
      return { listed, found };
    });

    expect(seen.listed.data.map(row => row.title)).toEqual([
      "committed",
      "uncommitted",
    ]);
    expect(seen.found.title).toBe("uncommitted");
  });

  it("refuses a host collection holding none of its field types, and a settled token, before reading", async () => {
    const ctx = await boot(dialect);
    const { collections, ownCollections } = ctx.services;
    const service = handle().getService("collectionService");
    const listEntries = vi.spyOn(service, "listEntries");
    const findEntryById = vi.spyOn(service, "findEntryById");
    let kept: PluginCollectionTransaction | undefined;

    const refusals = await collections.withTransaction(async tx => {
      kept = tx;
      return [
        await rejectionOf(() =>
          ownCollections.listHostEntriesInTransaction(tx, PLAIN)
        ),
        await rejectionOf(() =>
          ownCollections.findHostEntryByIdInTransaction(tx, PLAIN, "missing")
        ),
        await rejectionOf(() =>
          ownCollections.listHostEntriesInTransaction(tx, "hostread_nowhere")
        ),
      ];
    });
    if (!kept) throw new Error("the transaction's work did not run");
    const settled = kept;
    const late = await rejectionOf(() =>
      ownCollections.listHostEntriesInTransaction(settled, HOSTED)
    );

    for (const refused of refusals) {
      expect(refused).toMatchObject({
        code: "INVALID_INPUT",
        logContext: { reason: "host-collection-read-not-eligible" },
      });
    }
    expect(late).toMatchObject({
      code: "VALIDATION_ERROR",
      logContext: { reason: "plugin-transaction-finished" },
    });
    expect(listEntries).not.toHaveBeenCalled();
    expect(findEntryById).not.toHaveBeenCalled();
  });

  it("reads a host Single holding its field type as the write left it, past its read hooks, and refuses one holding none", async () => {
    const ctx = await boot(dialect);
    // A read hook the host read must not run: it rewrites the headline.
    handle().hooks.register("afterRead", HOSTED_SINGLE_KEY, hook => ({
      ...(hook.data as Record<string, unknown>),
      headline: "hooked",
    }));
    const seen: unknown[] = [];
    ctx.hooks.onInTransaction(HOSTED_SINGLE_KEY, async write => {
      const own = ctx.services.ownCollections;
      const single = await own.getHostSingleInTransaction(
        write.transaction,
        HOSTED_SINGLE
      );
      seen.push(single.headline);
      seen.push(
        await rejectionOf(() =>
          own.getHostSingleInTransaction(write.transaction, PLAIN_SINGLE)
        )
      );
      // A collection's slug is not a Single, even one holding the type.
      seen.push(
        await rejectionOf(() =>
          own.getHostSingleInTransaction(write.transaction, HOSTED)
        )
      );
    });

    await handle().nextly.updateSingle({
      slug: HOSTED_SINGLE,
      data: { headline: "uncommitted", _overwrite: true },
    });

    expect(seen[0]).toBe("uncommitted");
    for (const refused of seen.slice(1)) {
      expect(refused).toMatchObject({
        code: "INVALID_INPUT",
        logContext: { reason: "host-single-read-not-eligible" },
      });
    }
    // The control: the ordinary read of the same Single runs the hook.
    const ordinary = await handle().nextly.findSingle({ slug: HOSTED_SINGLE });
    expect(ordinary.headline).toBe("hooked");
  });
});
