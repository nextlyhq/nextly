/**
 * The resolver answers "where did this value come from", and the compiler decides what the
 * browser actually shows. If those two could disagree, the inspector would describe a page that
 * is not on screen — confidently, which is worse than saying nothing. So the order lives in one
 * place and these tests pin the answers it produces at every tier and along both axes.
 */
import { describe, expect, it } from "vitest";

import type { NodeStyles } from "../document";

import type { NamedClass } from "./named-class";
import { orderedNamedClasses, resolveNodeClasses } from "./named-class";
import { resolveStyle } from "./resolve-style";

const at = (breakpoint: string, values: Record<string, unknown>): NodeStyles =>
  ({ base: { [breakpoint]: values } }) as unknown as NodeStyles;

const namedClass = (
  id: string,
  orderIndex: number,
  styles: NodeStyles
): NamedClass => ({ id, slug: id, orderIndex, styles });

describe("which tier wins", () => {
  // Catalog-valid values throughout, because resolution now reports only what the compiler would
  // write: a fixture the catalog rejects would resolve to nothing and pass or fail for a reason
  // that has nothing to do with tiers.
  const blockBase = at("desktop", {
    color: "black",
    padding: { blockStart: "8px" },
  });
  const card = namedClass("card", 0, at("desktop", { color: "blue" }));
  const feature = namedClass("feature", 1, at("desktop", { color: "green" }));

  it("prefers a class over the block default, and names the class", () => {
    const found = resolveStyle("color", "base", "desktop", {
      blockBase,
      classes: [card],
    });

    expect(found?.value).toBe("blue");
    expect(found?.source).toEqual({ tier: "class", id: "card", slug: "card" });
  });

  it("prefers the node's own value over every class", () => {
    const found = resolveStyle("color", "base", "desktop", {
      blockBase,
      classes: [card, feature],
      node: at("desktop", { color: "red" }),
    });

    expect(found?.value).toBe("red");
    expect(found?.source).toEqual({ tier: "local" });
  });

  it("prefers the later class in library order, not the later one on the node", () => {
    // The same two classes listed the other way round must resolve identically: order is the
    // library's, so two nodes carrying the same classes cannot look different.
    const listedForwards = resolveStyle("color", "base", "desktop", {
      classes: resolveNodeClasses(
        ["card", "feature"],
        new Map([
          ["card", card],
          ["feature", feature],
        ])
      ),
    });
    const listedBackwards = resolveStyle("color", "base", "desktop", {
      classes: resolveNodeClasses(
        ["feature", "card"],
        new Map([
          ["card", card],
          ["feature", feature],
        ])
      ),
    });

    expect(listedForwards?.value).toBe("green");
    expect(listedBackwards).toEqual(listedForwards);
  });

  it("falls through to the block default for a property no one else states", () => {
    const found = resolveStyle("padding", "base", "desktop", {
      blockBase,
      classes: [card],
      node: at("desktop", { color: "red" }),
    });

    expect(found?.value).toEqual({ blockStart: "8px" });
    expect(found?.source).toEqual({ tier: "blockDefault" });
  });

  it("reports nothing for a property no tier states", () => {
    expect(
      resolveStyle("margin", "base", "desktop", { blockBase, classes: [card] })
    ).toBeUndefined();
  });
});

