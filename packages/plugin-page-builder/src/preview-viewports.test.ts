/**
 * A site's own breakpoints, offered as preview viewports.
 *
 * The cases below are all about DECLINING, because that is where a preset stops
 * being useful and becomes a claim: an option sized to a width the compiled
 * sheet has no rule for sits the frame at a tier the site never renders, and
 * the author cannot tell that from a working one by looking.
 */
import { describe, expect, it } from "vitest";

import type { BreakpointSet } from "@nextlyhq/blocks-engine";

import { siteStyleViewports } from "./preview-viewports";

/** A set with only the fields this reader consults. */
function set(
  viewport: BreakpointSet["viewport"],
  container: BreakpointSet["container"] = []
): BreakpointSet {
  return { viewport, container };
}

describe("siteStyleViewports", () => {
  it("offers nothing when the site declares no breakpoints", () => {
    expect(siteStyleViewports(undefined)).toEqual([]);
  });

  it("offers each viewport tier by the author's own name", () => {
    expect(
      siteStyleViewports(
        set([
          { id: "base", label: "Desktop" },
          { id: "tablet", label: "Tablet", maxWidth: 1024 },
          { id: "mobile", label: "Mobile", maxWidth: 640 },
        ])
      )
    ).toEqual([
      { label: "Tablet", width: 1024 },
      { label: "Mobile", width: 640 },
    ]);
  });

  it("skips the BASE tier, which has no upper bound to offer", () => {
    /*
     * Base is "everything wider", so there is no width a preset could name for
     * it. The pane's own Responsive option is what covers that case honestly —
     * inventing a number here would be a claim about the widest device rather
     * than about this site.
     */
    const offered = siteStyleViewports(
      set([
        { id: "base", label: "Desktop" },
        { id: "sm", label: "Small", maxWidth: 480 },
      ])
    );

    expect(offered).toEqual([{ label: "Small", width: 480 }]);
    expect(offered.map(v => v.label)).not.toContain("Desktop");
  });

  it("offers VIEWPORT tiers only, never container ones", () => {
    /*
     * A container tier answers a question about a BOX inside the page, so a
     * frame sized to one previews a viewport no visitor has. The two axes share
     * an id namespace, which is exactly why this filters on the axis rather
     * than on the shape of the definition.
     */
    expect(
      siteStyleViewports(
        set(
          [{ id: "tablet", label: "Tablet", maxWidth: 1024 }],
          [{ id: "card", label: "Card", maxWidth: 320 }]
        )
      )
    ).toEqual([{ label: "Tablet", width: 1024 }]);
  });

  it("skips a tier with no usable label rather than showing its id", () => {
    // A control showing `bp_2` is a row the author can see and cannot identify,
    // which is worse than one option fewer.
    expect(
      siteStyleViewports(
        set([
          { id: "bp_2", label: "   ", maxWidth: 900 },
          { id: "tablet", label: "Tablet", maxWidth: 1024 },
        ])
      )
    ).toEqual([{ label: "Tablet", width: 1024 }]);
  });

  it("joins the label to the width by ID, not by position", () => {
    /*
     * The separating property. The label comes from the STORED definition and
     * the width from the engine's reader, and the reader is free to drop a
     * definition or reorder what it returns — so a positional join would put
     * one tier's name on another's width, which is a preset that is confidently
     * wrong rather than absent.
     */
    const offered = siteStyleViewports(
      set([
        { id: "wide", label: "Wide", maxWidth: 1440 },
        { id: "narrow", label: "Narrow", maxWidth: 480 },
      ])
    );

    expect(offered).toContainEqual({ label: "Wide", width: 1440 });
    expect(offered).toContainEqual({ label: "Narrow", width: 480 });
    // The pairing, not merely the membership: a swap would satisfy both lines
    // above and neither of these.
    expect(offered.find(v => v.width === 1440)?.label).toBe("Wide");
    expect(offered.find(v => v.width === 480)?.label).toBe("Narrow");
  });
});
