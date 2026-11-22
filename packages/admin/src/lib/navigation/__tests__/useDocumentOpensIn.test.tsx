/**
 * Where the document being edited opens, and its list, as a document view
 * reads them: from the collection as the admin lists it and the published
 * views, by the same rule the list's rows follow.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentIdentity } from "@admin/components/features/entries/EntryForm/EntryFormContext";

import { useDocumentOpensIn } from "../useDocumentOpensIn";

const state = vi.hoisted(() => ({
  identity: null as DocumentIdentity | null,
  collections: undefined as readonly object[] | undefined,
  singles: undefined as readonly object[] | undefined,
}));

vi.mock(
  "@admin/components/features/entries/EntryForm/EntryFormContext",
  async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useDocumentIdentity: () => state.identity,
  })
);
vi.mock("@admin/hooks/queries/useCollections", () => ({
  useEveryNavCollection: () => ({ data: state.collections }),
}));
vi.mock("@admin/hooks/queries/useSingles", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEverySingle: () => ({ data: state.singles }),
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({
    plugins: [
      {
        name: "@acme/builder",
        documentViews: [
          {
            fieldType: "blocks",
            path: "builder",
            component: "@acme/x#View",
            opensFirst: "mainField",
          },
        ],
      },
    ],
  }),
}));

const title = { name: "title", type: "text" };
const PAGES = {
  name: "pages",
  label: "Page",
  labels: { plural: "Pages" },
  fields: [title, { name: "content", type: "blocks" }],
};
const POSTS = {
  name: "posts",
  labels: { plural: "Posts" },
  fields: [
    title,
    { name: "excerpt", type: "textarea" },
    { name: "body", type: "blocks" },
  ],
};

/** A Homepage Single: a title and a page layout, so the builder comes first. */
const HOMEPAGE = {
  slug: "homepage",
  label: "Homepage",
  fields: [title, { name: "layout", type: "blocks" }],
};
/** Contact details: an email first, so it opens as a form. */
const CONTACT = {
  slug: "contact",
  label: "Contact details",
  fields: [
    { name: "email", type: "email" },
    { name: "extras", type: "blocks" },
  ],
};

beforeEach(() => {
  state.identity = { kind: "collection", slug: "pages", documentId: "p1" };
  state.collections = [PAGES, POSTS];
  state.singles = [HOMEPAGE, CONTACT];
});

const read = () => renderHook(() => useDocumentOpensIn()).result.current;

describe("useDocumentOpensIn", () => {
  it("names the view a page opens in, and its list by the plural label", () => {
    expect(read()).toEqual({
      opensIn: "builder",
      list: { label: "Pages", address: "/admin/collections/pages" },
    });
  });

  it("says the form for a post, whose main field is an excerpt", () => {
    // The control for the case above: a document in a collection that opens
    // as a form, with a blocks field all the same.
    state.identity = { kind: "collection", slug: "posts", documentId: "x" };
    expect(read()).toEqual({
      opensIn: "form",
      list: { label: "Posts", address: "/admin/collections/posts" },
    });
  });

  it("says the form for a page whose collection keeps its entries in the form", () => {
    // `opensIn: "form"` wins over a main field the builder opens first on.
    state.collections = [{ ...PAGES, admin: { opensIn: "form" } }];
    expect(read()?.opensIn).toBe("form");
  });

  it("falls back to the collection's label, then its name, as the list's heading does", () => {
    state.collections = [{ ...PAGES, labels: {} }];
    expect(read()?.list.label).toBe("Page");
    state.collections = [{ ...PAGES, labels: {}, label: undefined }];
    expect(read()?.list.label).toBe("pages");
  });

  it("is null outside an editor, on a new entry and before the collection is known", () => {
    state.identity = null;
    expect(read()).toBeNull();
    state.identity = { kind: "collection", slug: "pages" };
    expect(read()).toBeNull();
    state.identity = { kind: "collection", slug: "pages", documentId: "p1" };
    state.collections = undefined;
    expect(read()).toBeNull();
  });
});

describe("useDocumentOpensIn on a Single", () => {
  it("names the builder for a Homepage, and the Content screen as where it is found", () => {
    state.identity = { kind: "single", slug: "homepage", documentId: "h1" };
    expect(read()).toEqual({
      opensIn: "builder",
      list: { label: "content", address: "/admin/content" },
    });
  });

  it("says the form for a Single whose first field is not the builder", () => {
    state.identity = { kind: "single", slug: "contact", documentId: "c1" };
    expect(read()?.opensIn).toBe("form");
  });

  it("reads the Single, not a collection that shares its slug", () => {
    // A collection named like the Single opens in the builder; the Single,
    // whose first field is an email, still says the form.
    state.collections = [{ ...PAGES, name: "contact" }];
    state.identity = { kind: "single", slug: "contact", documentId: "c1" };
    expect(read()?.opensIn).toBe("form");
  });

  it("is null before the Single is known", () => {
    state.identity = { kind: "single", slug: "homepage", documentId: "h1" };
    state.singles = undefined;
    expect(read()).toBeNull();
  });
});
