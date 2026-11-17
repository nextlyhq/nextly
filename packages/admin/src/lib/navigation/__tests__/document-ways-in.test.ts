/**
 * The other ways into a document, as a list row's menu and the document bar
 * offer them: the form ("Edit details") from a row whose entries open in a
 * view, and each view the document may be opened in from a row or a form
 * that opens as the form. Worded by the view (`openLabel`), so the admin
 * never names a plugin itself, and addressed by the same rule every "open
 * this document" link uses.
 */
import { describe, expect, it } from "vitest";

import type { RegisteredDocumentView } from "@admin/lib/plugins/document-view-registry";

import {
  rowWaysIn,
  viewsToOpenIn,
  type OpenableCollection,
  type OpenRequest,
} from "../document-address";

const BUILDER: RegisteredDocumentView = {
  fieldType: "blocks",
  path: "builder",
  component: "@acme/builder#View",
  label: "Page Builder",
  openLabel: "Open in builder",
  opensFirst: "mainField",
};

const title = { name: "title", type: "text" };
const slug = { name: "slug", type: "text" };
const excerpt = { name: "excerpt", type: "textarea" };
const blocks = (name: string) => ({ name, type: "blocks" });

/** Pages: the blocks field is the main field, so they open in the builder. */
const PAGES: OpenableCollection = { fields: [title, slug, blocks("content")] };
/** Posts: an excerpt comes first, so they open as a form. */
const POSTS: OpenableCollection = {
  fields: [title, slug, excerpt, blocks("sections")],
};
/** Authors: no blocks field, so the builder is no way in. */
const AUTHORS: OpenableCollection = { fields: [title, excerpt] };

const editor: OpenRequest = { canUpdate: true, defaultLocale: "en" };

function row(
  collection: OpenableCollection | undefined,
  views: readonly RegisteredDocumentView[] = [BUILDER],
  request: OpenRequest = editor
) {
  return rowWaysIn(
    { kind: "collection", slug: "items", id: "7" },
    collection,
    request,
    views
  );
}

function bar(
  collection: OpenableCollection | undefined,
  views: readonly RegisteredDocumentView[] = [BUILDER],
  request: OpenRequest = editor
) {
  return viewsToOpenIn(
    { kind: "collection", slug: "items", id: "7" },
    collection,
    request,
    views
  );
}

describe("a list row's other way in", () => {
  it('offers "Edit details", the form, where the entries open in a view', () => {
    expect(row(PAGES)).toEqual([
      {
        label: "Edit details",
        address: "/admin/collections/items/7",
        opens: "form",
      },
    ]);
  });

  it("offers the view, in its own words and at its field, where the entries open as a form", () => {
    expect(row(POSTS)).toEqual([
      {
        label: "Open in builder",
        address: "/admin/collections/items/7/builder?field=sections",
        opens: "view",
      },
    ]);
  });

  it('offers "Edit details" where a declared opensIn sends the entries to a view', () => {
    expect(row({ ...POSTS, admin: { opensIn: "builder" } })).toEqual([
      {
        label: "Edit details",
        address: "/admin/collections/items/7",
        opens: "form",
      },
    ]);
  });

  it("offers the view where a declared opensIn keeps a page in the form", () => {
    expect(row({ ...PAGES, admin: { opensIn: "form" } })).toEqual([
      {
        label: "Open in builder",
        address: "/admin/collections/items/7/builder?field=content",
        opens: "view",
      },
    ]);
  });

  it("offers nothing on a collection no view applies to", () => {
    expect(row(AUTHORS)).toEqual([]);
  });

  it("offers nothing while the collection is not yet known", () => {
    expect(row(undefined)).toEqual([]);
  });
});

describe("the views a form offers to open the document in", () => {
  it("offers the view on a post, which opens as a form", () => {
    expect(bar(POSTS)).toEqual([
      {
        label: "Open in builder",
        address: "/admin/collections/items/7/builder?field=sections",
        opens: "view",
      },
    ]);
  });

  it("offers the view on a page too: the form is open, whatever the rule says", () => {
    expect(bar(PAGES)).toEqual([
      {
        label: "Open in builder",
        address: "/admin/collections/items/7/builder?field=content",
        opens: "view",
      },
    ]);
  });

  it("offers nothing on a document with no field of the view's type", () => {
    expect(bar(AUTHORS)).toEqual([]);
  });

  it("offers nothing to a reader who may not update the document, as a view edits it", () => {
    expect(bar(POSTS, [BUILDER], { ...editor, canUpdate: false })).toEqual([]);
    expect(row(POSTS, [BUILDER], { ...editor, canUpdate: false })).toEqual([]);
  });

  it("offers nothing in a language other than the default, which only the form edits", () => {
    expect(bar(POSTS, [BUILDER], { ...editor, locale: "ar" })).toEqual([]);
  });

  it("offers it in the default language", () => {
    expect(bar(POSTS, [BUILDER], { ...editor, locale: "en" })).toHaveLength(1);
  });

  it("offers nothing on a Single, which opens as its form for now", () => {
    expect(
      viewsToOpenIn({ kind: "single", slug: "home" }, POSTS, editor, [BUILDER])
    ).toEqual([]);
  });

  it("offers a view declared on the collection's own slug", () => {
    const review: RegisteredDocumentView = {
      slug: "items",
      path: "review",
      component: "@acme/review#View",
      openLabel: "Open in review",
    };
    const other: RegisteredDocumentView = { ...review, slug: "others" };
    expect(bar(AUTHORS, [review, other])).toEqual([
      {
        label: "Open in review",
        address: "/admin/collections/items/7/review",
        opens: "view",
      },
    ]);
  });
});

describe("the words of a way in", () => {
  it("are the view's openLabel", () => {
    expect(bar(POSTS)[0]?.label).toBe("Open in builder");
  });

  it("fall back to the view's label where it declares no openLabel", () => {
    const { openLabel: _words, ...unworded } = BUILDER;
    expect(bar(POSTS, [unworded])[0]?.label).toBe("Open in Page Builder");
  });

  it("leave a view with neither out, since there are no words to offer it by", () => {
    const { openLabel: _words, label: _name, ...bare } = BUILDER;
    expect(bar(POSTS, [bare])).toEqual([]);
    expect(row(POSTS, [bare])).toEqual([]);
  });
});
