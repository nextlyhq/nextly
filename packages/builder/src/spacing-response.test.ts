// @vitest-environment jsdom

/**
 * What the probe must leave behind: nothing.
 *
 * WHICH edge responds is a layout question and jsdom has no layout, so the
 * answer itself is verified in a browser — measured there on an auto-height
 * block (border edge moves out) and a fixed-height one (content edge moves in).
 * What IS checkable here is the property that makes the probe safe to run
 * against a node the canvas is rendering: it writes to that element, and it must
 * restore it exactly, or it is an edit nobody made.
 *
 * @module spacing-response.test
 */

import { describe, expect, it } from "vitest";

import type { SpacingBox, SpacingSide } from "./spacing-bands";
import { spacingRespondsOutward, styleCapable } from "./spacing-response";

function block(css?: string): HTMLElement {
  const element = document.createElement("div");
  if (css !== undefined) element.setAttribute("style", css);
  document.body.append(element);
  return element;
}

describe("the threshold is judged in the units the probe is SEEN in", () => {
  /*
   * `boxAcross` answers in viewport pixels and the canvas is painted through a
   * transform, so ten CSS pixels of padding move the edge by ten times the
   * scale on screen — five at half zoom, two and a half at quarter. A threshold
   * fixed in viewport pixels therefore reads an ordinary outward-growing block
   * as stationary on any zoomed canvas, puts the handle on the edge that never
   * moves and inverts the drag: the very defect this module exists to remove,
   * reintroduced by the units it was measured in.
   *
   * jsdom lays nothing out, so the movement is supplied directly: the rects are
   * stubbed to grow by exactly what the probe would produce at each scale.
   */
  function respondsAt(scale: number, grewBy: number): boolean {
    const element = block();
    let call = 0;
    element.getBoundingClientRect = () => {
      call += 1;
      // The second read is taken with the probe applied.
      const bottom = call === 1 ? 100 : 100 + grewBy;
      return { top: 0, bottom, left: 0, right: 100 } as DOMRect;
    };
    return spacingRespondsOutward(element, "padding", "bottom", scale);
  }

  it("sees an outward response at full zoom", () => {
    expect(respondsAt(1, 10)).toBe(true);
  });

  it("still sees it at half zoom, where the edge moves only five pixels", () => {
    expect(respondsAt(0.5, 5)).toBe(true);
  });

  it("still sees it at quarter zoom", () => {
    expect(respondsAt(0.25, 2.5)).toBe(true);
  });

  /*
   * The control. A block whose border edge does not move must read as inward at
   * every zoom — otherwise a threshold small enough to catch the quarter-zoom
   * case would call everything outward, which is the same defect mirrored.
   */
  it("reads no movement as inward at every zoom", () => {
    for (const scale of [1, 0.5, 0.25]) {
      expect(respondsAt(scale, 0), String(scale)).toBe(false);
    }
  });

  it("survives a scale it cannot use", () => {
    // Neither zero nor a broken number may make every block answer the same way.
    expect(respondsAt(0, 10)).toBe(true);
    expect(respondsAt(Number.NaN, 10)).toBe(true);
  });
});

