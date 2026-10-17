/**
 * The Schema Builder's preview says what a field leaving translation moves to the archive.
 *
 * Making a translated field shared archives every non-default language's value and keeps the
 * default language's as the shared one. The preview the builder shows before Apply has to say
 * so: how many values in which languages move, and how to bring them back. A field that cannot
 * leave translation in one change is refused there, before Apply, rather than after it.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

const LOCALES = ["en", "es", "ar"];
const TRANSLATED = [
  { name: "heading", type: "text" },
  { name: "views", type: "number" },
];
const SHARED = [
  { name: "heading", type: "text", localized: false },
  { name: "views", type: "number" },
];

/** What the preview reports for one field leaving translation. */
interface LeavingTranslation {
  name: string;
  byLocale: Record<string, number>;
  total: number;
  defaultLocale: string;
  restoreCommand: string;
  refusal?: { reason: string; steps: string[] };
}

interface Preview {
  hasChanges: boolean;
  leavingTranslation?: LeavingTranslation[];
}

interface Entries {
  createEntry(
    params: {
      collectionName: string;
      overrideAccess?: boolean;
      locale?: string;
    },
    data: Record<string, unknown>
  ): Promise<{ success: boolean; data: unknown }>;
  updateEntry(
    params: {
      collectionName: string;
      entryId: string;
      overrideAccess?: boolean;
      locale?: string;
    },
    data: Record<string, unknown>
  ): Promise<{ success: boolean }>;
}

interface CollectionsHandler {
  createCollection(data: Record<string, unknown>): Promise<{
    success: boolean;
    message?: string;
  }>;
  getEntryService(): Entries;
}

function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

async function bodyOf(response: unknown): Promise<Preview> {
  const data = (await (response as Response).json()) as Preview & {
    data?: Preview;
  };
  return data.data ?? data;
}

describeEachDialect("the preview of a field leaving translation", dialect => {
  let current: TestNextly;

  beforeEach(async () => {
    vi.stubEnv("NODE_ENV", "development");
    current = await createTestNextly({
      dialect,
      collections: [],
      localization: { locales: LOCALES, defaultLocale: "en" },
    });
  });

  afterEach(async () => {
    await current.destroy();
    vi.unstubAllEnvs();
  });

  async function query<T>(sql: string): Promise<T[]> {
    return (
      current.adapter as unknown as {
        executeQuery<R>(statement: string): Promise<R[]>;
      }
    ).executeQuery<T>(sql);
  }

  const handler = () =>
    current.getService("collectionsHandler") as unknown as CollectionsHandler;

  /** Two entries: both with Spanish, one with Arabic. */
  async function seedCollection(
    fields: Record<string, unknown>[] = TRANSLATED
  ): Promise<void> {
    const created = await handler().createCollection({
      name: "posts",
      label: "Post",
      localized: true,
      fields,
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const entries = handler().getEntryService();
    for (const [title, translations] of [
      ["One", { es: "Uno", ar: "واحد" }],
      ["Two", { es: "Dos" }],
    ] as const) {
      const entry = await entries.createEntry(
        { collectionName: "posts", overrideAccess: true, locale: "en" },
        { heading: title, views: 1 }
      );
      expect(entry.success, JSON.stringify(entry)).toBe(true);
      const id = String((entry.data as { id: unknown }).id);
      for (const [locale, value] of Object.entries(translations)) {
        const translated = await entries.updateEntry(
          {
            collectionName: "posts",
            entryId: id,
            overrideAccess: true,
            locale,
          },
          { heading: value }
        );
        expect(translated.success, JSON.stringify(translated)).toBe(true);
      }
    }
  }

  it("counts a collection's values by language and names the restore", async () => {
    await seedCollection();

    const preview = await bodyOf(
      await dispatchCollections(
        {} as ServiceContainer,
        "previewSchemaChanges",
        { collectionName: "posts" },
        { fields: SHARED, localized: true }
      )
    );

    // A change, so the builder opens its dialog rather than saving straight away; which dialog
    // is the admin's to choose, from the list below.
    expect(preview.hasChanges).toBe(true);
    expect(preview.leavingTranslation).toEqual([
      {
        name: "heading",
        byLocale: { ar: 1, es: 2 },
        total: 3,
        defaultLocale: "en",
        restoreCommand:
          "nextly i18n:restore --collection posts --field heading",
      },
    ]);
  });

  it("names the refusal before Apply for a field that cannot leave in one change", async () => {
    await seedCollection([
      { name: "heading", type: "text", required: true },
      { name: "views", type: "number" },
    ]);

    const preview = await bodyOf(
      await dispatchCollections(
        {} as ServiceContainer,
        "previewSchemaChanges",
        { collectionName: "posts" },
        {
          fields: [
            { name: "heading", type: "text", required: true, localized: false },
            { name: "views", type: "number" },
          ],
          localized: true,
        }
      )
    );

    expect(preview.leavingTranslation?.[0]?.refusal).toEqual({
      reason:
        "A required field can't stop being translated in the same change.",
      steps: [
        "Turn off Required and save.",
        "Turn off Localized and save.",
        "Turn Required back on and save.",
      ],
    });
  });

  it("counts a Single's values", async () => {
    await dispatchSingles(
      "createSingle",
      {},
      { slug: "hero", label: "Hero", localized: true, fields: TRANSLATED }
    );
    const singles: SingleEntryService =
      current.getService("singleEntryService");
    for (const [locale, value] of [
      ["en", "Hello"],
      ["es", "Hola"],
    ]) {
      const written = await singles.update(
        "hero",
        { heading: value },
        { locale, overrideAccess: true }
      );
      expect(written.success, JSON.stringify(written)).toBe(true);
    }

    const preview = await bodyOf(
      await dispatchSingles(
        "previewSingleSchemaChanges",
        { slug: "hero" },
        { fields: SHARED, localized: true }
      )
    );

    expect(preview.leavingTranslation).toEqual([
      expect.objectContaining({
        name: "heading",
        byLocale: { es: 1 },
        total: 1,
        restoreCommand: "nextly i18n:restore --collection hero --field heading",
      }),
    ]);
  });

  it("counts a field group's values", async () => {
    await dispatchComponents(
      "createComponent",
      {},
      { slug: "promo", label: "Promo", localized: true, fields: TRANSLATED }
    );
    await query(
      `INSERT INTO ${quote(dialect, "comp_promo")} (${["id", "_parent_id", "_parent_table", "_parent_field", "views"].map(c => quote(dialect, c)).join(", ")}) ` +
        `VALUES ('promo-1', 'entry-1', 'dc_pages', 'promo', 7)`
    );
    for (const [locale, value] of [
      ["en", "Hello"],
      ["es", "Hola"],
      ["ar", "مرحبا"],
    ]) {
      await query(
        `INSERT INTO ${quote(dialect, "comp_promo_locales")} (${["_parent", "_locale", "heading"].map(c => quote(dialect, c)).join(", ")}) ` +
          `VALUES ('promo-1', '${locale}', '${value}')`
      );
    }

    const preview = await bodyOf(
      await dispatchComponents(
        "previewComponentSchemaChanges",
        { slug: "promo" },
        { fields: SHARED, localized: true }
      )
    );

    expect(preview.leavingTranslation).toEqual([
      expect.objectContaining({
        name: "heading",
        byLocale: { ar: 1, es: 1 },
        total: 2,
      }),
    ]);
  });
});
