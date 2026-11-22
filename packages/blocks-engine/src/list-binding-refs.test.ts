/**
 * A binding naming the list it reads (`list`) holds a node id, so every
 * copier that mints node ids has to carry it along: a copy of an outer list
 * whose blocks still name the original reads nothing and is refused at save.
 * Each copier is held to the same two answers: a list inside the copy is
 * followed to its copy, and a list outside it is left as named.
 */
import { describe, expect, it } from "vitest";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "./document";
import {
  composeEntryContent,
  ENTRY_CONTENT_SLOT,
  ENTRY_CONTENT_TYPE,
} from "./entry-content";
import { resolveComponentInstances } from "./resolve-instances";
import { findNode, reidForestWithMap, reidSubtree } from "./tree";

/** A heading reading `field` of the entry of the list `list`. */
function heading(id: string, list: string, field = "name"): BlockNode {
  return {
    id,
    type: "core/heading",
    version: 1,
    props: { text: "Own text" },
    bindings: { text: { $bind: field, source: "item", list } },
  };
}

/** A list of `collection`, its entries drawn with `children`. */
function list(id: string, collection: string, children: BlockNode[]) {
  return {
    id,
    type: "core/collection-loop",
    version: 1,
    props: { collection, limit: 3 },
    slots: { children },
  } satisfies BlockNode;
}

/**
 * Categories, each drawing its posts, whose headings name the category list
 * (inside what is copied) and a page list around it (outside).
 */
function categories(): BlockNode {
  return list("categories", "categories", [
    list("posts", "posts", [
      heading("by-category", "categories"),
      heading("by-page", "page-list", "title"),
    ]),
  ]);
}

/** The list a heading's text binding names, if any. */
function listNamedBy(node: BlockNode | undefined): string | undefined {
  const binding = node?.bindings?.text;
  return binding !== undefined && "list" in binding ? binding.list : undefined;
}

/** The list each of the two headings names, found inside `nodes`. */
function namedLists(nodes: BlockNode[]): {
  categoryList: string;
  copiedCategory: unknown;
  pageList: unknown;
} {
  const outer = nodes[0];
  const inner = outer?.slots?.children?.[0];
  const [byCategory, byPage] = inner?.slots?.children ?? [];
  return {
    categoryList: outer?.id ?? "",
    copiedCategory: listNamedBy(byCategory),
    pageList: listNamedBy(byPage),
  };
}

describe("a binding naming its list, copied", () => {
  it("follows a duplicated list to its copy, and leaves one outside the copy alone", () => {
    const copy = reidSubtree(categories());
    const named = namedLists([copy]);
    expect(named.categoryList).not.toBe("categories");
    expect(named.copiedCategory).toBe(named.categoryList);
    expect(named.pageList).toBe("page-list");
  });

  it("follows a pasted or saved run's lists to their copies", () => {
    for (const policy of ["keep", "remint"] as const) {
      const { nodes } = reidForestWithMap([categories()], policy);
      const named = namedLists(nodes);
      expect(named.categoryList).not.toBe("categories");
      expect(named.copiedCategory).toBe(named.categoryList);
      expect(named.pageList).toBe("page-list");
    }
  });

  it("follows a component's list to the id the instance draws it with", () => {
    const host: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        list("page-list", "pages", [
          {
            id: "placed",
            type: COMPONENT_INSTANCE_TYPE,
            version: 1,
            props: { componentId: "cards" },
          },
        ]),
      ],
    };
    const definition: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [categories()],
    };
    const { document } = resolveComponentInstances(
      host,
      new Map([["cards", definition]])
    );
    const drawn = document.nodes[0]?.slots?.children ?? [];
    const named = namedLists(drawn);
    expect(named.categoryList).not.toBe("categories");
    expect(named.copiedCategory).toBe(named.categoryList);
    expect(named.pageList).toBe("page-list");
  });

  it("follows an entry's list to the id its template draws it with", () => {
    const template: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "template",
      nodes: [
        {
          id: "content",
          type: ENTRY_CONTENT_TYPE,
          version: 1,
          props: { field: "body" },
        },
      ],
    };
    const body: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [categories()],
    };
    const composed = composeEntryContent(template, {
      valueOf: field => (field === "body" ? body : undefined),
    });
    const drawn =
      findNode(composed.nodes, "content")?.slots?.[ENTRY_CONTENT_SLOT] ?? [];
    const named = namedLists(drawn);
    expect(named.categoryList).not.toBe("categories");
    expect(named.copiedCategory).toBe(named.categoryList);
    expect(named.pageList).toBe("page-list");
  });
});
