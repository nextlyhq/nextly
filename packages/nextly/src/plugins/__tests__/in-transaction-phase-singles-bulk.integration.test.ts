/**
 * The in-transaction hook phase on Singles, on the publish-every-language
 * paths, and in batches, on every dialect.
 *
 * - A Single's update runs the handlers registered under `single:<slug>`, as
 *   an `update`: the handler's row commits with the save, a handler that
 *   throws aborts it with its own status and keeps nothing, and a
 *   version-conflict retry runs it again, keeping one row.
 * - Publishing every language of a Single or of a collection entry runs the
 *   phase too, as an `update`, and a throwing handler aborts the publish.
 * - A batch sharing one transaction (`createEntries`, `updateEntries`,
 *   `deleteEntries`) runs the phase once per entry, also with `skipHooks`,
 *   and a handler that throws aborts the whole batch whatever `stopOnError`
 *   says: MySQL cannot undo one entry's part of a shared transaction.
 * - A batch that gives each entry a transaction of its own
 *   (`bulkUpdateEntries`) fails only the entry whose handler refused.
 */
import { afterEach, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../config";
import type { SingleEntryService } from "../../domains/singles/services/single-entry-service";
import { col, defineTable } from "../../domains/schema/extension/dsl";
import { VersionConflictError } from "../../domains/versions/version-conflict";
import { NextlyError } from "../../errors/nextly-error";
import type { CollectionsHandler } from "../../services/collections-handler";
import type { CollectionEntryService } from "../../services/collections/collection-entry-service";
import {
  definePlugin,
  type InTransactionHandler,
  type PluginContext,
} from "../plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

import { describeEachDialect } from "./helpers/dialect-matrix";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The plugin's own table: one row per write its handler saw. */
const ledger = defineTable("ledger", {
  id: col.id(),
  target: col.shortText(),
  entryId: col.shortText(),
  op: col.shortText(),
});

const BANNER = "banner";
const BANNER_KEY = `single:${BANNER}`;

/** Boot the plugin with a localized Single and two collections. */
async function boot(dialect: TestDialect): Promise<PluginContext> {
  let captured: PluginContext | undefined;
  current = await createTestNextly({
    dialect,
    localization: { locales: ["en", "de"], defaultLocale: "en" },
    collections: [
      defineCollection({ slug: "items", fields: [text({ name: "title" })] }),
      defineCollection({
        slug: "articles",
        localized: true,
        status: true,
        fields: [text({ name: "heading" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: BANNER,
        localized: true,
        status: true,
        fields: [text({ name: "headline" })],
      }),
    ],
    plugins: [
      definePlugin({
        name: "@test/phase-ledger",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { schema: { prefix: "phl", tables: [ledger] } },
        init(ctx) {
          captured = ctx;
        },
      }),
    ],
  });
  if (!captured) throw new Error("the plugin's init did not run");
  return captured;
}

function handle(): TestNextly {
  if (!current) throw new Error("not booted");
  return current;
}

function entries(): CollectionEntryService {
  return (
    handle().getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

function singles(): SingleEntryService {
  return handle().getService("singleEntryService");
}

/** The ledger as committed, read outside any transaction. */
async function ledgerRows(
  ctx: PluginContext
): Promise<{ target: string; op: string }[]> {
  return (await ctx.db.select(ledger).all())
    .map(row => ({ target: row.target, op: row.op }))
    .sort((a, b) => a.target.localeCompare(b.target));
}

/** Keeps the ledger: one row per write, through the handler's `db`. */
const keepLedger: InTransactionHandler = async ({
  db,
  collection,
  id,
  operation,
  data,
}) => {
  // Items are told apart by title; a Single and an article have one row each.
  const title = (data as { title?: unknown } | undefined)?.title;
  await db.insert(ledger, {
    target:
      collection === "items" && typeof title === "string"
        ? `${collection}/${title}`
        : collection,
    entryId: id,
    op: operation,
  });
};

/** Refuses any entry titled "bad", as a handler enforcing a rule would. */
const refuseBad: InTransactionHandler = ({ data }) => {
  if ((data as { title?: unknown } | undefined)?.title === "bad") {
    throw NextlyError.validation({
      errors: [{ path: "title", code: "INVALID", message: "refused" }],
    });
  }
};

/** Refuses every write it sees. */
const refuseAll: InTransactionHandler = () => {
  throw NextlyError.forbidden({});
};

async function itemTitles(): Promise<string[]> {
  const found = await handle().nextly.find({
    collection: "items",
    limit: 50,
  });
  return found.items.map(item => String(item.title)).sort();
}

async function createItems(titles: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const title of titles) {
    const created = await handle().nextly.create({
      collection: "items",
      data: { title },
    });
    ids.push(String(created.item.id));
  }
  return ids;
}

describeEachDialect("the in-transaction phase on a Single", dialect => {
  it("commits the handler's row with the Single's update, under single:<slug>", async () => {
    const ctx = await boot(dialect);
    const seen: { collection: string; operation: string }[] = [];
    ctx.hooks.onInTransaction(BANNER_KEY, async write => {
      seen.push({ collection: write.collection, operation: write.operation });
      await keepLedger(write);
    });

    await handle().nextly.updateSingle({
      slug: BANNER,
      data: { headline: "hello" },
    });

    expect(seen).toEqual([{ collection: BANNER_KEY, operation: "update" }]);
    expect(await ledgerRows(ctx)).toEqual([
      { target: BANNER_KEY, op: "update" },
    ]);
  });

  it("aborts the Single's update with the handler's status, keeping neither", async () => {
    const ctx = await boot(dialect);
    await handle().nextly.updateSingle({
      slug: BANNER,
      data: { headline: "kept" },
    });
    ctx.hooks.onInTransaction(BANNER_KEY, keepLedger);
    ctx.hooks.onInTransaction(BANNER_KEY, refuseAll);

    await expect(
      handle().nextly.updateSingle({ slug: BANNER, data: { headline: "lost" } })
    ).rejects.toMatchObject({ statusCode: 403 });

    const stored = await handle().nextly.findSingle({ slug: BANNER });
    expect((stored as { headline?: unknown }).headline).toBe("kept");
    expect(await ledgerRows(ctx)).toEqual([]);
  });

  it("runs again on a retried attempt of a Single's update, keeping one row", async () => {
    const ctx = await boot(dialect);
    let attempts = 0;
    ctx.hooks.onInTransaction(BANNER_KEY, async write => {
      attempts += 1;
      await keepLedger(write);
    });
    // The conflict comes after the first attempt's row is written.
    let conflicts = 0;
    ctx.hooks.onInTransaction(BANNER_KEY, () => {
      conflicts += 1;
      if (conflicts === 1) throw new VersionConflictError();
    });

    await handle().nextly.updateSingle({
      slug: BANNER,
      data: { headline: "after" },
    });

    expect(attempts).toBe(2);
    expect(await ledgerRows(ctx)).toEqual([
      { target: BANNER_KEY, op: "update" },
    ]);
  });

  it("runs on publishing every language of the Single, and aborts the publish when it throws", async () => {
    const ctx = await boot(dialect);
    await handle().nextly.updateSingle({
      slug: BANNER,
      data: { headline: "draft" },
    });
    ctx.hooks.onInTransaction(BANNER_KEY, keepLedger);
    ctx.hooks.onInTransaction(BANNER_KEY, refuseAll);

    // A Single's publish throws its refusal rather than returning it.
    await expect(
      singles().publishAllLocales(BANNER, { overrideAccess: true })
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await ledgerRows(ctx)).toEqual([]);

    ctx.hooks.offInTransaction(BANNER_KEY, refuseAll);
    const published = await singles().publishAllLocales(BANNER, {
      overrideAccess: true,
    });
    expect(published.success).toBe(true);
    expect(await ledgerRows(ctx)).toEqual([
      { target: BANNER_KEY, op: "update" },
    ]);
  });
});

describeEachDialect(
  "the in-transaction phase on publishing every language",
  dialect => {
    it("runs as an update of the entry, and aborts the publish when it throws", async () => {
      const ctx = await boot(dialect);
      const created = await handle().nextly.create({
        collection: "articles",
        data: { heading: "draft", status: "draft" },
        locale: "en",
      });
      const id = String(created.item.id);
      ctx.hooks.onInTransaction("articles", keepLedger);
      ctx.hooks.onInTransaction("articles", refuseAll);

      const refused = await entries().publishAllLocales({
        collectionName: "articles",
        entryId: id,
        overrideAccess: true,
      });
      expect(refused).toMatchObject({ success: false, statusCode: 403 });
      expect(await ledgerRows(ctx)).toEqual([]);

      ctx.hooks.offInTransaction("articles", refuseAll);
      const published = await entries().publishAllLocales({
        collectionName: "articles",
        entryId: id,
        overrideAccess: true,
      });
      expect(published.success).toBe(true);
      expect(await ledgerRows(ctx)).toEqual([
        { target: "articles", op: "update" },
      ]);
    });
  }
);

describeEachDialect("the in-transaction phase in a batch", dialect => {
  it("aborts a whole create batch when one handler refuses, whatever stopOnError says", async () => {
    const ctx = await boot(dialect);
    ctx.hooks.onInTransaction("items", keepLedger);
    ctx.hooks.onInTransaction("items", refuseBad);

    const result = await entries().createEntries(
      { collectionName: "items", overrideAccess: true },
      [{ title: "one" }, { title: "bad" }, { title: "three" }],
      { stopOnError: false }
    );

    expect(result.successful).toBe(0);
    expect(result.errors.some(e => e.code === "VALIDATION_ERROR")).toBe(true);
    expect(await itemTitles()).toEqual([]);
    expect(await ledgerRows(ctx)).toEqual([]);
  });

  it("runs once per entry of a batch that skips its hooks", async () => {
    const ctx = await boot(dialect);
    ctx.hooks.onInTransaction("items", keepLedger);

    const result = await entries().createEntries(
      { collectionName: "items", overrideAccess: true },
      [{ title: "one" }, { title: "two" }],
      { skipHooks: true }
    );

    expect(result.successful).toBe(2);
    expect(await ledgerRows(ctx)).toEqual([
      { target: "items/one", op: "create" },
      { target: "items/two", op: "create" },
    ]);
  });

  it("aborts a whole update batch when one handler refuses", async () => {
    const ctx = await boot(dialect);
    const [first, second] = await createItems(["one", "two"]);
    ctx.hooks.onInTransaction("items", keepLedger);
    ctx.hooks.onInTransaction("items", refuseBad);

    const result = await entries().updateEntries(
      { collectionName: "items", overrideAccess: true },
      [
        { id: first, data: { title: "changed" } },
        { id: second, data: { title: "bad" } },
      ],
      { stopOnError: false }
    );

    expect(result.successful).toBe(0);
    expect(await itemTitles()).toEqual(["one", "two"]);
    expect(await ledgerRows(ctx)).toEqual([]);
  });

  it("aborts a whole delete batch when one handler refuses", async () => {
    const ctx = await boot(dialect);
    const [first, second] = await createItems(["one", "bad"]);
    ctx.hooks.onInTransaction("items", keepLedger);
    ctx.hooks.onInTransaction("items", refuseBad);

    const result = await entries().deleteEntries(
      { collectionName: "items" },
      [first, second],
      { stopOnError: false }
    );

    expect(result.successful).toBe(0);
    expect(await itemTitles()).toEqual(["bad", "one"]);
    expect(await ledgerRows(ctx)).toEqual([]);
  });

  it("fails only the refused entry where each entry has its own transaction", async () => {
    const ctx = await boot(dialect);
    const [first, second] = await createItems(["one", "two"]);
    ctx.hooks.onInTransaction("items", keepLedger);
    // Refuses the second entry only, by id: the data is the same for both.
    ctx.hooks.onInTransaction("items", ({ id }) => {
      if (id === second) throw NextlyError.forbidden({});
    });

    const result = await entries().bulkUpdateEntries({
      collectionName: "items",
      ids: [first, second],
      data: { title: "same" },
      overrideAccess: true,
    });

    expect(result.successes).toHaveLength(1);
    expect(result.failures).toEqual([
      expect.objectContaining({ id: second, code: "FORBIDDEN" }),
    ]);
    expect(await itemTitles()).toEqual(["same", "two"]);
    expect(await ledgerRows(ctx)).toEqual([
      { target: "items/same", op: "update" },
    ]);
  });
});
