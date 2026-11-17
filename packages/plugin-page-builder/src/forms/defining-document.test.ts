/**
 * Naming the document that defines a form, and reading its node as
 * published: what each kind reads, as whom, and that a read is all it does.
 * Against a real database: `__tests__/form-receiver.integration.test.ts`.
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  definingDocumentValue,
  parseDefiningDocument,
  publishedNode,
  type DefiningDocument,
  type DefiningStores,
  type PublishedReadApi,
} from "./defining-document";

const STORES: DefiningStores = {
  pages: "pages",
  templates: "templates",
  layouts: "layouts",
  components: { collection: "components", field: "content" },
};

const form = (id: string): BlockNode => ({
  id,
  type: "core/form",
  version: 1,
  props: {},
});

/**
 * A Direct API holding published rows by collection, recording every read,
 * and refusing anything that is not a read: the receiver writes nothing.
 */
function directApi(rows: Record<string, Record<string, unknown>[]>) {
  const reads: Record<string, unknown>[] = [];
  const api = new Proxy(
    {
      find: async (args: Record<string, unknown>) => {
        reads.push(args);
        const where = args.where as {
          id?: { equals?: string; in?: string[] };
          or?: Record<string, { equals?: unknown }>[];
        };
        const stored = rows[String(args.collection)] ?? [];
        if (where.or !== undefined) {
          // Any of the conditions, each one field's equality.
          return {
            items: stored.filter(row =>
              where.or!.some(condition =>
                Object.entries(condition).every(
                  ([field, test]) => row[field] === test.equals
                )
              )
            ),
          };
        }
        const ids = where.id?.in ?? [where.id?.equals];
        return {
          items: stored.filter(row => ids.includes(String(row.id))),
        };
      },
    },
    {
      get(target, name) {
        if (name === "find") return target.find;
        throw new Error(`the form receiver called ${String(name)}`);
      },
    }
  ) as unknown as PublishedReadApi;
  return { api, reads };
}

const page = (nodes: BlockNode[]) => ({
  formatVersion: 1,
  kind: "page",
  nodes,
});

describe("the document a post names", () => {
  it.each<[string, DefiningDocument]>([
    ["page:p1", { kind: "page", id: "p1" }],
    ["template:t-1", { kind: "template", id: "t-1" }],
    ["component:c_1", { kind: "component", id: "c_1" }],
    ["layout:l1:footer", { kind: "layout", id: "l1", area: "footer" }],
  ])("reads %s, and writes it back the same", (value, document) => {
    expect(parseDefiningDocument(value)).toEqual(document);
    expect(definingDocumentValue(document)).toBe(value);
  });

  it.each([
    undefined,
    "",
    "page",
    "page:",
    "page:a b",
    "page:p1:extra",
    "pages:p1",
    "layout:l1",
    "layout:l1:sidebar",
    `page:${"x".repeat(129)}`,
  ])("names nothing for %j", value => {
    expect(parseDefiningDocument(value)).toBeNull();
  });
});

