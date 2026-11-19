/**
 * A Section's padding preset, as the page compile writes it: Compact and Roomy
 * pad the block from their own pair of the site's spacing variables, as a
 * default of that one block, and Normal writes nothing.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode, NodeStyles } from "../document";
import { DEFAULT_LIMITS } from "../limits";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss } from "./compile-page";
import type { StyleCompileContext } from "./compile-page";
import { documentTokenUsage } from "./document-token-usage";
import {
  nodeClassName,
  PAGE_ROOT_CLASS,
  PAGE_ROOT_SELECTOR,
} from "./node-class";
import { PADDING_PRESET_PROP, paddingPresetTokensOf } from "./padding-preset";
import { styleOrigin } from "./style-origin";

/** A Section's own default, as the block library declares it. */
const SECTION_BASE = {
  base: {
    base: {
      padding: {
        blockStart: { $token: "space.section-y" },
        blockEnd: { $token: "space.section-y" },
        inlineStart: { $token: "space.gutter" },
        inlineEnd: { $token: "space.gutter" },
      },
    },
  },
} as unknown as NodeStyles;

const CTX: StyleCompileContext = {
  breakpoints: FIXTURE_BREAKPOINTS,
  blockBases: { "core/section": SECTION_BASE },
};

function page(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

function section(
  id: string,
  props: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
): BlockNode {
  return {
    id,
    type: "core/section",
    version: 1,
    props,
    ...extra,
  } as BlockNode;
}

function compiled(nodes: BlockNode[], ctx: StyleCompileContext = CTX) {
  return compilePageCss(page(nodes), ctx);
}

/**
 * The weightless rule a preset writes for one node, as the compile spells it:
 * each side padding at least the containment inset, as every one is.
 */
function presetRule(id: string, y: string, x: string): string {
  const side = `max(var(--site-${x}), var(--nx-contain-inset, 0px))`;
  return `.${PAGE_ROOT_CLASS} :where(.${nodeClassName(id)}) { padding-block-end: var(--site-${y}); padding-block-start: var(--site-${y}); padding-inline-end: ${side}; padding-inline-start: ${side} }`;
}

describe("a Section's padding preset", () => {
  it("names the prop the builder writes", () => {
    expect(PADDING_PRESET_PROP).toBe("paddingPreset");
  });

  it.each([
    ["compact", "space-section-y-compact", "space-gutter-compact"],
    ["roomy", "space-section-y-roomy", "space-gutter-roomy"],
  ])(
    "pads a %s section from its own pair of variables, as that section's default",
    (preset, y, x) => {
      const { css } = compiled([section("n1", { paddingPreset: preset })]);
      expect(css).toContain(presetRule("n1", y, x));
    }
  );

  it("is written after the type's default, so it takes its place", () => {
    const { css } = compiled([section("n1", { paddingPreset: "roomy" })]);
    const typeDefault = css.indexOf("var(--site-space-section-y)");
    expect(typeDefault).toBeGreaterThanOrEqual(0);
    expect(css.indexOf("var(--site-space-section-y-roomy)")).toBeGreaterThan(
      typeDefault
    );
  });

  it("names its variables under the site's token prefix", () => {
    const { css } = compiled([section("n1", { paddingPreset: "compact" })], {
      ...CTX,
      tokenPrefix: "--brand-",
    });
    expect(css).toContain("var(--brand-space-section-y-compact)");
    expect(css).not.toContain("--site-space-section-y-compact");
  });

  it("is written on that section alone", () => {
    const { css } = compiled([
      section(
        "outer",
        { paddingPreset: "roomy" },
        { slots: { children: [section("inner")] } }
      ),
    ]);
    expect(css).toContain(`:where(.${nodeClassName("outer")})`);
    expect(css).not.toContain(`:where(.${nodeClassName("inner")})`);
  });

  it("writes nothing for Normal, so a stored page's sheet is unchanged byte for byte", () => {
    const stored = compiled([section("n1")]);
    for (const props of [
      { paddingPreset: "normal" },
      { paddingPreset: undefined },
    ]) {
      const result = compiled([section("n1", props)]);
      expect(result.css).toBe(stored.css);
      expect(result.warnings).toEqual([]);
    }
    expect(stored.css).not.toContain(`:where(.${nodeClassName("n1")})`);
  });

  it.each([["huge"], [3], [{ $token: "space.section-y" }]])(
    "writes nothing for %j, and says so",
    value => {
      const { css, warnings } = compiled([
        section("n1", { paddingPreset: value }),
      ]);
      expect(css).not.toContain(`:where(.${nodeClassName("n1")})`);
      expect(warnings).toEqual([
        expect.objectContaining({
          code: "invalid-style-value",
          path: "/nodes/0/props/paddingPreset",
        }),
      ]);
    }
  );

  it("is held out of the sheet with a gated section", () => {
    const gated = section(
      "n1",
      { paddingPreset: "compact" },
      {
        visibility: {
          conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
        },
      }
    );
    const result = compiled([gated]);
    expect(result.css).not.toContain("space-section-y-compact");
    expect(result.gated?.n1).toContain("var(--site-space-section-y-compact)");
  });
});

describe("what a preset section's padding is read as", () => {
  /** The declaration a section shows for one property, every device live. */
  function winner(nodes: BlockNode[], nodeId: string, property: string) {
    const { trace } = compilePageCss(page(nodes), { ...CTX, trace: true });
    expect(trace).toBeDefined();
    return styleOrigin(
      trace ?? [],
      { nodeId, blockType: "core/section" },
      {
        property,
        state: "base",
        breakpoints: FIXTURE_BREAKPOINTS.viewport.map(each => each.id),
      }
    );
  }

  it("is the section's own default, from the preset's variable", () => {
    const found = winner(
      [section("n1", { paddingPreset: "compact" })],
      "n1",
      "padding-block-start"
    );
    expect(found?.origin).toEqual({
      kind: "blockType",
      type: "core/section",
      node: "n1",
    });
    expect(found?.value).toBe("var(--site-space-section-y-compact)");
  });

  it("does not reach another section of the type", () => {
    const found = winner(
      [section("n1", { paddingPreset: "compact" }), section("n2")],
      "n2",
      "padding-block-start"
    );
    expect(found?.origin).toEqual({ kind: "blockType", type: "core/section" });
    expect(found?.value).toBe("var(--site-space-section-y)");
  });

  it("gives way to a side the section sets itself, in the sheet and in the reading", () => {
    const own = section(
      "n1",
      { paddingPreset: "roomy" },
      { styles: { base: { base: { padding: { blockStart: "10px" } } } } }
    );
    const { css } = compiled([own]);
    // The own rule is the heavier selector, so the browser uses it.
    expect(css).toContain(
      `${PAGE_ROOT_SELECTOR} .${nodeClassName("n1")} { padding-block-start: 10px }`
    );
    expect(winner([own], "n1", "padding-block-start")?.origin).toEqual({
      kind: "node",
      id: "n1",
    });
    expect(winner([own], "n1", "padding-block-end")?.value).toBe(
      "var(--site-space-section-y-roomy)"
    );
  });
});

describe("the variables a preset section uses", () => {
  it("are its preset's pair", () => {
    expect(
      paddingPresetTokensOf(section("n1", { paddingPreset: "compact" }))
    ).toEqual(["space.section-y-compact", "space.gutter-compact"]);
    expect(paddingPresetTokensOf(section("n1"))).toEqual([]);
    expect(
      paddingPresetTokensOf(section("n1", { paddingPreset: "x" }))
    ).toEqual([]);
  });

  it("count as used by the page, as a variable its styles name does", () => {
    const usage = documentTokenUsage(
      page([section("n1", { paddingPreset: "roomy" })]),
      DEFAULT_LIMITS
    );
    expect(usage.ids).toEqual(
      expect.arrayContaining(["space.section-y-roomy", "space.gutter-roomy"])
    );
  });
});
