import { describe, expect, it } from "vitest";

import { buildCapabilities } from "@admin/hooks/useCurrentUserPermissions";
import type { ApiCollection } from "@admin/types/entities";
import type { AdminCapabilities } from "@admin/types/permissions";

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

// Derived rather than hand-built, as the sidebar's own tests do: a reader who
// may read every type, so only placement and order decide the sections.
const readsEverything: AdminCapabilities = buildCapabilities([], true, {
  isSuperAdmin: true,
  validUntil: null,
  entities: {},
});

/** What the sidebar's Collections section is drawn for: no branding, no pins. */
const sidebar = {
  branding: undefined,
  capabilities: readsEverything,
  pinnedCollections: new Set<string>(),
};

describe("newMenu", () => {
  it("creates the most recent type the reader may still create", () => {
    const menu = newMenu({
      creatable: [posts, pages, authors],
      recentSlugs: ["gone", "authors", "posts"],
      ...sidebar,
    });
    expect(menu.primary?.name).toBe("authors");
    expect(names(menu.recent)).toEqual(["authors", "posts"]);
  });

  it("falls back to the first type in sidebar order, not by name", () => {
    // Pins first, then order, then name: the sidebar's own sort.
    const late = collection("articles", { order: 200 });
    const menu = newMenu({
      creatable: [late, authors, posts, pages],
      recentSlugs: [],
      ...sidebar,
      pinnedCollections: new Set(["pages"]),
    });
    expect(menu.primary?.name).toBe("pages");
    expect(menu.sections).toEqual([
      {
        id: "collections",
        label: "Collections",
        collections: [pages, authors, posts, late],
      },
    ]);
  });

  it("places a creatable type past the sidebar's first page in Collections", () => {
    // The sidebar reads one page of 100 collections. The menu reads every
    // creatable type, so the 101st ordinary one still sits in Collections, in
    // the sidebar's order, rather than falling into "Other".
    const many = Array.from({ length: 101 }, (_, i) =>
      collection(`type${String(i).padStart(3, "0")}`)
    );
    const pastThePage = many[100]!;
    const menu = newMenu({ creatable: many, recentSlugs: [], ...sidebar });
    expect(menu.sections.map(s => s.id)).toEqual(["collections"]);
    expect(menu.sections[0]!.collections).toHaveLength(101);
    expect(menu.sections[0]!.collections.at(-1)).toBe(pastThePage);
  });

  it("leaves a type the reader may not read out of Collections, as the sidebar does", () => {
    const readsPostsOnly: AdminCapabilities = {
      ...readsEverything,
      collections: { posts: readsEverything.collections.posts! },
    };
    const menu = newMenu({
      creatable: [posts, pages],
      recentSlugs: [],
      ...sidebar,
      capabilities: readsPostsOnly,
    });
    expect(menu.sections.map(s => [s.id, names(s.collections)])).toEqual([
      ["collections", ["posts"]],
      ["other", ["pages"]],
    ]);
  });

  it("keeps at most three recent types", () => {
    const four = [posts, pages, authors, collection("tags")];
    const menu = newMenu({
      creatable: four,
      recentSlugs: names(four),
      ...sidebar,
    });
    expect(names(menu.recent)).toEqual(["posts", "pages", "authors"]);
  });

  it("lists a type the reader may not create nowhere, recent or not", () => {
    const menu = newMenu({
      creatable: [posts],
      recentSlugs: ["pages"],
      ...sidebar,
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
      ...sidebar,
      branding: {
        customGroups: [{ slug: "help", name: "Help" }],
        plugins: [
          { name: "Placer", collections: ["placed"], placement: "help" },
        ],
      },
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
      ...sidebar,
      branding: {
        customGroups: [
          { slug: "commerce", name: "Commerce" },
          { slug: "misc", name: "Other" },
        ],
      },
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

  it('draws a plugin\'s group-less types and its "Other" group as one section', () => {
    // The plugin nav names a missing heading "Other", so both sit under one
    // "Other" there, and here, beside a type placed nowhere else.
    const forms = collection("forms", { isPlugin: true });
    const replies = collection("replies", { isPlugin: true, group: "Other" });
    const loose = collection("loose", { sidebarGroup: "nowhere" });
    const menu = newMenu({
      creatable: [forms, replies, loose],
      recentSlugs: [],
      ...sidebar,
    });
    expect(
      menu.sections.map(s => [s.id, s.label, names(s.collections)])
    ).toEqual([["other", "Other", ["forms", "loose", "replies"]]]);
  });

  it("offers a search past ten types, not at ten", () => {
    const types = (n: number) =>
      Array.from({ length: n }, (_, i) => collection(`t${i}`));
    const at = (n: number) =>
      newMenu({
        creatable: types(n),
        recentSlugs: [],
        ...sidebar,
      }).searchable;
    expect([at(3), at(10), at(11)]).toEqual([false, false, true]);
  });

  it("has nothing to create when nothing is creatable", () => {
    const menu = newMenu({
      creatable: [],
      recentSlugs: ["posts"],
      ...sidebar,
    });
    expect(menu).toEqual({
      primary: null,
      recent: [],
      sections: [],
      searchable: false,
    });
  });
});
