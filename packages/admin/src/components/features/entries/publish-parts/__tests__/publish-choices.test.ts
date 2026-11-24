/**
 * What the choice of what goes live lists: each language and the shared fields as a part of its
 * own, what each changes for its readers in the server's words, which can be chosen, and the
 * lines that say the shared fields change every language and which translations go out of date.
 *
 * The plausible broken versions: a sentence only beside chosen parts (the dialog as it was);
 * offering a language with nothing to publish, or one the server would refuse as it stands;
 * offering the shared fields when they hold nothing; not offering them where they are the whole
 * document, or where they are not live; leaving them unchosen on a first publish that takes them;
 * wording a part from a guess rather than from the description; the "every language" line when
 * the shared fields do not go live, or on a one-language site; and a request that asks for a part
 * the rows show as not offered.
 */
import { describe, expect, it } from "vitest";

import type {
  PartsLanguageOutcome,
  PublishPartsResult,
} from "@admin/services/publishParts";

import { offeredChoice, publishChoices } from "../publish-choices";
import { SHARED_PATH } from "../publish-parts-choice";

const LANGUAGES = ["en", "es", "fr", "ar"];
const labelOf = (code: string) =>
  ({ en: "English", es: "Spanish", fr: "French", ar: "Arabic" })[code] ?? code;

function answer(
  languages: PartsLanguageOutcome[],
  shared: PublishPartsResult["shared"] = { changes: false, added: false }
): PublishPartsResult {
  return { id: "post-1", languages, shared };
}

/** English and Spanish hold changes, French has a draft never live, Arabic is not started. */
const everyLanguage = answer([
  { locale: "en", outcome: "goes-live-with-pending-change" },
  { locale: "es", outcome: "goes-live-with-pending-change" },
  { locale: "fr", outcome: "goes-live" },
  { locale: "ar", outcome: "shows-fallback", fallback: "en" },
]);

