// @vitest-environment jsdom

/**
 * The page's facts the editor reads from its form: the address Settings reads
 * for a saved page is one value while what it says is the same, though it is
 * worked out afresh on every render, so Settings, drawn again only for a
 * value that changed, is not drawn again for a render beside it.
 *
 * @module admin/editor/page-facts.test
 */
import { act, renderHook } from "@testing-library/react";
import { useForm, type FieldValues } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

// A saved entry of a collection, as a new object on every call, as the
// admin's own answer may be.
vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  useDocumentIdentity: () => ({
    kind: "collection",
    slug: "pages",
    documentId: "p1",
  }),
}));

const { usePageFacts } = await import("./editor-settings");

function useFacts(): {
  facts: ReturnType<typeof usePageFacts>;
  setSlug: (slug: string) => void;
} {
  const form = useForm<FieldValues>({
    defaultValues: { title: "About us", slug: "about" },
  });
  return {
    facts: usePageFacts(form.control),
    setSlug: slug => form.setValue("slug", slug),
  };
}

describe("the page's address, as the editor reads it", () => {
  it("is the same value across renders that change nothing in it", () => {
    const { result, rerender } = renderHook(useFacts);
    const first = result.current.facts.address;
    // The control: it is an address, not null.
    expect(first).toEqual({
      page: { collection: "pages", id: "p1" },
      savedSlug: "about",
      slugChanged: false,
      savedRevision: 0,
    });

    rerender();
    rerender();

    expect(result.current.facts.address).toBe(first);
  });

  it("is a new value saying so once the slug differs from the saved one", () => {
    const { result } = renderHook(useFacts);
    const first = result.current.facts.address;

    act(() => {
      result.current.setSlug("our-story");
    });

    expect(result.current.facts.address).not.toBe(first);
    expect(result.current.facts.address?.slugChanged).toBe(true);
  });
});
