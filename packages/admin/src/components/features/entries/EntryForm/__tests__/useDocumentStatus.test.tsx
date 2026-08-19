/**
 * How the surrounding document stands, read from inside a field.
 *
 * A field that covers the editor's own chrome — the page builder does exactly
 * that — leaves an author with no way to see whether the page is live. These
 * cases pin what a caller has to handle, and in particular that "nobody knows"
 * is an answer rather than a default.
 *
 * @module components/features/entries/EntryForm/__tests__/useDocumentStatus.test
 */
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  EntryFormContextProvider,
  useDocumentStatus,
  type DocumentStatus,
} from "../EntryFormContext";

function inProvider(documentStatus?: DocumentStatus) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <EntryFormContextProvider
        collectionSlug="pages"
        entryId="p1"
        {...(documentStatus === undefined ? {} : { documentStatus })}
      >
        {children}
      </EntryFormContextProvider>
    );
  };
}

describe("useDocumentStatus", () => {
  it("reports the status the form published", () => {
    const { result } = renderHook(useDocumentStatus, {
      wrapper: inProvider({ status: "published", hasWorkingDraft: false }),
    });

    expect(result.current).toEqual({
      status: "published",
      hasWorkingDraft: false,
    });
  });

  it("carries a pending working draft", () => {
    const { result } = renderHook(useDocumentStatus, {
      wrapper: inProvider({ status: "published", hasWorkingDraft: true }),
    });

    expect(result.current?.hasWorkingDraft).toBe(true);
  });

  it("answers null when the form published nothing", () => {
    // A create form has no persisted status. Answering "draft" there would tell
    // an author a document was unpublished when nobody had said so.
    const { result } = renderHook(useDocumentStatus, {
      wrapper: inProvider(),
    });

    expect(result.current).toBeNull();
  });

  it("answers null outside any form", () => {
    // Field components also render in previews and pickers, which have no
    // document at all.
    const { result } = renderHook(useDocumentStatus);

    expect(result.current).toBeNull();
  });

  it("keeps the same object while the status has not changed", () => {
    /*
     * The FIXTURE is the point here. A real form builds this prop inline from
     * `effectiveEntryStatus(...)` and a cast off the entry, so the provider
     * receives a NEW object on every parent render — and a wrapper holding one
     * object across renders cannot tell a memo keyed on the fields from one
     * keyed on the object. Measured: with a stable fixture this case passed
     * against both implementations, which is worse than having no case at all.
     *
     * So the wrapper rebuilds it each render, exactly as a form does.
     */
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <EntryFormContextProvider
          collectionSlug="pages"
          entryId="p1"
          documentStatus={{ status: "draft", hasWorkingDraft: false }}
        >
          {children}
        </EntryFormContextProvider>
      );
    }
    const { result, rerender } = renderHook(useDocumentStatus, {
      wrapper: Wrapper,
    });
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });
});