describe("what the choice lists", () => {
  it("lists every language and the shared fields, each saying what changes for its readers", () => {
    const { rows } = publishChoices({
      languages: LANGUAGES,
      labelOf,
      currentLocale: "en",
      choice: { locales: ["en"], shared: true },
      chosenAnswer: answer([
        { locale: "en", outcome: "goes-live-with-pending-change" },
      ]),
      everyLanguageAnswer: everyLanguage,
      sharedPending: true,
      outOfDate: [],
    });
    expect(rows).toEqual([
      {
        part: "en",
        label: "English",
        current: true,
        chosen: true,
        offered: true,
        says: "Its unpublished changes go live for readers of English.",
      },
      {
        part: "es",
        label: "Spanish",
        current: false,
        chosen: false,
        offered: true,
        says: "Its unpublished changes go live for readers of Spanish.",
      },
      {
        part: "fr",
        label: "French",
        current: false,
        chosen: false,
        offered: true,
        says: "Goes live for the first time: readers of French see it.",
      },
      {
        part: "ar",
        label: "Arabic",
        current: false,
        chosen: false,
        offered: false,
        says: "Not started, so there is nothing to publish.",
      },
      {
        part: SHARED_PATH,
        label: "Shared fields",
        current: false,
        chosen: true,
        offered: true,
        says: "Their unpublished changes go live for readers of every language.",
      },
    ]);
  });

  it("words a chosen language from the description of the request as chosen", () => {
    const { rows } = publishChoices({
      languages: LANGUAGES,
      labelOf,
      currentLocale: "en",
      choice: { locales: ["en", "fr"], shared: false },
      // As chosen, the server says French shows English's content.
      chosenAnswer: answer([
        { locale: "en", outcome: "goes-live-with-pending-change" },
        { locale: "fr", outcome: "shows-fallback", fallback: "en" },
      ]),
      everyLanguageAnswer: everyLanguage,
      sharedPending: false,
      outOfDate: [],
    });
    expect(rows.find(row => row.part === "fr")?.says).toBe(
      "Not started, so there is nothing to publish."
    );
  });

  it("does not offer a live language with nothing new, and leaves it unchosen though it was chosen", () => {
    const { rows } = publishChoices({
      languages: LANGUAGES,
      labelOf,
      currentLocale: "en",
      choice: { locales: ["en"], shared: false },
      chosenAnswer: undefined,
      everyLanguageAnswer: answer([
        { locale: "en", outcome: "stays-published" },
        { locale: "es", outcome: "goes-live-with-pending-change" },
        { locale: "fr", outcome: "goes-live" },
        { locale: "ar", outcome: "shows-fallback", fallback: null },
      ]),
      sharedPending: false,
      outOfDate: [],
    });
    expect(rows[0]).toMatchObject({
      part: "en",
      chosen: false,
      offered: false,
      says: "Live, with nothing new to publish.",
    });
  });

  it("does not offer a language whose change is behind the live shared values, and says how to fix it", () => {
    const { rows } = publishChoices({
      languages: LANGUAGES,
      labelOf,
      currentLocale: "en",
      choice: { locales: ["en", "es"], shared: false },
      chosenAnswer: undefined,
      everyLanguageAnswer: answer([
        { locale: "en", outcome: "goes-live-with-pending-change" },
        {
          locale: "es",
          outcome: "out-of-date",
          fields: ["tagline"],
          hiddenCount: 1,
        },
        { locale: "fr", outcome: "goes-live" },
        { locale: "ar", outcome: "shows-fallback", fallback: "en" },
      ]),
      sharedPending: false,
      outOfDate: [],
    });
    expect(rows[1]).toMatchObject({
      part: "es",
      chosen: false,
      offered: false,
      says: "Its changes are behind the live tagline and 1 field you can't see. Open Spanish and take the live values before publishing it.",
    });
  });

  it("does not offer the shared fields when they hold no unpublished changes", () => {
    const { rows, facts } = publishChoices({
      languages: LANGUAGES,
      labelOf,
      currentLocale: "en",
      choice: { locales: ["en"], shared: true },
      chosenAnswer: undefined,
      everyLanguageAnswer: everyLanguage,
      sharedPending: false,
      outOfDate: [],
    });
    expect(rows[rows.length - 1]).toEqual({
      part: SHARED_PATH,
      label: "Shared fields",
      current: false,
      chosen: false,
      offered: false,
      says: "No unpublished changes.",
    });
    expect(facts).toEqual([]);
  });

  it("shows the shared fields chosen, and fixed, when the first publish takes them", () => {
    const { rows, facts } = publishChoices({
      languages: LANGUAGES,
      labelOf,
      currentLocale: "es",
      choice: { locales: ["es"], shared: false },
      chosenAnswer: answer([{ locale: "es", outcome: "goes-live" }], {
        changes: true,
        added: true,
      }),
      everyLanguageAnswer: undefined,
      sharedPending: false,
      outOfDate: [],
    });
    expect(rows[rows.length - 1]).toMatchObject({
      chosen: true,
      offered: false,
      says: "Go live too: a first publish always takes them, for readers of every language.",
    });
    expect(facts).toEqual(["Shared fields change every language."]);
  });

  it("offers every language and says nothing of it while the server has not described it", () => {
    const { rows } = publishChoices({
      languages: LANGUAGES,
      labelOf,
      currentLocale: "en",
      choice: { locales: ["en"], shared: false },
      chosenAnswer: undefined,
      everyLanguageAnswer: undefined,
      sharedPending: false,
      outOfDate: [],
    });
    expect(rows.slice(0, 4).map(row => [row.offered, row.says])).toEqual([
      [true, undefined],
      [true, undefined],
      [true, undefined],
      [true, undefined],
    ]);
    expect(rows[0].chosen).toBe(true);
  });
});

describe("the shared fields' row", () => {
  it("is the whole of a document that is not translated: offered, chosen as chosen, in the server's words", () => {
    const row = (shared: boolean, chosenAnswer?: PublishPartsResult) =>
      publishChoices({
        languages: [],
        labelOf,
        currentLocale: undefined,
        choice: { locales: [], shared },
        chosenAnswer,
        everyLanguageAnswer: undefined,
        sharedPending: false,
        outOfDate: [],
      });
    expect(row(true, answer([], { changes: true, added: false }))).toEqual({
      rows: [
        {
          part: SHARED_PATH,
          label: "Shared fields",
          current: false,
          chosen: true,
          offered: true,
          says: "Their unpublished changes go live.",
        },
      ],
      facts: [],
    });
    expect(row(false).rows).toEqual([
      expect.objectContaining({
        chosen: false,
        offered: true,
        says: undefined,
      }),
    ]);
  });

  it("is offered where they are not live and hold no changes, and no chosen language takes them", () => {
    const row = (locales: string[]) =>
      publishChoices({
        languages: LANGUAGES,
        labelOf,
        currentLocale: "en",
        choice: { locales, shared: true },
        chosenAnswer: undefined,
        everyLanguageAnswer: answer([{ locale: "en", outcome: "goes-live" }], {
          changes: true,
          added: false,
        }),
        sharedPending: false,
        outOfDate: [],
      }).rows.at(-1);
    expect(row([])).toMatchObject({
      chosen: true,
      offered: true,
      says: "Go live for readers of every language.",
    });
    expect(row(["en"])).toMatchObject({
      chosen: true,
      offered: false,
      says: "Go live too: a first publish always takes them, for readers of every language.",
    });
  });

  it("is offered, saying nothing, while the server has not said whether they hold anything", () => {
    const { rows } = publishChoices({
      languages: LANGUAGES,
      labelOf,
      currentLocale: "en",
      choice: { locales: ["en"], shared: false },
      chosenAnswer: undefined,
      everyLanguageAnswer: undefined,
      sharedPending: false,
      outOfDate: [],
    });
    expect(rows.at(-1)).toMatchObject({
      chosen: false,
      offered: true,
      says: undefined,
    });
  });
});

