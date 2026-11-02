/**
 * Opening the surrounding document's preview from inside a field.
 *
 * A field that shows the page — the page builder's entry view — offers the
 * same full-page preview the editor's own Preview action opens. These cases pin
 * that the field gets the editor's handler rather than one of its own, and that
 * "no preview here" is an answer a caller must handle.
 *
 * @module components/features/entries/EntryForm/__tests__/useDocumentPreview.test
 */
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  EntryFormContextProvider,
  useDocumentPreview,
} from "../EntryFormContext";

function inProvider(openPreview?: () => Promise<void>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <EntryFormContextProvider
        collectionSlug="pages"
        entryId="p1"
        {...(openPreview === undefined ? {} : { openPreview })}
      >
        {children}
      </EntryFormContextProvider>
    );
  };
}

describe("useDocumentPreview", () => {
  it("opens the preview through the editor's own handler", async () => {
    const openPreview = vi.fn(async () => {});
    const { result } = renderHook(useDocumentPreview, {
      wrapper: inProvider(openPreview),
    });

    await result.current?.open();

    expect(openPreview).toHaveBeenCalledTimes(1);
  });

  it("answers null where the editor offers no preview", () => {
    // No preview configured, an unsaved entry, a reader: the editor offers no
    // Preview action, so a field offering one would open nothing.
    const { result } = renderHook(useDocumentPreview, {
      wrapper: inProvider(),
    });

    expect(result.current).toBeNull();
  });

  it("answers null outside any form", () => {
    const { result } = renderHook(useDocumentPreview);

    expect(result.current).toBeNull();
  });

  it("keeps the same object while the handler has not changed", () => {
    // A field memoising on it would otherwise redo its work on every render of
    // the form around it.
    const openPreview = vi.fn(async () => {});
    const { result, rerender } = renderHook(useDocumentPreview, {
      wrapper: inProvider(openPreview),
    });
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });
});
