import { describe, expect, it } from "vitest";

import type { ApiCollection } from "@admin/types/entities";

import { newMenu } from "./new-menu-model";

function collection(
  name: string,
  admin: ApiCollection["admin"] = {},
  singular = name.replace(/s$/, "")
): ApiCollection {
  return {
    id: name,
    name,
    label: name,
    labels: { singular, plural: name },
    tableName: name,
    schemaDefinition: { fields: [] },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    admin,
  };
}

const posts = collection("posts");
const pages = collection("pages");
const authors = collection("authors");
const names = (list: readonly ApiCollection[]) => list.map(c => c.name);

describe("newMenu", () => {
  it("creates the most recent type the reader may still create", () => {
    const menu = newMenu({
      creatable: [posts, pages, authors],
      recentSlugs: ["gone", "authors", "posts"],
      sidebarCollections: [pages, posts, authors],
    });
    expect(menu.primary?.name).toBe("authors");
    expect(names(menu.recent)).toEqual(["authors", "posts"]);
  });

  it("falls back to the first type in sidebar order, not by name", () => {
    const menu = newMenu({
      creatable: [authors, posts, pages],
      recentSlugs: [],
      sidebarCollections: [pages, authors, posts],
    });
    expect(menu.primary?.name).toBe("pages");
    expect(menu.sections).toEqual([
      {
        id: "collections",
        label: "Collections",
        collections: [pages, authors, posts],
      },
    ]);
  });

  it("keeps at most three recent types", () => {
    const four = [posts, pages, authors, collection("tags")];
    const menu = newMenu({
      creatable: four,
      recentSlugs: names(four),
      sidebarCollections: four,
    });
    expect(names(menu.recent)).toEqual(["posts", "pages", "authors"]);
  });

  it("lists a sidebar type the reader may not create nowhere", () => {
    const menu = newMenu({
      creatable: [posts],
      recentSlugs: ["pages"],
      sidebarCollections: [pages, posts],
    });
    expect(menu.recent).toEqual([]);
    expect(menu.sections).toEqual([
      { id: "collections", label: "Collections", collections: [posts] },
    ]);
  });

  it("groups the rest as the sidebar does, each type once", () => {
    const faq = collection("faqs", { sidebarGroup: "help", order: 2 });
    const guides = collection("guides", { sidebarGroup: "help", order: 1 });
    const orders = collection("orders", { isPlugin: true, group: "Shop" });
    const forms = collection("forms", { isPlugin: true });
    const loose = collection("loose", { sidebarGroup: "nowhere" });
    const placed = collection("placed", { isPlugin: true });
    const menu = newMenu({
      creatable: [faq, guides, orders, forms, loose, placed, posts],
      recentSlugs: [],
      sidebarCollections: [posts],
      customGroups: [{ slug: "help", name: "Help" }],
      plugins: [{ name: "Placer", collections: ["placed"], placement: "help" }],
    });
    expect(menu.sections.map(s => [s.label, names(s.collections)])).toEqual([
      ["Collections", ["posts"]],
      ["Help", ["guides", "faqs", "placed"]],
      ["Other", ["forms", "loose"]],
      ["Shop", ["orders"]],
    ]);
  });

  it("names each section by what it is, so two of one heading stay two", () => {
    const deals = collection("deals", { sidebarGroup: "commerce" });
    const orders = collection("orders", { isPlugin: true, group: "Commerce" });
    const notes = collection("notes", { sidebarGroup: "misc" });
    const forms = collection("forms", { isPlugin: true });
    const menu = newMenu({
      creatable: [deals, orders, notes, forms],
      recentSlugs: [],
      sidebarCollections: [],
      customGroups: [
        { slug: "commerce", name: "Commerce" },
        { slug: "misc", name: "Other" },
      ],
    });
    expect(
      menu.sections.map(s => [s.id, s.label, names(s.collections)])
    ).toEqual([
      ["custom:commerce", "Commerce", ["deals"]],
      ["custom:misc", "Other", ["notes"]],
      ["plugin:Commerce", "Commerce", ["orders"]],
      ["other", "Other", ["forms"]],
    ]);
  });

  it("offers a search past ten types, not at ten", () => {
    const types = (n: number) =>
      Array.from({ length: n }, (_, i) => collection(`t${i}`));
    const at = (n: number) =>
      newMenu({
        creatable: types(n),
        recentSlugs: [],
        sidebarCollections: types(n),
      }).searchable;
    expect([at(3), at(10), at(11)]).toEqual([false, false, true]);
  });

  it("has nothing to create when nothing is creatable", () => {
    const menu = newMenu({
      creatable: [],
      recentSlugs: ["posts"],
      sidebarCollections: [posts],
    });
    expect(menu).toEqual({
      primary: null,
      recent: [],
      sections: [],
      searchable: false,
    });
  });
});
