/**
 * Where the entry page draws each field, as a surface covering it asks: the
 * identity, the page's own content, a plugin's tab that takes the field, or
 * nowhere; and the content's top-level fields, for the surface to find the
 * ones it draws its own way.
 *
 * @module components/entries/EntryForm/entry-fields-layout.test
 */
import { describe, expect, it } from "vitest";

import { entryFieldsLayout } from "./entry-fields-layout";

const title = { name: "title", type: "text", label: "Title" };
const slug = { name: "slug", type: "text" };
const summary = { name: "summary", type: "textarea", label: "Summary" };
const seo = { name: "seo", type: "group", fields: [{ name: "title" }] };
const layoutField = { name: "layout", type: "blocks", label: "Layout" };
const sidebar = { name: "sidebar", type: "blocks", label: "Sidebar" };
const hidden = { name: "mode", type: "text", admin: { hidden: true } };
// A nameless row only arranges the fields inside it, which the form stores
// at the root.
const row = {
  type: "row",
  fields: [{ name: "category", type: "select", label: "Category" }],
};
// Kept off the type by a plugin's switch: declared, and drawn nowhere.
const withheld = { name: "promo", type: "text" };

const all = [
  title,
  slug,
  summary,
  seo,
  layoutField,
  sidebar,
  hidden,
  row,
  withheld,
];
// What the page's content draws: every field less the one the SEO tab takes
// and the one kept off the type.
const content = [title, slug, summary, layoutField, sidebar, hidden, row];
const taken = new Map([["seo", "acme-seo.tab"]]);

describe("the entry page's layout of a document's fields", () => {
  const layout = entryFieldsLayout(all, content, taken);

  it("puts the title and the slug in the document's identity", () => {
    expect(layout.tabOf("title")).toEqual({ kind: "page" });
    expect(layout.tabOf("slug")).toEqual({ kind: "page" });
  });

  it("puts a field of the page's content, and a path inside one, in the content", () => {
    expect(layout.tabOf("summary")).toEqual({ kind: "content" });
    expect(layout.tabOf("layout.sections.0.heading")).toEqual({
      kind: "content",
    });
  });

  it("finds a field inside a nameless row by its own name", () => {
    expect(layout.tabOf("category")).toEqual({ kind: "content" });
  });

  it("puts a field a plugin's tab takes on that tab, by the tab's id", () => {
    expect(layout.tabOf("seo.title")).toEqual({
      kind: "tab",
      id: "acme-seo.tab",
    });
  });

  it("answers nowhere for a hidden field, one kept off the type, and an unknown path", () => {
    expect(layout.tabOf("mode")).toBeNull();
    expect(layout.tabOf("promo")).toBeNull();
    expect(layout.tabOf("nothing.here")).toBeNull();
  });

  it("lists the content's named fields, less the identity and hidden ones, in order", () => {
    expect(layout.contentFields).toEqual([
      { name: "summary", type: "textarea", label: "Summary" },
      { name: "layout", type: "blocks", label: "Layout" },
      { name: "sidebar", type: "blocks", label: "Sidebar" },
    ]);
  });
});
