/**
 * A block's shared style: saving its look as one, the compiled class that
 * results, and the edits that move values between the block and its style.
 */
import {
  compilePageCss,
  nodeClassName,
  overlaidStyles,
  type BlockDocument,
  type BreakpointSet,
  type NamedClass,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  hasOwnStyles,
  newSharedStyleName,
  nodeSharedStyles,
  DETACH_LOOK_NOT_KEPT,
  planDetachSharedStyle,
  moveToSharedStyleClear,
  planMoveToSharedStyle,
  planRemoveSharedStyle,
  planSaveAsSharedStyle,
  saveAsSharedStyleRefusal,
  sharedStyleChange,
  sharedStyleMoveSummary,
  sharedStyleWrite,
  NO_DESIGN_RIGHT,
} from "./shared-style-target";

const BREAKPOINTS: BreakpointSet = {
  viewport: [
    { id: "base", label: "Base" },
    { id: "md", label: "Medium", maxWidth: 900 },
  ],
  container: [],
};

/** Block A's own look: a base colour and padding, a hover colour, a tablet size. */
const OWN: NodeStyles = {
  base: {
    base: { color: "#112233", padding: { blockStart: "24px" } },
    md: { fontSize: "14px" },
  },
  hover: { base: { color: { $token: "color.brand" } } },
};

function page(a: Record<string, unknown>, b: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "a", type: "core/box", version: 1, props: {}, ...a },
      { id: "b", type: "core/box", version: 1, props: {}, ...b },
    ],
  } as unknown as BlockDocument;
}

const card: NamedClass = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 3,
  styles: { base: { base: { color: "#445566" } } },
};
const hero: NamedClass = {
  id: "c-hero",
  slug: "hero",
  orderIndex: 1,
  styles: {},
};

/** A well-formed envelope, beside the malformed ones. */
const colour: NodeStyles = { base: { base: { color: "#123456" } } };

const offer = (library: readonly NamedClass[] = [card], mayChange = true) => ({
  library,
  mayChange,
});

/** The ops applied to a document, as the editor would. */
function applied(document: BlockDocument, ops: readonly unknown[]) {
  const nodes = document.nodes.map(node => {
    let next: Record<string, unknown> = { ...node };
    for (const op of ops as {
      id: string;
      patch: Record<string, unknown>;
      unset?: string[];
    }[]) {
      if (op.id !== node.id) continue;
      next = { ...next, ...op.patch };
      for (const field of op.unset ?? []) delete next[field];
    }
    return next;
  });
  return { ...document, nodes } as unknown as BlockDocument;
}

describe("saving a block's look as a shared style", () => {
  it("moves the whole envelope into the new style and puts it on the block", () => {
    const plan = planSaveAsSharedStyle(
      page({ styles: OWN, classes: ["other"], visibility: { hidden: true } }),
      "a",
      "Primary button",
      offer(),
      undefined,
      () => "c-new"
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.entry).toEqual({
      id: "c-new",
      slug: "primary-button",
      label: "Primary button",
      // One past the highest, so the new style wins over the older ones.
      orderIndex: 4,
      styles: OWN,
    });
    // The styles leave the block; its other classes and its visibility stay.
    expect(plan.ops).toEqual([
      {
        kind: "update",
        id: "a",
        patch: { classes: ["other", "c-new"] },
        unset: ["styles"],
      },
    ]);
  });

  it("refuses with the reason an author can act on", () => {
    const refusal = (
      node: Record<string, unknown>,
      library = [card],
      may = true
    ) => saveAsSharedStyleRefusal(page(node), "a", offer(library, may));
    expect(refusal({ styles: OWN }, [card], false)).toBe(NO_DESIGN_RIGHT);
    expect(refusal({})).toBe("This block has no styles of its own yet.");
    expect(refusal({ styles: { base: { base: {} } } })).toBe(
      "This block has no styles of its own yet."
    );
    expect(refusal({ styles: OWN, classes: ["c-card"] })).toBe(
      "This block already uses Card."
    );
    // A class the site does not define styles nothing, so it is no reason.
    expect(refusal({ styles: OWN, classes: ["gone"] })).toBeUndefined();
    expect(refusal({ styles: OWN, locked: true })).toMatch(/lock/i);
    expect(
      saveAsSharedStyleRefusal(page({ styles: OWN }), "a", {
        library: undefined,
        mayChange: true,
      })
    ).toBe("This site's shared styles haven't been read yet.");
  });

  it("refuses a name another style's class name already has", () => {
    const plan = planSaveAsSharedStyle(
      page({ styles: OWN }),
      "a",
      "card!",
      offer()
    );
    expect(plan).toEqual({
      ok: false,
      reason: "“card!” is already a shared style. Choose another name.",
    });
    expect(newSharedStyleName("  ", [card])).toEqual({
      ok: false,
      reason: "A shared style needs a name.",
    });
  });

  it("says what moves, in words", () => {
    expect(sharedStyleMoveSummary(OWN, "Card")).toBe(
      "Moves this block's 4 values (2 devices, Hover) into Card."
    );
    expect(
      sharedStyleMoveSummary({ base: { base: { color: "red" } } }, "")
    ).toBe("Moves this block's 1 value into the new shared style.");
  });
});

