/**
 * A repeater keeps one structure across languages in its pending changes too: its rows, their
 * order and their shared values are the shared part's, so a structure change is drafted in the
 * shared draft and goes live with any language's publish; the text inside each row is its
 * language's, drafted in that language's draft keyed by row id, and goes live only with that
 * language's publish.
 *
 * The plausible broken implementations: the repeater filed whole in the shared part (a translation
 * held in one language starts a shared draft and is published with every language), filed whole in
 * the language part (a reorder held in one language reaches no other), a language's draft carrying
 * its copy of the structure (a publish puts back an order another language's publish changed), and
 * a shared draft carrying the text of the language that saved it.
 *
 * Each "absent" assertion stands beside a positive one in the same case.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, number, repeater, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

const SLUG = "slidesite";

/** Booting a site per test takes most of the default timeout on MySQL alone. */
const BOOT_TIMEOUT = 90_000;

interface Slide {
  id: string;
  caption?: string | null;
  rank?: number | null;
}

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
}, BOOT_TIMEOUT);

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
          repeater({
            name: "slides",
            fields: [text({ name: "caption" }), number({ name: "rank" })],
          }),
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
  // Every save here replaces what is stored, as an editor's save does.
  const saved = await singles.update(
    SLUG,
    { ...data, _overwrite: true },
    { locale, overrideAccess: true }
  );
  expect(saved.success, JSON.stringify(saved)).toBe(true);
}

async function read(
  singles: SingleEntryService,
  locale: string,
  editor = false
): Promise<{ slides: Slide[]; _sharedChangesPending?: boolean }> {
  const res = await singles.get(SLUG, {
    locale,
    overrideAccess: true,
    ...(editor ? { includeWorkingDraft: true, status: "all" as const } : {}),
  });
  expect(res.success, JSON.stringify(res)).toBe(true);
  return res.data as never;
}

const captions = (slides: Slide[]) => slides.map(slide => slide.caption);

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

/** The Single published in English and Spanish with two slides, each caption translated. */
async function publishedInBoth(
  singles: SingleEntryService
): Promise<{ first: string; second: string }> {
  await save(singles, "en", {
    title: "en title",
    slides: [
      { caption: "first", rank: 1 },
      { caption: "second", rank: 2 },
    ],
    status: "published",
  });
  const [first, second] = (await read(singles, "en")).slides;
  await save(singles, "es", {
    title: "es title",
    slides: [
      { id: first!.id, caption: "primero", rank: 1 },
      { id: second!.id, caption: "segundo", rank: 2 },
    ],
    status: "published",
  });
  return { first: first!.id, second: second!.id };
}

describe.each(getConfiguredTestDialects())(
  "a repeater's structure is drafted in the shared part, its text per language (integration, %s)",
  dialect => {
    it(
      "holds a translation inside a row in that language's draft only, keyed by the row's id",
      async () => {
        const singles = await boot(dialect);
        const { first, second } = await publishedInBoth(singles);

        await save(singles, "es", {
          slides: [
            { id: first, caption: "primero 2", rank: 1 },
            { id: second, caption: "segundo", rank: 2 },
          ],
        });

        const stored = await drafts();
        expect(Object.keys(stored)).toEqual(["es"]);
        // The language's draft holds the text by row id, and no shared value.
        expect(stored.es.slides).toMatchObject({
          [first]: { caption: "primero 2" },
        });
        expect(JSON.stringify(stored.es.slides)).not.toMatch(/rank/);
        expect(captions((await read(singles, "es", true)).slides)).toEqual([
          "primero 2",
          "segundo",
        ]);
        const english = await read(singles, "en", true);
        expect(captions(english.slides)).toEqual(["first", "second"]);
        expect(english._sharedChangesPending).toBe(false);
        // Nothing published moved.
        expect(captions((await read(singles, "es")).slides)).toEqual([
          "primero",
          "segundo",
        ]);
      },
      BOOT_TIMEOUT
    );

    it(
      "holds a reorder made in one language in the shared draft, without that language's text",
      async () => {
        const singles = await boot(dialect);
        const { first, second } = await publishedInBoth(singles);

        await save(singles, "es", {
          slides: [
            { id: second, caption: "segundo", rank: 2 },
            { id: first, caption: "primero", rank: 1 },
          ],
        });

        const stored = await drafts();
        expect(Object.keys(stored)).toEqual(["shared"]);
        expect(stored.shared.slides).toEqual([
          { id: second, rank: 2 },
          { id: first, rank: 1 },
        ]);
        // Every language's editor sees the new order, each row in its own language's text.
        const english = await read(singles, "en", true);
        expect(captions(english.slides)).toEqual(["second", "first"]);
        expect(english._sharedChangesPending).toBe(true);
        expect(captions((await read(singles, "es", true)).slides)).toEqual([
          "segundo",
          "primero",
        ]);
      },
      BOOT_TIMEOUT
    );

    it(
      "puts only the publishing language's text live, and keeps the other language's pending",
      async () => {
        const singles = await boot(dialect);
        const { first, second } = await publishedInBoth(singles);
        await save(singles, "en", {
          slides: [
            { id: first, caption: "first 2", rank: 1 },
            { id: second, caption: "second", rank: 2 },
          ],
        });
        await save(singles, "es", {
          slides: [
            { id: first, caption: "primero 2", rank: 1 },
            { id: second, caption: "segundo", rank: 2 },
          ],
        });

        await save(singles, "es", { status: "published" });

        expect(captions((await read(singles, "es")).slides)).toEqual([
          "primero 2",
          "segundo",
        ]);
        expect(captions((await read(singles, "en")).slides)).toEqual([
          "first",
          "second",
        ]);
        expect(Object.keys(await drafts())).toEqual(["en"]);
        expect(captions((await read(singles, "en", true)).slides)).toEqual([
          "first 2",
          "second",
        ]);
      },
      BOOT_TIMEOUT
    );

    it(
      "puts a structure change live for every language with one language's publish, and keeps another language's held text",
      async () => {
        const singles = await boot(dialect);
        const { first, second } = await publishedInBoth(singles);
        await save(singles, "en", {
          slides: [
            { id: first, caption: "first 2", rank: 1 },
            { id: second, caption: "second", rank: 2 },
          ],
        });
        await save(singles, "es", {
          slides: [
            { id: second, caption: "segundo", rank: 20 },
            { id: first, caption: "primero", rank: 1 },
          ],
        });

        await save(singles, "es", { status: "published" });

        const english = await read(singles, "en");
        expect(english.slides.map(({ id, rank }) => [id, rank])).toEqual([
          [second, 20],
          [first, 1],
        ]);
        // English's own text stayed as published; its held edit is still pending, on the new order.
        expect(captions(english.slides)).toEqual(["second", "first"]);
        expect(Object.keys(await drafts())).toEqual(["en"]);
        expect(captions((await read(singles, "en", true)).slides)).toEqual([
          "second",
          "first 2",
        ]);
      },
      BOOT_TIMEOUT
    );
  }
);
