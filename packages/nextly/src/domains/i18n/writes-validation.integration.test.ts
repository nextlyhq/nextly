// M5b: server-side validation is language-aware — a required LOCALIZED field is enforced only
// for the default-locale write; other locales may be blank (they fall back). Shared required
// fields are always enforced. Validation runs BEFORE the DB write and surfaces the offending
// field in the canonical envelope's `errors` array (path/code/message), which the admin maps
// onto form fields; the top-level `message` stays the generic "Validation failed.".

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
        fields: [
          text({ name: "code", localized: false, required: true }), // shared, always required
          text({ name: "heading", required: true }), // localized, required (default-locale only)
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

/** Ensure the migrated shape: companion exists + no localized col on main. The code-first boot
 * sync already provisions both, so this only fills gaps and tolerates the column being absent. */
async function migrate(t: TestNextly): Promise<void> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<unknown>;
  };
  await adapter.executeQuery(
    'CREATE TABLE IF NOT EXISTS "dc_pages_locales" ("_parent" text, "_locale" text, "heading" text, PRIMARY KEY ("_parent","_locale"))'
  );
  try {
    await adapter.executeQuery('ALTER TABLE "dc_pages" DROP COLUMN "heading"');
  } catch (err) {
    // The code-first boot sync already omits the translatable column from the main table,
    // so a missing-column error is expected. Any other failure (syntax, lock, dialect) means
    // the test is running against an unintended schema — rethrow it.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/no such column|does not exist|unknown column/i.test(msg)) {
      throw err;
    }
  }
}

interface ValidationFieldError {
  path: string;
  code: string;
  message: string;
}

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    createEntry: (
      p: Record<string, unknown>,
      body: Record<string, unknown>
    ) => Promise<{
      success: boolean;
      statusCode: number;
      message: string;
      errors?: ValidationFieldError[];
    }>;
  };
}

/** The paths named in a result's canonical `errors` array (empty when none). */
function errorPaths(res: { errors?: ValidationFieldError[] }): string[] {
  return (res.errors ?? []).map(e => e.path);
}

describe("write validation — language-aware required (M5b)", () => {
  it("enforces a required localized field for the default locale (en) with a named 400", async () => {
    const handler = handlerOf(await boot());
    const res = await handler.createEntry(
      { collectionName: "pages", locale: "en", overrideAccess: true },
      { code: "C" } // heading missing
    );
    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(errorPaths(res)).toContain("heading");
  });

  it("passes when the default-locale required localized field is provided", async () => {
    const handler = handlerOf(await boot());
    const res = await handler.createEntry(
      { collectionName: "pages", locale: "en", overrideAccess: true },
      { code: "C", heading: "H" }
    );
    expect(res.success).toBe(true);
  });

  it("allows a blank required localized field for a NON-default locale (de, migrated)", async () => {
    const t = await boot();
    await migrate(t); // localized column now lives on the (nullable) companion
    const res = await handlerOf(t).createEntry(
      { collectionName: "pages", locale: "de", overrideAccess: true },
      { code: "C" } // heading missing — allowed for de (falls back)
    );
    expect(res.success).toBe(true);
  });

  it("always enforces a shared required field, regardless of locale", async () => {
    const handler = handlerOf(await boot());
    const res = await handler.createEntry(
      { collectionName: "pages", locale: "de", overrideAccess: true },
      { heading: "H" } // code (shared, required) missing
    );
    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(errorPaths(res)).toContain("code");
  });
});
