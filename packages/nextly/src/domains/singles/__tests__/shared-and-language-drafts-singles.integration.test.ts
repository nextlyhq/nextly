/**
 * Under per-language storage, a Single's shared part and each of its languages
 * keep a pending change of their own, as a collection entry's do.
 *
 * A held edit is split by part: a shared field's change goes to the Single's
 * one shared draft (stored under no language), a translatable field's to the
 * draft of the language it was made in. Neither draft holds the other part's
 * values. Every language's editor read says whether shared changes are
 * pending, and a public read serves only what is published.
 *
 * Each "absent" assertion stands beside a positive one in the same case.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, number, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

const SLUG = "partsite";
const TRANSLATABLE = ["title", "tagline"];
const SHARED = ["views"];

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<SingleEntryService> {
  current = await createTestNextly({
    dialect,
    perLanguageStorage: true,
    singles: [
      defineSingle({
        slug: SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "title" }),
          text({ name: "tagline" }),
          number({ name: "views" }),
        ],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return current.getService("singleEntryService");
}

async function save(
  singles: SingleEntryService,
  locale: string,
  data: Record<string, unknown>
): Promise<void> {
  const saved = await singles.update(SLUG, data, {
    locale,
    overrideAccess: true,
  });
  expect(saved.success, JSON.stringify(saved)).toBe(true);
}

/** The Single published in English and Spanish, with `views` at 10. */
async function publishedInBoth(singles: SingleEntryService): Promise<void> {
  await save(singles, "en", {
    title: "en title",
    tagline: "en tagline",
    views: 10,
    status: "published",
  });
  await save(singles, "es", {
    title: "es title",
    tagline: "es tagline",
    status: "published",
  });
}

/** The Single's working drafts as stored, by slot (`shared` for none). */
async function drafts(): Promise<Record<string, Record<string, unknown>>> {
  const rows = await current!.adapter.select<{
    locale: string | null;
    snapshot: unknown;
  }>("nextly_versions", {
    where: {
      and: [
        { column: "scopeKind", op: "=", value: "single" },
        { column: "scopeSlug", op: "=", value: SLUG },
        { column: "isAutosave", op: "=", value: false },
        { column: "versionNo", op: "IS NULL" },
        { column: "status", op: "=", value: "draft" },
      ],
    },
  });
  const bySlot: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    bySlot[row.locale ?? "shared"] =
      typeof row.snapshot === "string"
        ? (JSON.parse(row.snapshot) as Record<string, unknown>)
        : (row.snapshot as Record<string, unknown>);
  }
  return bySlot;
}

const carried = (draft: Record<string, unknown>, names: string[]) =>
  names.filter(name => name in draft);

async function read(
  singles: SingleEntryService,
  locale: string,
  editor = false
): Promise<Record<string, unknown>> {
  const res = await singles.get(SLUG, {
    locale,
    overrideAccess: true,
    ...(editor ? { includeWorkingDraft: true, status: "all" as const } : {}),
  });
  expect(res.success, JSON.stringify(res)).toBe(true);
  return res.data as Record<string, unknown>;
}

describe.each(getConfiguredTestDialects())(
  "a Single's shared part and each language get their own draft (integration, %s)",
  dialect => {
    it("keeps one shared draft and one draft per language, each with its own part only", async () => {
      const singles = await boot(dialect);
      await publishedInBoth(singles);

      await save(singles, "en", { title: "en 2", views: 11 });
      await save(singles, "es", { title: "es 2", views: 12 });

      const stored = await drafts();
      expect(Object.keys(stored).sort()).toEqual(["en", "es", "shared"]);
      expect(stored.shared.views).toBe(12);
      expect(carried(stored.shared, TRANSLATABLE)).toEqual([]);
      expect(stored.en.title).toBe("en 2");
      expect(stored.es.title).toBe("es 2");
      expect(carried(stored.en, SHARED)).toEqual([]);
      expect(carried(stored.es, SHARED)).toEqual([]);
      // Nothing published moved.
      expect(await read(singles, "es")).toMatchObject({
        title: "es title",
        views: 10,
      });
    }, 90_000);

    it("records a shared edit made in a non-default language in the shared draft, and tells every language", async () => {
      const singles = await boot(dialect);
      await publishedInBoth(singles);

      await save(singles, "es", { views: 20 });

      const stored = await drafts();
      expect(Object.keys(stored)).toEqual(["shared"]);
      expect(stored.shared.views).toBe(20);
      for (const locale of ["en", "es"]) {
        const editor = await read(singles, locale, true);
        expect(editor.views).toBe(20);
        expect(editor._sharedChangesPending).toBe(true);
      }
    }, 90_000);

    it("records a translatable edit in that language's draft only", async () => {
      const singles = await boot(dialect);
      await publishedInBoth(singles);

      await save(singles, "es", { tagline: "es tagline 2" });

      const stored = await drafts();
      expect(Object.keys(stored)).toEqual(["es"]);
      expect(stored.es.tagline).toBe("es tagline 2");
      expect(carried(stored.es, SHARED)).toEqual([]);
      expect((await read(singles, "es", true)).tagline).toBe("es tagline 2");
      expect((await read(singles, "en", true)).tagline).toBe("en tagline");
      expect((await read(singles, "en", true))._sharedChangesPending).toBe(
        false
      );
    }, 90_000);

    it("publishes a language's draft with the shared draft, and keeps the other language's", async () => {
      const singles = await boot(dialect);
      await publishedInBoth(singles);
      await save(singles, "en", { title: "en 2" });
      await save(singles, "es", { title: "es 2", views: 40 });

      await save(singles, "es", { status: "published" });

      expect(await read(singles, "es")).toMatchObject({
        title: "es 2",
        views: 40,
      });
      expect((await read(singles, "en")).title).toBe("en title");
      expect(Object.keys(await drafts())).toEqual(["en"]);
    }, 90_000);

    it("publishes every language with a shared edit made in a non-default language", async () => {
      const singles = await boot(dialect);
      await publishedInBoth(singles);
      await save(singles, "es", { views: 60 });

      const published = await singles.publishAllLocales(SLUG, {
        overrideAccess: true,
      });

      expect(published.success, JSON.stringify(published)).toBe(true);
      for (const locale of ["en", "es"]) {
        expect((await read(singles, locale)).views).toBe(60);
      }
      expect(await drafts()).toEqual({});
    }, 90_000);
  }
);
