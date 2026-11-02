/**
 * Taking a removed field's values out of the documents that place a component.
 *
 * A retired id is one a designer removed from a component, so no placement
 * value under it may survive a write. The properties under test are the ones
 * a plausible strip gets wrong: removing the same id from a DIFFERENT
 * component's placement, missing a placement nested in another's slot
 * content, leaving an empty `overrides` behind, and rewriting a document it
 * had nothing to remove from.
 */
import { describe, expect, it } from "vitest";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
} from "./document";
import { stripRetiredExposures } from "./retired-exposures";
import { instanceExposure } from "./resolve-instances";

function placement(
  id: string,
  componentId: string,
  overrides: Record<string, unknown> | undefined,
  slots?: Record<string, BlockNode[]>
): BlockNode {
  return {
    id,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: {
      componentId,
      ...(overrides === undefined ? {} : { overrides }),
    },
    ...(slots === undefined ? {} : { slots }),
  };
}

const box = (id: string, children: BlockNode[]): BlockNode => ({
  id,
  type: "acme/box",
  version: 1,
  props: {},
  slots: { children },
});

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

const retired = new Map([
  ["hero", { properties: ["subtitle"], slots: ["aside"] }],
]);

describe("stripping a host", () => {
  it("removes the retired values of that component only", () => {
    const host = page([
      placement("p1", "hero", { title: "Kept", subtitle: "Gone" }),
      // Another component exposing an id spelled the same: its value stays.
      placement("p2", "footer", { subtitle: "Mine" }),
    ]);

    const { document, removed } = stripRetiredExposures(host, retired);

    expect(removed).toBe(1);
    expect(document.nodes[0]?.props.overrides).toEqual({ title: "Kept" });
    expect(document.nodes[1]?.props.overrides).toEqual({ subtitle: "Mine" });
  });

  it("reaches a placement inside a container and inside another placement's slot content", () => {
    const inner = placement("p3", "hero", { subtitle: "Deep" });
    const host = page([
      box("b1", [placement("p2", "hero", { subtitle: "Nested" })]),
      placement("p1", "card", undefined, { body: [inner] }),
    ]);

    const { document, removed } = stripRetiredExposures(host, retired);

    expect(removed).toBe(2);
    expect(JSON.stringify(document)).not.toContain("subtitle");
  });

  it("drops an overrides record the strip emptied", () => {
    const { document } = stripRetiredExposures(
      page([placement("p1", "hero", { subtitle: "Gone" })]),
      retired
    );

    expect(document.nodes[0]?.props).toEqual({ componentId: "hero" });
  });

  it("removes the content a placement gave a retired slot", () => {
    const host = page([
      placement("p1", "hero", undefined, {
        aside: [box("b1", [])],
        main: [box("b2", [])],
      }),
    ]);

    const { document, removed } = stripRetiredExposures(host, retired);

    expect(removed).toBe(1);
    expect(Object.keys(document.nodes[0]?.slots ?? {})).toEqual(["main"]);
  });

  it("strips a component's own placements of another component", () => {
    const definition: ComponentDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [placement("p1", "hero", { subtitle: "Gone" })],
    };

    const { document } = stripRetiredExposures(definition, retired);

    expect(document.nodes[0]?.props).toEqual({ componentId: "hero" });
  });

  it("is idempotent, and hands back the same document when nothing is retired there", () => {
    const host = page([placement("p1", "hero", { subtitle: "Gone" })]);
    const snapshot = structuredClone(host);

    const once = stripRetiredExposures(host, retired);
    const twice = stripRetiredExposures(once.document, retired);

    expect(twice.removed).toBe(0);
    expect(twice.document).toBe(once.document);
    // The caller's document is not changed in place.
    expect(host).toEqual(snapshot);
  });
});

describe("an editor is not told about a retired id", () => {
  it("leaves it out of the orphaned ids, and keeps reporting the others", () => {
    const definition: ComponentDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [{ id: "h1", type: "acme/box", version: 1, props: {} }],
      exposed: [],
    };
    const instance = placement("p1", "hero", {
      subtitle: "Gone",
      old: "Stale",
    });

    const view = instanceExposure(definition, instance, {
      properties: ["subtitle"],
      slots: [],
    });

    expect(view.orphanedOverrideIds).toEqual(["old"]);
  });
});
