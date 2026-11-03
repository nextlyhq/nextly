/**
 * A block's shared style: saving its look as one, the compiled class that
 * results, and the edits that move values between the block and its style.
 */
import {
  compilePageCss,
  nodeClassName,
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
  overlaidStyles,
  planDetachSharedStyle,
  planMoveToSharedStyle,
  planRemoveSharedStyle,
  planSaveAsSharedStyle,
  saveAsSharedStyleRefusal,
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
      reason: "“card” is already a shared style. Choose another name.",
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
    expect(plan.ops).toEqual([
      {
        kind: "update",
        id: "a",
        patch: { styles: { base: { base: { margin: "4px" } } } },
      },
    ]);
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
