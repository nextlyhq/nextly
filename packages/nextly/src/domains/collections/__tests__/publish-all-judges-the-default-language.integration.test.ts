// Publishing every language judges the default language too, with or without
// a translation row of its own.
//
// The main row goes live with the default language, and a default language
// that only ever received shared values stores no translation row. Judged
// only by the rows the translations keep, such a document would go live
// without its default-language rules ever being asked, `required` among them.

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

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
  publishAllLocales(params: {
    collectionName: string;
    entryId: string;
    overrideAccess?: boolean;
  }): Promise<{ success: boolean }>;
}

async function boot(): Promise<{ t: TestNextly; entries: Entries }> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "notices",
        status: true,
        localized: true,
        fields: [
          text({ name: "heading", localized: true, required: true }),
          text({ name: "tag" }),
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  const entries = (
    current.getService("collectionsHandler") as unknown as {
      getEntryService(): Entries;
    }
  ).getEntryService();
  return { t: current, entries };
}

describe("publishing every language of an entry", () => {
  it("refuses when the default language, holding no translation row, breaks its own rules", async () => {
    const { t, entries } = await boot();
    const created = await entries.createEntry(
      { collectionName: "notices", overrideAccess: true, locale: "en" },
      { heading: "Notice", tag: "general", status: "draft" }
    );
    expect(created.success, JSON.stringify(created)).toBe(true);
    const id = String((created.data as { id: unknown }).id);
    const german = await entries.updateEntry(
      {
        collectionName: "notices",
        entryId: id,
        locale: "de",
        overrideAccess: true,
      },
      { heading: "Hinweis", status: "draft" }
    );
    expect(german.success, JSON.stringify(german)).toBe(true);
    // The default language's row removed, as a document whose default
    // language only ever received shared values stores none.
    await t.adapter.delete("dc_notices_locales", {
      and: [{ column: "_locale", op: "=", value: "en" }],
    });

    const result = await entries.publishAllLocales({
      collectionName: "notices",
      entryId: id,
      overrideAccess: true,
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('"path":"heading"');
  });
});

describe("publishing every language of an entry, with a language since removed", () => {
  it("does not judge a removed language's leftover row, which no request can reach to repair", async () => {
    const { t, entries } = await boot();
    const created = await entries.createEntry(
      { collectionName: "notices", overrideAccess: true, locale: "en" },
      { heading: "Notice", tag: "general", status: "draft" }
    );
    const id = String((created.data as { id: unknown }).id);
    // A German draft whose heading falls back to English, as a translation
    // may: required is enforced on the default language only.
    const german = await entries.updateEntry(
      {
        collectionName: "notices",
        entryId: id,
        locale: "de",
        overrideAccess: true,
      },
      { tag: "general", status: "draft" }
    );
    expect(german.success, JSON.stringify(german)).toBe(true);
    // The row relabelled to a language the app no longer configures, as one
    // left behind when a locale is removed.
    await t.adapter.update(
      "dc_notices_locales",
      { _locale: "fr" },
      { and: [{ column: "_locale", op: "=", value: "de" }] }
    );

    const result = await entries.publishAllLocales({
      collectionName: "notices",
      entryId: id,
      overrideAccess: true,
    });

    expect(result.success, JSON.stringify(result)).toBe(true);
  });
});
