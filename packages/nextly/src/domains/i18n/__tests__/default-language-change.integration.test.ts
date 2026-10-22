/**
 * Making another language the default, on each dialect: a site that adds a language in Settings
 * can translate content at once, the summary counts each language's translations, the change moves
 * no data and the registry serves the new default, and a change with pending changes in the current
 * default is refused.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { LanguageRegistry } from "../language-registry";
import { LanguageSettingsService } from "../services/language-settings-service";

describeEachDialect("making another language the default", dialect => {
  let current: TestNextly | undefined;

  beforeEach(() => {
    // The Builder applies a collection's migration in development only.
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    await current?.destroy();
    current = undefined;
    vi.unstubAllEnvs();
  });

  async function boot() {
    current = await createTestNextly({ dialect, collections: [] });
    const registry = current.getService("languageRegistry") as LanguageRegistry;
    return {
      registry,
      settings: new LanguageSettingsService(current.adapter, registry),
    };
  }

  /** A translated collection holding one entry, in English and in French. */
  async function seedTranslated(t: TestNextly): Promise<string> {
    const handler = t.getService(
      "collectionsHandler"
    ) as unknown as CollectionsHandler;
    const created = await handler.createCollection({
      name: "posts",
      label: "Post",
      localized: true,
      fields: [{ name: "heading", type: "text" }],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const entries = handler.getEntryService();
    const entry = await entries.createEntry(
      { collectionName: "posts", overrideAccess: true, locale: "en" },
      { heading: "Hello" }
    );
    expect(entry.success, JSON.stringify(entry)).toBe(true);
    const id = String((entry.data as { id: unknown }).id);
    const french = await entries.updateEntry(
      {
        collectionName: "posts",
        entryId: id,
        overrideAccess: true,
        locale: "fr",
      },
      { heading: "Bonjour" }
    );
    expect(french.success, JSON.stringify(french)).toBe(true);
    return id;
  }

  it("counts each language's translations, then makes French the default with nothing moved", async () => {
    const { registry, settings } = await boot();
    await settings.change({ kind: "add", code: "fr", label: "French" });
    await seedTranslated(current!);

    const summary = await settings.previewDefaultChange("fr");
    expect(summary).toMatchObject({
      from: "en",
      to: "fr",
      translationsPerLanguage: { en: 1, fr: 1 },
      pendingInCurrentDefault: 0,
    });

    await settings.change({ kind: "setDefault", code: "fr" });

    expect(registry.current()?.defaultLocale).toBe("fr");
    expect(
      (await settings.previewDefaultChange("en")).translationsPerLanguage
    ).toEqual({ en: 1, fr: 1 });
  });

  it("refuses the change while the current default has a pending change", async () => {
    const { settings } = await boot();
    await settings.change({ kind: "add", code: "fr", label: "French" });
    const now = new Date();
    await current!.adapter.transaction(tx =>
      tx.insert("nextly_versions", {
        id: "pending-en",
        scopeKind: "collection",
        scopeSlug: "posts",
        entryId: "entry-1",
        status: "draft",
        isAutosave: false,
        snapshot: JSON.stringify({}),
        locale: "en",
        draftKey: "pending-en-key",
        createdAt: now,
        updatedAt: now,
      })
    );

    await expect(
      settings.change({ kind: "setDefault", code: "fr" })
    ).rejects.toMatchObject({
      publicData: {
        errors: [
          expect.objectContaining({ code: "default_has_pending_changes" }),
        ],
      },
    });
    expect(
      (await settings.previewDefaultChange("fr")).pendingInCurrentDefault
    ).toBe(1);
  });
});