describe("the compiled class after a save", () => {
  const compile = (document: BlockDocument, classes: NamedClass[]) =>
    compilePageCss(document, {
      breakpoints: BREAKPOINTS,
      namedClasses: classes,
    });

  it("carries the block's declarations, in every state and breakpoint, to both blocks", () => {
    const plan = planSaveAsSharedStyle(
      page({ styles: OWN }),
      "a",
      "Card style",
      offer([]),
      undefined,
      () => "c-new"
    );
    if (!plan.ok) throw new Error(plan.reason);
    // Block B wears the new style too.
    const after = applied(applied(page({ styles: OWN }), plan.ops), [
      { id: "b", patch: { classes: ["c-new"] } },
    ]);
    const { css, classes } = compile(after, [plan.entry]);

    const rule = css.slice(css.indexOf(".nx-c-card-style"));
    expect(rule).toContain("color: #112233");
    expect(rule).toContain("padding-block-start: 24px");
    expect(css).toMatch(
      /\.nx-c-card-style:where\(:hover\) \{ color: var\(--site-color-brand\) \}/
    );
    expect(css).toMatch(
      /@media[^{]*900px[^{]*\{[^@]*\.nx-c-card-style[^{]*\{[^}]*font-size: 14px/
    );
    expect(classes.get("a")?.split(" ")).toContain("nx-c-card-style");
    expect(classes.get("b")?.split(" ")).toContain("nx-c-card-style");
    // No rule of block A's own is left to win over the style.
    expect(css).not.toContain(nodeClassName("a"));
  });

  it("changes both blocks when the style changes", () => {
    const document = page({ classes: ["c-card"] }, { classes: ["c-card"] });
    const changed = sharedStyleWrite(
      card.styles,
      { state: "base", breakpoint: "base", property: "color", path: [] },
      "#abcdef"
    );
    if (changed.kind !== "write") throw new Error("not written");
    const { css, classes } = compile(document, [
      { ...card, styles: changed.styles },
    ]);
    expect(css).toContain("color: #abcdef");
    expect(css).not.toContain("#445566");
    for (const id of ["a", "b"]) {
      expect(classes.get(id)?.split(" ")).toContain("nx-c-card");
    }
  });

  it("lets a value left on the block win over its style", () => {
    const { css } = compile(
      page({
        classes: ["c-card"],
        styles: { base: { base: { color: "#000001" } } },
      }),
      [card]
    );
    expect(css.indexOf("#000001")).toBeGreaterThan(css.indexOf("#445566"));
  });
});

describe("the shared styles a block wears", () => {
  it("lists every readable one in library order, by name", () => {
    expect(
      nodeSharedStyles([card, hero], ["c-card", "missing", "c-hero"]).map(
        row => row.name
      )
    ).toEqual(["hero", "Card"]);
  });

  it("knows an envelope with nothing in it", () => {
    expect(hasOwnStyles(undefined)).toBe(false);
    expect(hasOwnStyles({ hover: { base: {} } })).toBe(false);
    expect(hasOwnStyles(OWN)).toBe(true);
  });
});

describe("a stored envelope that is malformed at some level", () => {
  const malformed = [
    { base: null },
    { base: "red" },
    { base: { base: null } },
    { hover: { base: 5 } },
    { base: { base: ["color"] } },
  ] as unknown as NodeStyles[];

  it.each(malformed)(
    "is read as holding nothing there, never thrown on: %j",
    styles => {
      expect(() => hasOwnStyles(styles)).not.toThrow();
      expect(hasOwnStyles(styles)).toBe(false);
      expect(() =>
        saveAsSharedStyleRefusal(page({ styles }), "a", offer())
      ).not.toThrow();
      expect(sharedStyleMoveSummary(styles, "Card")).toBe(
        "Moves this block's 0 values into Card."
      );
      expect(overlaidStyles(styles, colour)).toEqual(colour);
      expect(overlaidStyles(colour, styles)).toEqual(colour);
      expect(() =>
        planDetachSharedStyle(
          page({ styles, classes: ["c-card"] }),
          "a",
          { id: "c-card", styles },
          [
            { id: "c-card", styles },
            { id: "c-late", styles: colour },
          ]
        )
      ).not.toThrow();
    }
  );
});

/**
 * The value a block shows for one property at one viewport width, read off the
 * compiled sheet as the browser's cascade would: every rule whose selector the
 * block carries and whose `max-width` admits the width, the last one winning
 * (every rule here has one specificity, so source order decides).
 */
function shown(
  document: BlockDocument,
  library: NamedClass[],
  property: string,
  width: number,
  /** The pseudo-class active, as the sheet wraps it: `:hover`. */
  pseudo?: string,
  /**
   * The site's breakpoints, and the width of the query container the block
   * sits in, if any: a container rule applies only inside one.
   */
  frame: { breakpoints?: BreakpointSet; container?: number } = {}
): string | undefined {
  const { css, classes } = compilePageCss(document, {
    breakpoints: frame.breakpoints ?? BREAKPOINTS,
    namedClasses: library,
  });
  const tokens = new Set((classes.get("a") ?? "").split(" "));
  let value: string | undefined;
  let applies = true;
  for (const line of css.split("\n")) {
    const media = /@media \(max-width: (\d+)px\)/.exec(line);
    if (media) {
      applies = width <= Number(media[1]);
      continue;
    }
    const query =
      /@container \((max|min)-width: (\d+)px\)|@container \(min-width: 0\)/.exec(
        line
      );
    if (query) {
      const inside = frame.container;
      applies =
        inside !== undefined &&
        (query[1] !== "max" || inside <= Number(query[2]));
      continue;
    }
    if (line.trim() === "}") {
      applies = true;
      continue;
    }
    const rule = /\.([\w-]+)(?::where\([^)]*\))? \{ (.*) \}/.exec(line);
    if (!rule || !tokens.has(rule[1] ?? "") || !applies) continue;
    // A state's rule applies only while that state is active; base always.
    const state = /:where\(([^)]*)\)/.exec(line)?.[1];
    if (state !== undefined && state !== pseudo) continue;
    for (const declaration of (rule[2] ?? "").split(";")) {
      const [name, ...rest] = declaration.split(":");
      if (name?.trim() === property) value = rest.join(":").trim();
    }
  }
  return value;
}

describe("detaching and removing a block's style", () => {
  it("keeps the look on the block: the style's values under its own", () => {
    const style = {
      id: "c-card",
      styles: {
        base: {
          base: {
            color: "#445566",
            padding: { blockStart: "8px", inlineStart: "4px" },
          },
        },
      } as NodeStyles,
    };
    const plan = planDetachSharedStyle(
      page({
        classes: ["c-card"],
        styles: { base: { base: { padding: { blockStart: "24px" } } } },
      }),
      "a",
      style,
      [style]
    );
    expect(plan).toEqual({
      ok: true,
      ops: [
        {
          kind: "update",
          id: "a",
          patch: {
            styles: {
              base: {
                base: {
                  color: "#445566",
                  padding: { blockStart: "24px", inlineStart: "4px" },
                },
              },
            },
          },
          unset: ["classes"],
        },
      ],
    });
  });

  it("copies only what the detached style wins, so a later style keeps its values", () => {
    // Earlier in library order, so the later style's colour wins today.
    const earlier = {
      id: "c-early",
      styles: {
        base: {
          base: {
            color: "#aa0000",
            padding: { blockStart: "8px", inlineStart: "4px" },
          },
        },
      } as NodeStyles,
    };
    const later = {
      id: "c-late",
      styles: {
        base: { base: { color: "#0000aa", padding: { blockStart: "2px" } } },
      } as NodeStyles,
    };
    const plan = planDetachSharedStyle(
      page({ classes: ["c-early", "c-late"] }),
      "a",
      earlier,
      [earlier, later]
    );
    expect(plan).toEqual({
      ok: true,
      ops: [
        {
          kind: "update",
          id: "a",
          // The colour and the block-start side stay the later style's; only
          // the inline-start side was the detached style's to give.
          patch: {
            styles: { base: { base: { padding: { inlineStart: "4px" } } } },
            classes: ["c-late"],
          },
        },
      ],
    });
  });

  it("keeps the look at every width when a later style wins at a narrower breakpoint", () => {
    const early: NamedClass = {
      id: "c-early",
      slug: "early",
      orderIndex: 0,
      styles: { base: { base: { color: "#aa0000", opacity: 0.5 } } },
    };
    // Later in library order, and set only at the tablet width.
    const late: NamedClass = {
      id: "c-late",
      slug: "late",
      orderIndex: 1,
      styles: { base: { md: { color: "#0000aa" } } },
    };
    const before = page({ classes: ["c-early", "c-late"] });
    const look = (document: BlockDocument, library: NamedClass[]) => ({
      desktop: shown(document, library, "color", 1280),
      tablet: shown(document, library, "color", 800),
      opacity: shown(document, library, "opacity", 1280),
    });
    expect(look(before, [early, late])).toEqual({
      desktop: "#aa0000",
      tablet: "#0000aa",
      opacity: "0.5",
    });

    const plan = planDetachSharedStyle(
      before,
      "a",
      early,
      [early, late],
      undefined,
      BREAKPOINTS
    );
    if (!plan.ok) throw new Error(plan.reason);

    // The block's own values now give what the two styles gave, at each width.
    expect(look(applied(before, plan.ops), [late])).toEqual({
      desktop: "#aa0000",
      tablet: "#0000aa",
      opacity: "0.5",
    });
  });

  describe("keeps the look in every state and at every width", () => {
    /** A block's colour at desktop and tablet, at rest and hovered. */
    const look = (document: BlockDocument, library: NamedClass[]) => ({
      desktop: shown(document, library, "color", 1280),
      desktopHover: shown(document, library, "color", 1280, ":hover"),
      tablet: shown(document, library, "color", 800),
      tabletHover: shown(document, library, "color", 800, ":hover"),
    });
    const detached = (
      before: BlockDocument,
      style: NamedClass,
      worn: NamedClass[]
    ) => {
      const plan = planDetachSharedStyle(
        before,
        "a",
        style,
        worn,
        undefined,
        BREAKPOINTS
      );
      if (!plan.ok) throw new Error(plan.reason);
      return applied(before, plan.ops);
    };
    const early = (styles: NodeStyles): NamedClass => ({
      id: "c-early",
      slug: "early",
      orderIndex: 0,
      styles,
    });
    const late = (styles: NodeStyles): NamedClass => ({
      id: "c-late",
      slug: "late",
      orderIndex: 1,
      styles,
    });

    it("keeps a later style's hover over the detached style's base", () => {
      // The block's own rules come after every style's, and a state's rule
      // is weightless, so a base value copied onto the block would beat the
      // later style's hover while hovered.
      const styleA = early({ base: { base: { color: "#aa0000" } } });
      const styleB = late({ hover: { base: { color: "#0000aa" } } });
      const before = page({ classes: ["c-early", "c-late"] });
      const was = look(before, [styleA, styleB]);
      // The population first: the two styles really do differ by state.
      expect(was).toEqual({
        desktop: "#aa0000",
        desktopHover: "#0000aa",
        tablet: "#aa0000",
        tabletHover: "#0000aa",
      });
      expect(
        look(detached(before, styleA, [styleA, styleB]), [styleB])
      ).toEqual(was);
    });

    it("keeps the block's own tablet value over a later style's hover", () => {
      const styleA = early({ base: { base: { color: "#aa0000" } } });
      const styleB = late({ hover: { base: { color: "#0000aa" } } });
      const before = page({
        classes: ["c-early", "c-late"],
        styles: { base: { md: { color: "#00aa00" } } },
      });
      const was = look(before, [styleA, styleB]);
      expect(was.tabletHover).toBe("#00aa00");
      expect(was.desktopHover).toBe("#0000aa");
      expect(
        look(detached(before, styleA, [styleA, styleB]), [styleB])
      ).toEqual(was);
    });

    it("keeps the block's own wider value over a later style's narrower one", () => {
      const styleA = early({ base: { base: { color: "#aa0000" } } });
      const styleB = late({ base: { md: { color: "#0000aa" } } });
      const before = page({
        classes: ["c-early", "c-late"],
        styles: { base: { base: { color: "#00aa00" } } },
      });
      const was = look(before, [styleA, styleB]);
      // The block's own value wins at every width, the later style's tablet
      // value included.
      expect(was.tablet).toBe("#00aa00");
      expect(
        look(detached(before, styleA, [styleA, styleB]), [styleB])
      ).toEqual(was);
    });

    it("keeps a later style's container value over the detached style's viewport one", () => {
      // The browser applies both axes at once: a tablet-wide page with the
      // block in a small container shows the later style's container value,
      // and a viewport value copied onto the block would beat it there.
      const set: BreakpointSet = {
        viewport: [
          { id: "base", label: "Base" },
          { id: "md", label: "Medium", maxWidth: 900 },
        ],
        container: [{ id: "cq-sm", label: "Small", maxWidth: 400 }],
      };
      const styleA = early({ base: { md: { color: "#aa0000" } } });
      const styleB = late({ base: { "cq-sm": { color: "#0000aa" } } });
      const before = page({ classes: ["c-early", "c-late"] });
      const everywhere = (document: BlockDocument, library: NamedClass[]) =>
        [1280, 800].flatMap(width =>
          [undefined, 300, 600].map(container =>
            shown(document, library, "color", width, undefined, {
              breakpoints: set,
              container,
            })
          )
        );
      const was = everywhere(before, [styleA, styleB]);
      // The population first: the small container shows the later style.
      // Desktop: no container, a small one, a wide one; then tablet.
      expect(was).toEqual([
        undefined,
        "#0000aa",
        undefined,
        "#aa0000",
        "#0000aa",
        "#aa0000",
      ]);
      const plan = planDetachSharedStyle(
        before,
        "a",
        styleA,
        [styleA, styleB],
        undefined,
        set
      );
      if (!plan.ok) throw new Error(plan.reason);
      expect(everywhere(applied(before, plan.ops), [styleB])).toEqual(was);
    });

    it("refuses, leaving the style worn, a look the block's own rules can't hold", () => {
      // The detached style's small-container value shows only where the
      // later style's tablet value does not: "small container and not
      // tablet" is a combined query the block's own rules have no way to say.
      const set: BreakpointSet = {
        viewport: [
          { id: "base", label: "Base" },
          { id: "md", label: "Medium", maxWidth: 900 },
        ],
        container: [{ id: "cq-sm", label: "Small", maxWidth: 400 }],
      };
      const styleA = early({ base: { "cq-sm": { color: "#aaaa00" } } });
      const styleB = late({ base: { md: { color: "#0000aa" } } });
      const before = page({ classes: ["c-early", "c-late"] });
      expect(
        planDetachSharedStyle(
          before,
          "a",
          styleA,
          [styleA, styleB],
          undefined,
          set
        )
      ).toEqual({ ok: false, reason: DETACH_LOOK_NOT_KEPT });
    });

    it("keeps the look for any mix of styles, states and widths", () => {
      // Seeded, so a failure names a case that can be run again.
      // mulberry32: 32-bit integer steps, so no bits are lost to floats.
      let seed = 7;
      const next = (n: number): number => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) % n;
      };
      const states = ["base", "hover", "focus", "active"] as const;
      const pseudos = [undefined, ":hover", ":focus-visible", ":active"];
      const colours = ["#aa0000", "#00aa00", "#0000aa", "#aaaa00"];
      const anEnvelope = (): NodeStyles => {
        let styles: NodeStyles = {};
        for (let count = next(4); count > 0; count -= 1) {
          const state = states[next(4)] ?? "base";
          const breakpoint = next(2) === 0 ? "base" : "md";
          const values =
            next(2) === 0
              ? { color: colours[next(4)] }
              : {
                  padding: {
                    [next(2) === 0 ? "blockStart" : "inlineStart"]:
                      `${next(4) * 8}px`,
                  },
                };
          styles = overlaidStyles(styles, {
            [state]: { [breakpoint]: values },
          } as NodeStyles);
        }
        return styles;
      };
      const everyLook = (document: BlockDocument, library: NamedClass[]) =>
        pseudos.flatMap(pseudo =>
          [1280, 800].flatMap(width =>
            ["color", "padding-block-start", "padding-inline-start"].map(
              property => shown(document, library, property, width, pseudo)
            )
          )
        );
      for (let run = 0; run < 150; run += 1) {
        const worn: NamedClass[] = Array.from(
          { length: 2 + next(2) },
          (_, index) => ({
            id: `c-${index}`,
            slug: `s${index}`,
            orderIndex: index,
            styles: anEnvelope(),
          })
        );
        const before = page({
          classes: worn.map(row => row.id),
          styles: anEnvelope(),
        });
        const style = worn[next(worn.length)] as NamedClass;
        const rest = worn.filter(row => row.id !== style.id);
        expect({
          run,
          look: everyLook(detached(before, style, worn), rest),
        }).toEqual({ run, look: everyLook(before, worn) });
      }
    });

    it("keeps the detached style's hover over an earlier style's", () => {
      const styleA = early({ hover: { base: { color: "#aa0000" } } });
      const styleB = late({
        base: { base: { color: "#111111" } },
        hover: { md: { color: "#0000aa" } },
      });
      const before = page({ classes: ["c-early", "c-late"] });
      const was = look(before, [styleA, styleB]);
      expect(
        look(detached(before, styleB, [styleA, styleB]), [styleA])
      ).toEqual(was);
    });
  });

  it("refuses on a block whose design is locked", () => {
    expect(
      planDetachSharedStyle(
        page({ classes: ["c-card"], locked: true }),
        "a",
        card,
        [card]
      ).ok
    ).toBe(false);
  });

  it("takes one style off and leaves the rest", () => {
    expect(
      planRemoveSharedStyle(
        page({ classes: ["x", "c-card", "y"] }),
        "a",
        "c-card"
      )
    ).toEqual({
      ok: true,
      ops: [{ kind: "update", id: "a", patch: { classes: ["x", "y"] } }],
    });
  });

  it("overlays token references as values, not as records to merge", () => {
    expect(
      overlaidStyles(
        { base: { base: { color: { $token: "a" } } } },
        { base: { base: { color: { $token: "b" } } } }
      )
    ).toEqual({ base: { base: { color: { $token: "b" } } } });
  });
});

