/**
 * Publishing every language of a Single whose repeater keeps one structure across languages.
 *
 * A pending change that removes a row is the shared part's, so publishing every language puts the
 * new structure live: the row's text goes with it from every language, as a save's removal takes
 * it, and so does every language's record of it. A language's pending text, recorded as copied
 * from another language, goes live with its record kept: published, it is still a copy.
 *
 * The broken publishes these separate: one that puts the structure live and leaves the removed
 * row's text in another language (a row given that id again reads it back), and one that records
 * the promoted text as the publisher's own, losing that it was copied.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, number, repeater, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { parsedValue } from "../../../shared/lib/json-column-value";
import type { SingleEntryService } from "../services/single-entry-service";

const SLUG = "pashow";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          repeater({
            name: "slides",
            fields: [text({ name: "caption" }), number({ name: "rank" })],
          }),
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  // A PostgreSQL or MySQL leg that silently booted SQLite proves nothing.
  expect(current.adapter.dialect).toBe(dialect);
  return current;
}

const singlesOf = (t: TestNextly): SingleEntryService =>
  t.getService("singleEntryService");

async function save(
  t: TestNextly,
  locale: string,
  data: Record<string, unknown>
): Promise<void> {
  const result = await singlesOf(t).update(
    SLUG,
    { _overwrite: true, ...data },
    { overrideAccess: true, locale }
  );
  expect(result.success, JSON.stringify(result)).toBe(true);
}

async function live(
  t: TestNextly,
  locale: string
): Promise<{ id: string; slides: { id: string; caption?: string }[] }> {
  const result = await singlesOf(t).get(SLUG, {
    overrideAccess: true,
    locale,
    fallbackLocale: false,
  } as never);
  expect(result.success, JSON.stringify(result)).toBe(true);
  return result.data as never;
}

/** The text German's translation row keeps inside the repeater, by row id. */
async function germanText(t: TestNextly): Promise<Record<string, unknown>> {
  const [row] = await t.adapter.select<{ slides: unknown }>(
    `single_${SLUG}_locales`,
    { where: { and: [{ column: "_locale", op: "=", value: "de" }] } }
  );
  return (parsedValue(row?.slides) ?? {}) as Record<string, unknown>;
}

/** German's records of where each row's text came from, live or held, by field path. */
async function germanOrigins(
  t: TestNextly,
  entryId: string,
  part: "live" | "draft" = "live"
): Promise<Record<string, string>> {
  const rows = await t.adapter.select<{
    scopeSlug: string;
    entryId: string;
    locale: string;
    partState: string;
    fieldPath: string;
    origin: string;
  }>("nextly_translation_provenance");
  return Object.fromEntries(
    rows
      .filter(
        row =>
          row.scopeSlug === SLUG &&
          row.entryId === entryId &&
          row.locale === "de" &&
          row.partState === part
      )
      .map(row => [row.fieldPath, row.origin])
  );
}

/** Published in English and German, two rows, German's text copied from English. */
async function published(
  t: TestNextly
): Promise<{ id: string; first: string; second: string }> {
  await save(t, "en", {
    slides: [
      { caption: "one", rank: 1 },
      { caption: "two", rank: 2 },
    ],
    status: "published",
  });
  const english = await live(t, "en");
  const [first, second] = english.slides.map(slide => slide.id);
  await save(t, "de", {
    slides: [
      { id: first, caption: "eins", rank: 1 },
      { id: second, caption: "zwei", rank: 2 },
    ],
    status: "published",
  });
  return { id: english.id, first: first!, second: second! };
}

async function publishAll(t: TestNextly): Promise<void> {
  const result = await singlesOf(t).publishAllLocales(SLUG, {
    overrideAccess: true,
    data: { _overwrite: true },
  });
  expect(result.success, JSON.stringify(result)).toBe(true);
}

describe.each(getConfiguredTestDialects())(
  "publishing every language of a Single with a repeater (%s)",
  dialect => {
    it("drops a row a pending change removed from every language's text", async () => {
      const t = await boot(dialect);
      const { first, second } = await published(t);
      // POPULATION CONTROL: German holds both rows' text.
      expect(Object.keys(await germanText(t)).sort()).toEqual(
        [first, second].sort()
      );
      // English holds a change removing the second row: the shared part's.
      await save(t, "en", { slides: [{ id: first, caption: "one", rank: 1 }] });
      expect((await live(t, "en")).slides).toHaveLength(2);

      await publishAll(t);

      expect((await live(t, "de")).slides.map(slide => slide.id)).toEqual([
        first,
      ]);
      expect(Object.keys(await germanText(t))).toEqual([first]);
    });

    it("keeps a pending text's record as copied once every language is published", async () => {
      const t = await boot(dialect);
      const { id, first, second } = await published(t);
      // German holds new text copied from English, recorded as a copy.
      await save(t, "de", {
        slides: [
          { id: first, caption: "one", rank: 1 },
          { id: second, caption: "two", rank: 2 },
        ],
        _provenance: { slides: { origin: "copy", sourceLocale: "en" } },
      });
      // POPULATION CONTROL: the held text is recorded as copied, row by row.
      expect(await germanOrigins(t, id, "draft")).toMatchObject({
        [`slides#${first}`]: "copy",
        [`slides#${second}`]: "copy",
      });

      await publishAll(t);

      expect((await live(t, "de")).slides.map(slide => slide.caption)).toEqual([
        "one",
        "two",
      ]);
      const origins = await germanOrigins(t, id);
      expect(origins[`slides#${first}`]).toBe("copy");
      expect(origins[`slides#${second}`]).toBe("copy");
    });
  }
);
