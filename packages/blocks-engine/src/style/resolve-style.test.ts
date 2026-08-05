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
      classes: resolveNodeClasses(["card", "feature"], [card, feature]),
    });
    const listedBackwards = resolveStyle("color", "base", "desktop", {
      classes: resolveNodeClasses(["feature", "card"], [card, feature]),
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

  it("skips a token name the compiler refuses in its own emission path", () => {
    // Validation passes this and the compiler writes nothing for it, so the two disagree unless
    // resolution asks the compiler rather than a paraphrase of it.
    const found = resolveStyle("color", "base", "desktop", {
      classes: [namedClass("card", 0, at("desktop", { color: "blue" }))],
      node: at("desktop", { color: { $token: "bad name" } }),
    });

    expect(found?.value).toBe("blue");
    expect(found?.source).toEqual({ tier: "class", id: "card", slug: "card" });
  });

  it("reports nothing for an empty composite, which states no declaration", () => {
    expect(
      resolveStyle("padding", "base", "desktop", {
        node: at("desktop", { padding: {} }),
      })
    ).toBeUndefined();
  });

  it("reports nothing for an empty field inside a composite that does state something", () => {
    // `border: { width: {}, style: "solid" }` compiles to exactly one declaration, so the whole
    // value is written and only `width` states nothing. Recorded as a field, it would show a
    // width control as set over a page with no border-width declaration at all.
    const found = resolveStyle("border", "base", "desktop", {
      node: at("desktop", { border: { width: {}, style: "solid" } }),
    });

    expect(found?.value).toEqual({ style: "solid" });
    expect(found?.parts?.width).toBeUndefined();
  });

  it("keeps a lower tier's side when a higher tier's side is refused", () => {
    // The whole value compiles — `blockStart` is written — so a check on the whole property says
    // yes while `blockEnd` was dropped. Folded in, the refused side reports itself as the source
    // over a class value the browser is still showing there.
    const found = resolveStyle("padding", "base", "desktop", {
      classes: [
        namedClass("card", 0, at("desktop", { padding: { blockEnd: "4px" } })),
      ],
      node: at("desktop", {
        padding: { blockStart: "16px", blockEnd: "bogus" },
      }),
    });

    expect(found?.value).toEqual({ blockStart: "16px", blockEnd: "4px" });
    expect(found?.parts?.blockEnd.source).toEqual({
      tier: "class",
      id: "card",
      slug: "card",
    });
  });

  it("reports nothing for a key the catalog does not define", () => {
    expect(
      resolveStyle("nonsense", "base", "desktop", {
        node: at("desktop", { nonsense: "x" }),
      })
    ).toBeUndefined();
  });
});

describe("a composite property is not one declaration", () => {
  it("keeps a lower tier's untouched side, and names the tier that still supplies it", () => {
    // `padding` is four declarations. A node stating only `blockStart` overrides that side; the
    // class's `blockEnd` is never overridden and stays on the page. Reported atomically, the
    // class would vanish from the answer while its value is still what the author can see.
    const found = resolveStyle("padding", "base", "desktop", {
      classes: [
        namedClass("card", 0, at("desktop", { padding: { blockEnd: "4px" } })),
      ],
      node: at("desktop", { padding: { blockStart: "16px" } }),
    });

    expect(found?.value).toEqual({ blockStart: "16px", blockEnd: "4px" });
    expect(found?.parts?.blockStart.source).toEqual({ tier: "local" });
    expect(found?.parts?.blockEnd.source).toEqual({
      tier: "class",
      id: "card",
      slug: "card",
    });
  });

  it("names no single origin when the fields came from different tiers", () => {
    // There is no honest answer to "where did this padding come from" here, and picking the last
    // writer would attribute a side it never set.
    const found = resolveStyle("padding", "base", "desktop", {
      classes: [
        namedClass("card", 0, at("desktop", { padding: { blockEnd: "4px" } })),
      ],
      node: at("desktop", { padding: { blockStart: "16px" } }),
    });

    expect(found?.source).toBeUndefined();
  });

  it("still names one origin when a single tier supplied every field", () => {
    const found = resolveStyle("padding", "base", "desktop", {
      node: at("desktop", { padding: { blockStart: "16px", blockEnd: "4px" } }),
    });

    expect(found?.source).toEqual({ tier: "local" });
  });

  it("lets a higher tier override the side it does state", () => {
    const found = resolveStyle("padding", "base", "desktop", {
      classes: [
        namedClass(
          "card",
          0,
          at("desktop", { padding: { blockStart: "4px" } })
        ),
      ],
      node: at("desktop", { padding: { blockStart: "16px" } }),
    });

    expect(found?.value).toEqual({ blockStart: "16px" });
    expect(found?.source).toEqual({ tier: "local" });
  });
});