describe("every side, against what Chromium actually does", () => {
  /*
   * The rows below were MEASURED, in Chromium, one case at a time: a block in
   * normal flow, its band's two edges read before and after the value grew by
   * ten. They are assertions rather than prose because a table of layout cases
   * reasoned out instead of measured reads exactly as convincing and cannot
   * fail when it is wrong.
   *
   * `signed` is what `edgeMovedOut` sees — the border edge's movement AWAY from
   * the block's middle — and it is negative wherever the border edge came
   * inward, which is the case a signed comparison silently filed under "did not
   * move at all".
   *
   * Note `margin-right` appearing twice with opposite answers. That is the row
   * that rules out any table keyed on the side: growing it on an auto-width
   * block eats the block's own width and leaves the outer edge pinned to the
   * container, while on a fixed-width one it pushes outward.
   */
  const MEASURED = [
    {
      case: "flow margin-top",
      box: "margin",
      side: "top",
      signed: -10,
      out: false,
    },
    {
      case: "flow margin-bottom",
      box: "margin",
      side: "bottom",
      signed: 0,
      out: true,
    },
    {
      case: "flow margin-left",
      box: "margin",
      side: "left",
      signed: -10,
      out: false,
    },
    {
      case: "auto-width margin-right",
      box: "margin",
      side: "right",
      signed: -10,
      out: false,
    },
    {
      case: "fixed-width margin-right",
      box: "margin",
      side: "right",
      signed: 0,
      out: true,
    },
    {
      case: "auto-height padding-bottom",
      box: "padding",
      side: "bottom",
      signed: 10,
      out: true,
    },
    {
      case: "fixed-height padding-bottom",
      box: "padding",
      side: "bottom",
      signed: 0,
      out: false,
    },
    {
      case: "auto-height padding-top",
      box: "padding",
      side: "top",
      signed: 0,
      out: false,
    },
    {
      case: "auto-height padding-right",
      box: "padding",
      side: "right",
      signed: 0,
      out: false,
    },
  ] as const satisfies readonly {
    readonly case: string;
    readonly box: SpacingBox;
    readonly side: SpacingSide;
    readonly signed: number;
    readonly out: boolean;
  }[];

  /*
   * jsdom lays nothing out, so the movement each row measured is supplied
   * directly: the border box is stubbed to displace that edge by `signed`
   * pixels outward, negative meaning inward.
   */
  function respondsWhenBorderMoves(
    box: SpacingBox,
    side: SpacingSide,
    signed: number
  ): boolean {
    const element = block();
    const base = { top: 100, bottom: 200, left: 100, right: 200 };
    let call = 0;
    element.getBoundingClientRect = () => {
      call += 1;
      if (call === 1) return { ...base } as DOMRect;
      const after = { ...base };
      if (side === "top") after.top = base.top - signed;
      if (side === "bottom") after.bottom = base.bottom + signed;
      if (side === "left") after.left = base.left - signed;
      if (side === "right") after.right = base.right + signed;
      return after as DOMRect;
    };
    return spacingRespondsOutward(element, box, side, 1);
  }

  it.each(MEASURED)(
    "$case: a border edge moving $signed reads as outward $out",
    ({ box, side, signed, out }) => {
      expect(respondsWhenBorderMoves(box, side, signed)).toBe(out);
    }
  );

  /*
   * The margin question is whether that edge moved AT ALL, so the two signs of
   * one movement must give one answer. Asserted apart from the table because it
   * is the property, and the table is only the evidence for it.
   */
  it("reads a margin's border edge the same way whichever way it moved", () => {
    for (const side of ["top", "bottom", "left", "right"] as const) {
      expect(respondsWhenBorderMoves("margin", side, 10), side).toBe(
        respondsWhenBorderMoves("margin", side, -10)
      );
    }
  });
});

describe("the probe leaves the element as it found it", () => {
  it("removes an inline padding it added", () => {
    const element = block();
    spacingRespondsOutward(element, "padding", "bottom", 1);
    expect(element.getAttribute("style")).toBeNull();
  });

  it("restores an inline value the author set", () => {
    const element = block("padding-bottom: 7px;");
    spacingRespondsOutward(element, "padding", "bottom", 1);
    expect(element.style.getPropertyValue("padding-bottom")).toBe("7px");
    expect(element.style.getPropertyPriority("padding-bottom")).toBe("");
  });

  /*
   * Priority included. The probe writes `!important` so an author's own
   * important padding cannot win and make every block answer the same way — so
   * restoring the value while dropping its priority would quietly promote the
   * author's declaration over whatever it used to lose to.
   */
  it("restores the author's priority too", () => {
    const element = block("padding-bottom: 7px !important;");
    spacingRespondsOutward(element, "padding", "bottom", 1);
    expect(element.style.getPropertyValue("padding-bottom")).toBe("7px");
    expect(element.style.getPropertyPriority("padding-bottom")).toBe(
      "important"
    );
  });

  it("leaves the other sides alone", () => {
    const element = block("padding-top: 3px; padding-left: 5px;");
    spacingRespondsOutward(element, "padding", "bottom", 1);
    expect(element.style.getPropertyValue("padding-top")).toBe("3px");
    expect(element.style.getPropertyValue("padding-left")).toBe("5px");
  });

  it("restores every side it is asked about", () => {
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const element = block();
      spacingRespondsOutward(element, "padding", side, 1);
      expect(element.getAttribute("style"), side).toBeNull();
    }
  });
});

