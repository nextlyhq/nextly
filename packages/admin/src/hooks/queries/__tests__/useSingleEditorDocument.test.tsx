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

const { docSpy, storedSpy, mayReadTranslations } = vi.hoisted(() => ({
  docSpy: vi.fn(),
  storedSpy: vi.fn(),
  /** Whether the server lets the user read every language's state. */
  mayReadTranslations: { current: true },
}));

vi.mock("@admin/hooks/useCanRequest", () => ({
  useCanRequest: (_slug: string, request: string) =>
    request === "readTranslations" ? mayReadTranslations.current : false,
}));

vi.mock("../useSingles", () => ({
  useSingleDocument: (...args: unknown[]) => {
    docSpy(...args);
    return { data: undefined, isLoading: false, error: null };
  },
  singleDocumentKeys: {
    detail: (slug: string) => ["single-documents", "detail", slug],
  },
}));

vi.mock("../useStoredReferences", () => ({
  useStoredSingleDocument: (...args: unknown[]) => {
    storedSpy(...args);
    return { data: undefined, isLoading: false, error: null };
  },
  useWithStoredReferences: ({
    populated,
  }: {
    populated: { data: unknown; isLoading: boolean; error: unknown };
  }) => ({
    document: populated.data,
    isLoading: populated.isLoading,
    error: populated.error,
  }),
}));

import { useSingleEditorDocument } from "../useSingleEditorDocument";

/** The options the EDIT read was issued with (the first call). */
const editRead = () => docSpy.mock.calls[0]?.[1] as Record<string, unknown>;
/** The options the SOURCE read was issued with (the second call). */
const sourceRead = () => docSpy.mock.calls[1]?.[1] as Record<string, unknown>;
/** The options the STORED-links read was issued with. */
const storedRead = () =>
  storedSpy.mock.calls[0]?.[1] as Record<string, unknown>;

describe("useSingleEditorDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mayReadTranslations.current = true;
  });

  it("asks for every language's state only where the server lets the user read them", () => {
    const read = () =>
      renderHook(() =>
        useSingleEditorDocument({
          slug: "homepage",
          localizationEnabled: true,
          draftsEnabled: false,
          fields: undefined,
        })
      );
    read();
    expect(editRead().translationStatus).toBe(true);
    // A user who may read only some languages gets the Single without the
    // overview, rather than a read the server refuses.
    vi.clearAllMocks();
    mayReadTranslations.current = false;
    read();
    expect(editRead().translationStatus).toBe(false);
  });

  it("asks for the pending change when the split applies", () => {
    renderHook(() =>
      useSingleEditorDocument({
        slug: "homepage",
        localizationEnabled: false,
        draftsEnabled: true,
        fields: undefined,
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
        fields: undefined,
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
        fields: undefined,
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
        fields: undefined,
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
        fields: undefined,
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
        fields: undefined,
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
        fields: undefined,
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

  it("reads the stored links in the same language and view as the edit read", () => {
    // A depth-0 read of another language, or of the live row while the edit
    // read shows the pending change, would merge links from another document.
    renderHook(() =>
      useSingleEditorDocument({
        slug: "homepage",
        locale: "es",
        defaultLocale: "en",
        localizationEnabled: true,
        draftsEnabled: true,
        fields: undefined,
      })
    );

    expect(storedSpy.mock.calls[0]?.[0]).toBe("homepage");
    expect(storedRead()).toEqual({
      locale: editRead().locale,
      fallbackLocale: editRead().fallbackLocale,
      draft: editRead().draft,
    });
  });
});