describe("what an ancestor passes down", () => {
  it("names the ancestor a value is inherited from, and how that ancestor got it", () => {
    // The compiler writes a parent's colour on the parent's own selector and every descendant
    // that states nothing shows it. A resolver that knows only this node and the page reports
    // nothing for a colour plainly on screen.
    const found = resolveStyle("color", "base", "desktop", {
      ancestors: [
        {
          nodeId: "section",
          classes: [namedClass("card", 0, at("desktop", { color: "blue" }))],
        },
      ],
    });

    expect(found?.value).toBe("blue");
    expect(found?.source).toEqual({
      tier: "ancestor",
      nodeId: "section",
      source: { tier: "class", id: "card", slug: "card" },
    });
  });

  it("prefers the nearest ancestor, which is the one the browser stops at", () => {
    const found = resolveStyle("color", "base", "desktop", {
      ancestors: [
        { nodeId: "outer", node: at("desktop", { color: "red" }) },
        { nodeId: "inner", node: at("desktop", { color: "green" }) },
      ],
    });

    expect(found?.value).toBe("green");
    expect(found?.source).toEqual({
      tier: "ancestor",
      nodeId: "inner",
      source: { tier: "local" },
    });
  });

  it("loses to any declaration on the node itself, including its block default", () => {
    const found = resolveStyle("color", "base", "desktop", {
      ancestors: [{ nodeId: "outer", node: at("desktop", { color: "red" }) }],
      blockBase: at("desktop", { color: "black" }),
    });

    expect(found?.source).toEqual({ tier: "blockDefault" });
  });

  it("passes down nothing for a property that does not travel", () => {
    expect(
      resolveStyle("padding", "base", "desktop", {
        ancestors: [
          {
            nodeId: "outer",
            node: at("desktop", { padding: { blockStart: "8px" } }),
          },
        ],
      })
    ).toBeUndefined();
  });
});

describe("a shorthand under a partial record", () => {
  it("keeps the corners the shorthand is still painting, and names their tier", () => {
    // `border-radius: 4px` sets four corners; one logical longhand after it overrides one. The
    // browser keeps 4px on the other three, so replacing the shorthand outright would leave three
    // visible corners attributed to nothing.
    const found = resolveStyle("borderRadius", "base", "desktop", {
      classes: [namedClass("card", 0, at("desktop", { borderRadius: "4px" }))],
      node: at("desktop", { borderRadius: { startStart: "8px" } }),
    });

    expect(found?.parts?.startStart.source).toEqual({ tier: "local" });
    expect(found?.parts?.startEnd.source).toEqual({
      tier: "class",
      id: "card",
      slug: "card",
    });
    expect(found?.parts?.startEnd.value).toBe("4px");
  });
});

