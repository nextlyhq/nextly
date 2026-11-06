/**
 * The placement rule across a component placement, judged on the composed tree
 * as the page draws it: what a component renders counts under a host's link,
 * and what a component's inner chain refuses reaches content the host puts in
 * its exposed slot.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compositionFaults } from "./composition-faults";
import type { ContentModel } from "./content-model";
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "./document";
import {
  clearBlocks,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
} from "./registry";
import { resolveComponentInstances } from "./resolve-instances";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

beforeEach(() => {
  registerBlocks(
    [
      {
        ...base,
        name: "t/card",
        editor: { label: "Card" },
        slots: { children: {} },
        contentModel: (props: { link?: string }): ContentModel =>
          props.link
            ? {
                is: ["flow", "interactive"],
                accepts: { without: ["interactive"] },
              }
            : { is: ["flow"] },
      },
      {
        ...base,
        name: "t/button",
        editor: { label: "Button" },
        contentModel: () => ({ is: ["flow", "phrasing", "interactive"] }),
      },
    ] as never,
    { source: "test" }
  );
});

afterEach(() => {
  clearBlocks();
});

const card = (
  id: string,
  props: Record<string, unknown>,
  children: BlockNode[] = []
) =>
  ({ id, type: "t/card", version: 1, props, slots: { children } }) as BlockNode;
const button = (id: string): BlockNode => ({
  id,
  type: "t/button",
  version: 1,
  props: {},
});
const instance = (
  id: string,
  componentId: string,
  slots?: Record<string, BlockNode[]>
) =>
  ({
    id,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId },
    ...(slots ? { slots } : {}),
  }) as BlockNode;
const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});
const component = (nodes: BlockNode[], slots?: Record<string, unknown>) =>
  ({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes,
    ...(slots ? { slots } : {}),
  }) as unknown as BlockDocument;

function faults(
  host: BlockDocument,
  definitions: Record<string, BlockDocument>,
  baselines?: readonly unknown[]
) {
  const composition = resolveComponentInstances(
    host,
    new Map(Object.entries(definitions))
  );
  return compositionFaults(host, composition, {
    nesting: registryNestingSource(),
    definitions: registryBlockSource(),
    ...(baselines === undefined ? {} : { storedCompositions: baselines }),
  });
}

describe("compositionFaults: the content model across a placement", () => {
  it("refuses a component holding a Button placed inside the page's linked card", () => {
    const cta = component([button("b")]);
    const host = page([card("c", { link: "/go" }, [instance("i", "cta")])]);

    const found = faults(host, { cta });
    expect(found.map(f => [f.code, f.instanceId, f.componentId])).toEqual([
      ["content-model", "i", "cta"],
    ]);
    expect(found[0]?.message).toContain(
      "Nothing clickable can sit inside a link"
    );
  });

  it("refuses a Button the page puts in a slot a component exposes inside its link", () => {
    const tile = component([card("inner", { link: "/go" })], {
      body: { label: "Body", nodeId: "inner", slot: "children" },
    });
    const host = page([instance("i", "tile", { body: [button("b")] })]);

    expect(faults(host, { tile }).map(f => f.code)).toEqual(["content-model"]);
  });

  it("leaves a break wholly among the page's own blocks to the page's validation", () => {
    const tile = component([card("inner", {})], {
      body: { label: "Body", nodeId: "inner", slot: "children" },
    });
    const host = page([
      instance("i", "tile", {
        body: [card("own", { link: "/go" }, [button("b")])],
      }),
    ]);

    expect(faults(host, { tile })).toEqual([]);
  });

  it("keeps a break the stored page already composed to", () => {
    const cta = component([button("b")]);
    const host = page([card("c", { link: "/go" }, [instance("i", "cta")])]);
    const stored = resolveComponentInstances(
      host,
      new Map([["cta", cta]])
    ).document;

    expect(faults(host, { cta }, [stored])).toEqual([]);
  });
});

describe("compositionFaults: what a page puts in a placement's slots", () => {
  const tile = (allow?: readonly string[]) =>
    component([card("inner", {})], {
      body: {
        label: "Body",
        nodeId: "inner",
        slot: "children",
        ...(allow ? { allow } : {}),
      },
    });
  const judgeWith = (
    host: BlockDocument,
    definitions: Record<string, BlockDocument>,
    storedHosts?: readonly unknown[]
  ) => {
    const lookup = new Map(Object.entries(definitions));
    return compositionFaults(host, resolveComponentInstances(host, lookup), {
      nesting: registryNestingSource(),
      definitions: registryBlockSource(),
      components: lookup,
      ...(storedHosts === undefined ? {} : { storedHosts }),
    });
  };

  it("refuses content in a slot the component does not expose", () => {
    const host = page([instance("i", "tile", { aside: [button("b")] })]);
    expect(
      judgeWith(host, { tile: tile() }).map(f => [f.code, f.instanceId])
    ).toEqual([["undeclared-slot", "i"]]);
  });

  it("refuses content the exposure's own allow-list excludes", () => {
    const host = page([instance("i", "tile", { body: [button("b")] })]);
    expect(
      judgeWith(host, { tile: tile(["t/card"]) }).map(f => f.code)
    ).toEqual(["not-allowed-in-slot"]);
  });

  it("keeps such a break the stored page already held", () => {
    const host = page([instance("i", "tile", { aside: [button("b")] })]);
    expect(judgeWith(host, { tile: tile() }, [host])).toEqual([]);
  });
});
