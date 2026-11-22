/**
 * A public read in a language while the collection is in its pre-migration
 * state: registered as translated, with per-language publishing, and no
 * translations table yet, so every value is still on the main table.
 *
 * The test of "published in this language" reads the translations table, so
 * it is not asked until that table is there: until then the document's one
 * status is the only publication there is, and the read answers the document
 * rather than failing on a query against a missing table. (Its translated
 * values are another matter: the runtime schema no longer reads them from the
 * main table, and they reach the translations table with its migration.)
 *
 * File-backed SQLite, as the window is reached by booting twice: once without
 * languages to store the entries, then with them and the translations table
 * removed, the state a `db:sync` from another process leaves a running server
 * in.
 *
 * @module domains/i18n/__tests__/language-read-pre-migration.integration.test
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { forgetCompanionReadiness } from "../runtime/companion-readiness";

const POSTS = "lrpre_posts";
const COMPANION = `dc_${POSTS}_locales`;

let dir: string;
let dbPath: string;
let current: TestNextly | undefined;
// The harness snapshots DB_DIALECT when it creates an adapter; these tests
// build their own first, so the real dialect is put back afterwards.
let previousDialect: string | undefined;

beforeEach(() => {
  previousDialect = process.env.DB_DIALECT;
  dir = mkdtempSync(join(tmpdir(), "nextly-lrpre-"));
  dbPath = join(dir, "test.db");
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  rmSync(dir, { recursive: true, force: true });
});

async function boot(localized: boolean): Promise<TestNextly> {
  process.env.DB_DIALECT = "sqlite";
  const adapter = await createAdapter({
    type: "sqlite",
    url: `file:${dbPath}`,
  } as Parameters<typeof createAdapter>[0]);
  return createTestNextly({
    adapter,
    // A visitor's read is judged by the Public role, which the `read` rule
    // below grants.
    seedPublic: true,
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: POSTS,
        localized,
        status: true,
        access: { read: () => true },
        fields: [text({ name: "title", localized: true })],
      }),
    ],
  });
}

describe("a public read in a language before the translations table exists", () => {
  it("answers the document rather than failing", async () => {
    // Stored while the collection has no languages, so the title is on the
    // main table, where it stays until the translations table is made.
    current = await boot(false);
    const created = await current.nextly.create({
      collection: POSTS,
      data: { title: "Harbour", status: "published" },
    });
    const id = String(created.item.id);
    await current.destroy();

    // Registered as translated now, with no translations table behind it.
    current = await boot(true);
    await current.adapter.executeQuery(`DROP TABLE IF EXISTS "${COMPANION}"`);
    forgetCompanionReadiness(current.adapter, COMPANION);

    const one = (await current.nextly.findByID({
      collection: POSTS,
      id,
      locale: "es",
      overrideAccess: false,
    })) as Record<string, unknown> | null;
    expect(String(one?.id)).toBe(id);
    const listed = await current.nextly.find({
      collection: POSTS,
      locale: "es",
      overrideAccess: false,
    });
    expect(listed.items.map(item => String(item.id))).toEqual([id]);
  });
});
