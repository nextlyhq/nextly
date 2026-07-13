// i18n: creating a localized collection through the UI/dynamic path (collectionsHandler
// .createCollection) must persist `localized: true`, build the main table WITHOUT the
// translatable columns, and create the companion `_locales` table — end-to-end, so a
// UI-created localized collection stores per-language values instead of sharing one column.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";

// The UI-create path only runs the generated migration in development (it otherwise
// persists metadata + a pending migration). Force dev so the physical main + companion
// tables are actually created and we can assert on them.
let prevNodeEnv: string | undefined;
beforeEach(() => {
  prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
});

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  process.env.NODE_ENV = prevNodeEnv;
});

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    createCollection: (data: Record<string, unknown>) => Promise<unknown>;
  };
}

async function columns(t: TestNextly, table: string): Promise<string[]> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<Record<string, unknown>[]>;
  };
  // sqlite: PRAGMA table_info returns one row per column with a `name` field.
  const rows = await adapter.executeQuery(`PRAGMA table_info("${table}")`);
  return rows.map(r => String(r.name));
}

async function tableExists(t: TestNextly, table: string): Promise<boolean> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<Record<string, unknown>[]>;
  };
  const rows = await adapter.executeQuery(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`
  );
  return rows.length > 0;
}

describe("UI-created localized collection (create path)", () => {
  it("persists localized, omits translatable cols from main, creates the companion", async () => {
    const t = await boot();
    await handlerOf(t).createCollection({
      name: "articles",
      label: "Article",
      status: true,
      localized: true,
      fields: [
        { name: "heading", type: "text" }, // translatable → companion
        { name: "views", type: "number" }, // shared → main
      ],
    });

    // Main table exists WITHOUT the translatable column, WITH the shared one.
    const mainCols = await columns(t, "dc_articles");
    expect(mainCols).toContain("views");
    expect(mainCols).not.toContain("heading");

    // Companion table was created with the translatable column + per-locale system cols.
    expect(await tableExists(t, "dc_articles_locales")).toBe(true);
    const compCols = await columns(t, "dc_articles_locales");
    expect(compCols).toContain("_parent");
    expect(compCols).toContain("_locale");
    expect(compCols).toContain("_status"); // status: true → per-locale _status
    expect(compCols).toContain("heading");

    // Metadata persisted localized = true.
    const adapter = t.adapter as unknown as {
      executeQuery: (sql: string) => Promise<{ localized: unknown }[]>;
    };
    const rows = await adapter.executeQuery(
      `SELECT localized FROM dynamic_collections WHERE slug='articles'`
    );
    expect(rows[0]?.localized === 1 || rows[0]?.localized === true).toBe(true);
  });
});
