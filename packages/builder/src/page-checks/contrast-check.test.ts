/**
 * The contrast check: text whose colour against its background is below
 * WCAG AA (4.5:1, or 3:1 for a heading), where both colours are known, in
 * light mode and, where the site's colours differ there, in dark mode. Text
 * over an image or a gradient is skipped and said to be. Called over stored
 * documents with no DOM.
 */
import type {
  AnyBlockDefinition,
  BlockDocument,
  BlockNode,
  NamedClass,
  SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { CONTRAST_CHECK } from "./contrast-check";
import { runPageChecks } from "./page-checks";

/** A site whose text and background swap in dark mode. */
const TOKENS: SiteTokenSet = {
  tokens: [
    {
      name: "color.text",
      kind: "color",
      values: { light: "#111827", dark: "#f9fafb" },
    },
    {
      name: "color.background",
      kind: "color",
      values: { light: "#ffffff", dark: "#111827" },
    },
    { name: "color.muted", kind: "color", values: { light: "#6b7280" } },
  ],
} as SiteTokenSet;

/** A site with no dark values: one mode to judge. */
const LIGHT_ONLY: SiteTokenSet = {
  tokens: [
    { name: "color.text", kind: "color", values: { light: "#111827" } },
    { name: "color.background", kind: "color", values: { light: "#ffffff" } },
  ],
} as SiteTokenSet;

function block(
  id: string,
  type: string,
  base: Record<string, unknown> | undefined,
  children?: BlockNode[],
  extra: Partial<BlockNode> = {}
): BlockNode {
  return {
    id,
    type,
    version: 1,
    props:
      type === "core/heading"
        ? { text: "Title", level: "h2" }
        : { text: "Words" },
    ...(base === undefined ? {} : { styles: { base: { base: base } } }),
    ...(children === undefined ? {} : { slots: { children } }),
    ...extra,
  } as BlockNode;
}

const text = (id: string, base?: Record<string, unknown>, extra = {}) =>
  block(id, "core/text", base, undefined, extra);

function findings(
  nodes: BlockNode[],
  tokens: SiteTokenSet | undefined = LIGHT_ONLY
) {
  const document: BlockDocument = { formatVersion: 1, kind: "page", nodes };
  return runPageChecks(
    { document, ...(tokens === undefined ? {} : { tokens }) },
    [CONTRAST_CHECK]
  ).findings;
}

describe("the contrast check", () => {
  it("passes dark text on the site's background, and leaves the site's own pair alone", () => {
    expect(findings([text("a", { color: "#1f2937" }), text("b")])).toEqual([]);
  });

  it("flags light grey text on the site's white background, with the ratio", () => {
    expect(findings([text("a", { color: "#e5e7eb" })])).toEqual([
      expect.objectContaining({
        group: "accessibility",
        nodeId: "a",
        what: "Text contrast is too low: 1.2:1",
        fix: { tab: "style", id: "color" },
      }),
    ]);
  });

  it("judges text against the background of the container it sits in", () => {
    expect(
      findings([
        block("box", "core/box", { backgroundColor: "#1f2937" }, [
          text("a", { color: "#374151" }),
        ]),
      ])
    ).toEqual([
      expect.objectContaining({
        nodeId: "a",
        what: "Text contrast is too low: 1.4:1",
      }),
    ]);
  });

  it("holds a heading to the large text threshold, 3:1", () => {
    // About 4.8:1 on white, then about 3.5:1: body text fails at 4.5, a heading passes.
    expect(
      findings([block("h", "core/heading", { color: "#757575" })])
    ).toEqual([]);
    expect(findings([text("t", { color: "#8a8a8a" })])).toHaveLength(1);
    expect(
      findings([block("h", "core/heading", { color: "#8a8a8a" })])
    ).toEqual([]);
  });

  it("flags a colour that only fails in dark mode, saying so", () => {
    // Muted grey has no dark value: on the dark background it fails.
    expect(
      findings([text("a", { color: { $token: "color.muted" } })], TOKENS)
    ).toEqual([
      expect.objectContaining({
        nodeId: "a",
        what: "Text contrast is too low in dark mode: 3.7:1",
      }),
    ]);
  });

  it("says one item for both modes when both fail", () => {
    // Grey on a pale surface, and on its darker dark value: both fail.
    const both = findings(
      [
        text("b", {
          color: "#9ca3af",
          backgroundColor: { $token: "color.surface" },
        }),
      ],
      {
        tokens: [
          ...LIGHT_ONLY.tokens,
          {
            name: "color.surface",
            kind: "color",
            values: { light: "#e5e7eb", dark: "#6b7280" },
          },
        ],
      } as SiteTokenSet
    );
    expect(both).toHaveLength(1);
    expect(both[0]?.what).toMatch(
      /^Text contrast is too low: \d\.\d:1 \(\d\.\d:1 in dark mode\)$/
    );
  });

  it("skips text over a background image or gradient, and says it was skipped", () => {
    expect(
      findings([
        block("hero", "core/section", { background: { image: "/hero.jpg" } }, [
          text("a", { color: "#ffffff" }),
        ]),
        text("b", {
          color: "#111827",
          backgroundGradient: "linear-gradient(red, blue)",
        }),
      ])
    ).toEqual([
      expect.objectContaining({
        nodeId: "a",
        what: "Contrast not checked: text over an image or gradient",
      }),
      expect.objectContaining({
        nodeId: "b",
        what: "Contrast not checked: text over an image or gradient",
      }),
    ]);
  });

  it("skips text under a container's opacity, which changes both colours", () => {
    expect(
      findings([
        block("box", "core/box", { opacity: 0.5 }, [
          text("a", { color: "#e5e7eb" }),
        ]),
      ])
    ).toEqual([
      expect.objectContaining({
        what: "Contrast not checked: text over an image or gradient",
      }),
    ]);
  });

  it("reads a block type's own colours under the block's, as a Button's blue", () => {
    const button = {
      name: "core/button",
      version: 1,
      editor: { label: "Button" },
      props: {},
      baseStyles: {
        base: { base: { backgroundColor: "#1d4ed8", color: "#ffffff" } },
      },
      render: () => null,
    } as unknown as AnyBlockDefinition;
    const run = (base: Record<string, unknown>) =>
      runPageChecks(
        {
          document: {
            formatVersion: 1,
            kind: "page",
            nodes: [block("b", "core/button", base)],
          },
          blocks: type => (type === "core/button" ? button : undefined),
          tokens: LIGHT_ONLY,
        },
        [CONTRAST_CHECK]
      ).findings;
    // White text the author chose, on the Button's own blue: it reads.
    expect(run({ color: "#ffffff" })).toEqual([]);
    // A pale background the author chose, under the Button's white text.
    expect(run({ backgroundColor: "#e5e7eb" })).toHaveLength(1);
  });

  it("reads the site's edit of a block type's look over the type's own", () => {
    const button = {
      name: "core/button",
      version: 1,
      editor: { label: "Button" },
      props: {},
      baseStyles: { base: { base: { backgroundColor: "#1d4ed8" } } },
      render: () => null,
    } as unknown as AnyBlockDefinition;
    // The site made its Buttons white.
    const whiteButtons = {
      id: "look:core/button:white",
      slug: "button-white",
      orderIndex: 0,
      blockType: "core/button",
      isDefault: true,
      styles: { base: { base: { backgroundColor: "#ffffff" } } },
    } as unknown as NamedClass;
    const found = runPageChecks(
      {
        document: {
          formatVersion: 1,
          kind: "page",
          nodes: [block("b", "core/button", { color: "#000000" })],
        },
        blocks: type => (type === "core/button" ? button : undefined),
        tokens: LIGHT_ONLY,
        namedClasses: [whiteButtons],
      },
      [CONTRAST_CHECK]
    ).findings;
    // Black on the site's white, 21:1, not black on the type's blue.
    expect(found).toEqual([]);
  });

  it("judges no rich text whose runs carry colours of their own", () => {
    const passage = (style: string | undefined) => ({
      ...block("r", "core/rich-text", { color: "#e5e7eb" }),
      props: {
        content: {
          root: {
            type: "root",
            children: [
              {
                type: "paragraph",
                children: [
                  {
                    type: "text",
                    text: "Dark words",
                    ...(style === undefined ? {} : { style }),
                  },
                ],
              },
            ],
          },
        },
      },
    });
    expect(findings([passage("color: #111111")])).toEqual([]);
    // The control: runs with no colour of their own are the block's colour.
    expect(findings([passage(undefined)])).toHaveLength(1);
  });

  it("holds a heading to 3:1 only where it is large: level 1 or 2, or a size of 24px", () => {
    const sized = (level: string, base: Record<string, unknown>) => ({
      ...block("h", "core/heading", base),
      props: { text: "Title", level },
    });
    // About 3.5:1 on white: large text passes, body-sized text fails.
    expect(findings([sized("h2", { color: "#8a8a8a" })])).toEqual([]);
    expect(findings([sized("h3", { color: "#8a8a8a" })])).toHaveLength(1);
    expect(
      findings([sized("h1", { color: "#8a8a8a", fontSize: "16px" })])
    ).toHaveLength(1);
    expect(
      findings([sized("h4", { color: "#8a8a8a", fontSize: "2rem" })])
    ).toEqual([]);
  });

  it("measures text with an opaque background of its own over an image", () => {
    expect(
      findings([
        block(
          "hero",
          "core/section",
          { backgroundGradient: "linear-gradient(red, blue)" },
          [text("a", { color: "#111111", backgroundColor: "#000000" })]
        ),
      ])
    ).toEqual([
      expect.objectContaining({
        nodeId: "a",
        what: "Text contrast is too low: 1.1:1",
      }),
    ]);
  });

  it("judges no text block with no words", () => {
    const empty = { ...text("a", { color: "#e5e7eb" }), props: { text: "" } };
    expect(findings([empty])).toEqual([]);
    // A Heading's level is not words.
    const untitled = {
      ...block("h", "core/heading", { color: "#e5e7eb" }),
      props: { text: "", level: "h3" },
    };
    expect(findings([untitled])).toEqual([]);
  });

  it("skips text under a gradient its type's own look paints", () => {
    const panel = {
      name: "acme/panel",
      version: 1,
      editor: { label: "Panel" },
      props: {},
      baseStyles: {
        base: { base: { backgroundGradient: "linear-gradient(#000, #000)" } },
      },
      render: () => null,
    } as unknown as AnyBlockDefinition;
    const found = runPageChecks(
      {
        document: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            block("p", "acme/panel", undefined, [
              text("a", { color: "#ffffff" }),
            ]),
          ],
        },
        blocks: type => (type === "acme/panel" ? panel : undefined),
        tokens: LIGHT_ONLY,
      },
      [CONTRAST_CHECK]
    ).findings;
    expect(found).toEqual([
      expect.objectContaining({
        nodeId: "a",
        what: "Contrast not checked: text over an image or gradient",
      }),
    ]);
  });

  it("judges a List by its items, and no block styled by the site's own CSS classes", () => {
    const list = {
      ...block("l", "core/list", { color: "#e5e7eb" }),
      props: { kind: "unordered", items: ["First", "Second"] },
    };
    expect(findings([list])).toHaveLength(1);
    expect(findings([{ ...list, props: { items: [] } }])).toEqual([]);
    expect(
      findings([
        { ...text("a", { color: "#ffffff" }), cssClasses: "dark-surface" },
      ])
    ).toEqual([]);
  });

  it("judges a pair in dark mode where only dark mode can measure it", () => {
    // A variable with a dark value only resolves in dark mode here.
    const darkOnly = {
      tokens: [
        ...LIGHT_ONLY.tokens,
        {
          name: "color.night",
          kind: "color",
          values: { light: "var(--brand-night)", dark: "#1f2937" },
        },
      ],
    } as SiteTokenSet;
    const found = findings(
      [
        text("a", {
          color: "#374151",
          backgroundColor: { $token: "color.night" },
        }),
      ],
      darkOnly
    );
    expect(found).toEqual([
      expect.objectContaining({
        what: expect.stringMatching(/in dark mode/) as unknown,
      }),
    ]);
  });

  it("judges nothing whose colours come from a shared style", () => {
    expect(
      findings([text("a", { color: "#e5e7eb" }, { classes: ["c-1"] })])
    ).toEqual([]);
  });

  it("judges nothing it can't resolve, such as a variable the site lacks", () => {
    expect(
      findings([text("a", { color: { $token: "color.missing" } })])
    ).toEqual([]);
  });

  it("judges only pairs it can read where the caller gives no site variables", () => {
    // No tokens at all, not the helper's default site.
    const run = (base: Record<string, unknown>) =>
      runPageChecks(
        {
          document: {
            formatVersion: 1,
            kind: "page",
            nodes: [text("a", base)],
          },
        },
        [CONTRAST_CHECK]
      ).findings;
    // Grey on the site's background: the background isn't known, so not judged.
    expect(run({ color: "#e5e7eb" })).toEqual([]);
    // Both colours the block's own: judged.
    expect(run({ color: "#e5e7eb", backgroundColor: "#ffffff" })).toHaveLength(
      1
    );
  });

  it("judges only blocks that draw text", () => {
    expect(
      findings([block("d", "core/divider", { color: "#ffffff" })])
    ).toEqual([]);
  });
});
