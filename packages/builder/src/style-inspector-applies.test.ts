/**
 * Which Style tab rows show, judged by what the block is: its own
 * arrangement, its parent's, and what it renders.
 *
 * Each case builds the page the way the canvas reads it, a compiled cascade
 * and a subject naming the element drawn, so the answer comes from the same
 * reading the panel makes. The cases without a cascade are the other half:
 * what cannot be read is treated as applying.
 *
 * @module style-inspector-applies.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
  type StyleTraceEntry,
} from "@nextlyhq/blocks-engine";
import { afterEach, describe, expect, it } from "vitest";

import { inspectStyle, type StyleInspectionOptions } from "./style-inspector";

afterEach(() => {
  clearBlocks();
});

function register(): void {
  registerBlocks(
    [
      {
        name: "acme/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        supports: { layout: true, dimensions: true, position: true },
        render: () => null,
      },
    ] as never,
    { source: "style-inspector-applies-test" }
  );
}

/** A box holding a box, so the inner one has a parent to be judged by. */
function nested(
  kind: BlockDocument["kind"] = "page",
  styles: { outer?: NodeStyles; inner?: NodeStyles } = {}
): BlockDocument {
  return {
    formatVersion: 1,
    kind,
    nodes: [
      {
        id: "outer",
        type: "acme/box",
        version: 1,
        props: {},
        styles: styles.outer,
        slots: {
          main: [
            {
              id: "inner",
              type: "acme/box",
              version: 1,
              props: {},
              styles: styles.inner,
            },
          ],
        },
      },
    ] as BlockNode[],
  } as BlockDocument;
}

/** A declaration the compiler wrote for one node's own values. */
function own(id: string, property: string, value: string): StyleTraceEntry {
  return {
    origin: { kind: "node", id },
    property,
    value,
    state: "base",
    breakpoint: BASE_BREAKPOINT,
  } as StyleTraceEntry;
}

/** The canvas's reading of a node: the cascade, and the element it draws. */
function read(
  id: "outer" | "inner",
  trace: readonly StyleTraceEntry[],
  tag = "div"
): NonNullable<StyleInspectionOptions["cascade"]> {
  return {
    trace,
    subject:
      id === "outer"
        ? { nodeId: "outer", blockType: "acme/box", tag, ancestors: [] }
        : {
            nodeId: "inner",
            blockType: "acme/box",
            tag,
            ancestors: [{ nodeId: "outer", blockType: "acme/box" }],
          },
  };
}

/** The rows of one section that show without being asked for. */
function shown(
  document: BlockDocument,
  id: string,
  section: string,
  options?: StyleInspectionOptions
): string[] {
  return (
    inspectStyle(document, id, options)
      ?.sections.find(entry => entry.key === section)
      ?.properties.filter(row => row.common)
      .map(row => row.property) ?? []
  );
}

/**
 * A block's Size rows shown, then the rows of "Inside its parent" that apply:
 * a child's share of a Row or a Grid is drawn there as Fill / Fit / Fixed,
 * its CSS rows behind More, so what decides them is whether they apply.
 */
function sizeAndChild(
  document: BlockDocument,
  id: string,
  options?: StyleInspectionOptions
): string[] {
  const inspected = inspectStyle(document, id, options)?.sections;
  const size =
    inspected
      ?.find(entry => entry.key === "size")
      ?.properties.filter(row => row.common)
      .map(row => row.property) ?? [];
  const child =
    inspected
      ?.find(entry => entry.key === "inside-parent")
      ?.properties.filter(row => row.applies)
      .map(row => row.property) ?? [];
  return [...size, ...child];
}

// A box's Size rows: its aspect ratio waits behind More, as on any block that
// draws no replaced element.
const SIZE = ["width", "height", "minWidth", "maxWidth"];