describe("two catalog keys writing one CSS property", () => {
  it("stops reporting a value another key has overwritten", () => {
    // `background.url` and `backgroundGradient` both write `background-image`, and the compiler
    // writes the gradient last. Reporting the class's image would name a picture the browser is
    // no longer painting.
    const found = resolveStyle("background", "base", "desktop", {
      classes: [
        namedClass("card", 0, at("desktop", { background: { url: "/a.png" } })),
      ],
      node: at("desktop", {
        backgroundGradient: "linear-gradient(red, blue)",
      }),
    });

    expect(found?.parts?.url).toBeUndefined();
  });

  it("reports the gradient under the key that actually holds it", () => {
    // The overwriting value is not expressible as a `background` — there is no field of it that
    // holds a gradient — so it is answered where it lives.
    const found = resolveStyle("backgroundGradient", "base", "desktop", {
      classes: [
        namedClass("card", 0, at("desktop", { background: { url: "/a.png" } })),
      ],
      node: at("desktop", {
        backgroundGradient: "linear-gradient(red, blue)",
      }),
    });

    expect(found?.value).toBe("linear-gradient(red, blue)");
    expect(found?.source).toEqual({ tier: "local" });
  });

  it("orders two keys in one map the way the compiler sorts them, not as stored", () => {
    // The compiler SORTS a map's keys before emitting, so two documents differing only in the
    // order they were written compile to the same bytes. `background` sorts before
    // `backgroundGradient`, so the gradient is written last and wins — from either storage order.
    const storedLast = resolveStyle("backgroundGradient", "base", "desktop", {
      node: at("desktop", {
        background: { url: "/a.png" },
        backgroundGradient: "linear-gradient(red, blue)",
      }),
    });
    const storedFirst = resolveStyle("backgroundGradient", "base", "desktop", {
      node: at("desktop", {
        backgroundGradient: "linear-gradient(red, blue)",
        background: { url: "/a.png" },
      }),
    });

    expect(storedLast?.value).toBe("linear-gradient(red, blue)");
    expect(storedFirst?.value).toBe("linear-gradient(red, blue)");
  });
});

describe("a style map the compiler refuses whole", () => {
  it("reports the tier below, not the value stored beside the wreckage", () => {
    // The compiler compiles a MAP, and a map with enough malformed siblings is refused together.
    // Compiling the one asked-for property in isolation says it is fine and reports a local value
    // the browser never received.
    const wreckage: Record<string, unknown> = { color: "red" };
    for (let index = 0; index < 400; index += 1) {
      wreckage[`bogusProperty${index}`] = "nonsense";
    }

    const found = resolveStyle("color", "base", "desktop", {
      classes: [namedClass("card", 0, at("desktop", { color: "blue" }))],
      node: at("desktop", wreckage),
    });

    expect(found?.value).toBe("blue");
    expect(found?.source).toEqual({ tier: "class", id: "card", slug: "card" });
  });
});

describe("a declaration is evidence only for the key that wrote it", () => {
  it("does not let a sibling on another selector vouch for a refused value", () => {
    // `color` lands on the block and `linkColor` lands on an `a` inside it. Both emit the CSS
    // property `color`, so a set of bare property names lets the valid link colour make the
    // invalid root colour look written — and it is reported over the class the browser shows.
    const found = resolveStyle("color", "base", "desktop", {
      classes: [namedClass("card", 0, at("desktop", { color: "blue" }))],
      node: at("desktop", { color: "not a color", linkColor: "blue" }),
    });

    expect(found?.value).toBe("blue");
    expect(found?.source).toEqual({ tier: "class", id: "card", slug: "card" });
  });

  it("refuses a composite field the catalog does not define", () => {
    // `padding` compiles because `blockStart` is valid; `bogus` names no leaf, so the compiler
    // writes nothing for it. Kept, it reports a value with a local source over a page that has no
    // such declaration at all.
    const found = resolveStyle("padding", "base", "desktop", {
      node: at("desktop", { padding: { blockStart: "16px", bogus: "4px" } }),
    });

    expect(found?.value).toEqual({ blockStart: "16px" });
    expect(found?.parts?.bogus).toBeUndefined();
  });

  it("reads a token reference as a value rather than descending into it", () => {
    // A token ref is a record in storage and a value in meaning. Walked as a composite, `$token`
    // names no catalog leaf and the whole reference would be refused.
    const found = resolveStyle("color", "base", "desktop", {
      node: at("desktop", { color: { $token: "brand.primary" } }),
    });

    expect(found?.value).toEqual({ $token: "brand.primary" });
    expect(found?.source).toEqual({ tier: "local" });
  });
});

