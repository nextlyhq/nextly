/**
 * The block listing the Schema Builder's outline reads.
 *
 * - Every registered block when a field names no allow-list, none for an
 *   empty one, else the blocks its entries admit (an exact name, or "ns/*"
 *   bound to the separator), each with the entries that admit it.
 * - Each block's label as the palette names it, its props as the inspector
 *   names them, and who registered it: metadata only.
 * - It admits a block exactly when the blocks field's validator does, over
 *   one table of cases, so the outline cannot offer a block a save refuses.
 * - The route is contributed, signed-in only (not public, no permission),
 *   reads the allow-list from its query, and answers the list envelope.
 */
import type { AnyBlockDefinition } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  BLOCKS_LIST_ALLOW_PARAM,
  BLOCKS_LIST_ROUTE_PATH,
} from "./blocks-list-contract";
import {
  blocksListRoute,
  listAcceptedBlocks,
  type BlocksListReads,
} from "./blocks-list-route";
import { validateBlocksValue } from "./fields/blocks-validator";
import { pageBuilder } from "./plugin";

/** A registered block as the listing reads one. */
function block(
  name: string,
  extra: Partial<Record<string, unknown>> = {}
): AnyBlockDefinition {
  return {
    name,
    version: 1,
    description: `The ${name} block.`,
    ...extra,
  } as unknown as AnyBlockDefinition;
}

/** A registry holding `blocks`, each registered by its namespace. */
function reads(...blocks: AnyBlockDefinition[]): BlocksListReads {
  return {
    blocks: () => blocks,
    sourceOf: name =>
      name.startsWith("core/")
        ? "core"
        : name.startsWith("acme/")
          ? "@acme/blocks"
          : undefined,
  };
}

const registry = reads(
  block("core/paragraph"),
  block("core/heading", {
    editor: { label: "Heading" },
    props: {
      text: { type: "string", label: "Text" },
      backgroundColor: { type: "string" },
      level: { type: "select" },
    },
  }),
  block("acme/hero"),
  block("coreevil/banner")
);
const names = (allow: readonly string[] | undefined) =>
  listAcceptedBlocks(allow, registry).map(item => item.name);

describe("which blocks a field accepts", () => {
  it("lists every registered block when the field names no allow-list, by name", () => {
    expect(names(undefined)).toEqual([
      "acme/hero",
      "core/heading",
      "core/paragraph",
      "coreevil/banner",
    ]);
    // With no list, no entry admits a block: the field accepts any.
    expect(
      listAcceptedBlocks(undefined, registry).every(
        item => item.matchedBy.length === 0
      )
    ).toBe(true);
  });

  it("lists none for an empty allow-list", () => {
    expect(names([])).toEqual([]);
  });

  it("admits an exact name, and names the entry that admits it", () => {
    const [item] = listAcceptedBlocks(["core/heading"], registry);
    expect(item).toMatchObject({
      name: "core/heading",
      matchedBy: ["core/heading"],
    });
    expect(names(["core/heading"])).toEqual(["core/heading"]);
  });

  it("admits a namespace by its pattern, bound to the separator", () => {
    expect(names(["core/*"])).toEqual(["core/heading", "core/paragraph"]);
  });

  it("names every entry admitting a block, and lists no block for an entry admitting none", () => {
    const items = listAcceptedBlocks(
      ["core/*", "core/heading", "acme/gone", "nothing/*"],
      registry
    );
    expect(items.map(item => [item.name, item.matchedBy])).toEqual([
      ["core/heading", ["core/*", "core/heading"]],
      ["core/paragraph", ["core/*"]],
    ]);
  });
});