describe("a container's own rows", () => {
  it("shows a Stack (block flow) only what a block box uses", () => {
    register();
    expect(
      shown(nested(), "outer", "layout", { cascade: read("outer", []) })
    ).toEqual(["display"]);
  });

  it("shows a Row its flex rows and no grid ones", () => {
    register();
    const cascade = read("outer", [own("outer", "display", "flex")]);
    expect(shown(nested(), "outer", "layout", { cascade })).toEqual([
      "display",
      "flexDirection",
      "justifyContent",
      "alignItems",
      "gap",
      "flexWrap",
    ]);
  });

  it("shows a Grid its grid rows and no flex-only ones", () => {
    register();
    const cascade = read("outer", [own("outer", "display", "grid")]);
    expect(shown(nested(), "outer", "layout", { cascade })).toEqual([
      "display",
      "justifyContent",
      "alignItems",
      "gap",
      "gridTemplateColumns",
      "gridTemplateRows",
    ]);
  });

  it("marks what does not apply, rather than dropping it", () => {
    // "+ More" and the picker that replaces it read the same answer.
    register();
    const rows =
      inspectStyle(nested(), "outer", {
        cascade: read("outer", []),
      })?.sections.find(entry => entry.key === "layout")?.properties ?? [];
    const answer = Object.fromEntries(
      rows.map(row => [row.property, row.applies])
    );
    expect(answer).toMatchObject({
      display: true,
      flexDirection: false,
      gridTemplateColumns: false,
      // A Stack is a block container: with a set height its content moves.
      alignContent: true,
      justifyItems: false,
      gridAutoFlow: false,
    });
  });
});

describe("a child's rows, by its parent's arrangement", () => {
  it("gives a Stack's child no Row or Grid sizing", () => {
    register();
    expect(
      sizeAndChild(nested(), "inner", { cascade: read("inner", []) })
    ).toEqual(SIZE);
  });

  it("gives a Row's child grow, shrink, basis, align self and order", () => {
    register();
    const cascade = read("inner", [own("outer", "display", "flex")]);
    expect(sizeAndChild(nested(), "inner", { cascade })).toEqual([
      ...SIZE,
      "flexGrow",
      "flexShrink",
      "flexBasis",
      "alignSelf",
      "order",
    ]);
  });

  it("gives a Grid's child align self, justify self and order", () => {
    register();
    const cascade = read("inner", [own("outer", "display", "inline-grid")]);
    expect(sizeAndChild(nested(), "inner", { cascade })).toEqual([
      ...SIZE,
      "alignSelf",
      "justifySelf",
      "order",
    ]);
  });

  it("looks past a parent that draws no box of its own", () => {
    // A `display: contents` parent hands its children to its own parent.
    register();
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "row",
          type: "acme/box",
          version: 1,
          props: {},
          slots: {
            main: [
              {
                id: "wrapper",
                type: "acme/box",
                version: 1,
                props: {},
                slots: {
                  main: [
                    { id: "leaf", type: "acme/box", version: 1, props: {} },
                  ],
                },
              },
            ],
          },
        },
      ],
    } as unknown as BlockDocument;
    const subject = {
      nodeId: "leaf",
      blockType: "acme/box",
      tag: "div",
      ancestors: [
        { nodeId: "row", blockType: "acme/box" },
        { nodeId: "wrapper", blockType: "acme/box" },
      ],
    };
    const through = (wrapper: string) =>
      sizeAndChild(document, "leaf", {
        cascade: {
          trace: [
            own("row", "display", "flex"),
            own("wrapper", "display", wrapper),
          ],
          subject,
        },
      });
    expect(through("contents")).toContain("flexGrow");
    // The control: a wrapper that draws a block box is the parent.
    expect(through("block")).not.toContain("flexGrow");
  });

  it("reads the parent's stored display where there is no cascade", () => {
    register();
    // The child's own keywords are stored too, so only the parent decides.
    const inner = {
      base: { [BASE_BREAKPOINT]: { display: "block", flexWrap: "nowrap" } },
    } as NodeStyles;
    const flexParent = nested("page", {
      outer: { base: { [BASE_BREAKPOINT]: { display: "flex" } } } as NodeStyles,
      inner,
    });
    expect(sizeAndChild(flexParent, "inner")).toContain("flexGrow");
    const blockParent = nested("page", {
      outer: {
        base: { [BASE_BREAKPOINT]: { display: "block" } },
      } as NodeStyles,
      inner,
    });
    expect(sizeAndChild(blockParent, "inner")).not.toContain("flexGrow");
  });

  it("knows a page's top-level block sits in the page's flow", () => {
    register();
    expect(
      sizeAndChild(nested(), "outer", { cascade: read("outer", []) })
    ).toEqual(SIZE);
  });

  it("does not take a subject that names no ancestors for a top-level block", () => {
    register();
    const cascade = {
      trace: [],
      subject: { nodeId: "inner", blockType: "acme/box", tag: "div" },
    };
    expect(sizeAndChild(nested(), "inner", { cascade })).toContain("flexGrow");
  });

  it("does not know where a component's top-level block is placed", () => {
    // A component goes wherever an author puts it, a Row included.
    register();
    expect(
      sizeAndChild(nested("component"), "outer", {
        cascade: read("outer", []),
      })
    ).toContain("flexGrow");
  });
});

