/**
 * A text is translated only from a language whose readers see its own, published, up-to-date text.
 * Each rule is checked beside a text that differs in that one thing and qualifies.
 */
import { describe, expect, it, vi } from "vitest";

import {
  qualifyingSources,
  sourceRefusal,
  type SourceQuestion,
  type SourceText,
} from "../source-eligibility";

/** A text anyone may translate from. */
const GOOD: SourceText = {
  readable: true,
  published: true,
  value: "Text",
  provenance: { outOfDate: false },
};

/** A site in English, French, German and Spanish, translating into Spanish. */
function question(
  texts: Partial<Record<string, Partial<SourceText>>> = {}
): SourceQuestion {
  return {
    languages: ["en", "fr", "de", "es"],
    defaultLocale: "en",
    target: "es",
    textIn: locale => ({ ...GOOD, ...texts[locale] }),
  };
}

describe("a language as the source of a text", () => {
  it("is one with its own published, up-to-date text", () => {
    expect(sourceRefusal(question(), "fr")).toBeNull();
    expect(sourceRefusal(question(), "en")).toBeNull();
  });

  it("is never the language being written", () => {
    expect(sourceRefusal(question(), "es")).toBe("is-target");
  });

  it("is never a language the site does not have, whose text is not asked for", () => {
    const asked = vi.fn(() => GOOD);
    expect(sourceRefusal({ ...question(), textIn: asked }, "it")).toBe(
      "not-configured"
    );
    expect(asked).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<SourceText>, string]>([
    ["the caller may not read", { readable: false }, "not-readable"],
    ["is a draft", { published: false }, "not-published"],
    ["has no value of its own", { value: null }, "no-own-value"],
    ["has a value that was never set", { value: undefined }, "no-own-value"],
    ["has an empty value", { value: "" }, "no-own-value"],
  ])("is not one whose text %s", (_why, text, refusal) => {
    expect(sourceRefusal(question({ fr: text }), "fr")).toBe(refusal);
    // The default language is held to it as any other is.
    expect(sourceRefusal(question({ en: text }), "en")).toBe(refusal);
  });

  it.each<[string, SourceText["provenance"]]>([
    ["is known to be old", { outOfDate: true }],
    ["was never recorded", undefined],
    ["is recorded without saying", {}],
  ])("is the default language alone where its age %s", (_why, provenance) => {
    expect(sourceRefusal(question({ en: { provenance } }), "en")).toBeNull();
    expect(sourceRefusal(question({ fr: { provenance } }), "fr")).toBe(
      "out-of-date"
    );
  });

  it.each([false, 0, "0", [], {}])("may hold %j, which is a value", value => {
    expect(sourceRefusal(question({ fr: { value } }), "fr")).toBeNull();
  });

  it("tells a caller who may not read it nothing else about it", () => {
    const hidden = {
      readable: false,
      published: false,
      value: null,
      provenance: { outOfDate: true },
    };
    expect(sourceRefusal(question({ fr: hidden }), "fr")).toBe("not-readable");
  });
});

describe("the languages a text may be translated from", () => {
  it("are those that qualify, in the site's order", () => {
    expect(qualifyingSources(question())).toEqual(["en", "fr", "de"]);
    expect(qualifyingSources(question({ fr: { published: false } }))).toEqual([
      "en",
      "de",
    ]);
  });

  it("leave out every other language where no age was ever recorded, and keep the default", () => {
    const unknown = { provenance: undefined };
    expect(
      qualifyingSources(question({ en: unknown, fr: unknown, de: unknown }))
    ).toEqual(["en"]);
    // One of them recorded as up to date qualifies beside it.
    expect(qualifyingSources(question({ en: unknown, fr: unknown }))).toEqual([
      "en",
      "de",
    ]);
  });

  it("are none where the language is the first written", () => {
    const nothing = { value: null };
    expect(
      qualifyingSources(question({ en: nothing, fr: nothing, de: nothing }))
    ).toEqual([]);
  });

  it("may be another language where the default language has no text", () => {
    expect(qualifyingSources(question({ en: { value: "" } }))).toEqual([
      "fr",
      "de",
    ]);
  });
});
