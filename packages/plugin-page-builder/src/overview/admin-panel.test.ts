/**
 * Where the Page Builder sits in the admin, as the plugin declares it: its
 * own rail item after Forms, opening the overview, which is registered with
 * the permission its route asks; and its panel: the four libraries under
 * Library, each counting the collection it opens, then "Bindings to fix"
 * under Checks with the report's attention badge.
 *
 * Asserted against the plugin's definition, which is what core serializes for
 * the admin, and against what that definition also declares (its
 * collections, its attention items, its pages and routes), since core leaves
 * out a count naming a collection the plugin does not contribute, a badge
 * naming an attention item it does not declare, and a landing naming a page
 * it does not register.
 */
import { describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PATTERNS_SLUG } from "../collections/patterns";
import { TEMPLATES_SLUG } from "../collections/templates";
import { pageBuilder } from "../plugin";

import { OVERVIEW_ROUTE_PATH } from "./contract";

/**
 * Where the form builder places Forms in the rail (`admin.after` and
 * `admin.order` in `@nextlyhq/plugin-form-builder`), which this package does
 * not depend on.
 */
const FORMS = { after: "media", order: 50 } as const;

/** Where the plugin's own pages are mounted in the admin. */
const PAGES_PREFIX = "/admin/plugins/nextlyhq-plugin-page-builder";

describe("the Page Builder's rail item", () => {
  it("is standalone, right after Forms, and after Media without it", () => {
    const admin = pageBuilder().admin;
    expect(admin?.placement).toBe("standalone");
    // The same anchor as Forms, ordered after it: the rail sorts plugins
    // sharing an anchor by order, lower first.
    expect(admin?.after).toBe(FORMS.after);
    expect(admin?.order).toBeGreaterThan(FORMS.order);
  });

  it("opens the overview, a page the plugin registers for those who edit pages", () => {
    const plugin = pageBuilder();
    const pages = plugin.contributes?.admin?.pages ?? [];
    const overview = pages.find(page => page.path === OVERVIEW_ROUTE_PATH);

    expect(plugin.admin?.landing).toBe(`${PAGES_PREFIX}${OVERVIEW_ROUTE_PATH}`);
    expect(overview).toBeDefined();
    expect(overview?.component).toBe(
      "@nextlyhq/plugin-page-builder/admin#PageBuilderOverview"
    );
    // The permission the bindings page asks, the two being for one reader.
    const bindings = pages.find(page => page.path === "/bindings-to-fix");
    expect(overview?.requiredPermission).toBe("update-pages");
    expect(bindings?.requiredPermission).toBe(overview?.requiredPermission);
  });

  it("reads the overview through a route of its own, asking what its page asks", () => {
    const routes = pageBuilder().contributes?.routes ?? [];
    const route = routes.find(
      candidate => candidate.path === OVERVIEW_ROUTE_PATH
    );
    expect(route?.method).toBe("GET");
    // Resolved through the host's naming of Pages, as the bindings route is:
    // `update` on Pages, under whatever slug the site registered it.
    const permission = route?.requiredPermission;
    if (typeof permission !== "function") {
      throw new Error("the overview route names no permission resolver");
    }
    const scope = {
      plugin: "@nextlyhq/plugin-page-builder",
      collection: (slug: string, action: string) => `${action}-${slug}`,
      single: (slug: string, action: string) => `${action}-${slug}`,
    };
    expect(permission(scope)).toBe("update-pages");
    expect(
      permission({ ...scope, collection: (_slug, action) => `${action}-site` })
    ).toBe("update-site");
  });
});

describe("the Page Builder's panel", () => {
  it("declares Library, then Checks", () => {
    const panel = pageBuilder().contributes?.admin?.panel;
    expect(panel?.groups).toEqual([
      { id: "library", label: "Library" },
      { id: "checks", label: "Checks" },
    ]);
  });

  it("lists the four libraries under Library, each counting the collection it opens", () => {
    const plugin = pageBuilder();
    const menu = plugin.contributes?.admin?.menu ?? [];
    const contributed = (plugin.contributes?.collections ?? []).map(
      collection => collection.slug
    );
    const libraries = menu.filter(item => item.group === "library");

    expect(libraries.map(item => item.label)).toEqual([
      "Patterns",
      "Components",
      "Layouts",
      "Templates",
    ]);
    expect(libraries.map(item => item.collection)).toEqual([
      PATTERNS_SLUG,
      COMPONENTS_SLUG,
      LAYOUTS_SLUG,
      TEMPLATES_SLUG,
    ]);
    for (const item of libraries) {
      // A quiet count, of the collection the item opens, which the plugin
      // contributes; never a badge.
      expect(item.count, item.label).toEqual({ collection: item.collection });
      expect(item.badge, item.label).toBeUndefined();
      expect(contributed, item.label).toContain(item.collection);
      expect(item.to).toBe(`/admin/collections/${item.collection}`);
      // Gated on reading the collection, through `collection`, as before.
      expect(item.requiredPermission, item.label).toBeUndefined();
    }
  });

  it("lists Bindings to fix under Checks, with the report's attention badge", () => {
    const plugin = pageBuilder();
    const menu = plugin.contributes?.admin?.menu ?? [];
    const attention = (plugin.contributes?.dashboard?.attention ?? []).map(
      item => item.id
    );
    const checks = menu.filter(item => item.group === "checks");

    expect(checks.map(item => item.label)).toEqual(["Bindings to fix"]);
    const [bindings] = checks;
    expect(bindings?.badge).toEqual({
      attention: "page-builder/bindings-to-fix",
    });
    expect(bindings?.count).toBeUndefined();
    expect(attention).toContain("page-builder/bindings-to-fix");
    expect(bindings?.requiredPermission).toBe("update-pages");
    // Every item is in a group: none is listed above the headings.
    expect(menu.filter(item => item.group === undefined)).toEqual([]);
  });

  it("keeps Components on the plugin's own collection where a host keeps its store elsewhere", () => {
    // The item opens the plugin's own Components whichever store the editor
    // reads definitions from, so the number beside it counts that collection,
    // which the plugin still contributes.
    const plugin = pageBuilder({
      componentReadiness: { collection: "site-components" },
    });
    const components = (plugin.contributes?.admin?.menu ?? []).find(
      item => item.label === "Components"
    );
    expect(components?.to).toBe(`/admin/collections/${COMPONENTS_SLUG}`);
    expect(components?.count).toEqual({ collection: COMPONENTS_SLUG });
    expect(
      (plugin.contributes?.collections ?? []).map(collection => collection.slug)
    ).toContain(COMPONENTS_SLUG);
  });
});