describe("what the block renders", () => {
  it("shows an image its fit and focal point, and a box neither", () => {
    register();
    const image = sizeAndChild(nested(), "outer", {
      cascade: read("outer", [], "img"),
      media: true,
    });
    expect(image).toEqual([
      "objectFit",
      "objectPosition",
      "width",
      "height",
      "minWidth",
      "maxWidth",
      "aspectRatio",
    ]);
    const box = sizeAndChild(nested(), "outer", {
      cascade: read("outer", []),
      media: false,
    });
    expect(box).not.toContain("objectFit");
    expect(box).not.toContain("objectPosition");
    expect(box).not.toContain("aspectRatio");
  });
});

describe("what cannot be read", () => {
  it("treats every property as applying before the canvas has been read", () => {
    register();
    const rows = (
      inspectStyle(nested(), "inner", { media: false })?.sections ?? []
    ).flatMap(section => section.properties);
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.filter(row => !row.applies).map(row => row.property)).toEqual(
      []
    );
  });
});

describe("a value that no longer applies", () => {
  it("stays a row, marked as not applying, until it is cleared", () => {
    register();
    const document = nested("page", {
      outer: {
        base: { [BASE_BREAKPOINT]: { flexDirection: "column" } },
      } as NodeStyles,
    });
    const row = inspectStyle(document, "outer", {
      cascade: read("outer", []),
    })
      ?.sections.find(entry => entry.key === "layout")
      ?.properties.find(each => each.property === "flexDirection");
    expect(row).toMatchObject({ set: true, applies: false, common: true });
  });
});

