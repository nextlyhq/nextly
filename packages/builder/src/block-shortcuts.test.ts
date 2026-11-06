/**
 * The Section and Button shortcuts: what each choice writes, and what each
 * reads back from what a block stores.
 *
 * @module block-shortcuts.test
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  fullWidthOf,
  heightOf,
  planFullWidth,
  planHeight,
  planSize,
  reachingBeneath,
  sizeOf,
} from "./block-shortcuts";
import { applyOp } from "./ops";
import type { StyleProvenance } from "./style-provenance";

const padding = {
  blockStart: { $token: "button.padding-y" },
  blockEnd: { $token: "button.padding-y" },
  inlineStart: { $token: "button.padding-x" },
  inlineEnd: { $token: "button.padding-x" },
};

beforeAll(() => {
  const block = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    version: 1,
    description: name,
    example: { props: {} },
    editor: { label: name },
    props: {},
    render: () => null,
    ...extra,
  });
  registerBlocks(
    [
      block("core/section"),
      block("core/button", { baseStyles: { base: { base: { padding } } } }),
    ] as never,
    { source: "block-shortcuts-test" }
  );
});
afterAll(clearBlocks);

const at = { state: "base", breakpoint: "base" } as const;
const mobile = { state: "base", breakpoint: "sm" } as const;

function node(type: string, styles?: BlockNode["styles"]): BlockNode {
  return {
    id: "n",
    type,
    version: 1,
    props: {},
    ...(styles === undefined ? {} : { styles }),
  };
}

/** The node after the op, through the real store. */
function applied(before: BlockNode, op: ReturnType<typeof planHeight>) {
  if (op === null) return before;
  const document = applyOp(
    {
      formatVersion: 1,
      kind: "page",
      nodes: [before],
    } as unknown as BlockDocument,
    op
  ).document;
  return document.nodes[0] as BlockNode;
}

describe("a Section's height", () => {
  it("is Full screen as min-height 100svh at the edited device, Auto clearing it", () => {
    const section = node("core/section");
    expect(heightOf(section, at)).toBe("auto");
    const tall = applied(section, planHeight(section, "screen", mobile));
    expect(tall.styles).toEqual({ base: { sm: { minHeight: "100svh" } } });
    expect(heightOf(tall, mobile)).toBe("screen");
    // At the base it is still Auto: written where the author edits.
    expect(heightOf(tall, at)).toBe("auto");
    expect(
      applied(tall, planHeight(tall, "auto", mobile)).styles ?? {}
    ).toEqual({});
  });

  it("reads as neither for any other min height", () => {
    expect(
      heightOf(
        node("core/section", { base: { base: { minHeight: "40rem" } } }),
        at
      )
    ).toBeUndefined();
  });
});

describe("a Button's size", () => {
  it("scales the button's own padding tokens, and its text in em", () => {
    const button = node("core/button");
    expect(sizeOf(button, at)).toBe("medium");
    const small = applied(button, planSize(button, "small", at));
    expect(small.styles?.base?.base).toEqual({
      padding: {
        blockStart: { $token: "button.padding-y", times: 0.75 },
        blockEnd: { $token: "button.padding-y", times: 0.75 },
        inlineStart: { $token: "button.padding-x", times: 0.75 },
        inlineEnd: { $token: "button.padding-x", times: 0.75 },
      },
      fontSize: "0.875em",
    });
    expect(sizeOf(small, at)).toBe("small");
    const large = applied(small, planSize(small, "large", at));
    expect(sizeOf(large, at)).toBe("large");
    expect(JSON.stringify(large.styles)).toContain('"times":1.25');
    expect(JSON.stringify(large.styles)).toContain('"fontSize":"1.125em"');
    // Medium clears both, back to the tokens.
    expect(applied(large, planSize(large, "medium", at)).styles ?? {}).toEqual(
      {}
    );
  });

  it("reads a scaled token whatever order its fields were stored in", () => {
    // Keys in JSON carry no meaning: an import may write `times` first.
    const imported = node("core/button", {
      base: {
        base: {
          padding: Object.fromEntries(
            ["blockStart", "blockEnd", "inlineStart", "inlineEnd"].map(side => [
              side,
              {
                times: 0.75,
                $token: side.startsWith("block")
                  ? "button.padding-y"
                  : "button.padding-x",
              },
            ])
          ),
          fontSize: "0.875em",
        },
      },
    } as never);
    expect(sizeOf(imported, at)).toBe("small");
  });

  it("reads as none of the three for padding or text set any other way", () => {
    expect(
      sizeOf(node("core/button", { base: { base: { fontSize: "2rem" } } }), at)
    ).toBeUndefined();
  });
});

