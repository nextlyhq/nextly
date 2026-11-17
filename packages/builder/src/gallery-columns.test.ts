/**
 * A Gallery's Columns and On mobile tiles, as what they store: the gallery's
 * own `gridTemplateColumns` at its base values and at the site's mobile
 * tier, and what the tiles read back.
 *
 * @module gallery-columns.test
 */
import {
  BASE_BREAKPOINT,
  type BlockDocument,
  type BlockNode,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  galleryColumnsOf,
  planGalleryColumns,
  planGalleryMobile,
} from "./gallery-columns";
import { stackTiers } from "./columns-layout";
import { applyOps, type BuilderOp } from "./op-vocabulary";
import { readStyleValue } from "./style-values";

const SITE: BreakpointSet = {
  viewport: [
    { id: "md", label: "Tablet", maxWidth: 1024 },
    { id: "sm", label: "Mobile", maxWidth: 640 },
    { id: "xs", label: "Small phone", maxWidth: 400 },
  ],
  container: [],
};
const NO_PHONE: BreakpointSet = {
  viewport: [{ id: "md", label: "Tablet", maxWidth: 1024 }],
  container: [],
};

function gallery(styles?: BlockNode["styles"]): BlockNode {
  return {
    id: "g",
    type: "core/gallery",
    version: 1,
    props: {},
    slots: { children: [] },
    ...(styles === undefined ? {} : { styles }),
  };
}

/** The gallery after an op, through the editor's own op layer. */
function after(node: BlockNode, op: BuilderOp | null): BlockNode {
  expect(op).not.toBeNull();
  const document: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [node],
  };
  const next = applyOps(document, op === null ? [] : [op]).document.nodes[0];
  if (next === undefined) throw new Error("no gallery");
  return next;
}

const at = (node: BlockNode, breakpoint: string) =>
  readStyleValue(node.styles, {
    state: "base",
    breakpoint,
    property: "gridTemplateColumns",
    path: [],
  });

describe("a gallery's Columns and On mobile", () => {
  it("reads 3 and 1 while nothing is stored, as the block's default grid draws", () => {
    expect(galleryColumnsOf(gallery(), stackTiers(SITE))).toEqual({
      columns: 3,
      mobile: 1,
    });
  });

  it("writes a Columns choice at the base values, and On mobile's 1 at the widest tier under a phone's width in the same edit", () => {
    const tiers = stackTiers(SITE);
    const node = after(gallery(), planGalleryColumns(gallery(), 4, tiers));
    expect(at(node, BASE_BREAKPOINT)).toBe("repeat(4, minmax(0, 1fr))");
    expect(at(node, "sm")).toBe("repeat(1, minmax(0, 1fr))");
    // Nothing at the tablet tier or the smaller phone tier.
    expect(at(node, "md")).toBeUndefined();
    expect(at(node, "xs")).toBeUndefined();
    expect(galleryColumnsOf(node, tiers)).toEqual({ columns: 4, mobile: 1 });
  });

  it("leaves an On mobile already chosen as it is when Columns changes", () => {
    const tiers = stackTiers(SITE);
    const two = after(gallery(), planGalleryMobile(gallery(), 2, tiers));
    expect(at(two, "sm")).toBe("repeat(2, minmax(0, 1fr))");
    expect(at(two, BASE_BREAKPOINT)).toBeUndefined();
    const node = after(two, planGalleryColumns(two, 2, tiers));
    expect(at(node, BASE_BREAKPOINT)).toBe("repeat(2, minmax(0, 1fr))");
    expect(at(node, "sm")).toBe("repeat(2, minmax(0, 1fr))");
    expect(galleryColumnsOf(node, tiers)).toEqual({ columns: 2, mobile: 2 });
  });

  it("writes Columns alone, and offers no On mobile, where the site has no tier under a phone's width", () => {
    const tiers = stackTiers(NO_PHONE);
    const node = after(gallery(), planGalleryColumns(gallery(), 2, tiers));
    expect(node.styles).toEqual({
      base: {
        [BASE_BREAKPOINT]: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
      },
    });
    expect(planGalleryMobile(gallery(), 2, tiers)).toBeNull();
    expect(galleryColumnsOf(node, tiers).mobile).toBeUndefined();
  });

  it("reads a template no tile writes as no tile", () => {
    const node = gallery({
      base: { [BASE_BREAKPOINT]: { gridTemplateColumns: "1fr 2fr" } },
    });
    expect(galleryColumnsOf(node, stackTiers(SITE))).toEqual({
      columns: undefined,
      mobile: undefined,
    });
  });

  it("writes nothing for the choice already shown", () => {
    const tiers = stackTiers(SITE);
    const node = after(gallery(), planGalleryColumns(gallery(), 3, tiers));
    expect(planGalleryColumns(node, 3, tiers)).toBeNull();
  });
});
