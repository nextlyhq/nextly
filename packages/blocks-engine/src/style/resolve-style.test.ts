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
  const blockBase = at("desktop", { color: "black", padding: "0" });
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

    expect(found?.value).toBe("0");
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
      breakpointChain: ["desktop"],
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
      breakpointChain: ["desktop"],
    });

    expect(found?.value).toBe("blue");
    expect(found?.source).toEqual({ tier: "local" });
  });

  it("prefers a CLASS at the narrow breakpoint over the node's own wider value", () => {
    // The narrower breakpoint is the more specific answer whoever wrote it, and the compiler
    // emits it later for that reason. Resolving the other way would contradict the stylesheet.
    const found = resolveStyle("color", "base", "tablet", {
      classes: [namedClass("card", 0, at("tablet", { color: "blue" }))],
      node: at("desktop", { color: "red" }),
      breakpointChain: ["desktop"],
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

describe("a class library that is incomplete or unordered", () => {
  it("skips an id the library does not have rather than failing", () => {
    const library = new Map([
      ["card", namedClass("card", 0, at("desktop", { color: "blue" }))],
    ]);

    // Configuration that has not loaded cannot make a document invalid — the rule PR-S2 settled
    // for unknown tokens. The node keeps the classes that do resolve.
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
