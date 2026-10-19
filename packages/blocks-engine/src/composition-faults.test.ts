/**
 * What a composed page breaks that none of its documents breaks alone.
 *
 * Each case is built so the page and every definition pass on their own, which
 * is the property that separates this judgement from ordinary validation: a
 * judge that only re-ran each document's own rules would return nothing here.
 */
import { describe, expect, it } from "vitest";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
} from "./document";
import { compositionFaults } from "./composition-faults";
import { DEFAULT_LIMITS, type DocumentLimits } from "./limits";
import type { NestingSource } from "./nesting";
import { resolveComponentInstances } from "./resolve-instances";
import { validateDocument } from "./validation";
import { FIXTURE_BREAKPOINTS } from "./validation.fixtures";

const node = (id: string, extra: Partial<BlockNode> = {}): BlockNode => ({
  id,
  type: "core/text",
  version: 1,
  props: {},
  ...extra,
});

const box = (id: string, children: BlockNode[], type = "core/box") =>
  node(id, { type, slots: { children } });

const instance = (
  id: string,
  componentId: string,
  extra: Partial<BlockNode> = {}
): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
  ...extra,
});

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

const component = (
  nodes: BlockNode[],
  envelope: Partial<ComponentDocument> = {}
): ComponentDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes,
  ...envelope,
});

/**
 * `core/column` may only sit in `core/columns`, and a `core/button`'s slot
 * holds text only — the two halves of the nesting rule, one each.
 */
const nesting: NestingSource = {
  parentsOf: type => (type === "core/column" ? ["core/columns"] : undefined),
  slotAllowOf: parent => (parent === "core/button" ? ["core/text"] : undefined),
};

function judge(
  host: BlockDocument,
  definitions: Record<string, BlockDocument>,
  limits: DocumentLimits = DEFAULT_LIMITS,
  maxComposedDepth?: number
) {
  const lookup = new Map(Object.entries(definitions));
  const composition = resolveComponentInstances(host, lookup, {
    limits,
    maxComposedDepth,
  });
  return compositionFaults(host, composition, { limits, nesting });
}

/** The engine's own verdict on one document, errors only. */
function ownErrors(doc: BlockDocument, limits: DocumentLimits) {
  return validateDocument(doc, {
    breakpoints: FIXTURE_BREAKPOINTS,
    mode: "forgiving",
    limits,
    nesting,
  }).issues.filter(issue => issue.severity === "error");
}

describe("compositionFaults: nesting across a placement", () => {
  it("refuses a definition root the page places where it cannot sit", () => {
    const host = page([instance("i1", "cols")]);
    const cols = component([node("c1", { type: "core/column" })]);

    const faults = judge(host, { cols });

    expect(faults.map(f => [f.code, f.instanceId, f.componentId])).toEqual([
      ["restricted-at-root", "i1", "cols"],
    ]);
    expect(faults[0]!.message).toContain("core/columns");
  });

  it("refuses page content an instance puts into a slot that cannot hold it", () => {
    const button = component([box("d1", [], "core/button")], {
      slots: { label: { label: "Label", nodeId: "d1", slot: "children" } },
    });
    const host = page([
      instance("i1", "button", {
        slots: { label: [box("mine", [])] },
      }),
    ]);

    // The page alone holds a box inside an instance, which nothing restricts.
    expect(ownErrors(host, DEFAULT_LIMITS)).toEqual([]);
    const faults = judge(host, { button });

    expect(faults.map(f => [f.code, f.instanceId])).toEqual([
      ["not-allowed-in-slot", "i1"],
    ]);
  });

  it("refuses a disallowed child inside a definition, through a nested component", () => {
    const inner = component([node("x", { type: "core/column" })]);
    const outer = component([box("o1", [instance("o2", "inner")])]);
    const host = page([instance("i1", "outer")]);

    const faults = judge(host, { outer, inner });

    // Named by the placement the AUTHOR made, not the inner one they never saw.
    expect(faults.map(f => [f.code, f.instanceId, f.componentId])).toEqual([
      ["wrong-parent", "i1", "outer"],
    ]);
  });

  it("reports nothing for a page whose own nodes break the rule", () => {
    // That is the page's own validation's to report; repeating it here would
    // give one defect two verdicts.
    const host = page([node("c1", { type: "core/column" })]);

    expect(judge(host, {})).toEqual([]);
  });

  it("reports nothing for a composition that respects both halves", () => {
    const col = component([node("c1", { type: "core/column" })]);
    const host = page([box("cols", [instance("i1", "col")], "core/columns")]);

    expect(judge(host, { col })).toEqual([]);
  });
});

