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
import { routeConfig } from "@admin/pages/registry";

import {
  clearDocumentViews,
  documentViewApplies,
  documentViewMissing,
  resolveViewField,
  matchDocumentView,
  registerDocumentViews,
  routedDocumentView,
} from "./document-view-registry";

// Pages load on demand through lazyRoute, so the resolver hands back the
// route table's own wrapper for each page. Identity is asserted against
// those entries rather than against the raw page modules.
const EditEntryPage = routeConfig[ROUTES.COLLECTION_ENTRY_EDIT].component;
const EntryVersionsPage =
  routeConfig[ROUTES.COLLECTION_ENTRY_VERSIONS].component;
const SingleEditPage = routeConfig[ROUTES.SINGLE_EDIT].component;
const SingleVersionsPage = routeConfig[ROUTES.SINGLE_VERSIONS].component;

afterEach(() => clearDocumentViews());

const builder = {
  slug: "pages",
  path: "builder",
  component: "@acme/pb/admin#Builder",
};

describe("document view registry", () => {
  it("finds a view by slug and path, and nothing at another path or slug", () => {
    registerDocumentViews([builder]);

    expect(matchDocumentView("collection", "pages", "builder")).toEqual(
      builder
    );
    expect(matchDocumentView("collection", "pages", "preview")).toBeUndefined();
    expect(matchDocumentView("collection", "posts", "builder")).toBeUndefined();
  });

  it("keeps two pairs apart that a joined key would merge", () => {
    // A slug or path containing the delimiter a flat join would use must not
    // make `("a-b", "c")` and `("a", "b-c")` one entry.
    registerDocumentViews([
      { slug: "a-b", path: "c", component: "one" },
      { slug: "a", path: "b-c", component: "two" },
    ]);

    expect(matchDocumentView("collection", "a-b", "c")?.component).toBe("one");
    expect(matchDocumentView("collection", "a", "b-c")?.component).toBe("two");
  });

  it("names no view for missing or repeated route segments", () => {
    registerDocumentViews([builder]);

    expect(routedDocumentView("collection", "pages", "builder")).toEqual(
      builder
    );
    expect(
      routedDocumentView("collection", "pages", undefined)
    ).toBeUndefined();
    expect(
      routedDocumentView("collection", undefined, "builder")
    ).toBeUndefined();
    expect(
      routedDocumentView("collection", ["pages"], "builder")
    ).toBeUndefined();
  });

  it("forgets every view on clear", () => {
    registerDocumentViews([builder]);
    clearDocumentViews();
    expect(matchDocumentView("collection", "pages", "builder")).toBeUndefined();
  });
});

/** A view offered wherever a top-level "blocks" field is. */
const blocksBuilder = {
  fieldType: "blocks",
  path: "page-builder",
  component: "@acme/pb/admin#Builder",
};

describe("a view scoped to a field type", () => {
  it("is the candidate at its path on any document", () => {
    registerDocumentViews([blocksBuilder]);
    expect(matchDocumentView("collection", "pages", "page-builder")).toBe(
      blocksBuilder
    );
    expect(matchDocumentView("collection", "homepage", "page-builder")).toBe(
      blocksBuilder
    );
    expect(matchDocumentView("collection", "pages", "other")).toBeUndefined();
  });

  it("applies to a document with a TOP-LEVEL field of its type only", () => {
    expect(
      documentViewApplies(blocksBuilder, [{ type: "text" }, { type: "blocks" }])
    ).toBe(true);
    // Nested inside a group, the field is not counted.
    expect(
      documentViewApplies(blocksBuilder, [
        { name: "extra", type: "group", fields: [{ type: "blocks" }] },
      ])
    ).toBe(false);
    expect(documentViewApplies(blocksBuilder, [{ type: "text" }])).toBe(false);
    expect(documentViewApplies(blocksBuilder, undefined)).toBe(false);
  });

  it("applies a slug-scoped view to its document whatever its fields", () => {
    expect(documentViewApplies(builder, [])).toBe(true);
  });

  it("is missing on a document without the field, and present where it has one", () => {
    registerDocumentViews([blocksBuilder]);
    expect(
      documentViewMissing("collection", "posts", "page-builder", [
        { type: "text" },
      ])
    ).toBe(true);
    expect(
      documentViewMissing("collection", "pages", "page-builder", [
        { type: "blocks" },
      ])
    ).toBe(false);
    // An address naming no view at all is the resolver's to refuse, not this.
    expect(documentViewMissing("collection", "pages", "other", [])).toBe(false);
  });

  it("answers a Single's address only when scoped to a field type", () => {
    // A collection and a Single can share a slug; a view declared on the
    // collection must not appear at the Single's address.
    registerDocumentViews([builder, blocksBuilder]);
    expect(matchDocumentView("single", "pages", "builder")).toBeUndefined();
    expect(matchDocumentView("single", "home", "page-builder")).toBe(
      blocksBuilder
    );
  });

  it("is forgotten on clear", () => {
    registerDocumentViews([blocksBuilder]);
    clearDocumentViews();
    expect(
      matchDocumentView("collection", "pages", "page-builder")
    ).toBeUndefined();
  });

  it("routes an entry address at its path to the entry page, gated as the editor it draws is", () => {
    registerDocumentViews([blocksBuilder]);
    const resolved = resolveRoute(
      buildRoute(ROUTES.COLLECTION_ENTRY_VIEW, {
        slug: "pages",
        id: "e1",
        view: "page-builder",
      }),
      ""
    );
    expect(resolved.Component).toBe(EditEntryPage);
    expect(resolved.requiredPermission).toBe("read-pages");
  });
});