describe("what it says of each block", () => {
  it("names the block and its props as the editor does, with who registered it", () => {
    const [heading] = listAcceptedBlocks(["core/heading"], registry);
    expect(heading).toEqual({
      name: "core/heading",
      label: "Heading",
      description: "The core/heading block.",
      source: "core",
      matchedBy: ["core/heading"],
      props: [
        { name: "text", label: "Text", type: "string" },
        // No declared label: the inspector's own spelling of the name.
        { name: "backgroundColor", label: "Background colour", type: "string" },
        { name: "level", label: "Level", type: "select" },
      ],
    });
  });

  it("reads a label from the name when the block declares none, and no source when none was recorded", () => {
    const [banner] = listAcceptedBlocks(["coreevil/banner"], registry);
    expect(banner).toMatchObject({
      label: "Banner",
      source: null,
      props: [],
    });
  });
});

describe("agreeing with the blocks field's validator", () => {
  /** Whether the validator lets a document holding `type` through `allow`. */
  const validatorAdmits = (allow: string[], type: string) =>
    !validateBlocksValue(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            type,
            version: 1,
            props: {},
          },
        ],
      },
      "content",
      "Content",
      { allow }
    ).some(issue => issue.code === "DISALLOWED_BLOCK_TYPE");

  // Every type here is namespaced, as a registered block's name must be: a
  // bare name is refused by the document's structure before any allow-list.
  it.each([
    [["core/heading"], "core/heading"],
    [["core/heading"], "core/paragraph"],
    [["core/*"], "core/heading"],
    [["core/*"], "coreevil/banner"],
    [["core/"], "core/heading"],
    [["*"], "core/heading"],
    [["acme/*", "core/heading"], "acme/hero"],
    [["acme/*", "core/heading"], "core/paragraph"],
    [[], "core/heading"],
    [["core/heading,acme/hero"], "core/heading"],
    [[" core/heading"], "core/heading"],
  ] as const)(
    "allow %j and a %s block: listed exactly when a save keeps it",
    (allow, type) => {
      const listed =
        listAcceptedBlocks([...allow], reads(block(type))).length === 1;
      expect(listed).toBe(validatorAdmits([...allow], type));
    }
  );
});

describe("the route", () => {
  const route = (pageBuilder().contributes?.routes ?? []).find(
    each => each.path === BLOCKS_LIST_ROUTE_PATH
  );

  it("is contributed as a GET, for signed-in callers only", () => {
    expect(route?.method).toBe("GET");
    // Secure by default: not public, and no permission beyond signing in.
    expect(route?.public).not.toBe(true);
    expect(route?.requiredPermission).toBeUndefined();
  });

  const ask = async (query: string) => {
    const response = await blocksListRoute(registry).handler(
      new Request(`http://localhost/x${query}`)
    );
    return (await response.json()) as {
      items: { name: string }[];
      meta: { total: number };
    };
  };

  const allowQuery = (allow: unknown) =>
    `?${BLOCKS_LIST_ALLOW_PARAM}=${encodeURIComponent(JSON.stringify(allow))}`;

  it("reads the allow-list from its query, as a JSON array", async () => {
    const body = await ask(allowQuery(["core/heading", "acme/*"]));
    expect(body.items.map(item => item.name)).toEqual([
      "acme/hero",
      "core/heading",
    ]);
    expect(body.meta.total).toBe(2);
  });

  it("lists every block when the query names no allow-list, and none for an empty one", async () => {
    expect((await ask("")).items).toHaveLength(4);
    expect((await ask(allowQuery([]))).items).toEqual([]);
  });

  it("keeps each entry as stored, splitting or trimming none, as a save judges it", async () => {
    // One entry holding a comma names no block, so a save keeps neither
    // heading nor hero: the listing must not read it as two.
    expect((await ask(allowQuery(["core/heading,acme/hero"]))).items).toEqual(
      []
    );
    expect((await ask(allowQuery([" core/heading"]))).items).toEqual([]);
  });

  it("refuses an allow-list longer than it reads, or one that is not a list of names", async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => `x/b${i}`);
    for (const query of [
      allowQuery(tooMany),
      allowQuery("core/heading"),
      allowQuery([1, 2]),
      `?${BLOCKS_LIST_ALLOW_PARAM}=${encodeURIComponent("core/heading,acme/*")}`,
    ]) {
      await expect(ask(query)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    }
  });
});
