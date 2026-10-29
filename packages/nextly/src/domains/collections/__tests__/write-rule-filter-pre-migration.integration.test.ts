/**
 * A delete rule's filter on a translated field, while the collection is in
 * its pre-migration state: registered as localized, with no companion table
 * yet, so the translated values are still on the main table.
 *
 * The collection's runtime schema no longer carries the translated columns
 * then, and the companion it would read them from is not there, so the
 * filter cannot be built. It is not run against the missing companion, which
 * fails the delete with a database error: like any filter that cannot be
 * built, it matches no entry, so the delete is refused and nothing removed.
 *
 * File-backed SQLite, as the window is reached by booting twice: once without
 * languages to store the entries, then with them and the companion removed,
 * the state a `db:sync` from another process leaves a running server in.
 *
 * @module domains/collections/__tests__/write-rule-filter-pre-migration.integration.test
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { clearRuleFilterReports } from "../../../auth/access/rule-answer";
import { defineCollection, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { forgetCompanionReadiness } from "../../../domains/i18n/runtime/companion-readiness";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

const POSTS = "wfpre_posts";
const COMPANION = `dc_${POSTS}_locales`;
const AUTHOR = "wfpre-author";

let dir: string;
let dbPath: string;
let current: TestNextly | undefined;
// The harness snapshots DB_DIALECT when it creates an adapter; these tests
// build their own first, so the real dialect is put back afterwards.
let previousDialect: string | undefined;

beforeEach(() => {
  previousDialect = process.env.DB_DIALECT;
  dir = mkdtempSync(join(tmpdir(), "nextly-wfpre-"));
  dbPath = join(dir, "test.db");
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  clearRuleFilterReports();
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  rmSync(dir, { recursive: true, force: true });
});

/** "Only entries titled mine", over a translated field. */
const titledMine = () => ({ title: { equals: "mine" } }) as unknown as boolean;

async function boot(localized: boolean): Promise<TestNextly> {
  process.env.DB_DIALECT = "sqlite";
  const adapter = await createAdapter({
    type: "sqlite",
    url: `file:${dbPath}`,
  } as Parameters<typeof createAdapter>[0]);
  return createTestNextly({
    adapter,
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: POSTS,
        localized,
        access: { read: () => true, delete: titledMine },
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "owner", localized: false }),
        ],
      }),
    ],
  });
}

/** Whether the main table still holds `id`, read as stored. */
async function stored(handle: TestNextly, id: string): Promise<boolean> {
  const rows = await handle.adapter.executeQuery<{ id: string }>(
    `SELECT id FROM dc_${POSTS} WHERE id = '${id}'`
  );
  return rows.length === 1;
}

describe("a delete rule's filter before the companion exists", () => {
  it("matches no entry, refusing the delete rather than failing it", async () => {
    // Stored while the collection has no languages, so the titles are on the
    // main table, where they stay until the companion is made.
    current = await boot(false);
    const mine = await current.nextly.create({
      collection: POSTS,
      data: { title: "mine", owner: AUTHOR },
    });
    const theirs = await current.nextly.create({
      collection: POSTS,
      data: { title: "theirs", owner: "someone-else" },
    });
    await current.destroy();

    // Registered as localized now, with no companion behind it.
    current = await boot(true);
    await current.adapter.executeQuery(`DROP TABLE IF EXISTS "${COMPANION}"`);
    forgetCompanionReadiness(current.adapter, COMPANION);
    await userWhoMay(current, AUTHOR, "read", [POSTS]);
    await grantTo(current, AUTHOR, "delete", [POSTS]);
    const asAuthor = { overrideAccess: false, user: { id: AUTHOR } } as const;
    const t = current;

    const refusalOf = (id: string) =>
      t.nextly.delete({ collection: POSTS, id, ...asAuthor }).then(
        () => undefined,
        (error: unknown) => (NextlyError.is(error) ? error : error)
      );
    const ownRefusal = await refusalOf(String(mine.item.id));
    const otherRefusal = await refusalOf(String(theirs.item.id));

    // Refused in words, as an entry outside the filter the caller may read
    // is, and never a server error from a query against the missing table.
    for (const refusal of [ownRefusal, otherRefusal]) {
      expect(NextlyError.is(refusal)).toBe(true);
      expect(NextlyError.is(refusal) && refusal.statusCode).toBe(403);
    }
    expect(await stored(t, String(mine.item.id))).toBe(true);
    expect(await stored(t, String(theirs.item.id))).toBe(true);
  });
});
