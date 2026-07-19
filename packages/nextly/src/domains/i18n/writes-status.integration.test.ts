// M6b: writes set the companion `_status` for the write's locale (draft default on create;
// changes on update ONLY when `status` is explicitly in the patch, so editing content doesn't
// un-publish it).

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

// Create the companion (with per-locale `_status`). We intentionally do NOT drop the localized
// column from the main table here: a *fully*-migrated collection exposes a separate, pre-existing
// updateEntry limitation (it references dropped localized columns in pre-write machinery) that is
// out of scope for M6 — see the i18n progress memo. The companion `_status` write logic is
// independent of that and is what this suite exercises.
async function migrate(t: TestNextly): Promise<void> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<unknown>;
  };
  await adapter.executeQuery(
    'CREATE TABLE IF NOT EXISTS "dc_pages_locales" ("_parent" text, "_locale" text, "_status" text NOT NULL DEFAULT \'draft\', "heading" text, PRIMARY KEY ("_parent","_locale"))'
  );
}

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    createEntry: (
      p: Record<string, unknown>,
      body: Record<string, unknown>
    ) => Promise<{ success: boolean }>;
    updateEntry: (
      p: Record<string, unknown>,
      body: Record<string, unknown>
    ) => Promise<{ success: boolean }>;
  };
}

async function companionStatus(
  t: TestNextly,
  locale: string
): Promise<string | undefined> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<{ _status: string }[]>;
  };
  const rows = await adapter.executeQuery(
    `SELECT "_status" FROM "dc_pages_locales" WHERE "_locale"='${locale}'`
  );
  return rows[0]?._status;
}

async function idOf(t: TestNextly): Promise<string> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<{ id: string }[]>;
  };
  return (await adapter.executeQuery('SELECT "id" FROM "dc_pages"'))[0].id;
}

// Main-table `status` gates entry-level visibility (the read path filters on it),
// so a per-locale status change must not touch it for a non-default locale (H3).
async function mainStatus(t: TestNextly): Promise<string | undefined> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<{ status: string }[]>;
  };
  const rows = await adapter.executeQuery('SELECT "status" FROM "dc_pages"');
  return rows[0]?.status;
}

describe("write companion _status (M6b)", () => {
  it("create defaults the companion _status to draft", async () => {
    const t = await boot();
    await migrate(t);
    await handlerOf(t).createEntry(
      { collectionName: "pages", locale: "de", overrideAccess: true },
      { title: "T", heading: "H" }
    );
    expect(await companionStatus(t, "de")).toBe("draft");
  });

  it("create with status=published sets the companion _status to published", async () => {
    const t = await boot();
    await migrate(t);
    await handlerOf(t).createEntry(
      { collectionName: "pages", locale: "de", overrideAccess: true },
      { title: "T", heading: "H", status: "published" }
    );
    expect(await companionStatus(t, "de")).toBe("published");
  });

  it("update WITHOUT status leaves _status unchanged; update WITH status changes it", async () => {
    const t = await boot();
    await migrate(t);
    const h = handlerOf(t);
    await h.createEntry(
      { collectionName: "pages", locale: "de", overrideAccess: true },
      { title: "T", heading: "H", status: "published" }
    );
    const id = await idOf(t);

    // Content-only update → still published.
    await h.updateEntry(
      {
        collectionName: "pages",
        entryId: id,
        locale: "de",
        overrideAccess: true,
      },
      { heading: "H2" }
    );
    expect(await companionStatus(t, "de")).toBe("published");

    // Explicit status change → draft.
    await h.updateEntry(
      {
        collectionName: "pages",
        entryId: id,
        locale: "de",
        overrideAccess: true,
      },
      { status: "draft" }
    );
    expect(await companionStatus(t, "de")).toBe("draft");
  });

  // H3: a per-locale status change for a NON-default locale must not clobber the
  // main table's status (which the read path uses to gate entry-level visibility).
  it("status change on a non-default locale leaves the main status untouched", async () => {
    const t = await boot();
    await migrate(t);
    const h = handlerOf(t);
    // Create in the default locale (en) as published → main.status = published.
    await h.createEntry(
      { collectionName: "pages", locale: "en", overrideAccess: true },
      { title: "T", heading: "H", status: "published" }
    );
    const id = await idOf(t);
    expect(await mainStatus(t)).toBe("published");

    // Unpublish the German translation only.
    await h.updateEntry(
      {
        collectionName: "pages",
        entryId: id,
        locale: "de",
        overrideAccess: true,
      },
      { status: "draft" }
    );
    expect(await companionStatus(t, "de")).toBe("draft");
    // The entry (and its default/English content) must remain published.
    expect(await mainStatus(t)).toBe("published");
  });

  // H3: the default-locale write IS the entry-level status action → main updates.
  it("status change on the default locale updates the main status", async () => {
    const t = await boot();
    await migrate(t);
    const h = handlerOf(t);
    await h.createEntry(
      { collectionName: "pages", locale: "en", overrideAccess: true },
      { title: "T", heading: "H", status: "published" }
    );
    const id = await idOf(t);
    expect(await mainStatus(t)).toBe("published");

    await h.updateEntry(
      {
        collectionName: "pages",
        entryId: id,
        locale: "en",
        overrideAccess: true,
      },
      { status: "draft" }
    );
    expect(await mainStatus(t)).toBe("draft");
    expect(await companionStatus(t, "en")).toBe("draft");
  });
});