describe("which breakpoint the value comes from", () => {
  it("marks a value inherited from a wider breakpoint, and names it", () => {
    const found = resolveStyle("color", "base", "tablet", {
      node: at("desktop", { color: "red" }),
      viewportChain: ["desktop", "tablet"],
    });

    // A control showing an empty field here would be lying about a page that plainly has a
    // colour; "inherited from desktop" is the honest answer, and it is also the actionable one.
    expect(found?.value).toBe("red");
    expect(found?.source).toEqual({
      tier: "inheritedBreakpoint",
      from: "desktop",
      source: { tier: "local" },
    });
  });

  it("prefers the asked-for breakpoint over a wider one", () => {
    const found = resolveStyle("color", "base", "tablet", {
      node: {
        base: { desktop: { color: "red" }, tablet: { color: "blue" } },
      } as unknown as NodeStyles,
      viewportChain: ["desktop", "tablet"],
    });

    expect(found?.value).toBe("blue");
    expect(found?.source).toEqual({ tier: "local" });
  });

  it("prefers the node's WIDER value over a class's narrow one, because the tier wins", () => {
    // The intuitive answer is that the narrower breakpoint is more specific and should win
    // whoever wrote it. The stylesheet says otherwise: a whole tier is emitted before the whole
    // of the next, so the node's rule comes after the class's and both match at tablet. Reading
    // it the intuitive way would report a value the browser never shows.
    const found = resolveStyle("color", "base", "tablet", {
      classes: [namedClass("card", 0, at("tablet", { color: "blue" }))],
      node: at("desktop", { color: "red" }),
      viewportChain: ["desktop", "tablet"],
    });

    expect(found?.value).toBe("red");
    expect(found?.source).toEqual({
      tier: "inheritedBreakpoint",
      from: "desktop",
      source: { tier: "local" },
    });
  });

  it("prefers the narrower breakpoint WITHIN one tier, which is the desktop-first model", () => {
    const found = resolveStyle("color", "base", "tablet", {
      classes: [
        {
          id: "card",
          slug: "card",
          orderIndex: 0,
          styles: {
            base: { desktop: { color: "red" }, tablet: { color: "blue" } },
          } as never,
        },
      ],
      viewportChain: ["desktop", "tablet"],
    });

    expect(found?.value).toBe("blue");
    expect(found?.source).toEqual({ tier: "class", id: "card", slug: "card" });
  });

  it("keeps state and breakpoint independent", () => {
    const styles = {
      base: { desktop: { color: "black" } },
      hover: { desktop: { color: "red" } },
    } as unknown as NodeStyles;

    expect(
      resolveStyle("color", "hover", "desktop", { node: styles })?.value
    ).toBe("red");
    expect(
      resolveStyle("color", "base", "desktop", { node: styles })?.value
    ).toBe("black");
  });
});

describe("both responsive axes at once", () => {
  it("reports a live viewport rule while a container breakpoint is being edited", () => {
    // A viewport width and a container width match at the same moment, and the stylesheet holds
    // rules for both. Modelled as one chain outward from the breakpoint being edited, the tablet
    // rule is simply not in it, so a node that is plainly blue on screen reports black.
    const found = resolveStyle("color", "base", "card", {
      node: {
        base: { base: { color: "black" }, tablet: { color: "blue" } },
      } as unknown as NodeStyles,
      viewportChain: ["base", "tablet"],
      containerChain: ["card"],
    });

    expect(found?.value).toBe("blue");
    expect(found?.source).toEqual({
      tier: "inheritedBreakpoint",
      from: "tablet",
      source: { tier: "local" },
    });
  });

  it("lets the container axis beat the viewport axis, because it is written last", () => {
    const found = resolveStyle("color", "base", "card", {
      node: {
        base: { tablet: { color: "blue" }, card: { color: "green" } },
      } as unknown as NodeStyles,
      viewportChain: ["base", "tablet"],
      containerChain: ["card"],
    });

    expect(found?.value).toBe("green");
    expect(found?.source).toEqual({ tier: "local" });
  });

  it("keeps an id claimed by the viewport axis at its viewport position", () => {
    // The compiler claims breakpoint ids across both axes and drops the later definition, so an
    // id defined twice is a viewport context only. Resolving it as a container rule would put it
    // after every viewport rule and let it win a contest the stylesheet gives to the other value.
    const found = resolveStyle("color", "base", "wide", {
      node: {
        base: { dup: { color: "blue" }, wide: { color: "green" } },
      } as unknown as NodeStyles,
      viewportChain: ["dup", "wide"],
      containerChain: ["dup"],
    });

    expect(found?.value).toBe("green");
  });

  it("treats the edited breakpoint as the only live one when neither chain is given", () => {
    const found = resolveStyle("color", "base", "tablet", {
      node: {
        base: { desktop: { color: "red" }, tablet: { color: "blue" } },
      } as unknown as NodeStyles,
    });

    expect(found?.value).toBe("blue");
    expect(found?.source).toEqual({ tier: "local" });
  });
});

