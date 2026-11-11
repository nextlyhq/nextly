import { describe, expect, it } from "vitest";

import { buildCapabilities } from "@admin/hooks/useCurrentUserPermissions";
import type { ApiCollection } from "@admin/types/entities";
import type { AdminCapabilities } from "@admin/types/permissions";

import { newMenuTypes } from "./new-menu-model";

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

describe("newMenuTypes", () => {
  it("orders by the sidebar: pins first, then order, then name", () => {
    const late = collection("articles", { order: 200 });
    const types = newMenuTypes({
      creatable: [late, authors, posts, pages],
      ...sidebar,
      pinnedCollections: new Set(["pages"]),
    });
    expect(names(types)).toEqual(["pages", "authors", "posts", "articles"]);
  });

  it("keeps a creatable type past the sidebar's first page among the Collections", () => {
    // The sidebar reads one page of 100 collections. The menu reads every
    // creatable type, so the 101st ordinary one still sits with the other
    // Collections, in the sidebar's order, not after the custom groups.
    const many = Array.from({ length: 101 }, (_, i) =>
      collection(`type${String(i).padStart(3, "0")}`)
    );
    const grouped = collection("faqs", { sidebarGroup: "help" });
    const types = newMenuTypes({
      creatable: [grouped, ...many],
      ...sidebar,
      branding: { customGroups: [{ slug: "help", name: "Help" }] },
    });
    expect(types).toHaveLength(102);
    expect(types[100]).toBe(many[100]);
    expect(types.at(-1)).toBe(grouped);
  });

  it("puts a type the reader may not read after the Collections, as the sidebar does", () => {
    const readsPostsOnly: AdminCapabilities = {
      ...readsEverything,
      collections: { posts: readsEverything.collections.posts! },
    };
    const types = newMenuTypes({
      creatable: [pages, posts],
      ...sidebar,
      capabilities: readsPostsOnly,
    });
    expect(names(types)).toEqual(["posts", "pages"]);
  });

  it("lists only what is creatable", () => {
    expect(names(newMenuTypes({ creatable: [posts], ...sidebar }))).toEqual([
      "posts",
    ]);
  });

  it("follows the sidebar's places, each type once, with no headings", () => {
    const faq = collection("faqs", { sidebarGroup: "help", order: 2 });
    const guides = collection("guides", { sidebarGroup: "help", order: 1 });
    const orders = collection("orders", { isPlugin: true, group: "Shop" });
    const forms = collection("forms", { isPlugin: true });
    const loose = collection("loose", { sidebarGroup: "nowhere" });
    const placed = collection("placed", { isPlugin: true });
    const types = newMenuTypes({
      creatable: [faq, guides, orders, forms, loose, placed, posts],
      ...sidebar,
      branding: {
        customGroups: [{ slug: "help", name: "Help" }],
        plugins: [
          { name: "Placer", collections: ["placed"], placement: "help" },
        ],
      },
    });
    // Collections, then Help, then "Other", then Shop: the sidebar's places.
    expect(names(types)).toEqual([
      "posts",
      "guides",
      "faqs",
      "placed",
      "forms",
      "loose",
      "orders",
    ]);
    expect(new Set(names(types)).size).toBe(types.length);
  });

  it("keeps two places of one heading apart, in the sidebar's order", () => {
    const deals = collection("deals", { sidebarGroup: "commerce" });
    const orders = collection("orders", { isPlugin: true, group: "Commerce" });
    const notes = collection("notes", { sidebarGroup: "misc" });
    const forms = collection("forms", { isPlugin: true });
    const types = newMenuTypes({
      creatable: [deals, orders, notes, forms],
      ...sidebar,
      branding: {
        customGroups: [
          { slug: "commerce", name: "Commerce" },
          { slug: "misc", name: "Other" },
        ],
      },
    });
    expect(names(types)).toEqual(["deals", "notes", "orders", "forms"]);
  });

  it('keeps a plugin\'s group-less types and its "Other" group together', () => {
    // The plugin nav names a missing heading "Other", so both sit together
    // there, and here, beside a type placed nowhere else.
    const forms = collection("forms", { isPlugin: true });
    const replies = collection("replies", { isPlugin: true, group: "Other" });
    const loose = collection("loose", { sidebarGroup: "nowhere" });
    const types = newMenuTypes({
      creatable: [forms, replies, loose],
      ...sidebar,
    });
    expect(names(types)).toEqual(["forms", "loose", "replies"]);
  });

  it("lists nothing when nothing is creatable", () => {
    expect(newMenuTypes({ creatable: [], ...sidebar })).toEqual([]);
  });
});