describe("the published node", () => {
  it("reads a page and a template as the public, published only", async () => {
    const { api, reads } = directApi({
      pages: [{ id: "p1", content: page([form("f1")]) }],
      templates: [{ id: "t1", content: JSON.stringify(page([form("f2")])) }],
    });
    expect(
      (await publishedNode(api, STORES, { kind: "page", id: "p1" }, "f1", "de"))
        ?.id
    ).toBe("f1");
    // A value stored as text, as some adapters hand it back, reads the same.
    expect(
      (
        await publishedNode(
          api,
          STORES,
          { kind: "template", id: "t1" },
          "f2",
          undefined
        )
      )?.id
    ).toBe("f2");
    expect(reads).toEqual([
      expect.objectContaining({
        collection: "pages",
        status: "published",
        overrideAccess: false,
        locale: "de",
      }),
      expect.objectContaining({
        collection: "templates",
        status: "published",
        overrideAccess: false,
      }),
    ]);
  });

  it("reads a component, and a set's area, as the renderer reads them", async () => {
    const { api, reads } = directApi({
      components: [{ id: "c1", content: page([form("f3")]) }],
      layouts: [{ id: "l1", areas: [{ area: "header", component: "c1" }] }],
    });
    for (const document of [
      { kind: "component", id: "c1" },
      { kind: "layout", id: "l1", area: "header" },
    ] as DefiningDocument[]) {
      expect(
        (await publishedNode(api, STORES, document, "f3", undefined))?.id
      ).toBe("f3");
    }
    // An area the set does not fill holds no form.
    expect(
      await publishedNode(
        api,
        STORES,
        { kind: "layout", id: "l1", area: "footer" },
        "f3",
        undefined
      )
    ).toBeNull();
    for (const read of reads) {
      expect(read).toMatchObject({ status: "published", overrideAccess: true });
    }
  });

  it("finds a node nested in a container", async () => {
    const { api } = directApi({
      pages: [
        {
          id: "p1",
          content: page([
            {
              id: "s",
              type: "core/section",
              version: 1,
              props: {},
              slots: { children: [form("deep")] },
            },
          ]),
        },
      ],
    });
    expect(
      (
        await publishedNode(
          api,
          STORES,
          { kind: "page", id: "p1" },
          "deep",
          undefined
        )
      )?.id
    ).toBe("deep");
  });

  it("finds nothing in an unpublished, unreadable or other document", async () => {
    const { api } = directApi({
      pages: [
        { id: "p1", content: page([form("f1")]) },
        { id: "broken", content: "not json" },
      ],
    });
    for (const [document, nodeId] of [
      [{ kind: "page", id: "missing" }, "f1"],
      [{ kind: "page", id: "broken" }, "f1"],
      [{ kind: "page", id: "p1" }, "other"],
    ] as [DefiningDocument, string][]) {
      expect(
        await publishedNode(api, STORES, document, nodeId, undefined)
      ).toBeNull();
    }
  });

  it("takes the row only by the id asked for", async () => {
    // A hook rewriting the returned row's id must not let one page stand in
    // for another.
    const { api } = directApi({
      pages: [{ id: "p1", content: page([form("f1")]) }],
    });
    const lying = {
      find: async (args: Record<string, unknown>) => {
        const found = await api.find(args as never);
        return {
          items: found.items.map(row => ({ ...(row as object), id: "p2" })),
        };
      },
    } as unknown as PublishedReadApi;
    expect(
      await publishedNode(
        lying,
        STORES,
        { kind: "page", id: "p1" },
        "f1",
        undefined
      )
    ).toBeNull();
  });
});

describe("a form inside a component placed on a page", () => {
  it("is found under the id the page draws it with", async () => {
    const { COMPONENT_INSTANCE_TYPE } = await import("@nextlyhq/blocks-engine");
    const { coreBlocks } = await import("@nextlyhq/blocks-react/blocks");
    const { createBlockResolver, prepareDocumentForRead } = await import(
      "@nextlyhq/blocks-react"
    );
    const definition = {
      formatVersion: 1,
      kind: "component",
      nodes: [form("contact-form")],
    };
    const host = page([
      {
        id: "placed",
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId: "c1" },
      },
    ]);
    // The id the published page draws the form under, from the renderer's
    // own pipeline with the same definitions.
    const drawn = prepareDocumentForRead(host as never, {
      resolver: createBlockResolver(coreBlocks as never),
      definitions: new Map([["c1", definition as never]]),
    });
    const drawnForm = drawn?.nodes.find(node => node.type === "core/form");
    // Must-be-found: the page really draws the form, under an id of its own.
    expect(drawnForm?.id).toBeDefined();
    expect(drawnForm?.id).not.toBe("contact-form");

    const { api } = directApi({
      pages: [{ id: "p1", content: host }],
      components: [{ id: "c1", content: definition }],
    });
    const found = await publishedNode(
      api,
      STORES,
      { kind: "page", id: "p1" },
      drawnForm?.id ?? "",
      undefined
    );
    expect(found?.type).toBe("core/form");
  });

  it("is not found where the component is not published", async () => {
    const { COMPONENT_INSTANCE_TYPE } = await import("@nextlyhq/blocks-engine");
    const { api } = directApi({
      pages: [
        {
          id: "p1",
          content: page([
            {
              id: "placed",
              type: COMPONENT_INSTANCE_TYPE,
              version: 1,
              props: { componentId: "c-draft" },
            },
          ]),
        },
      ],
    });
    expect(
      await publishedNode(
        api,
        STORES,
        { kind: "page", id: "p1" },
        "cx-anything",
        undefined
      )
    ).toBeNull();
  });
});

