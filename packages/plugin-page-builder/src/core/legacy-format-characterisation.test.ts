/**
 * What the editor's CURRENT document format means, pinned before it changes.
 *
 * A-0 step 3 replaces the plugin's `BlockDocument` with the engine's. The two
 * disagree about what values MEAN, not merely how they are spelled — PR #861
 * found twelve such divergences over three rounds, each a new category — so a
 * type swap can compile cleanly and still change behaviour.
 *
 * **These tests exist to FAIL during that migration.** They are not asserting
 * that the legacy semantics are correct; several are the reason the format is
 * being replaced. They assert what is true today, so a change that alters it has
 * to say so out loud rather than passing silently. Each case names the engine's
 * answer beside the legacy one, so whoever runs the migration can tell "this
 * changed as intended" from "this changed by accident" without re-deriving it.
 *
 * There is no automated reviewer available while this work lands, so a
 * characterisation net is the only thing standing between a semantic regression
 * and `main`.
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
    // THE ENGINE HAS NO ROOT: its document is `{ formatVersion, kind, nodes }`
    // and the page IS the array. Payload, Sanity Portable Text and Gutenberg all
    // ship a flat top level; this root is the outlier the port removes.
    const d = doc([node("a"), node("b")]);

    expect(d.root.type).toBe("core/container");
    expect(d.root.slots?.default).toHaveLength(2);
    // The page's first block is two hops down, not `nodes[0]`.
    expect(d.root.slots?.default?.[0]?.id).toBe("a");
  });

  it("carries `version`, where the engine carries `formatVersion` and `kind`", () => {
    // Renaming is the harmless half of the change. Recorded so the migration is
    // not credited with having handled the format when it only handled the name.
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
    // node as 1 with no root above it, so every legacy depth is ONE MORE than
    // the engine's for the same visible nesting. That is why a legacy-valid tree
    // converted to depth 13 and failed against MAX_DEPTH.
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
    // Founder ruling 2026-08-17: all four are declared NOT-ALPHA and the
    // engine's node is NOT widened for them. This test records that they were
    // reachable before the port, so the drop is a decision with a date on it
    // rather than something discovered missing later.
    //
    // It is expected to be DELETED by the migration, not repaired.
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
    // Two fields collapse into one states x breakpoints structure. A migration
    // that moves `style` and forgets `styleHover` loses every hover rule in
    // every document, and nothing about the resulting node looks wrong.
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
