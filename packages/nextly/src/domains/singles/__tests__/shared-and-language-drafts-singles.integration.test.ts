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

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";

import {
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  number,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

const SLUG = "partsite";
/** Translated, with its translatable `title` required. */
const REQUIRED = "partreqsite";
/** Translated, with a publish rule that refuses Spanish. */
const GUARDED = "partguardsite";
const PUBLISHER = "part-site-publisher";
/** Untranslated, with no translatable field of its own: only a component. */
const COMPONENTED = "partcompsite";
const HERO = "partsitehero";
/** Translated, with a component inside a named group. */
const NESTED = "partnestsite";
/** Translated, with a shared field no caller but a trusted one may update. */
const FIELD_GUARDED = "partfieldsite";
const EDITOR = "part-site-editor";
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
      defineSingle({
        slug: REQUIRED,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "title", required: true }),
          number({ name: "views" }),
        ],
      }),
      defineSingle({
        slug: GUARDED,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          // Asked once for each language a publish puts live.
          publish: ({ locale }) => locale !== "es",
        },
        fields: [text({ name: "title" }), number({ name: "views" })],
      }),
      defineSingle({
        slug: NESTED,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "title" }),
          group({
            name: "layout",
            fields: [fieldGroup({ name: "hero", component: HERO })],
          }),
        ],
      }),
      defineSingle({
        slug: FIELD_GUARDED,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "title" }),
          number({ name: "views", access: { update: () => false } }),
        ],
      }),
      defineSingle({
        slug: COMPONENTED,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          number({ name: "views" }),
          fieldGroup({ name: "hero", component: HERO }),
        ],
      }),
    ],
    fieldGroups: [
      defineFieldGroup({ slug: HERO, fields: [text({ name: "heading" })] }),
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
  // Every save here replaces what is stored, as an editor's save does.
  const saved = await singles.update(
    SLUG,
    { ...data, _overwrite: true },
    {
      locale,
      overrideAccess: true,
    }
  );
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
async function drafts(
  slug: string = SLUG
): Promise<Record<string, Record<string, unknown>>> {
  const rows = await current!.adapter.select<{
    locale: string | null;
    snapshot: unknown;
  }>("nextly_versions", {
    where: {
      and: [
        { column: "scopeKind", op: "=", value: "single" },
        { column: "scopeSlug", op: "=", value: slug },
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
        data: { _overwrite: true },
        overrideAccess: true,
      });

      expect(published.success, JSON.stringify(published)).toBe(true);
      for (const locale of ["en", "es"]) {
        expect((await read(singles, locale)).views).toBe(60);
      }
      expect(await drafts()).toEqual({});
    }, 90_000);

    it("asks every language's publish rule about a shared-only draft a publish of every language puts live", async () => {
      const singles = await boot(dialect);
      await userWhoMay(current!, PUBLISHER, "update", [GUARDED]);
      for (const action of ["read", "publish"]) {
        await grantTo(current!, PUBLISHER, action, [GUARDED]);
      }
      // Live in both languages, so the Spanish edit below is held: a save in
      // a language that is not live yet is written live, and holds nothing.
      for (const [locale, title] of [
        ["en", "en title"],
        ["es", "es title"],
      ]) {
        const saved = await singles.update(
          GUARDED,
          {
            _overwrite: true,
            title,
            ...(locale === "en" ? { views: 10 } : {}),
            status: "published",
          },
          { locale, overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
      }
      const held = await singles.update(
        GUARDED,
        { _overwrite: true, views: 70 },
        { locale: "es", overrideAccess: true }
      );
      expect(held.success, JSON.stringify(held)).toBe(true);

      const published = await singles
        .update(
          GUARDED,
          { _overwrite: true, status: "published" },
          {
            locale: "*",
            user: { id: PUBLISHER, email: `${PUBLISHER}@example.test` },
            overrideAccess: false,
          }
        )
        .catch((error: unknown) => error);

      expect(published).toMatchObject({ statusCode: 403 });
      const live = await singles.get(GUARDED, {
        locale: "en",
        overrideAccess: true,
      });
      expect((live.data as { views?: unknown }).views).toBe(10);
    }, 90_000);

    it("publishes every language with a shared edit where a translated field is required", async () => {
      const singles = await boot(dialect);
      for (const [locale, title] of [
        ["en", "en title"],
        ["es", "es title"],
      ]) {
        const saved = await singles.update(
          REQUIRED,
          {
            _overwrite: true,
            title,
            ...(locale === "en" ? { views: 10 } : {}),
            status: "published",
          },
          { locale, overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
      }
      const held = await singles.update(
        REQUIRED,
        { _overwrite: true, views: 80 },
        { locale: "es", overrideAccess: true }
      );
      expect(held.success, JSON.stringify(held)).toBe(true);

      const published = await singles.publishAllLocales(REQUIRED, {
        data: { _overwrite: true },
        overrideAccess: true,
      });

      expect(published.success, JSON.stringify(published)).toBe(true);
      for (const locale of ["en", "es"]) {
        const live = await singles.get(REQUIRED, {
          locale,
          overrideAccess: true,
        });
        expect((live.data as { views?: unknown }).views).toBe(80);
      }
    }, 90_000);

    // Components are kept per language under the setting, so a held edit of
    // one is the language's, even on a Single with no translatable field of
    // its own: made in Spanish, it is Spanish's draft.
    it("keys an untranslated Single's held component edit by the language it was made in", async () => {
      const singles = await boot(dialect);
      const first = await singles.update(
        COMPONENTED,
        {
          _overwrite: true,
          views: 1,
          hero: { heading: "en heading" },
          status: "published",
        },
        { locale: "en", overrideAccess: true }
      );
      expect(first.success, JSON.stringify(first)).toBe(true);

      const held = await singles.update(
        COMPONENTED,
        { _overwrite: true, hero: { heading: "es heading" } },
        { locale: "es", overrideAccess: true }
      );
      expect(held.success, JSON.stringify(held)).toBe(true);

      const rows = await current!.adapter.select<{ locale: string | null }>(
        "nextly_versions",
        {
          where: {
            and: [
              { column: "scopeKind", op: "=", value: "single" },
              { column: "scopeSlug", op: "=", value: COMPONENTED },
              { column: "isAutosave", op: "=", value: false },
              { column: "versionNo", op: "IS NULL" },
              { column: "status", op: "=", value: "draft" },
            ],
          },
        }
      );
      expect(rows.map(row => row.locale ?? "shared")).toEqual(["es"]);
    }, 90_000);

    // A component is kept per language wherever it sits, so a held edit to
    // one inside a named group is the language's, never the shared draft's.
    it("keys a held edit to a component inside a named group by its language", async () => {
      const singles = await boot(dialect);
      for (const locale of ["en", "es"]) {
        const saved = await singles.update(
          NESTED,
          {
            _overwrite: true,
            title: `${locale} title`,
            layout: { hero: { heading: `${locale} heading` } },
            status: "published",
          },
          { locale, overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
      }

      const held = await singles.update(
        NESTED,
        { _overwrite: true, layout: { hero: { heading: "es held" } } },
        { locale: "es", overrideAccess: true }
      );
      expect(held.success, JSON.stringify(held)).toBe(true);

      expect(Object.keys(await drafts(NESTED)).sort()).toEqual(["es"]);
    }, 90_000);

    // A publish of every language judges a shared-only draft's values under
    // the publisher's field rules, even where every language it puts live is
    // already stored: a publisher who may not update a shared field cannot
    // put another author's held edit to it live.
    it("refuses a publish of every language whose shared draft holds a field the publisher may not update", async () => {
      const singles = await boot(dialect);
      await userWhoMay(current!, EDITOR, "update", [FIELD_GUARDED]);
      for (const action of ["read", "publish"]) {
        await grantTo(current!, EDITOR, action, [FIELD_GUARDED]);
      }
      for (const [locale, title] of [
        ["en", "en title"],
        ["es", "es title"],
      ]) {
        const saved = await singles.update(
          FIELD_GUARDED,
          {
            _overwrite: true,
            title,
            ...(locale === "en" ? { views: 10 } : {}),
            status: "published",
          },
          { locale, overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
      }
      // Another author's held edit to the guarded shared field.
      const held = await singles.update(
        FIELD_GUARDED,
        { _overwrite: true, views: 70 },
        { locale: "es", overrideAccess: true }
      );
      expect(held.success, JSON.stringify(held)).toBe(true);

      const published = await singles
        .publishAllLocales(FIELD_GUARDED, {
          data: { _overwrite: true },
          user: { id: EDITOR, email: `${EDITOR}@example.test` },
          overrideAccess: false,
        })
        .catch((error: unknown) => ({ success: false, error }));

      expect(published.success, JSON.stringify(published)).toBe(false);
      // Refused by the field rule, not for a missing version.
      expect(JSON.stringify(published)).not.toContain("VERSION_REQUIRED");
      const live = await singles.get(FIELD_GUARDED, {
        locale: "en",
        overrideAccess: true,
      });
      expect((live.data as { views?: unknown }).views).toBe(10);
    }, 90_000);
  }
);
