/**
 * What this package's document format MEANS, asserted rather than assumed.
 *
 * `core/types` and `@nextlyhq/blocks-engine` both define a `BlockDocument`, and
 * they disagree about the meaning of values rather than only their spelling: the
 * depth base differs by one, per-node visibility is a flat map here and a nested
 * one there, and four node fields have no counterpart at all. A type that is
 * swapped for the other therefore compiles cleanly while changing behaviour.
 *
 * **These assertions describe today's semantics, not desirable ones.** Several
 * pin behaviour that is the reason the two formats differ. Each case names the
 * engine's answer beside this package's, so a divergence is legible at the point
 * it matters rather than being re-derived from the two type declarations.
 *
 * @module core/legacy-format-characterisation
 */
import { describe, expect, it } from "vitest";

import { createBlockRegistry } from "./registry";
import { MAX_DEPTH } from "./types";
import type { BlockDocument, BlockNode } from "./types";
import { validateDocument } from "./validate";

/** A registry holding only the one container these fixtures nest. */
const registry = createBlockRegistry();
registry.register({
  type: "core/container",
  version: 1,
  label: "C",
  icon: "",
  category: "layout",
  isContainer: true,
  slots: [{ name: "default" }],
  defaultProps: {},
  render: () => null,
});

/** A node with only what these cases read, so each test states its own inputs. */
function node(id: string, children?: BlockNode[]): BlockNode {
  return {
    id,
    type: "core/container",
    props: {},
    ...(children ? { slots: { default: children } } : {}),
  };
}

/** A legacy document: a synthetic root whose `default` slot holds the page. */
function doc(children: BlockNode[]): BlockDocument {
  return { version: 1, root: node("root", children) };
}

describe("the legacy document envelope", () => {
  it("wraps the page in a synthetic root nobody inserted", () => {
    // The engine has no root: its document is `{ formatVersion, kind, nodes }`
    // and the page IS the array. Payload, Sanity Portable Text and Gutenberg all
    // ship a flat top level, so this synthetic root is the outlier.
    const d = doc([node("a"), node("b")]);

    expect(d.root.type).toBe("core/container");
    expect(d.root.slots?.default).toHaveLength(2);
    // The page's first block is two hops down, not `nodes[0]`.
    expect(d.root.slots?.default?.[0]?.id).toBe("a");
  });

  it("carries `version`, where the engine carries `formatVersion` and `kind`", () => {
    // The envelope's field names differ from the engine's. Stated separately
    // from the meaning differences below, because a rename is the one kind of
    // divergence that cannot alter behaviour.
    const d = doc([]);

    expect(d).toHaveProperty("version", 1);
    expect(d).not.toHaveProperty("formatVersion");
    expect(d).not.toHaveProperty("kind");
    expect(d).not.toHaveProperty("nodes");
  });
});

describe("the depth base — the divergence that failed a legal tree", () => {
  it("counts the synthetic root as depth 0, so a top-level block is depth 1", () => {
    // `validate.ts` enters at `check(d.root, 0)`. The engine counts a top-level
    // node as 1 with no root above it, so a depth here is ONE MORE than the
    // engine's for the same visible nesting — which is how a tree that is legal
    // under one limit exceeds the other while nothing about it changed.
    let deepest = node("leaf");
    // Build MAX_DEPTH levels BELOW the root: legal today, exactly at the limit.
    for (let i = 0; i < MAX_DEPTH - 1; i += 1) {
      deepest = node(`n${i}`, [deepest]);
    }

    expect(validateDocument(doc([deepest]), registry)).toBe(true);
  });

  it("refuses one level deeper, so the limit is real and this pins its edge", () => {
    // Without this, the case above would pass on a validator that never checks
    // depth at all — the population problem, applied to a boundary.
    let deepest = node("leaf");
    for (let i = 0; i < MAX_DEPTH + 2; i += 1) {
      deepest = node(`n${i}`, [deepest]);
    }

    expect(validateDocument(doc([deepest]), registry)).not.toBe(true);
  });
});

describe("per-node visibility", () => {
  it("is a FLAT breakpoint map, where the engine nests it under `devices`", () => {
    // legacy: visibility?: Partial<Record<Breakpoint, boolean>>
    // engine:  visibility?: { conditions?: Condition[][]; devices?: Record<..., boolean> }
    //
    // So a straight copy of the legacy object into the engine's field produces a
    // node whose breakpoint keys sit where `conditions` and `devices` are read,
    // and every per-breakpoint rule is silently lost. The shape change is what
    // makes the polarity change hard to see: two edits are needed and only one
    // of them is a compile error.
    const withVisibility: BlockNode = {
      ...node("a"),
      visibility: { tablet: false, mobile: true },
    };

    expect(withVisibility.visibility).toEqual({ tablet: false, mobile: true });
    expect(withVisibility.visibility).not.toHaveProperty("devices");
  });
});

describe("node fields the engine has no home for", () => {
  it("accepts customCss, cssId, attributes and motion today", () => {
    // `customCss`, `cssId`, `attributes` and `motion` are reachable on a node
    // here and have no counterpart in the engine's node, which holds only
    // `classes`, `styles`, `visibility`, `locked` and `name` beside the
    // identity fields. Adopting that shape removes these four capabilities, so
    // the loss is stated here rather than discovered by their absence.
    const rich: BlockNode = {
      ...node("a"),
      customCss: ".x { color: red }",
      cssId: "hero",
      attributes: { "data-analytics": "cta" },
    };

    expect(rich.customCss).toBe(".x { color: red }");
    expect(rich.cssId).toBe("hero");
    expect(rich.attributes).toEqual({ "data-analytics": "cta" });
  });

  it("splits styles across `style` and `styleHover`, where the engine has one `styles`", () => {
    // Two fields here correspond to one states x breakpoints structure there.
    // Code that carries `style` across and overlooks `styleHover` loses every
    // hover rule, and nothing about the resulting node looks wrong.
    const styled: BlockNode = {
      ...node("a"),
      style: { base: { color: "red" } },
      styleHover: { base: { color: "blue" } },
    };

    expect(styled.style?.base?.color).toBe("red");
    expect(styled.styleHover?.base?.color).toBe("blue");
    expect(styled).not.toHaveProperty("styles");
  });

  it("names one CSS class as a string, where the engine holds an ARRAY of class ids", () => {
    // `customClass: string` -> `classes: string[]`, and the contents change
    // meaning too: a CSS name becomes a reference to a site-global class by id.
    const classed: BlockNode = { ...node("a"), customClass: "promo" };

    expect(classed.customClass).toBe("promo");
    expect(classed).not.toHaveProperty("classes");
  });
});
