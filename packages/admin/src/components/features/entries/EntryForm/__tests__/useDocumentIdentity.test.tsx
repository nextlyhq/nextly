/**
 * Which document a field is rendered inside.
 *
 * A field component receives a name and a control and nothing that says what it
 * is editing, so anything addressing the document itself had to be given this
 * ambiently. These cases pin the three answers a caller has to handle: a
 * collection entry, a Single, and no document at all.
 *
 * @module components/features/entries/EntryForm/__tests__/useDocumentIdentity.test
 */
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  EntryFormContextProvider,
  useDocumentIdentity,
} from "../EntryFormContext";

function inProvider(props: {
  kind?: "collection" | "single";
  collectionSlug: string;
  entryId?: string;
}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <EntryFormContextProvider {...props}>{children}</EntryFormContextProvider>
    );
  };
}

describe("useDocumentIdentity", () => {
  it("answers null outside any form, rather than throwing", () => {
    // Field components also render in previews and pickers, which have no
    // document. Throwing would make every caller wrap this, and the ones that
    // forgot would break the surface they were embedded in.
    const { result } = renderHook(() => useDocumentIdentity());

    expect(result.current).toBeNull();
  });

  it("names a collection entry", () => {
    const { result } = renderHook(() => useDocumentIdentity(), {
      wrapper: inProvider({ collectionSlug: "posts", entryId: "e1" }),
    });

    expect(result.current).toEqual({
      kind: "collection",
      slug: "posts",
      documentId: "e1",
    });
  });

  it("names a Single, which the entry shape cannot express", () => {
    // THE case this was extended for. A Single has one document addressed by
    // its own slug, and a consumer guessing from the presence of an id would
    // read it as a collection entry.
    const { result } = renderHook(() => useDocumentIdentity(), {
      wrapper: inProvider({
        kind: "single",
        collectionSlug: "homepage",
        entryId: "601b",
      }),
    });

    expect(result.current?.kind).toBe("single");
    expect(result.current?.slug).toBe("homepage");
  });

  it("reports no documentId while an entry is being created", () => {
    // There is no document yet, so anything addressing one must not be given a
    // placeholder to address.
    const { result } = renderHook(() => useDocumentIdentity(), {
      wrapper: inProvider({ collectionSlug: "posts" }),
    });

    expect(result.current?.documentId).toBeUndefined();
    // The control: the identity itself still exists, so a caller can tell
    // "inside a form, not yet saved" from "no form at all". Collapsing those
    // would make a create form look like a preview.
    expect(result.current?.slug).toBe("posts");
  });

  it("defaults to a collection, so existing providers keep their meaning", () => {
    const { result } = renderHook(() => useDocumentIdentity(), {
      wrapper: inProvider({ collectionSlug: "posts", entryId: "e1" }),
    });

    expect(result.current?.kind).toBe("collection");
  });
});
