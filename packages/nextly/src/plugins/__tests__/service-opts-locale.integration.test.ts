/**
 * A plugin names the locale it reads or writes in, through
 * `ctx.services.collections`.
 *
 * The request context always carried `locale` and `fallbackLocale`, and every
 * entry-service read accepted them — but the plugin path had no field to say
 * them in, and the facade's forwarding seam did not pass them on even when a
 * context did. So every plugin read and write, on every localized site, was in
 * the default locale, and nothing reported it: a French page got English
 * content, silently.
 *
 * Proven through the real wrapper, the real facade and a real database rather
 * than a spy on any one layer. The wrapper's unit tests show the pair leaves
 * the plugin; only a read that comes back in the other language shows it
 * ARRIVED, through both layers that used to drop it.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { NextlyError } from "../../errors/nextly-error";
import { definePlugin, type PluginContext } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

type PluginServices = PluginContext["services"];

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const pages = () =>
  defineCollection({
    slug: "pages",
    // Both, deliberately: the collection flag is what gives a per-locale write
    // somewhere to go. A localized FIELD on an unlocalized collection has no
    // companion row, so a write in German lands on the one row there is —
    // which reads exactly like the locale never travelling.
    localized: true,
    fields: [text({ name: "title", localized: true })],
  });

/**
 * A collection with no localization, for the bulk-create control below.
 *
 * On a localized collection every field lives on the companion table, and the
 * bulk pipeline writes the main table only — so a bulk create there fails
 * each row whatever the locale, and a control that failed for that reason
 * would say nothing about the locale it exists to control for.
 */
const notes = () =>
  defineCollection({
    slug: "notes",
    fields: [text({ name: "body" })],
  });

/** Boot a localized site with a probe plugin that keeps its services. */
async function boot(): Promise<PluginServices> {
  let services: PluginServices | undefined;
  const probe = definePlugin({
    name: "@test/locale-probe",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init: c => {
      services = c.services;
    },
  });
  current = await createTestNextly({
    collections: [pages(), notes()],
    plugins: [probe],
    localization: { locales: ["en", "de", "fr"], defaultLocale: "en" },
  });
  // `init` has run by the time the harness resolves. Asserted rather than
  // assumed, so a harness that stopped calling it fails here by name rather
  // than on a property of `undefined` below.
  if (!services) {
    throw NextlyError.internal({
      logContext: { reason: "test-harness-init-did-not-run" },
    });
  }
  return services;
}

/** A page written in English, with a German translation, through the plugin path. */
async function pageInTwoLanguages(services: PluginServices): Promise<string> {
  const created = await services.collections.createEntry(
    "pages",
    { title: "Page EN" },
    { as: "system" }
  );
  const id = created.item.id;
  // The translation is WRITTEN through the same services, so this covers the
  // write half of the pair as well as the read half: a write locale that did
  // not travel would overwrite the English title instead of adding a German
  // one, and the English read below would say so.
  await services.collections.updateEntry(
    "pages",
    id,
    { title: "Seite DE" },
    { as: "system", locale: "de" }
  );
  return id;
}

const titleOf = (row: unknown): unknown => (row as { title?: unknown }).title;

describe("a plugin reading and writing in a named locale", () => {
  it("reads the translation it asked for, and the default when it asked for none", async () => {
    const services = await boot();
    const id = await pageInTwoLanguages(services);

    const german = await services.collections.findEntryById("pages", id, {
      as: "system",
      locale: "de",
    });
    expect(titleOf(german)).toBe("Seite DE");

    // The control, and the proof the German write did not clobber the
    // English row: with no locale named, the default answers, as it always
    // has for every existing caller.
    const unnamed = await services.collections.findEntryById("pages", id, {
      as: "system",
    });
    expect(titleOf(unnamed)).toBe("Page EN");
  });

  it("lists in the named locale too", async () => {
    const services = await boot();
    await pageInTwoLanguages(services);

    const listed = await services.collections.listEntries(
      "pages",
      {},
      { as: "system", locale: "de" }
    );
    expect(listed.data.map(titleOf)).toEqual(["Seite DE"]);

    // Inside this test rather than trusted to its neighbour: with the pair
    // dropped on the way to the facade, the German WRITE lands on the English
    // row, and a German list then finds "Seite DE" for the wrong reason. Only
    // the unnamed list still answering in English says the locale travelled.
    const unnamed = await services.collections.listEntries(
      "pages",
      {},
      { as: "system" }
    );
    expect(unnamed.data.map(titleOf)).toEqual(["Page EN"]);
  });

  it("tells a missing translation from the default standing in, when asked to", async () => {
    const services = await boot();
    const id = await pageInTwoLanguages(services);

    // French was never written. With the fallback chain in force the read is
    // answered by the default, which is the right thing to SHOW — and the wrong
    // thing to reason from. `fallbackLocale: false` is how a plugin asks the
    // other question, and it only means anything if the value travels as the
    // `false` it is rather than as an absence.
    const shown = await services.collections.findEntryById("pages", id, {
      as: "system",
      locale: "fr",
    });
    expect(titleOf(shown)).toBe("Page EN");

    const exact = await services.collections.findEntryById("pages", id, {
      as: "system",
      locale: "fr",
      fallbackLocale: false,
    });
    expect(titleOf(exact)).not.toBe("Page EN");
  });
});

describe("what the pair refuses", () => {
  it("refuses a write in a locale the site does not have, rather than writing the default", async () => {
    // A READ resolves an unconfigured code to the default so a page still
    // shows; a WRITE must not, or a typo overwrites the default language's
    // content. The services already refuse it with a 400; this pins that the
    // refusal reaches a plugin as a rejection instead of a quiet default write.
    const services = await boot();
    const id = await pageInTwoLanguages(services);

    await expect(
      services.collections.updateEntry(
        "pages",
        id,
        { title: "Typo" },
        { as: "system", locale: "xx" }
      )
    ).rejects.toMatchObject({ statusCode: 400 });

    // The row is exactly as it was: nothing landed under any language.
    const unnamed = await services.collections.findEntryById("pages", id, {
      as: "system",
    });
    expect(titleOf(unnamed)).toBe("Page EN");
  });

  it("refuses a locale on createMany by name, rather than dropping it", async () => {
    // The bulk pipeline cannot perform the localized split, so a locale it
    // accepted would file every row under the default language and report
    // success. Refused before any row is written, naming the write that does
    // honour it.
    const services = await boot();

    await expect(
      services.collections.createMany("notes", [{ body: "Notiz" }], {
        as: "system",
        locale: "de",
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    // Nothing was written.
    const listed = await services.collections.listEntries(
      "notes",
      {},
      { as: "system" }
    );
    expect(listed.data).toEqual([]);
  });

  it("still bulk-creates when no locale is named", async () => {
    // The control: the refusal is about a locale, not about createMany.
    const services = await boot();
    const result = await services.collections.createMany(
      "notes",
      [{ body: "one" }, { body: "two" }],
      { as: "system" }
    );
    expect(result.successful).toBe(2);
  });
});
