/**
 * Which language a field is rendered inside.
 *
 * A field in a localized document can name the document but not the language
 * its value belongs to, so anything keyed per language had to be given this
 * ambiently. These pin the answers a caller has to handle, including the two
 * different ways the language is UNKNOWABLE — outside a form, and inside one
 * that carries no locale context.
 *
 * @module components/features/entries/EntryForm/__tests__/useDocumentLocale.test
 */
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  EntryLocaleProvider,
  type EntryLocaleContextValue,
} from "../../EntryLocaleContext";
import {
  EntryFormContextProvider,
  useDocumentLocale,
} from "../EntryFormContext";

const localeValue = (
  over: Partial<EntryLocaleContextValue> = {}
): EntryLocaleContextValue => ({
  rtl: false,
  collectionLocalized: true,
  isNonDefaultLocale: false,
  ...over,
});

/** A form that also carries a locale context, as both real editors do. */
function inLocalizedForm(locale: EntryLocaleContextValue) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <EntryLocaleProvider value={locale}>
        <EntryFormContextProvider collectionSlug="posts" entryId="e1">
          {children}
        </EntryFormContextProvider>
      </EntryLocaleProvider>
    );
  };
}

/** A form with no locale context above it, as an embedded quick-edit renders. */
function inBareForm() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <EntryFormContextProvider collectionSlug="posts" entryId="e1">
        {children}
      </EntryFormContextProvider>
    );
  };
}

describe("useDocumentLocale", () => {
  it("answers null outside any form", () => {
    const { result } = renderHook(() => useDocumentLocale());

    expect(result.current).toBeNull();
  });

  it("answers null inside a form that carries no locale context", () => {
    // THE case this hook is shaped around. An embedded quick-edit renders
    // fields with no locale provider, and reporting "unlocalized" there would
    // describe a localized collection wrongly.
    const { result } = renderHook(() => useDocumentLocale(), {
      wrapper: inBareForm(),
    });

    expect(result.current).toBeNull();
  });

  it("reports the active language", () => {
    const { result } = renderHook(() => useDocumentLocale(), {
      wrapper: inLocalizedForm(
        localeValue({ locale: "es", isNonDefaultLocale: true, rtl: false })
      ),
    });

    expect(result.current).toEqual({
      code: "es",
      documentLocalized: true,
      isDefaultLocale: false,
      rtl: false,
    });
  });

  it("spells the app default as null, the way the admin addresses it", () => {
    // An absent `?locale=` IS the default language everywhere else, so a
    // consumer can put `code` straight into a key or a query param.
    const { result } = renderHook(() => useDocumentLocale(), {
      wrapper: inLocalizedForm(localeValue()),
    });

    expect(result.current?.code).toBeNull();
    expect(result.current?.isDefaultLocale).toBe(true);
  });

  it("reports an unlocalized document as such, which is not the same as unknown", () => {
    const { result } = renderHook(() => useDocumentLocale(), {
      wrapper: inLocalizedForm(localeValue({ collectionLocalized: false })),
    });

    // The control: an answer EXISTS here, so a caller can tell "this document
    // has one language" from "nobody knows the language". Collapsing them would
    // make an unlocalized editor indistinguishable from a preview.
    expect(result.current).not.toBeNull();
    expect(result.current?.documentLocalized).toBe(false);
  });

  it("carries the writing direction", () => {
    const { result } = renderHook(() => useDocumentLocale(), {
      wrapper: inLocalizedForm(
        localeValue({ locale: "ar", isNonDefaultLocale: true, rtl: true })
      ),
    });

    expect(result.current?.rtl).toBe(true);
  });
});