describe("values the compiler would refuse", () => {
  it("skips an invalid higher-tier value and reports the tier the browser actually shows", () => {
    // `compileStyleValues` drops a declaration validation rejects, so the class's blue is what
    // lands on the page. Reporting the local value would name a colour that is not on screen and
    // attribute the visible one to nothing.
    const found = resolveStyle("color", "base", "desktop", {
      classes: [namedClass("card", 0, at("desktop", { color: "blue" }))],
      node: at("desktop", { color: "not a color" }),
    });

    expect(found?.value).toBe("blue");
    expect(found?.source).toEqual({ tier: "class", id: "card", slug: "card" });
  });

  it("reports nothing when the only value stated is one the compiler refuses", () => {
    expect(
      resolveStyle("color", "base", "desktop", {
        node: at("desktop", { color: "not a color" }),
      })
    ).toBeUndefined();
  });

  it("reports nothing for a key the catalog does not define", () => {
    expect(
      resolveStyle("nonsense", "base", "desktop", {
        node: at("desktop", { nonsense: "x" }),
      })
    ).toBeUndefined();
  });
});

describe("page settings as an origin", () => {
  const pageSettings = at("desktop", {
    color: "rebeccapurple",
    padding: { blockStart: "8px" },
  });

  it("names the page for a property that reaches a node from the root", () => {
    const found = resolveStyle("color", "base", "desktop", { pageSettings });

    expect(found?.value).toBe("rebeccapurple");
    expect(found?.source).toEqual({ tier: "pageSettings" });
  });

  it("loses to a declaration on the node itself", () => {
    // An inherited value loses to any declaration on the element, whatever the source order, so
    // page settings sit below even the block default.
    const found = resolveStyle("color", "base", "desktop", {
      pageSettings,
      blockBase: at("desktop", { color: "black" }),
    });

    expect(found?.source).toEqual({ tier: "blockDefault" });
  });

  it("says nothing about a property that never leaves the page root", () => {
    // Padding on the page root is the page's padding. Offering it as this node's would name an
    // origin the browser does not use.
    expect(
      resolveStyle("padding", "base", "desktop", { pageSettings })
    ).toBeUndefined();
  });
});

describe("a class library that is incomplete or unordered", () => {
  it("skips an id the library does not have rather than failing", () => {
    const library = new Map([
      ["card", namedClass("card", 0, at("desktop", { color: "blue" }))],
    ]);

    // Configuration that has not loaded cannot make a document invalid, for the same reason an
    // unresolved token name is a warning. The node keeps the classes that do resolve.
    const resolved = resolveNodeClasses(["ghost", "card"], library);

    expect(resolved.map(c => c.id)).toEqual(["card"]);
  });

  it("applies a class listed twice once", () => {
    const card = namedClass("card", 0, at("desktop", { color: "blue" }));
    expect(
      resolveNodeClasses(["card", "card"], new Map([["card", card]])).length
    ).toBe(1);
  });

  it("orders two classes sharing an index deterministically", () => {
    // Same index is a data state the library permits; a stylesheet that reordered itself between
    // builds would change which class wins without anything having been edited.
    const a = namedClass("bbb", 5, at("desktop", {}));
    const b = namedClass("aaa", 5, at("desktop", {}));

    expect(orderedNamedClasses([a, b]).map(c => c.id)).toEqual(["aaa", "bbb"]);
    expect(orderedNamedClasses([b, a]).map(c => c.id)).toEqual(["aaa", "bbb"]);
  });
});