describe("where the parent is read from", () => {
  const stored = (values: Record<string, unknown>) =>
    ({ base: { [BASE_BREAKPOINT]: values } }) as unknown as NodeStyles;

  it("does not judge a shared style by the selected block's parent", () => {
    // A shared style or a look reaches blocks in Rows and Stacks alike.
    register();
    const document = nested("page", {
      outer: stored({ display: "block" }),
    });
    expect(sizeAndChild(document, "inner")).not.toContain("flexGrow");
    expect(sizeAndChild(document, "inner", { styles: stored({}) })).toContain(
      "flexGrow"
    );
  });

  it("reads the page's own display for a top-level block", () => {
    register();
    const document = {
      ...nested(),
      settings: { styles: stored({ display: "grid" }) },
    } as BlockDocument;
    expect(
      sizeAndChild(document, "outer", { cascade: read("outer", []) })
    ).toContain("justifySelf");
    expect(sizeAndChild(document, "outer")).toContain("justifySelf");
  });

  it("puts a template's top-level block in the page's flow, and a pattern's nowhere known", () => {
    register();
    const cascade = read("outer", []);
    expect(sizeAndChild(nested("template"), "outer", { cascade })).toEqual(
      SIZE
    );
    expect(sizeAndChild(nested("pattern"), "outer", { cascade })).toContain(
      "flexGrow"
    );
  });

  it("reads the parent in the state the canvas puts it in", () => {
    // Hover and active reach every ancestor on the canvas, so a parent that
    // turns into a Row on hover lays its child out as a Row there. Focus
    // stays on the block, so its parent is read at the base state.
    register();
    const document = nested("page", {
      outer: {
        base: { [BASE_BREAKPOINT]: { display: "block" } },
        hover: { [BASE_BREAKPOINT]: { display: "flex" } },
        active: { [BASE_BREAKPOINT]: { display: "flex" } },
        focus: { [BASE_BREAKPOINT]: { display: "flex" } },
      } as unknown as NodeStyles,
      inner: stored({ display: "block", flexWrap: "nowrap" }),
    });
    const at = (state: "base" | "hover" | "active" | "focus") =>
      sizeAndChild(document, "inner", { state });
    expect(at("hover")).toContain("flexGrow");
    expect(at("active")).toContain("flexGrow");
    expect(at("focus")).not.toContain("flexGrow");
    expect(at("base")).not.toContain("flexGrow");
  });

  it("looks past a parent whose contents display is escaped", () => {
    register();
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "row",
          type: "acme/box",
          version: 1,
          props: {},
          styles: stored({ display: "flex" }),
          slots: {
            main: [
              {
                id: "wrapper",
                type: "acme/box",
                version: 1,
                props: {},
                styles: stored({ display: "\\63 ontents" }),
                slots: {
                  main: [
                    { id: "leaf", type: "acme/box", version: 1, props: {} },
                  ],
                },
              },
            ],
          },
        },
      ],
    } as unknown as BlockDocument;
    expect(sizeAndChild(document, "leaf")).toContain("flexGrow");
  });

  it("reads the parent at the edited breakpoint", () => {
    register();
    const breakpoints = {
      viewport: [
        { id: BASE_BREAKPOINT, label: "Desktop" },
        { id: "mobile", label: "Mobile", maxWidth: 640 },
      ],
      container: [],
    } as never;
    const document = nested("page", {
      outer: {
        base: {
          [BASE_BREAKPOINT]: { display: "block" },
          mobile: { display: "flex" },
        },
      } as unknown as NodeStyles,
    });
    const at = (breakpoint: string) =>
      sizeAndChild(document, "inner", {
        breakpoint: breakpoint as never,
        breakpoints,
      });
    expect(at("mobile")).toContain("flexGrow");
    expect(at(BASE_BREAKPOINT)).not.toContain("flexGrow");
  });
});

describe("align content on a box in flow", () => {
  const alignContent = (display: string) =>
    inspectStyle(nested(), "outer", {
      cascade: read("outer", [own("outer", "display", display)]),
    })
      ?.sections.find(entry => entry.key === "layout")
      ?.properties.find(row => row.property === "alignContent")?.applies;

  it("applies on a Stack, a block container", () => {
    register();
    expect(alignContent("block")).toBe(true);
    expect(alignContent("flow-root")).toBe(true);
  });

  it("does not apply on an inline box, which holds no block content", () => {
    register();
    expect(alignContent("inline")).toBe(false);
    expect(alignContent("contents")).toBe(false);
  });
});

describe("a Row's own wrap", () => {
  it("gives align content an effect only once the Row wraps", () => {
    register();
    const alignContent = (wrap: string | undefined) =>
      inspectStyle(nested(), "outer", {
        cascade: read("outer", [
          own("outer", "display", "flex"),
          ...(wrap === undefined ? [] : [own("outer", "flex-wrap", wrap)]),
        ]),
      })
        ?.sections.find(entry => entry.key === "layout")
        ?.properties.find(row => row.property === "alignContent")?.applies;
    expect(alignContent(undefined)).toBe(false);
    expect(alignContent("nowrap")).toBe(false);
    expect(alignContent("wrap")).toBe(true);
  });
});
