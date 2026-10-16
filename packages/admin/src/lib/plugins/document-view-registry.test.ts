/**
 * The document-view registry, and the resolver's reading of it.
 *
 * Asked the question a click asks: which page answers an address, under which
 * permission, with which params. Component identity rather than "not the
 * not-found page", because the resolver's fallback is a component too.
 */
import { afterEach, describe, expect, it } from "vitest";

import { ROUTES, buildRoute } from "@admin/constants/routes";
import { resolveRoute } from "@admin/lib/routing";
import EditEntryPage from "@admin/pages/dashboard/entries/[slug]/[id]/index";
import EntryVersionsPage from "@admin/pages/dashboard/entries/[slug]/[id]/versions";
import SingleEditPage from "@admin/pages/dashboard/singles/[slug]/index";
import SingleVersionsPage from "@admin/pages/dashboard/singles/[slug]/versions";

import {
  clearDocumentViews,
  matchDocumentView,
  registerDocumentViews,
  routedDocumentView,
} from "./document-view-registry";

afterEach(() => clearDocumentViews());

const builder = {
  slug: "pages",
  path: "builder",
  component: "@acme/pb/admin#Builder",
};

describe("document view registry", () => {
  it("finds a view by slug and path, and nothing at another path or slug", () => {
    registerDocumentViews([builder]);

    expect(matchDocumentView("pages", "builder")).toEqual(builder);
    expect(matchDocumentView("pages", "preview")).toBeUndefined();
    expect(matchDocumentView("posts", "builder")).toBeUndefined();
  });

  it("keeps two pairs apart that a joined key would merge", () => {
    // A slug or path containing the delimiter a flat join would use must not
    // make `("a-b", "c")` and `("a", "b-c")` one entry.
    registerDocumentViews([
      { slug: "a-b", path: "c", component: "one" },
      { slug: "a", path: "b-c", component: "two" },
    ]);

    expect(matchDocumentView("a-b", "c")?.component).toBe("one");
    expect(matchDocumentView("a", "b-c")?.component).toBe("two");
  });

  it("names no view for missing or repeated route segments", () => {
    registerDocumentViews([builder]);

    expect(routedDocumentView("pages", "builder")).toEqual(builder);
    expect(routedDocumentView("pages", undefined)).toBeUndefined();
    expect(routedDocumentView(undefined, "builder")).toBeUndefined();
    expect(routedDocumentView(["pages"], "builder")).toBeUndefined();
  });

  it("forgets every view on clear", () => {
    registerDocumentViews([builder]);
    clearDocumentViews();
    expect(matchDocumentView("pages", "builder")).toBeUndefined();
  });
});

describe("resolveRoute for a document view", () => {
  it("resolves an entry's registered view to the entry page, gated as editing", () => {
    registerDocumentViews([builder]);
    const href = buildRoute(ROUTES.COLLECTION_ENTRY_VIEW, {
      slug: "pages",
      id: "e1",
      view: "builder",
    });

    const resolved = resolveRoute(href, "");

    expect(resolved.Component).toBe(EditEntryPage);
    expect(resolved.params).toEqual({
      slug: "pages",
      id: "e1",
      view: "builder",
    });
    expect(resolved.requiredPermission).toBe("update-pages");
    expect(resolved.routeType).toBe("private");
  });

  it("resolves a Single's registered view to the Single page, gated as editing", () => {
    registerDocumentViews([{ ...builder, slug: "homepage" }]);
    const href = buildRoute(ROUTES.SINGLE_VIEW, {
      slug: "homepage",
      view: "builder",
    });

    const resolved = resolveRoute(href, "");

    expect(resolved.Component).toBe(SingleEditPage);
    expect(resolved.params).toEqual({ slug: "homepage", view: "builder" });
    expect(resolved.requiredPermission).toBe("update-homepage");
  });

  it("answers an address no plugin declared with the not-found page", () => {
    // The positive control is the first case above: the same address shape
    // resolves once a view is registered, so this is the registry deciding.
    registerDocumentViews([builder]);

    for (const href of [
      "/admin/collections/pages/e1/preview",
      "/admin/collections/posts/e1/builder",
      "/admin/singles/homepage/preview",
    ]) {
      const resolved = resolveRoute(href, "");
      expect(resolved.Component, href).not.toBe(EditEntryPage);
      expect(resolved.Component, href).not.toBe(SingleEditPage);
      expect(resolved.params, href).toEqual({});
      expect(resolved.requiredPermission, href).toBeUndefined();
    }
  });

  it("keeps the versions and api addresses their own, even against a view claiming them", () => {
    // The server refuses these paths at boot. Registering them anyway is the
    // case where only route ORDER keeps the document's own screens reachable.
    registerDocumentViews([
      { slug: "pages", path: "versions", component: "x" },
      { slug: "homepage", path: "versions", component: "x" },
      { slug: "homepage", path: "api", component: "x" },
    ]);

    const entryVersions = resolveRoute(
      buildRoute(ROUTES.COLLECTION_ENTRY_VERSIONS, { slug: "pages", id: "e1" }),
      ""
    );
    expect(entryVersions.Component).toBe(EntryVersionsPage);
    expect(entryVersions.requiredPermission).toBe("read-pages");

    const singleVersions = resolveRoute(
      buildRoute(ROUTES.SINGLE_VERSIONS, { slug: "homepage" }),
      ""
    );
    expect(singleVersions.Component).toBe(SingleVersionsPage);
    expect(singleVersions.requiredPermission).toBe("read-homepage");

    const singleApi = resolveRoute(
      buildRoute(ROUTES.SINGLE_API, { slug: "homepage" }),
      ""
    );
    expect(singleApi.Component).not.toBe(SingleEditPage);
    expect(singleApi.requiredPermission).toBe("read-homepage");
  });

  it("leaves the plain edit addresses on the edit pages", () => {
    registerDocumentViews([builder]);

    const entry = resolveRoute(
      buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, { slug: "pages", id: "e1" }),
      ""
    );
    expect(entry.Component).toBe(EditEntryPage);
    expect(entry.params).toEqual({ slug: "pages", id: "e1" });

    const single = resolveRoute(
      buildRoute(ROUTES.SINGLE_EDIT, { slug: "homepage" }),
      ""
    );
    expect(single.Component).toBe(SingleEditPage);
    expect(single.params).toEqual({ slug: "homepage" });
  });
});
