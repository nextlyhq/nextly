/**
 * What the Single editor asks for when it reads.
 *
 * The options are the whole point of this hook: each one is a rule whose
 * failure mode is showing an author another language's text as their own, or
 * hiding a pending change they just saved. Asserted on the OPTIONS rather than
 * on rendered output, because that is where the rules live.
 */
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { docSpy } = vi.hoisted(() => ({ docSpy: vi.fn() }));

vi.mock("../useSingles", () => ({
  useSingleDocument: (...args: unknown[]) => {
    docSpy(...args);
    return { data: undefined, isLoading: false, error: null };
  },
}));

import { useSingleEditorDocument } from "../useSingleEditorDocument";

/** The options the EDIT read was issued with (the first call). */
const editRead = () => docSpy.mock.calls[0]?.[1] as Record<string, unknown>;
/** The options the SOURCE read was issued with (the second call). */
const sourceRead = () => docSpy.mock.calls[1]?.[1] as Record<string, unknown>;

describe("useSingleEditorDocument", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks for the pending change when the split applies", () => {
    renderHook(() =>
      useSingleEditorDocument({
        slug: "homepage",
        localizationEnabled: false,
        draftsEnabled: true,
      })
    );

    expect(editRead().draft).toBe(true);
  });

  it("does not ask for it when the split does not apply", () => {
    // An ordinary Single's read stays exactly as it was.
    renderHook(() =>
      useSingleEditorDocument({
        slug: "homepage",
        localizationEnabled: false,
        draftsEnabled: false,
      })
    );

    expect(editRead().draft).toBe(false);
  });

  it("disables fallback on a localized app so an untranslated field reads empty", () => {
    // With fallback on, the default language's text appears IN the field and a
    // save would store it as this language's translation.
    renderHook(() =>
      useSingleEditorDocument({
        slug: "homepage",
        locale: "es",
        defaultLocale: "en",
        localizationEnabled: true,
        draftsEnabled: false,
      })
    );

    expect({
      fallbackLocale: editRead().fallbackLocale,
      translationStatus: editRead().translationStatus,
    }).toEqual({ fallbackLocale: "none", translationStatus: true });
  });

  it("leaves fallback alone when the app is not localized", () => {
    renderHook(() =>
      useSingleEditorDocument({
        slug: "homepage",
        localizationEnabled: false,
        draftsEnabled: false,
      })
    );

    expect(editRead().fallbackLocale).toBeUndefined();
  });

  it("reads the source at the app default, and only off the default language", () => {
    const { result } = renderHook(() =>
      useSingleEditorDocument({
        slug: "homepage",
        locale: "es",
        defaultLocale: "en",
        localizationEnabled: true,
        draftsEnabled: false,
      })
    );

    expect(result.current.isNonDefaultLocale).toBe(true);
    expect(sourceRead().locale).toBe("en");
    expect((sourceRead().queryOptions as { enabled?: boolean }).enabled).toBe(
      true
    );
  });

  it("does not issue a source read while editing the default language", () => {
    const { result } = renderHook(() =>
      useSingleEditorDocument({
        slug: "homepage",
        locale: "en",
        defaultLocale: "en",
        localizationEnabled: true,
        draftsEnabled: false,
      })
    );

    expect(result.current.isNonDefaultLocale).toBe(false);
    expect((sourceRead().queryOptions as { enabled?: boolean }).enabled).toBe(
      false
    );
  });

  it("reads the source at the language translation mode named", () => {
    renderHook(() =>
      useSingleEditorDocument({
        slug: "homepage",
        locale: "ar",
        defaultLocale: "en",
        localizationEnabled: true,
        draftsEnabled: false,
        translateFrom: "es",
      })
    );

    // Not the app default: translation mode names the source explicitly, and
    // reading the default instead would present the wrong language as source.
    expect(sourceRead().locale).toBe("es");
    // The source read never falls back, or an untranslated source field
    // resolves to yet another language and is copied in as a translation.
    expect(sourceRead().fallbackLocale).toBe("none");
  });
});