describe("a Button's full width", () => {
  it("is width 100% at the edited device, and off clears it", () => {
    const button = node("core/button");
    expect(fullWidthOf(button, mobile)).toBe(false);
    const wide = applied(button, planFullWidth(button, true, mobile));
    expect(wide.styles).toEqual({ base: { sm: { width: "100%" } } });
    expect(fullWidthOf(wide, mobile)).toBe(true);
    expect(
      applied(wide, planFullWidth(wide, false, mobile)).styles ?? {}
    ).toEqual({});
  });
});

describe("a shortcut over a value reaching from a wider device", () => {
  /** What the cascade says reaches the edited address. */
  const reaching =
    (values: Record<string, string>) =>
    (cssProperty: string): string | undefined =>
      values[cssProperty];

  it("shows the preset that reaches, and overrides it with an explicit reset", () => {
    const section = node("core/section");
    const tall = reaching({ "min-height": "100svh" });
    expect(heightOf(section, mobile, tall)).toBe("screen");
    // A clear would leave the wider device's 100svh in force.
    expect(
      applied(section, planHeight(section, "auto", mobile, tall)).styles
    ).toEqual({ base: { sm: { minHeight: "auto" } } });
    // With nothing reaching, Auto still just clears.
    expect(planHeight(section, "auto", mobile)).toBeNull();
  });

  /** Each padding side as a scaled token compiles, under a site's prefix. */
  const scaledSides = (times: number) => ({
    "padding-block-start": `calc(var(--site-button-padding-y) * ${times})`,
    "padding-block-end": `calc(var(--site-button-padding-y) * ${times})`,
    "padding-inline-start": `calc(var(--site-button-padding-x) * ${times})`,
    "padding-inline-end": `calc(var(--site-button-padding-x) * ${times})`,
  });

  it("overrides a reaching inline side alone, which no other side shows", () => {
    const button = node("core/button");
    const inline = reaching({ "padding-inline-start": "2rem" });
    expect(sizeOf(button, mobile, inline)).toBeUndefined();
    const medium = applied(button, planSize(button, "medium", mobile, inline));
    expect(medium.styles?.base?.sm).toEqual({ padding, fontSize: "inherit" });
  });

  it("reads no size where only one side matches it", () => {
    const button = node("core/button");
    const oneSide = reaching({
      "font-size": "0.875em",
      "padding-block-start": "calc(var(--site-button-padding-y) * 0.75)",
      "padding-block-end": "1px",
      "padding-inline-start": "1px",
      "padding-inline-end": "1px",
    });
    expect(sizeOf(button, mobile, oneSide)).toBeUndefined();
    // Each side's own token, not merely its factor.
    const swapped = reaching({
      "font-size": "0.875em",
      ...scaledSides(0.75),
      "padding-inline-end": "calc(var(--site-button-padding-y) * 0.75)",
    });
    expect(sizeOf(button, mobile, swapped)).toBeUndefined();
  });

  it("reads a Small reaching from above, and Medium writes the button's own over it", () => {
    const button = node("core/button");
    const small = reaching({ "font-size": "0.875em", ...scaledSides(0.75) });
    expect(sizeOf(button, mobile, small)).toBe("small");
    const medium = applied(button, planSize(button, "medium", mobile, small));
    expect(medium.styles?.base?.sm).toEqual({ padding, fontSize: "inherit" });
  });

  it("reads Full width reaching from above, and off writes auto over it", () => {
    const button = node("core/button");
    const wide = reaching({ width: "100%" });
    expect(fullWidthOf(button, mobile, wide)).toBe(true);
    expect(
      applied(button, planFullWidth(button, false, mobile, wide)).styles
    ).toEqual({ base: { sm: { width: "auto" } } });
  });
});