describe("Move to", () => {
  const address = {
    state: "base" as const,
    breakpoint: "base",
    property: "color",
    path: [],
  };

  it("writes the block's value into the style and clears it from the block", () => {
    const plan = planMoveToSharedStyle(
      {
        id: "a",
        styles: { base: { base: { color: "#000001", margin: "4px" } } },
      },
      card,
      address
    );
    if (!plan.ok) throw new Error(plan.reason);
    // A change applied to the style as it is when stored, so an edit stored
    // in the meantime is kept.
    expect(
      plan.change({ base: { base: { color: "#445566", opacity: 0.5 } } })
    ).toEqual({
      kind: "write",
      styles: { base: { base: { color: "#000001", opacity: 0.5 } } },
    });
    // The block's half, built from the block as it stands when the style
    // has the value: an edit made meanwhile (padding) is kept.
    expect(
      moveToSharedStyleClear(
        {
          id: "a",
          styles: {
            base: { base: { color: "#000001", margin: "4px", padding: "2px" } },
          },
        },
        address,
        "#000001"
      )
    ).toEqual([
      {
        kind: "update",
        id: "a",
        patch: {
          styles: { base: { base: { margin: "4px", padding: "2px" } } },
        },
      },
    ]);
  });

  it("knows its own inverse: the address's previous value, or cleared", () => {
    const change = sharedStyleChange(address, "#000001");
    const before = { base: { base: { color: "#445566", opacity: 0.5 } } };
    // Applied later to a style that has since gained a value elsewhere, the
    // inverse puts back only this address.
    const now = { base: { base: { color: "#000001", opacity: 0.9 } } };
    expect(change.invert(before)(now)).toEqual({
      kind: "write",
      styles: { base: { base: { color: "#445566", opacity: 0.9 } } },
    });
    expect(change.invert({})(now)).toEqual({
      kind: "write",
      styles: { base: { base: { opacity: 0.9 } } },
    });
  });

  it("refuses when the block sets nothing there", () => {
    expect(
      planMoveToSharedStyle({ id: "a", styles: {} }, card, address).ok
    ).toBe(false);
  });

  it("refuses a value the style may not hold, through the block's own rule", () => {
    const write = sharedStyleWrite(card.styles, address, "url(javascript:x)");
    expect(write.kind).toBe("refused");
  });
});
