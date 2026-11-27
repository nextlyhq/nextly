/**
 * What the command palette offers a reader: collections, Singles, pages and
 * actions, each only where the reader may open it.
 */
import { describe, expect, it } from "vitest";

import { Settings } from "@admin/components/icons";
import type { SettingsNavGroup } from "@admin/components/layout/sidebar/lib/settings-nav";
import type { PluginMetadata } from "@admin/types/branding";
import type { ApiCollection, ApiSingle } from "@admin/types/entities";

import { paletteResults, type PaletteSources } from "./palette-results";

function collection(name: string, singular: string, plural: string) {
  return {
    name,
    label: plural,
    labels: { singular, plural },
  } as unknown as ApiCollection;
}

function single(slug: string, label: string) {
  return { slug, label } as unknown as ApiSingle;
}

const posts = collection("posts", "Post", "Posts");
const pages = collection("pages", "Page", "Pages");
const authors = collection("authors", "Author", "Authors");
const products = collection("products", "Product", "Products");
const homepage = single("homepage", "Homepage");

/** A plugin that adds a page to the menus, readable with one grant. */
const reportsPlugin = {
  name: "reports",
  menu: [
    {
      label: "Reports",
      to: "/admin/plugins/reports",
      requiredPermission: "read-reports",
    },
  ],
} as unknown as PluginMetadata;

function sources(over: Partial<PaletteSources>): PaletteSources {
  return {
    collections: [],
    singles: [],
    singleHref: s => `/admin/singles/${s.slug}`,
    creatable: [],
    hasPermission: () => false,
    canManageSettings: false,
    plugins: [],
    showBuilder: true,
    ...over,
  };
}

const labels = (rows: readonly { label: string }[]) => rows.map(r => r.label);

describe("the palette's results for an admin", () => {
  const admin = paletteResults(
    sources({
      collections: [posts, pages, authors, products],
      singles: [homepage],
      creatable: [posts, products],
      hasPermission: () => true,
      canManageSettings: true,
      plugins: [reportsPlugin],
    })
  );

  it("lists every collection and Single the Content panel lists, each opening its list or editor", () => {
    expect(admin.collections.map(r => [r.label, r.href])).toEqual([
      ["Posts", "/admin/collections/posts"],
      ["Pages", "/admin/collections/pages"],
      ["Authors", "/admin/collections/authors"],
      ["Products", "/admin/collections/products"],
    ]);
    expect(admin.singles.map(r => [r.label, r.href])).toEqual([
      ["Homepage", "/admin/singles/homepage"],
    ]);
  });

  it("lists the Settings pages, the Builders pages, Account settings and a plugin's page", () => {
    const shown = labels(admin.pages);
    for (const page of [
      "Dashboard",
      "General",
      "Users",
      "Roles",
      "API Keys",
      "Webhooks",
      "Collections",
      "Singles",
      "Field Groups",
      "Account settings",
      "Reports",
    ]) {
      expect(shown).toContain(page);
    }
    // Each page says where it sits, so "Collections" the builder reads apart
    // from a collection.
    expect(admin.pages.find(p => p.label === "Field Groups")?.hint).toBe(
      "Builders"
    );
    expect(admin.pages.find(p => p.label === "General")?.hint).toBe("Settings");
  });

  it('offers "New <type>" for each type they may create, and the help links', () => {
    const actions = labels(admin.actions);
    expect(actions).toEqual(
      expect.arrayContaining([
        "New Post",
        "New Product",
        "Create user",
        "Create role",
        "Open documentation",
        "GitHub",
        "Discord",
      ])
    );
    expect(actions).not.toContain("New Page");
    expect(admin.actions.find(a => a.label === "GitHub")).toMatchObject({
      href: "https://github.com/nextlyhq/nextly",
      external: true,
    });
    expect(admin.actions.find(a => a.label === "New Post")?.href).toBe(
      "/admin/collections/posts/create"
    );
  });
});

describe("the palette's results for a role that reads three collections", () => {
  const reads = new Set(["read-posts", "read-pages", "read-authors"]);
  const three = paletteResults(
    sources({
      collections: [posts, pages, authors],
      creatable: [],
      hasPermission: slug => reads.has(slug),
      plugins: [reportsPlugin],
    })
  );

  it("lists only what they may open: no Settings page, no user or role action, no plugin page they lack", () => {
    expect(labels(three.collections)).toEqual(["Posts", "Pages", "Authors"]);
    const shown = labels(three.pages);
    expect(shown).toContain("Dashboard");
    expect(shown).toContain("Account settings");
    for (const page of ["General", "Users", "Roles", "API Keys", "Reports"]) {
      expect(shown).not.toContain(page);
    }
    const actions = labels(three.actions);
    expect(actions).not.toContain("Create user");
    expect(actions).not.toContain("Create role");
    expect(actions.some(a => a.startsWith("New "))).toBe(false);
  });

  it("leaves the Builders pages out where the site turns the builder off", () => {
    // The control: with the builder on, the same reader has it.
    const on = paletteResults(sources({ showBuilder: true }));
    expect(labels(on.pages)).toContain("Field Groups");
    const off = paletteResults(sources({ showBuilder: false }));
    expect(labels(off.pages)).toContain("Dashboard");
    expect(labels(off.pages)).not.toContain("Field Groups");
  });
});

describe("a Settings page whose route asks more than its link", () => {
  it("is left out for a reader who may see the link but not open the page", () => {
    const nav: SettingsNavGroup[] = [
      {
        id: "developers",
        label: "Developers",
        items: [
          {
            id: "keys",
            label: "Keys",
            icon: Settings,
            href: "/admin/settings/keys",
            gate: { kind: "permission", permission: "read-keys-link" },
            routePermission: "open-keys",
          },
        ],
      },
    ];
    const seesLink = paletteResults(
      sources({ hasPermission: slug => slug === "read-keys-link" }),
      nav
    );
    expect(labels(seesLink.pages)).not.toContain("Keys");
    const opens = paletteResults(
      sources({
        hasPermission: slug =>
          slug === "read-keys-link" || slug === "open-keys",
      }),
      nav
    );
    expect(labels(opens.pages)).toContain("Keys");
  });
});

describe("help links a plugin hides", () => {
  it("leaves out each link a plugin's header.hide names", () => {
    const hider = {
      name: "quiet",
      header: { hide: ["github", "discord"] },
    } as unknown as PluginMetadata;
    const actions = labels(
      paletteResults(sources({ plugins: [hider] })).actions
    );
    expect(actions).toContain("Open documentation");
    expect(actions).not.toContain("GitHub");
    expect(actions).not.toContain("Discord");
  });

  it("leaves out all three where a plugin hides the defaults", () => {
    const hider = {
      name: "bare",
      header: { hideDefaults: true },
    } as unknown as PluginMetadata;
    const actions = labels(
      paletteResults(sources({ plugins: [hider], hasPermission: () => true }))
        .actions
    );
    // The control: the actions are drawn, only the help links are gone.
    expect(actions).toContain("Create user");
    for (const link of ["Open documentation", "GitHub", "Discord"]) {
      expect(actions).not.toContain(link);
    }
  });
});