describe("two keys that overlap on only part of what they write", () => {
  it("keeps the fields the other key did not overwrite, and their tier", () => {
    // `backgroundGradient` replaces `background-image` and nothing else. The class's position,
    // size and repeat are still painting the element, so clearing the whole value would send an
    // author looking for values that are plainly there.
    const found = resolveStyle("background", "base", "desktop", {
      classes: [
        namedClass(
          "card",
          0,
          at("desktop", {
            background: {
              url: "/a.png",
              position: "center",
              repeat: "no-repeat",
            },
          })
        ),
      ],
      node: at("desktop", { backgroundGradient: "linear-gradient(red, blue)" }),
    });

    expect(found?.parts?.position.source).toEqual({
      tier: "class",
      id: "card",
      slug: "card",
    });
    expect(found?.parts?.url).toBeUndefined();
  });

  it("ignores a key that writes none of what was asked about", () => {
    // `background: { position }` emits `background-position` only. Accepted as a candidate for
    // the gradient, it reports a position object as the image over an element with no image.
    const found = resolveStyle("backgroundGradient", "base", "desktop", {
      node: at("desktop", { background: { position: "center" } }),
    });

    expect(found).toBeUndefined();
  });
});

describe("a shorthand and its longhands", () => {
  it("sees a value the shorthand supplied under a different property name", () => {
    // `gap` writes both `row-gap` and `column-gap`, and shares no property NAME with either. A
    // longhand control that matched on the name alone reported no source for a gap the browser
    // is plainly applying.
    const found = resolveStyle("columnGap", "base", "desktop", {
      classes: [namedClass("card", 0, at("desktop", { gap: "16px" }))],
      node: at("desktop", { rowGap: "4px" }),
    });

    expect(found?.value).toBe("16px");
    expect(found?.source).toEqual({ tier: "class", id: "card", slug: "card" });
  });
});

describe("a shorthand partly overridden by a longhand", () => {
  it("stops reporting the shorthand for the side the longhand replaced", () => {
    // `gap: "16px"` writes both gaps; a local `rowGap: "4px"` replaces one of them. The
    // shorthand answered only `gap` unexpanded while the overwriting longhand was tracked as
    // `row-gap`, so the two never met and the class's uniform value kept being reported.
    const found = resolveStyle("gap", "base", "desktop", {
      classes: [namedClass("card", 0, at("desktop", { gap: "16px" }))],
      node: at("desktop", { rowGap: "4px" }),
    });

    expect(found).toBeUndefined();
  });
});

describe("a partial alias with nothing accumulated yet", () => {
  it("does not answer with a value the property cannot hold", () => {
    // Only a `backgroundGradient` is stored. Gated on there being an earlier producer, the skip
    // never ran and the gradient came back as a `background` — a value that shape cannot express
    // and a control cannot edit.
    const found = resolveStyle("background", "base", "desktop", {
      node: at("desktop", { backgroundGradient: "linear-gradient(red, blue)" }),
    });

    expect(found).toBeUndefined();
  });
});

describe("an interactive state on an ancestor", () => {
  it("does not report a parent's focus colour on a focused child", () => {
    // A parent's focus styles compile to `.parent:where(:focus-visible)`, which matches when the
    // PARENT is focus-visible. Focusing a child does not make that selector match, so the child
    // never shows it.
    const found = resolveStyle("color", "focus", "desktop", {
      ancestors: [
        {
          nodeId: "parent",
          node: {
            base: { desktop: { color: "black" } },
            focus: { desktop: { color: "red" } },
          } as unknown as NodeStyles,
        },
      ],
    });

    expect(found?.value).toBe("black");
  });
});

describe("a state the compiler does not know", () => {
  it("reports nothing, because no rule was written for it", () => {
    // `pressed` is reported as `invalid-style-state` and emits nothing. Read here, it would hand
    // back a value from a rule the compiler deliberately omitted.
    expect(
      resolveStyle("color", "pressed", "desktop", {
        node: {
          base: { desktop: { color: "black" } },
          pressed: { desktop: { color: "red" } },
        } as unknown as NodeStyles,
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
    const library = [namedClass("card", 0, at("desktop", { color: "blue" }))];

    // Configuration that has not loaded cannot make a document invalid, for the same reason an
    // unresolved token name is a warning. The node keeps the classes that do resolve.
    const resolved = resolveNodeClasses(["ghost", "card"], library);

    expect(resolved.map(c => c.id)).toEqual(["card"]);
  });

  it("applies a class listed twice once", () => {
    const card = namedClass("card", 0, at("desktop", { color: "blue" }));
    expect(resolveNodeClasses(["card", "card"], [card]).length).toBe(1);
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
