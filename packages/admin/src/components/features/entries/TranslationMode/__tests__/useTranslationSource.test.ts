// What the source pane is given, for a source document that exists.
//
// The interesting rule is WHICH fields reach the pane: only the translatable
// ones. A shared field holds the same value in both languages, so showing it
// would fill half the screen with a copy of what is in the other pane — and
// push the fields that actually differ off it.

import { renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { useTranslationSource } from "../useTranslationSource";

const LOCALES: Record<string, { label: string; rtl: boolean }> = {
  en: { label: "English", rtl: false },
  ar: { label: "Arabic", rtl: true },
};
const getLocale = (code: string | undefined) =>
  code === undefined ? undefined : LOCALES[code];

/** `localized` is explicit per field so the smart per-type default is not in play. */
const FIELDS = [
  { name: "headline", type: "text", localized: true },
  { name: "body", type: "textarea", localized: true },
  { name: "campaign", type: "text", localized: false },
] as never[];

/** The view the hook returns; `over` patches the inputs one case at a time. */
function viewFor(over: Record<string, unknown> = {}) {
  const { translation, ...rest } = {
    translation: {
      from: "en",
      sourceDocument: { headline: "Hi", body: "There", campaign: "autumn" },
    },
    fields: FIELDS,
    documentLocalized: true,
    locale: "ar",
    defaultLocale: "en",
    getLocale,
    ...over,
  } as never as Record<string, unknown>;
  return renderHook(() =>
    useTranslationSource({ translation, ...rest } as never)
  ).result.current;
}

/** The source pane's document, which is what most cases below are about. */
function sourceFor(over: Record<string, unknown> = {}) {
  return viewFor(over).source;
}

describe("useTranslationSource", () => {
  it("is undefined when no source language is named", () => {
    expect(sourceFor({ translation: {} })).toBeUndefined();
  });

  it("is undefined until the source document has arrived", () => {
    // Distinct from the case above: the mode is on and the fetch is in flight.
    // A pane rendered from an absent document would show every field blank,
    // which reads as "nothing to translate from" rather than "still loading".
    expect(sourceFor({ translation: { from: "en" } })).toBeUndefined();
  });

  it("passes only the TRANSLATABLE fields to the pane", () => {
    const source = sourceFor();
    expect(source?.fields.map(f => (f as { name: string }).name)).toEqual([
      "headline",
      "body",
    ]);
  });

  it("carries only the translatable values, keyed as the form reads them", () => {
    const source = sourceFor();
    expect(source?.values).toEqual({ headline: "Hi", body: "There" });
    // The negative half: a shared field must not ride along in the values even
    // though the source document has it.
    expect(source?.values).not.toHaveProperty("campaign");
  });

  it("takes its writing direction from the SOURCE, not the target", () => {
    // The target here is Arabic and the source English. Reading direction off
    // the document — which is what the rest of the editor does — would render
    // an English source right-to-left.
    expect(sourceFor()?.rtl).toBe(false);
    expect(
      sourceFor({
        translation: { from: "ar", sourceDocument: { headline: "Hi" } },
        locale: "en",
      })?.rtl
    ).toBe(true);
  });

  it("labels both languages for the mode bar", () => {
    const source = sourceFor();
    expect(source?.sourceLabel).toBe("English");
    expect(source?.targetLabel).toBe("Arabic");
  });

  it("falls back to the code when a language has no label", () => {
    const source = sourceFor({ getLocale: () => undefined });
    expect(source?.sourceLabel).toBe("en");
    expect(source?.targetLabel).toBe("ar");
  });

  it("treats every field as translatable-eligible only when the document is", () => {
    // The document switch wins over the per-field flag: a non-localized
    // document has no translatable fields at all, so the pane says so rather
    // than showing a source that cannot differ.
    expect(sourceFor({ documentLocalized: false })?.fields).toEqual([]);
  });
});