describe("a form in an entry's own blocks, drawn by its design", () => {
  it("is found as the entry's page draws it, composed into the design", async () => {
    const { composeEntryContent, ENTRY_CONTENT_TYPE } = await import(
      "@nextlyhq/blocks-engine"
    );
    const design = {
      formatVersion: 1,
      kind: "template",
      nodes: [
        form("design-form"),
        {
          id: "body",
          type: ENTRY_CONTENT_TYPE,
          version: 1,
          props: { field: "body" },
        },
      ],
    };
    const own = page([form("entry-form")]);
    const drawn = composeEntryContent(design as never, {
      valueOf: field => (field === "body" ? own : undefined),
    });
    const drawnIds = drawn.nodes.flatMap(function ids(node): string[] {
      return [
        ...(node.type === "core/form" ? [node.id] : []),
        ...Object.values(node.slots ?? {}).flatMap(list => list.flatMap(ids)),
      ];
    });
    // Must-be-found: the entry's form is drawn, under an id of its own.
    expect(drawnIds).toContain("design-form");
    const entryFormId = drawnIds.find(id => id !== "design-form");
    expect(entryFormId).toBeDefined();

    const { api } = directApi({
      posts: [{ id: "e1", title: "Hello", body: own }],
      templates: [
        {
          id: "t1",
          collection: "posts",
          entry: null,
          content: design,
        },
      ],
    });
    const entry = parseDefiningDocument("entry:posts:e1");
    expect(entry).toEqual({ kind: "entry", collection: "posts", id: "e1" });
    for (const nodeId of ["design-form", entryFormId ?? ""]) {
      expect(
        (await publishedNode(api, STORES, entry!, nodeId, undefined))?.type,
        nodeId
      ).toBe("core/form");
    }
  });
});

describe("a form in a Layout's header or footer", () => {
  it("is found under the id its region draws it with", async () => {
    const { regionDocument } = await import("@nextlyhq/blocks-engine");
    const { coreBlocks } = await import("@nextlyhq/blocks-react/blocks");
    const { createBlockResolver, prepareDocumentForRead } = await import(
      "@nextlyhq/blocks-react"
    );
    const footer = {
      formatVersion: 1,
      kind: "component",
      nodes: [form("signup")],
    };
    // The region as the page draws it: its component placed by the region.
    const drawn = prepareDocumentForRead(
      regionDocument([{ area: "footer", componentId: "c1" }]),
      {
        resolver: createBlockResolver(coreBlocks as never),
        definitions: new Map([["c1", footer as never]]),
      }
    );
    const drawnId = drawn?.nodes.find(node => node.type === "core/form")?.id;
    // Must-be-found: the region draws the form under an id of its own.
    expect(drawnId).toBeDefined();
    expect(drawnId).not.toBe("signup");

    const { api } = directApi({ components: [{ id: "c1", content: footer }] });
    expect(
      (
        await publishedNode(
          api,
          STORES,
          { kind: "component", id: "c1" },
          drawnId ?? "",
          undefined
        )
      )?.type
    ).toBe("core/form");
  });
});

describe("a form on a page the site lets grow past the default size", () => {
  it("is found under the site's own limits, as its page is drawn", async () => {
    const { COMPONENT_INSTANCE_TYPE, DEFAULT_LIMITS } = await import(
      "@nextlyhq/blocks-engine"
    );
    const filler = Array.from(
      { length: DEFAULT_LIMITS.maxNodes },
      (_, index): BlockNode => ({
        id: `p${index}`,
        type: "core/paragraph",
        version: 1,
        props: {},
      })
    );
    const definition = {
      formatVersion: 1,
      kind: "component",
      nodes: [form("late-form")],
    };
    const host = page([
      ...filler,
      {
        id: "placed",
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId: "c1" },
      },
    ]);
    const limits = {
      ...DEFAULT_LIMITS,
      maxNodes: DEFAULT_LIMITS.maxNodes + 100,
    };
    const { coreBlocks } = await import("@nextlyhq/blocks-react/blocks");
    const { createBlockResolver, prepareDocumentForRead } = await import(
      "@nextlyhq/blocks-react"
    );
    const drawnId = prepareDocumentForRead(host as never, {
      resolver: createBlockResolver(coreBlocks as never),
      definitions: new Map([["c1", definition as never]]),
      limits,
    })?.nodes.find(node => node.type === "core/form")?.id;
    // Must-be-found: the site's page does draw the form.
    expect(drawnId).toBeDefined();

    const { api } = directApi({
      pages: [{ id: "p1", content: host }],
      components: [{ id: "c1", content: definition }],
    });
    expect(
      (
        await publishedNode(
          api,
          STORES,
          { kind: "page", id: "p1" },
          drawnId ?? "",
          undefined,
          limits
        )
      )?.type
    ).toBe("core/form");
  });
});
