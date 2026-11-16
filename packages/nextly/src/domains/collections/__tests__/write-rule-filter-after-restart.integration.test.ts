/**
 * A delete rule's filter on a translated field, asked inside a caller's own
 * transaction just after the process restarted.
 *
 * A write inside a transaction can only read a translation table's readiness
 * already resolved: resolving queries, which inside the transaction could
 * abort it on PostgreSQL or wait for the connection it holds. After a restart
 * nothing has resolved it, and the write reads the translated field from a
 * table it cannot use, so the filter matches nothing and a delete it allows is
 * refused. The boot resolves every translated entity's table in the
 * background, so once that has finished the delete is judged by the filter,
 * in the plugin's own transaction and in a transaction opened on the adapter
 * alike.
 *
 * SQLite on a file, not in memory, so a second boot on a fresh adapter reads
 * what the first left, with nothing about it remembered.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { NextlyError } from "../../../errors/nextly-error";
import { companionReadinessWarmedForTests } from "../../../init/warm-companion-readiness";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { RequestContext } from "../../../services/shared";
import type { CollectionService } from "../services/collection-service";

// Integration files share fixed system-table names, so this file keeps its
// own collection slug.
const TRANSLATED = "writefilter_restart_posts";
const AUTHOR = "writefilter-restart-author";

let current: TestNextly | undefined;
let dir: string | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** An adapter on this test's database file, which outlives one boot. */
async function adapterOnFile() {
  dir ??= mkdtempSync(join(tmpdir(), "nextly-filter-restart-"));
  process.env.DB_DIALECT = "sqlite";
  return createAdapter({
    type: "sqlite",
    url: `file:${join(dir, "test.db")}`,
  } as Parameters<typeof createAdapter>[0]);
}

/** A boot on the file: the delete rule matches the entries titled "mine". */
async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    adapter: await adapterOnFile(),
    localization: { locales: ["en", "de"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: TRANSLATED,
        localized: true,
        access: {
          read: () => true,
          delete: () => ({ title: { equals: "mine" } }) as unknown as boolean,
        },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

/** The error a call threw; fails where it succeeded. */
async function errorOf(call: () => Promise<unknown>): Promise<NextlyError> {
  try {
    await call();
  } catch (error) {
    if (NextlyError.is(error)) return error;
    throw error;
  }
  throw new Error("the call succeeded");
}

async function stillThere(t: TestNextly, id: string): Promise<boolean> {
  const found = await t.nextly.find({
    collection: TRANSLATED,
    where: { id: { equals: id } },
  });
  return found.items.length === 1;
}

/**
 * The author's entries and another's, written by a first boot that then shuts
 * down; the second boot, a restart, is returned with nothing resolved but what
 * its own boot resolved.
 */
async function restartedWith(): Promise<{
  t: TestNextly;
  mine: string[];
  theirs: string;
}> {
  const first = await boot();
  await userWhoMay(first, AUTHOR, "read", [TRANSLATED]);
  await grantTo(first, AUTHOR, "delete", [TRANSLATED]);
  const made = async (title: string) =>
    String(
      (await first.nextly.create({ collection: TRANSLATED, data: { title } }))
        .item.id
    );
  const mine = [await made("mine"), await made("mine")];
  const theirs = await made("theirs");
  await first.destroy();
  current = undefined;
  return { t: await boot(), mine, theirs };
}

describe("a delete rule's filter on a translated field after a restart (sqlite)", () => {
  it("is applied inside a plugin transaction and an adapter transaction once the boot resolved the translations", async () => {
    const {
      t,
      mine: [inPluginTransaction, inAdapterTransaction],
      theirs,
    } = await restartedWith();
    await companionReadinessWarmedForTests();
    const service = t.getService(
      "collectionService"
    ) as unknown as CollectionService;
    const entries = t
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const asAuthor: RequestContext = {
      user: { id: AUTHOR },
      overrideAccess: false,
    } as RequestContext;

    // The plugin's own transaction.
    await service.withTransaction(tx =>
      service.deleteEntryInTransaction(
        tx,
        TRANSLATED,
        inPluginTransaction!,
        asAuthor
      )
    );
    // A transaction opened on the adapter, as `ctx.db.transaction` opens one.
    const deleted = await t.adapter.transaction(tx =>
      entries.deleteEntryInTransaction(tx, {
        collectionName: TRANSLATED,
        entryId: inAdapterTransaction!,
        user: { id: AUTHOR },
      })
    );
    const refused = await errorOf(() =>
      service.withTransaction(tx =>
        service.deleteEntryInTransaction(tx, TRANSLATED, theirs, asAuthor)
      )
    );

    expect(await stillThere(t, inPluginTransaction!)).toBe(false);
    expect(deleted.success).toBe(true);
    expect(await stillThere(t, inAdapterTransaction!)).toBe(false);
    // The control: the filter still decides, refusing the entry it does not
    // match.
    expect(refused.statusCode).toBe(403);
    expect(await stillThere(t, theirs)).toBe(true);
  });
});
