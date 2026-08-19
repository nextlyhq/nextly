/**
 * The plugin-facing way for a field to record a recovery point.
 *
 * Driven through the REAL providers a field is rendered inside, because the
 * whole point of this hook is that a caller passes neither a document nor a
 * language: it reads both from where it is mounted, and a stubbed context would
 * be a second implementation of the resolution being tested.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { saveSpy } = vi.hoisted(() => ({ saveSpy: vi.fn() }));

vi.mock("@admin/services/versionApi", () => ({
  versionApi: { saveAutosave: saveSpy },
}));

import { EntryFormContextProvider } from "@admin/components/features/entries/EntryForm/EntryFormContext";
import { EntryLocaleProvider } from "@admin/components/features/entries/EntryLocaleContext";

import { useDocumentCheckpoint } from "../useDocumentCheckpoint";

const DEBOUNCE = 2000;

/** A field rendered inside a document, with an optional active language. */
function inDocument(
  options: {
    kind?: "collection" | "single";
    slug?: string;
    /** `null` means the document has never been saved, so there is no id. */
    documentId?: string | null;
    locale?: string;
  } = {}
) {
  const {
    kind = "collection",
    slug = "posts",
    documentId = "e1",
    locale,
  } = options;
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <EntryFormContextProvider
        kind={kind}
        collectionSlug={slug}
        entryId={documentId ?? undefined}
        isCreateMode={false}
      >
        <EntryLocaleProvider
          value={{
            locale,
            rtl: false,
            collectionLocalized: locale !== undefined,
            isNonDefaultLocale: false,
          }}
        >
          {children}
        </EntryLocaleProvider>
      </EntryFormContextProvider>
    );
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  saveSpy.mockResolvedValue({
    updatedAt: "2026-08-19T09:00:00.000Z",
    locale: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDocumentCheckpoint", () => {
  it("records against the document it is rendered inside", async () => {
    // The caller names no document. Reading it from the surrounding form is
    // what lets a plugin field record at all: the props a field receives name a
    // value and nothing that addresses the document holding it.
    const { result } = renderHook(
      () =>
        useDocumentCheckpoint({
          snapshot: { title: "Hi" },
          debounceMs: DEBOUNCE,
        }),
      { wrapper: inDocument() }
    );

    act(() => result.current.schedule());
    act(() => void vi.advanceTimersByTime(DEBOUNCE));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(saveSpy).toHaveBeenCalledWith(
      { kind: "collection", slug: "posts", entryId: "e1" },
      { title: "Hi" },
      null
    );
  });

  it("addresses a Single by its slug rather than as an entry", async () => {
    // A Single has one document addressed by its own slug, and sending it as a
    // collection entry would write against a document that does not exist.
    const { result } = renderHook(
      () =>
        useDocumentCheckpoint({
          snapshot: { headline: "x" },
          debounceMs: DEBOUNCE,
        }),
      {
        wrapper: inDocument({
          kind: "single",
          slug: "homepage",
          documentId: "s1",
        }),
      }
    );

    act(() => result.current.schedule());
    act(() => void vi.advanceTimersByTime(DEBOUNCE));

    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith(
        { kind: "single", slug: "homepage", documentId: "s1" },
        { headline: "x" },
        null
      )
    );
  });

  it("carries the ACTIVE content language", async () => {
    // The row is one per document per author, so a recording made under the
    // wrong language overwrites the one the form's own recording wrote.
    const { result } = renderHook(
      () =>
        useDocumentCheckpoint({
          snapshot: { title: "Bonjour" },
          debounceMs: DEBOUNCE,
        }),
      { wrapper: inDocument({ locale: "fr-CA" }) }
    );

    act(() => result.current.schedule());
    act(() => void vi.advanceTimersByTime(DEBOUNCE));

    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        "fr-CA"
      )
    );
  });

  it("sends the snapshot as it stands AT FLUSH, not when it was scheduled", async () => {
    // The surface goes on editing during the debounce. Capturing the value at
    // scheduling time would record what the author had two seconds ago.
    const { result, rerender } = renderHook(
      ({ snapshot }: { snapshot: Record<string, unknown> }) =>
        useDocumentCheckpoint({ snapshot, debounceMs: DEBOUNCE }),
      { wrapper: inDocument(), initialProps: { snapshot: { title: "first" } } }
    );

    act(() => result.current.schedule());
    rerender({ snapshot: { title: "second" } });
    act(() => void vi.advanceTimersByTime(DEBOUNCE));

    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith(
        expect.anything(),
        { title: "second" },
        null
      )
    );
  });
});

describe("what switches recording off", () => {
  it("records nothing outside a document", async () => {
    // A field component also renders in previews and pickers, which have no
    // document. Doing nothing is the ordinary answer there, not an error.
    const { result } = renderHook(() =>
      useDocumentCheckpoint({ snapshot: { title: "Hi" }, debounceMs: DEBOUNCE })
    );

    act(() => result.current.schedule());
    act(() => void vi.advanceTimersByTime(DEBOUNCE * 2));

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("records nothing while the document has never been saved", async () => {
    // A collection entry has no id until it has been created once, and the
    // endpoint addresses a document that exists.
    const { result } = renderHook(
      () =>
        useDocumentCheckpoint({
          snapshot: { title: "Hi" },
          debounceMs: DEBOUNCE,
        }),
      { wrapper: inDocument({ documentId: null }) }
    );

    act(() => result.current.schedule());
    act(() => void vi.advanceTimersByTime(DEBOUNCE * 2));

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("records nothing while disabled", async () => {
    const { result } = renderHook(
      () =>
        useDocumentCheckpoint({
          snapshot: { title: "Hi" },
          enabled: false,
          debounceMs: DEBOUNCE,
        }),
      { wrapper: inDocument() }
    );

    act(() => result.current.schedule());
    act(() => void vi.advanceTimersByTime(DEBOUNCE * 2));

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("still records when enabled and addressable, which is the control", async () => {
    // Without this, the three cases above pass on a hook that never records at
    // all under any circumstances.
    const { result } = renderHook(
      () =>
        useDocumentCheckpoint({
          snapshot: { title: "Hi" },
          enabled: true,
          debounceMs: DEBOUNCE,
        }),
      { wrapper: inDocument() }
    );

    act(() => result.current.schedule());
    act(() => void vi.advanceTimersByTime(DEBOUNCE));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
  });
});