describe("the lines after the parts", () => {
  it("says the shared fields change every language, and which translations go out of date", () => {
    const { facts } = publishChoices({
      languages: LANGUAGES,
      labelOf,
      currentLocale: "en",
      choice: { locales: ["en"], shared: true },
      chosenAnswer: undefined,
      everyLanguageAnswer: everyLanguage,
      sharedPending: true,
      outOfDate: [{ locale: "es", fields: 2 }],
    });
    expect(facts).toEqual([
      "Shared fields change every language.",
      "After this, 2 Spanish fields will be out of date.",
    ]);
  });

  it("does not say the shared fields change every language when they are left out", () => {
    const { facts } = publishChoices({
      languages: LANGUAGES,
      labelOf,
      currentLocale: "en",
      choice: { locales: ["en"], shared: false },
      chosenAnswer: undefined,
      everyLanguageAnswer: everyLanguage,
      sharedPending: true,
      outOfDate: [],
    });
    expect(facts).toEqual([]);
  });

  it("does not say it on a document with one language", () => {
    const { facts } = publishChoices({
      languages: ["en"],
      labelOf,
      currentLocale: "en",
      choice: { locales: ["en"], shared: true },
      chosenAnswer: undefined,
      everyLanguageAnswer: undefined,
      sharedPending: true,
      outOfDate: [],
    });
    expect(facts).toEqual([]);
  });
});

describe("the request the choice makes", () => {
  const known = {
    languages: LANGUAGES,
    everyLanguageAnswer: answer([
      { locale: "en", outcome: "goes-live-with-pending-change" },
      { locale: "es", outcome: "stays-published" },
      { locale: "fr", outcome: "out-of-date", fields: ["tagline"] },
      { locale: "ar", outcome: "shows-fallback", fallback: "en" },
    ]),
    sharedPending: true,
  };

  it("asks only for the parts chosen and offered", () => {
    expect(
      offeredChoice({ locales: ["en", "es", "fr", "ar"], shared: true }, known)
    ).toEqual({ locales: ["en"], shared: true });
    expect(offeredChoice({ locales: [], shared: false }, known)).toEqual({
      locales: [],
      shared: false,
    });
  });

  it("leaves out shared fields with nothing to publish", () => {
    expect(
      offeredChoice(
        { locales: ["en"], shared: true },
        { ...known, sharedPending: false }
      )
    ).toEqual({ locales: ["en"], shared: false });
  });

  it("never asks for the shared fields a first publish takes", () => {
    const notLive = {
      ...known,
      everyLanguageAnswer: answer([{ locale: "en", outcome: "goes-live" }], {
        changes: true,
        added: false,
      }),
    };
    expect(offeredChoice({ locales: ["en"], shared: true }, notLive)).toEqual({
      locales: ["en"],
      shared: false,
    });
    // With no language to take them, they are a choice of their own.
    expect(offeredChoice({ locales: [], shared: true }, notLive)).toEqual({
      locales: [],
      shared: true,
    });
  });

  it("is the choice as made while the server has not described every language, and on a document that is not translated", () => {
    const choice = { locales: ["en", "ar"], shared: true };
    expect(
      offeredChoice(choice, {
        ...known,
        everyLanguageAnswer: undefined,
        sharedPending: false,
      })
    ).toEqual(choice);
    expect(
      offeredChoice(
        { locales: [], shared: true },
        {
          languages: [],
          everyLanguageAnswer: undefined,
          sharedPending: false,
        }
      )
    ).toEqual({ locales: [], shared: true });
  });
});