describe("which field a field-type view edits", () => {
  const twoFields = [
    { name: "title", type: "text" },
    { name: "hero", label: "Hero", type: "blocks" },
    { name: "body", label: "Body", type: "blocks" },
  ];

  it("opens the only field of its type, whatever the address asks", () => {
    expect(
      resolveViewField(
        "blocks",
        [{ name: "layout", type: "blocks" }],
        undefined
      )
    ).toEqual({
      kind: "field",
      name: "layout",
      // The declaration itself, so the view reads the field's own options.
      declaration: { name: "layout", type: "blocks" },
      within: [],
    });
  });

  it("opens the field the address names, on a document with two", () => {
    expect(resolveViewField("blocks", twoFields, "hero")).toEqual({
      kind: "field",
      name: "hero",
      declaration: twoFields[1],
      within: [],
    });
    expect(resolveViewField("blocks", twoFields, "body")).toEqual({
      kind: "field",
      name: "body",
      declaration: twoFields[2],
      within: [],
    });
  });

  it("asks which field when the address names none", () => {
    expect(resolveViewField("blocks", twoFields, undefined)).toEqual({
      kind: "choose",
      candidates: [
        { name: "hero", label: "Hero", declaration: twoFields[1], within: [] },
        { name: "body", label: "Body", declaration: twoFields[2], within: [] },
      ],
    });
  });

  it("names the unnamed groups around the field, outermost first", () => {
    // The form applies a group's gates to everything inside it, so a surface
    // editing the field on its own has to see them.
    const inner = {
      type: "group",
      fields: [{ name: "aside", type: "blocks" }],
    };
    const outer = { type: "group", admin: { readOnly: true }, fields: [inner] };
    const resolved = resolveViewField("blocks", [outer], undefined);
    expect(resolved.kind === "field" ? resolved.within : null).toEqual([
      outer,
      inner,
    ]);
  });

  it("offers only the fields `admits` lets through, and opens the only one", () => {
    const onlyBody = (candidate: { name: string }) => candidate.name === "body";
    expect(
      resolveViewField("blocks", twoFields, undefined, onlyBody)
    ).toMatchObject({
      kind: "field",
      name: "body",
    });
    const threeFields = [
      ...twoFields,
      { name: "aside", label: "Aside", type: "blocks" },
    ];
    const notHero = (candidate: { name: string }) => candidate.name !== "hero";
    const asked = resolveViewField("blocks", threeFields, undefined, notHero);
    expect(
      asked.kind === "choose" ? asked.candidates.map(c => c.name) : asked
    ).toEqual(["body", "aside"]);
  });

  it("answers the field the address names even when `admits` refuses it", () => {
    // The caller says why; opening another field in its place would hide that.
    const none = () => false;
    expect(resolveViewField("blocks", twoFields, "hero", none)).toMatchObject({
      kind: "field",
      name: "hero",
    });
  });

  it("asks among them all when `admits` lets none through", () => {
    const none = () => false;
    const asked = resolveViewField("blocks", twoFields, undefined, none);
    expect(
      asked.kind === "choose" ? asked.candidates.map(c => c.name) : asked
    ).toEqual(["hero", "body"]);
  });

  it("asks rather than guesses when the address names a field that is not one", () => {
    // A text field, and a name the document does not have.
    expect(resolveViewField("blocks", twoFields, "title").kind).toBe("choose");
    expect(resolveViewField("blocks", twoFields, "nope").kind).toBe("choose");
  });

  it("counts a field in an unnamed group as top-level, and one in a named group not", () => {
    // An unnamed group is presentation only: its fields are addressed at the
    // top level, so the view reaches them; a named group moves them down.
    const fields = [
      { type: "group", fields: [{ name: "aside", type: "blocks" }] },
      {
        name: "hero",
        type: "group",
        fields: [{ name: "inner", type: "blocks" }],
      },
    ];
    expect(resolveViewField("blocks", fields, undefined)).toMatchObject({
      kind: "field",
      name: "aside",
    });
    expect(documentViewApplies(blocksBuilder, fields)).toBe(true);
    expect(documentViewApplies(blocksBuilder, [fields[1] as object])).toBe(
      false
    );
  });

  it("names no field for a view scoped to the document itself", () => {
    expect(resolveViewField(undefined, twoFields, "hero")).toEqual({
      kind: "document",
    });
  });
});

describe("resolveRoute for a document view", () => {
  it("resolves an entry's registered view to the entry page, gated as the editor it draws is", () => {
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
    expect(resolved.requiredPermission).toBe("read-pages");
    expect(resolved.routeType).toBe("private");
    // A refused view names what it opens, as the entry page it draws does.
    expect(resolved.accessSubject).toBe("collection");
  });

  it("resolves a Single's field-type view to the Single page, gated as the editor it draws is", () => {
    // A Single is reached only by a field-type view: `views[slug]` declares
    // for a collection.
    registerDocumentViews([{ ...blocksBuilder, path: "builder" }]);
    const href = buildRoute(ROUTES.SINGLE_VIEW, {
      slug: "homepage",
      view: "builder",
    });

    const resolved = resolveRoute(href, "");

    expect(resolved.Component).toBe(SingleEditPage);
    expect(resolved.params).toEqual({ slug: "homepage", view: "builder" });
    expect(resolved.requiredPermission).toBe("read-homepage");
    expect(resolved.accessSubject).toBe("single");
  });

  it("does not route a collection's declared view at a Single of the same slug", () => {
    registerDocumentViews([{ ...builder, slug: "homepage" }]);
    const resolved = resolveRoute(
      buildRoute(ROUTES.SINGLE_VIEW, { slug: "homepage", view: "builder" }),
      ""
    );
    expect(resolved.Component).not.toBe(SingleEditPage);
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
