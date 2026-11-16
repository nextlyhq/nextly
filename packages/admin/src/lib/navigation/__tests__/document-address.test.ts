/**
 * The one address every "open this document" link uses: a list row, a
 * dashboard card's row. A collection opens its entries where it says
 * (`admin.opensIn`); else in a view asking to open first for its main field;
 * else in the form. A reader who may not update the entry, and an entry asked
 * for in a language other than the default, get the form.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearDocumentViews,
  registerDocumentViews,
  type RegisteredDocumentView,
} from "@admin/lib/plugins/document-view-registry";

import {
  documentAddress,
  mainFieldOf,
  type OpenableCollection,
} from "../document-address";

const BUILDER: RegisteredDocumentView = {
  fieldType: "blocks",
  path: "builder",
  component: "@acme/builder#View",
  opensFirst: "mainField",
};
const REVIEW: RegisteredDocumentView = {
  slug: "posts",
  path: "review",
  component: "@acme/review#View",
};

const title = { name: "title", type: "text" };
const slug = { name: "slug", type: "text" };
const excerpt = { name: "excerpt", type: "textarea" };
const blocks = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  type: "blocks",
  ...extra,
});

const editor = { canUpdate: true, defaultLocale: "en" };

function open(
  collection: OpenableCollection | undefined,
  request: Parameters<typeof documentAddress>[2] = editor,
  collectionSlug = "pages"
): string {
  return documentAddress(
    { kind: "collection", slug: collectionSlug, id: "42" },
    collection,
    request
  );
}

beforeEach(() => registerDocumentViews([BUILDER, REVIEW]));
afterEach(() => clearDocumentViews());

describe("the default, by the collection's main field", () => {
  it("opens a page, whose main field is the view's field type, in that view, naming the field", () => {
    expect(open({ fields: [title, slug, blocks("content")] })).toBe(
      "/admin/collections/pages/42/builder?field=content"
    );
  });

  it("opens a post, whose blocks field comes after an excerpt, as a form", () => {
    expect(
      open(
        { fields: [title, slug, excerpt, blocks("sections")] },
        editor,
        "posts"
      )
    ).toBe("/admin/collections/posts/42");
  });

  it("opens on the first of two blocks fields when it comes right after the title", () => {
    expect(open({ fields: [title, blocks("hero"), blocks("body")] })).toBe(
      "/admin/collections/pages/42/builder?field=hero"
    );
  });

  it("opens a collection with no blocks field as a form", () => {
    expect(open({ fields: [title, excerpt] })).toBe(
      "/admin/collections/pages/42"
    );
  });

  it("passes over a hidden first blocks field, so the form opens", () => {
    expect(
      open({
        fields: [title, blocks("layout", { admin: { hidden: true } }), excerpt],
      })
    ).toBe("/admin/collections/pages/42");
  });

  it("reads into an unnamed group, as the form lays it out", () => {
    expect(
      open({
        fields: [title, { type: "group", fields: [blocks("content")] }],
      })
    ).toBe("/admin/collections/pages/42/builder?field=content");
  });

  it("does not read into a named group", () => {
    expect(
      open({
        fields: [
          title,
          { type: "group", name: "hero", fields: [blocks("content")] },
        ],
      })
    ).toBe("/admin/collections/pages/42");
  });

  it("skips the field the collection titles its entries by", () => {
    expect(
      open({
        fields: [{ name: "name", type: "text" }, blocks("content")],
        admin: { useAsTitle: "name" },
      })
    ).toBe("/admin/collections/pages/42/builder?field=content");
  });

  it("reads the legacy schemaDefinition shape the collections list carries", () => {
    expect(
      open({ schemaDefinition: { fields: [title, blocks("content")] } })
    ).toBe("/admin/collections/pages/42/builder?field=content");
  });

  it("opens every entry as a form when no view asks to open first", () => {
    clearDocumentViews();
    registerDocumentViews([{ ...BUILDER, opensFirst: undefined }]);
    expect(open({ fields: [title, blocks("content")] })).toBe(
      "/admin/collections/pages/42"
    );
  });

  it("opens as a form while the collection is not known yet", () => {
    expect(open(undefined)).toBe("/admin/collections/pages/42");
  });
});

describe("a collection that says where its entries open", () => {
  it("opens in the form when it says so, whatever its main field", () => {
    expect(
      open({ fields: [title, blocks("content")], admin: { opensIn: "form" } })
    ).toBe("/admin/collections/pages/42");
  });

  it("opens in a field-type view on its first top-level field of that type", () => {
    expect(
      open(
        {
          fields: [title, excerpt, blocks("sections")],
          admin: { opensIn: "builder" },
        },
        editor,
        "posts"
      )
    ).toBe("/admin/collections/posts/42/builder?field=sections");
  });

  it("opens in a view declared on the collection itself", () => {
    expect(
      open(
        { fields: [title, excerpt], admin: { opensIn: "review" } },
        editor,
        "posts"
      )
    ).toBe("/admin/collections/posts/42/review");
  });

  it("opens in the form when the view is not published (its plugin is off)", () => {
    clearDocumentViews();
    expect(
      open({
        fields: [title, excerpt, blocks("sections")],
        admin: { opensIn: "builder" },
      })
    ).toBe("/admin/collections/pages/42");
  });
});

describe("the two ways back to the form", () => {
  const page = { fields: [title, blocks("content")] };

  it("opens the form, read-only, for a reader who may not update the entry", () => {
    expect(open(page, { canUpdate: false, defaultLocale: "en" })).toBe(
      "/admin/collections/pages/42"
    );
  });

  it("opens the form in a language other than the default", () => {
    expect(open(page, { ...editor, locale: "ar" })).toBe(
      "/admin/collections/pages/42?locale=ar"
    );
  });

  it("opens where the rule says for the default language", () => {
    expect(open(page, { ...editor, locale: "en" })).toBe(
      "/admin/collections/pages/42/builder?field=content"
    );
  });

  it("keeps the language on the form when the site has no default to compare", () => {
    expect(
      open({ fields: [title, excerpt] }, { canUpdate: true, locale: "fr" })
    ).toBe("/admin/collections/pages/42?locale=fr");
  });
});

describe("a Single", () => {
  it("opens as its form", () => {
    expect(
      documentAddress(
        { kind: "single", slug: "homepage" },
        { fields: [title, blocks("content")] },
        editor
      )
    ).toBe("/admin/singles/homepage");
  });

  it("carries its language", () => {
    expect(
      documentAddress({ kind: "single", slug: "homepage" }, undefined, {
        ...editor,
        locale: "ar",
      })
    ).toBe("/admin/singles/homepage?locale=ar");
  });
});

describe("mainFieldOf", () => {
  it("is the first top-level field that is not hidden, the title or the slug", () => {
    expect(mainFieldOf({ fields: [title, slug, excerpt] })?.path).toBe(
      "excerpt"
    );
  });

  it("passes over a field inside a hidden unnamed group", () => {
    expect(
      mainFieldOf({
        fields: [
          title,
          { type: "group", admin: { hidden: true }, fields: [blocks("a")] },
          excerpt,
        ],
      })?.path
    ).toBe("excerpt");
  });
});
