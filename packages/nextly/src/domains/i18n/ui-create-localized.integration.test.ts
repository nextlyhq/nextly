// i18n: creating a localized collection through the UI/dynamic path (collectionsHandler
// .createCollection) must persist `localized: true`, build the main table WITHOUT the
// translatable columns, and create the companion `_locales` table — end-to-end, so a
// UI-created localized collection stores per-language values instead of sharing one column.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dispatchSingles } from "../../dispatcher/handlers/single-dispatcher";
import { NextlyError } from "../../errors";
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
    createCollection: (data: Record<string, unknown>) => Promise<{
      success: boolean;
      statusCode: number;
      message?: string;
    }>;
    updateCollection: (
      params: { collectionName: string },
      body: Record<string, unknown>
    ) => Promise<{ success: boolean; statusCode: number; message?: string }>;
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

  // The real builder flow: the wizard creates the collection with NO fields (so no
  // companion yet), then fields are added via the update path. Adding a translatable
  // field must create the companion and route the column there (not to main).
  it("routes fields added AFTER create (update path) to the companion", async () => {
    const t = await boot();
    // Wizard create — empty, localized. No companion yet (no translatable fields).
    await handlerOf(t).createCollection({
      name: "notes",
      label: "Note",
      status: true,
      localized: true,
      fields: [],
    });
    expect(await tableExists(t, "dc_notes_locales")).toBe(false);

    // Builder canvas save — add a translatable text field.
    await handlerOf(t).updateCollection(
      { collectionName: "notes" },
      { fields: [{ name: "body", type: "text" }] }
    );

    // Companion now exists with the field; the main table does NOT carry it.
    expect(await tableExists(t, "dc_notes_locales")).toBe(true);
    expect(await columns(t, "dc_notes_locales")).toContain("body");
    expect(await columns(t, "dc_notes")).not.toContain("body");

    // Add a second translatable field — ALTERs the existing companion.
    await handlerOf(t).updateCollection(
      { collectionName: "notes" },
      {
        fields: [
          { name: "body", type: "text" },
          { name: "summary", type: "textarea" },
        ],
      }
    );
    const compCols = await columns(t, "dc_notes_locales");
    expect(compCols).toContain("body");
    expect(compCols).toContain("summary");
    expect(await columns(t, "dc_notes")).not.toContain("summary");
  });
});

// Enabling entity-level localization REQUIRES the app-level `localization`
// config: the DDL path splits storage unconditionally while the runtime
// resolves locales from that config, so an app without it would get a schema
// every write 500s against ("table dc_x has no column named y"). The create
// and enable paths must reject with a validation error instead.
describe("UI-created localized entities without app localization config", () => {
  async function bootWithoutLocalization(): Promise<TestNextly> {
    current = await createTestNextly({ collections: [] });
    return current;
  }

  it("rejects a localized collection create with a 400 and builds no tables", async () => {
    const t = await bootWithoutLocalization();
    const result = await handlerOf(t).createCollection({
      name: "broken",
      label: "Broken",
      status: true,
      localized: true,
      fields: [{ name: "heading", type: "text" }],
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    // Rejected before any DDL: neither the split main table nor the
    // companion exists.
    expect(await tableExists(t, "dc_broken")).toBe(false);
    expect(await tableExists(t, "dc_broken_locales")).toBe(false);
  });

  it("rejects ENABLING i18n on an existing collection without the config", async () => {
    const t = await bootWithoutLocalization();
    await handlerOf(t).createCollection({
      name: "plain",
      label: "Plain",
      status: true,
      localized: false,
      fields: [{ name: "heading", type: "text" }],
    });

    const result = await handlerOf(t).updateCollection(
      { collectionName: "plain" },
      { localized: true }
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    // The main table keeps its translatable column — no split happened.
    expect(await columns(t, "dc_plain")).toContain("heading");
    expect(await tableExists(t, "dc_plain_locales")).toBe(false);
  });

  it("rejects a localized single create and builds no tables", async () => {
    const t = await bootWithoutLocalization();
    // The dispatcher throws NextlyError.validation; its public message is
    // the generic validation envelope, so the specific reason is asserted
    // via logContext.
    const err = await dispatchSingles(
      "createSingle",
      {},
      {
        slug: "broken-page",
        label: "Broken page",
        status: true,
        localized: true,
        fields: [],
      }
    ).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(NextlyError);
    expect((err as NextlyError).logContext?.reason).toBe(
      "localization-not-configured"
    );
    expect(await tableExists(t, "single_broken_page")).toBe(false);
    expect(await tableExists(t, "single_broken_page_locales")).toBe(false);
  });

  it("still allows a NON-localized create without the config", async () => {
    const t = await bootWithoutLocalization();
    const result = await handlerOf(t).createCollection({
      name: "regular",
      label: "Regular",
      fields: [{ name: "heading", type: "text" }],
    });
    expect(result.success).toBe(true);
    expect(await tableExists(t, "dc_regular")).toBe(true);
  });
});