describe("compositionFaults: depth measured from the page's root", () => {
  const limits: DocumentLimits = { ...DEFAULT_LIMITS, maxDepth: 3 };

  it("refuses a page that composes past the depth limit", () => {
    const deep = component([box("d1", [node("d2")])]);
    const host = page([box("p1", [box("p2", [instance("i1", "deep")])])]);

    // Each alone is within the limit: the page is three deep, the definition two.
    expect(ownErrors(host, limits)).toEqual([]);
    expect(ownErrors(deep, limits)).toEqual([]);

    const faults = judge(host, { deep }, limits);

    expect(faults.map(f => [f.code, f.instanceId, f.componentId])).toEqual([
      ["depth-exceeded", "i1", "deep"],
    ]);
    expect(faults[0]!.message).toContain("3");
  });

  it("counts page content placed into a definition's slot where it lands", () => {
    const frame = component([box("d1", [box("d2", [])])], {
      slots: { body: { label: "Body", nodeId: "d2", slot: "children" } },
    });
    const host = page([
      instance("i1", "frame", { slots: { body: [box("mine", [node("t")])] } }),
    ]);

    // Stored, `t` is three deep; composed, it lands at four.
    expect(ownErrors(host, limits)).toEqual([]);
    expect(judge(host, { frame }, limits).map(f => f.code)).toEqual([
      "depth-exceeded",
    ]);
  });

  it("allows a composition that ends exactly at the limit", () => {
    const deep = component([box("d1", [node("d2")])]);
    const host = page([box("p1", [instance("i1", "deep")])]);

    expect(judge(host, { deep }, limits)).toEqual([]);
  });

  it("refuses components nested past the composition cap", () => {
    const outer = component([instance("d1", "inner")]);
    const inner = component([node("leaf")]);
    const host = page([instance("i1", "outer")]);

    const faults = judge(host, { outer, inner }, DEFAULT_LIMITS, 1);

    expect(faults.map(f => [f.code, f.instanceId, f.componentId])).toEqual([
      ["composed-depth", "i1", "outer"],
    ]);
  });

  it("refuses a definition too deep on its own", () => {
    const deep = component([box("d1", [box("d2", [box("d3", [node("d4")])])])]);
    const host = page([instance("i1", "deep")]);

    expect(judge(host, { deep }, limits).map(f => f.code)).toEqual([
      "node-depth",
    ]);
  });

  it("reports nothing for an instance whose component is missing", () => {
    // Drawn as a placeholder, which is not a depth or nesting fault.
    const host = page([box("p1", [box("p2", [instance("i1", "gone")])])]);

    expect(judge(host, {}, limits)).toEqual([]);
  });
});

describe("compositionFaults: what each message tells the author", () => {
  const limits: DocumentLimits = { ...DEFAULT_LIMITS, maxDepth: 3 };

  it("names the container a misplaced block is in and where it may go", () => {
    const inner = component([node("x", { type: "core/column" })]);
    const outer = component([box("o1", [instance("o2", "inner")])]);
    const [fault] = judge(page([instance("i1", "outer")]), { outer, inner });

    expect(fault!.message).toBe(
      'Component "outer" puts a "core/column" inside "core/box" here, but it may only sit inside "core/columns".'
    );
  });

  it("names the slot's owner and what the slot accepts", () => {
    const button = component([box("d1", [], "core/button")], {
      slots: { label: { label: "Label", nodeId: "d1", slot: "children" } },
    });
    const host = page([
      instance("i1", "button", { slots: { label: [box("mine", [])] } }),
    ]);
    const [fault] = judge(host, { button });

    expect(fault!.message).toBe(
      'Component "button" puts a "core/box" where its "core/button" does not accept one. That place accepts "core/text".'
    );
  });

  it("states the depth limit and where it is counted from", () => {
    const deep = component([box("d1", [node("d2")])]);
    const host = page([box("p1", [box("p2", [instance("i1", "deep")])])]);
    const [fault] = judge(host, { deep }, limits);

    expect(fault!.message).toBe(
      'Component "deep" nests content deeper than the maximum of 3 levels here, counted from the top of this document. Place it higher up, or flatten its content.'
    );
  });

  it("tells a too-deep definition's author to flatten it", () => {
    const deep = component([box("d1", [box("d2", [box("d3", [node("d4")])])])]);
    const [fault] = judge(page([instance("i1", "deep")]), { deep }, limits);

    expect(fault!.message).toBe(
      'Component "deep" holds content nested deeper than the maximum of 3 levels. Flatten its content.'
    );
  });

  it("tells the author to flatten components nested too deeply", () => {
    const outer = component([instance("d1", "inner")]);
    const inner = component([node("leaf")]);
    const [fault] = judge(
      page([instance("i1", "outer")]),
      { outer, inner },
      DEFAULT_LIMITS,
      1
    );

    expect(fault!.message).toBe(
      'Component "outer" places components inside components more deeply than is allowed. Flatten the components it places.'
    );
  });

  it("reports one fault per placement and rule, however many nodes break it", () => {
    const cols = component([
      node("c1", { type: "core/column" }),
      node("c2", { type: "core/column" }),
    ]);
    const faults = judge(page([instance("i1", "cols")]), { cols });

    expect(faults).toHaveLength(1);
    expect(faults[0]!.message).toBe(
      'Component "cols" puts a "core/column" at the top level here, but it may only sit inside "core/columns".'
    );
  });
});