describe("what can be probed at all", () => {
  /*
   * Not every block root is HTML. `isReplaced` counts `<svg>` among the
   * replaced boxes and `drawableBoxes` will draw its margins, so an HTML-only
   * test answered every SVG-rooted block with a fallback — a direction supplied
   * without measuring, which is the one thing this module exists to stop.
   */
  it("accepts an SVG root, whose margins the bands already draw", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    expect(styleCapable(svg)).toBe(true);
  });

  it("accepts an ordinary HTML element", () => {
    expect(styleCapable(document.createElement("div"))).toBe(true);
  });

  /*
   * And an element from a namespace carrying no inline style is refused rather
   * than probed, because the probe writes one and puts it back.
   */
  it("refuses an element with no inline style to write", () => {
    const foreign = document.createElementNS("urn:example:ns", "thing");
    expect(styleCapable(foreign)).toBe(false);
  });

  /*
   * And the probe really runs on one, leaving it as it found it. Accepting the
   * element without being able to restore it would be worse than refusing it:
   * the canvas watches this subtree, so a leftover attribute is an edit nobody
   * made.
   */
  it("probes an SVG root and puts its attribute back", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.append(svg);
    expect(styleCapable(svg)).toBe(true);
    if (!styleCapable(svg)) return;
    spacingRespondsOutward(svg, "margin", "bottom", 1);
    expect(svg.getAttribute("style")).toBeNull();
  });
});

describe("what the probe suppresses while it writes", () => {
  /*
   * The probed property must not transition, or the push does not land and the
   * block reads as unresponsive. Turning transitions OFF would do it and would
   * also cancel whatever the block is in the middle of — measured in Chromium, a
   * block part-way through an opacity transition jumps to its end value and
   * cannot be resumed, and a forced-state change starts exactly such a
   * transition and then asks for a measurement.
   *
   * So the probe names the transitions that are RUNNING, minus its own. jsdom
   * animates nothing, so the timelines are supplied here.
   */
  function suppressionFor(
    running: readonly string[],
    side: SpacingSide = "top"
  ): string | undefined {
    const element = block();
    element.getAnimations = () =>
      running.map(
        transitionProperty => ({ transitionProperty }) as unknown as Animation
      );
    let suppressed: string | undefined;
    const real = element.style.setProperty.bind(element.style);
    element.style.setProperty = (...args: Parameters<typeof real>): void => {
      if (args[0] === "transition-property") suppressed = args[1] ?? undefined;
      real(...args);
    };
    spacingRespondsOutward(element, "margin", side, 1);
    return suppressed;
  }

  it("keeps a transition the probe is not about", () => {
    expect(suppressionFor(["opacity"])).toBe("opacity");
  });

  it("drops its own property from what it keeps", () => {
    expect(suppressionFor(["opacity", "margin-top"])).toBe("opacity");
  });

  it("names each kept transition once", () => {
    expect(suppressionFor(["opacity", "opacity", "transform"])).toBe(
      "opacity, transform"
    );
  });

  /*
   * With nothing running there is nothing to preserve, and `none` still stops
   * the probe's own write from starting one.
   */
  it("suppresses everything when nothing is running", () => {
    expect(suppressionFor([])).toBe("none");
    expect(suppressionFor(["margin-top"])).toBe("none");
  });

  it("keeps a transition on the OTHER side of the same box", () => {
    expect(suppressionFor(["margin-bottom"], "top")).toBe("margin-bottom");
  });
});
