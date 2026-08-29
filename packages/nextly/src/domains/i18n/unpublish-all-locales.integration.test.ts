// The counterpart publishing has had since M7 and withdrawing never did:
// unpublishAllLocales sets the main status and every companion `_status` to
// 'draft' atomically, through the real service stack — and REFUSES rather than
// half-performing when the companion physically lacks the status column.
//
// Companion tables are migration-owned, so these tests seed them, which is also
// what lets one of them build the shape the refusal exists for.

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "pages",
        localized: true,
        status: true,
        fields: [
          text({ name: "title", localized: false }),
          text({ name: "heading" }),
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

/**
 * Called ON the adapter, never through an extracted reference: `executeQuery`
 * is a class method, so pulling it out loses `this` and every seed fails inside
 * the adapter with a message about `ensureDb` that names nothing in this file.
 */
function exec(
  t: TestNextly,
  sql: string
): Promise<{ rows?: unknown[] } | unknown[]> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<{ rows?: unknown[] } | unknown[]>;
  };
  return adapter.executeQuery(sql);
}

/** The companion as the migration builds it: WITH the per-locale status column. */
async function seedCompanion(
  t: TestNextly,
  rows: { parent: string; locale: string; status: string }[]
): Promise<void> {
  await exec(
    t,
    'CREATE TABLE IF NOT EXISTS "dc_pages_locales" ("_parent" text, "_locale" text, "_status" text NOT NULL DEFAULT \'draft\', "heading" text, PRIMARY KEY ("_parent","_locale"))'
  );
  for (const r of rows) {
    await exec(
      t,
      `INSERT INTO "dc_pages_locales" ("_parent","_locale","_status","heading") VALUES ('${r.parent}','${r.locale}','${r.status}','h') ON CONFLICT ("_parent","_locale") DO UPDATE SET "_status" = excluded."_status"`
    );
  }
}

/**
 * The companion as it stands on an install that was localized BEFORE
 * Draft/Published was enabled: physically present, and with no `_status`.
 * `reconcileCompanionColumns` declines to add the column to an already
 * provisioned companion, so this state persists until `nextly migrate` runs.
 */
async function seedCompanionWithoutStatus(
  t: TestNextly,
  parent: string
): Promise<void> {
  await exec(t, 'DROP TABLE IF EXISTS "dc_pages_locales"');
  await exec(
    t,
    'CREATE TABLE "dc_pages_locales" ("_parent" text, "_locale" text, "heading" text, PRIMARY KEY ("_parent","_locale"))'
  );
  await exec(
    t,
    `INSERT INTO "dc_pages_locales" ("_parent","_locale","heading") VALUES ('${parent}','de','h')`
  );
}

/** The main row's status, read from storage rather than through the read path. */
async function readMainStatus(
  t: TestNextly,
  id: string
): Promise<string | undefined> {
  const res = await exec(
    t,
    `SELECT "status" FROM "dc_pages" WHERE "id" = '${id}'`
  );
  const rows = (
    Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows
  ) as Array<{ status: string }> | undefined;
  return rows?.[0]?.status;
}

async function readStatuses(
  t: TestNextly,
  parent: string
): Promise<Record<string, string>> {
  const res = await exec(
    t,
    `SELECT "_locale", "_status" FROM "dc_pages_locales" WHERE "_parent" = '${parent}'`
  );
  const rows = (
    Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows
  ) as Array<{ _locale: string; _status: string }> | undefined;
  const out: Record<string, string> = {};
  for (const r of rows ?? []) out[r._locale] = r._status;
  return out;
}

type Result = {
  success: boolean;
  message?: string;
  data: Record<string, unknown> | null;
};

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    publishAllLocales: (p: Record<string, unknown>) => Promise<Result>;
    unpublishAllLocales: (p: Record<string, unknown>) => Promise<Result>;
    getEntry: (p: Record<string, unknown>) => Promise<Result>;
  };
}

async function makeEntry(t: TestNextly): Promise<string> {
  const created = (await t.nextly.create({
    collection: "pages",
    data: { title: "A" },
  })) as unknown as { item: { id: string } };
  return created.item.id;
}

describe("unpublishAllLocales", () => {
  it("sets every companion _status and the main status to draft", async () => {
    const t = await boot();
    const id = await makeEntry(t);
    await seedCompanion(t, [
      { parent: id, locale: "en", status: "published" },
      { parent: id, locale: "de", status: "published" },
    ]);
    await handlerOf(t).publishAllLocales({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });
    // Precondition: everything is live, so the assertions below cannot pass by
    // observing a document that was never published.
    expect(await readStatuses(t, id)).toEqual({
      en: "published",
      de: "published",
    });

    const res = await handlerOf(t).unpublishAllLocales({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });
    expect(res.success).toBe(true);

    expect(await readStatuses(t, id)).toEqual({ en: "draft", de: "draft" });
    const entry = await handlerOf(t).getEntry({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });
    expect(entry.data?.status).toBe("draft");
  });

  it("takes down a NON-DEFAULT locale, not just the default one", async () => {
    // The defect this whole capability exists for. An ordinary update carrying a
    // locale writes the main row and one companion; a document-wide withdrawal
    // that reached only the default language would leave `de` readable while the
    // release's read path hid the entry, so the translation reappears the moment
    // the projection goes away.
    const t = await boot();
    const id = await makeEntry(t);
    await seedCompanion(t, [
      { parent: id, locale: "en", status: "published" },
      { parent: id, locale: "de", status: "published" },
    ]);

    await handlerOf(t).unpublishAllLocales({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });

    expect((await readStatuses(t, id)).de).toBe("draft");
  });

  it("REFUSES and changes nothing when the companion has no _status column", async () => {
    // A collection localized before Draft/Published was enabled on it. Publishing
    // into this state fails loudly and loses nothing; a takedown that reported
    // success would leave every translation readable, which is the one outcome a
    // withdrawal must never produce.
    const t = await boot();
    const id = await makeEntry(t);
    await handlerOf(t).publishAllLocales({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });
    await seedCompanionWithoutStatus(t, id);

    const res = await handlerOf(t).unpublishAllLocales({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });

    expect(res.success).toBe(false);
    expect(res.message).toContain("nextly migrate");
    // Changed NOTHING — asserted against the STORED row, not through `getEntry`.
    // The read path is degraded by the very column this test removes, so asking
    // it would be asking a witness with the same defect: it answers `undefined`
    // for the status here whether or not the write was refused, which would make
    // this assertion pass for a takedown that had gone ahead.
    expect(await readMainStatus(t, id)).toBe("published");
  });

  it("still publishes every locale — the control", async () => {
    // A withdrawal implemented by breaking the shared core would satisfy every
    // case above while disabling publishing, since both directions now run the
    // same 745 lines.
    const t = await boot();
    const id = await makeEntry(t);
    await seedCompanion(t, [
      { parent: id, locale: "en", status: "draft" },
      { parent: id, locale: "de", status: "draft" },
    ]);

    const res = await handlerOf(t).publishAllLocales({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });

    expect(res.success).toBe(true);
    expect(await readStatuses(t, id)).toEqual({
      en: "published",
      de: "published",
    });
  });
});
