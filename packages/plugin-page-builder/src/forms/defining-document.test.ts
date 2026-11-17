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
        const where = args.where as { id: { equals?: string; in?: string[] } };
        const ids = where.id.in ?? [where.id.equals];
        return {
          items: (rows[String(args.collection)] ?? []).filter(row =>
            ids.includes(String(row.id))
          ),
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