describe("what reaches beneath a shortcut set here", () => {
  /** A trace entry, as much of one as the reader looks at. */
  const entry = (value: string) => ({ value }) as never;
  const answers =
    (
      byProperty: Record<
        string,
        { provenance: StyleProvenance; beneath: StyleProvenance }
      >
    ) =>
    (cssProperty: string) =>
      byProperty[cssProperty];

  it("is the value under a local one, so Medium overrides a Large beneath a local Small", () => {
    const button = node("core/button");
    // Small set at Mobile over Large from Desktop: the trace's winner is the
    // local Small, and Large is what a clear would leave in force.
    const large = (value: string) => ({
      provenance: { kind: "authored" as const, entry: entry("local") },
      beneath: {
        kind: "inherited" as const,
        entry: entry(value),
        from: { kind: "node", id: "b" } as never,
      },
    });
    const reaching = reachingBeneath(
      answers({
        "font-size": large("1.125em"),
        "padding-block-start": large(
          "calc(var(--site-button-padding-y) * 1.25)"
        ),
      })
    );
    const medium = applied(
      button,
      planSize(button, "medium", mobile, reaching)
    );
    expect(medium.styles?.base?.sm).toEqual({ padding, fontSize: "inherit" });
  });

  it("is the value reaching while nothing is set here, and none with nothing beneath", () => {
    const reaching = reachingBeneath(
      answers({
        width: {
          provenance: {
            kind: "inherited",
            entry: entry("100%"),
            from: { kind: "node", id: "b" } as never,
          },
          beneath: { kind: "unset" },
        },
        "min-height": {
          provenance: { kind: "authored", entry: entry("100svh") },
          beneath: { kind: "unset" },
        },
      })
    );
    expect(reaching("width")).toBe("100%");
    expect(reaching("min-height")).toBeUndefined();
    expect(reaching("font-size")).toBeUndefined();
  });
});

describe("a reset written over a value from elsewhere, read back", () => {
  it("reads Auto for the min height it wrote over a wider Full screen", () => {
    const section = node("core/section", {
      base: { sm: { minHeight: "auto" } },
    });
    const tall = (cssProperty: string) =>
      cssProperty === "min-height" ? "100svh" : undefined;
    expect(heightOf(section, mobile, tall)).toBe("auto");
  });

  it("reads Medium for the button's own padding and inherited text it wrote", () => {
    const button = node("core/button", {
      base: { sm: { padding, fontSize: "inherit" } },
    });
    expect(sizeOf(button, mobile)).toBe("medium");
  });
});

describe("a scaled token reaching from elsewhere, matched exactly", () => {
  /** Each side as a scaled token compiles under a prefix, for given tokens. */
  const sides = (prefix: string, y: string, x: string, times: number) => ({
    "font-size": "0.875em",
    "padding-block-start": `calc(var(${prefix}${y}) * ${times})`,
    "padding-block-end": `calc(var(${prefix}${y}) * ${times})`,
    "padding-inline-start": `calc(var(${prefix}${x}) * ${times})`,
    "padding-inline-end": `calc(var(${prefix}${x}) * ${times})`,
  });
  const reading =
    (values: Record<string, string>) =>
    (cssProperty: string): string | undefined =>
      values[cssProperty];

  it("reads Small for the button's own tokens under the site's prefix", () => {
    const button = node("core/button");
    const own = sides("--brand-", "button-padding-y", "button-padding-x", 0.75);
    expect(
      sizeOf(button, { ...mobile, tokenPrefix: "--brand-" }, reading(own))
    ).toBe("small");
  });

  it("reads no size for another token whose name ends the same way", () => {
    // `brand.button.padding-y` under `--site-`, not the button's own token.
    const button = node("core/button");
    const other = sides(
      "--site-",
      "brand-button-padding-y",
      "brand-button-padding-x",
      0.75
    );
    expect(
      sizeOf(button, { ...mobile, tokenPrefix: "--site-" }, reading(other))
    ).toBeUndefined();
  });
});
