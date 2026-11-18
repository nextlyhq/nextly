/**
 * The contrast check: text whose colour against its background is below
 * WCAG AA (4.5:1, or 3:1 for a heading), where both colours are known, in
 * light mode and, where the site's colours differ there, in dark mode. Text
 * over an image or a gradient is skipped and said to be. Called over stored
 * documents with no DOM.
 */
import type {
  BlockDocument,
  BlockNode,
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
    props: type === "core/heading" ? { text: "Title", level: "h2" } : { text: "Words" },
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
      expect.objectContaining({ nodeId: "a", what: "Text contrast is too low: 1.4:1" }),
    ]);
  });

  it("holds a heading to the large text threshold, 3:1", () => {
    // About 4.8:1 on white, then about 3.5:1: body text fails at 4.5, a heading passes.
    expect(findings([block("h", "core/heading", { color: "#757575" })])).toEqual([]);
    expect(findings([text("t", { color: "#8a8a8a" })])).toHaveLength(1);
    expect(findings([block("h", "core/heading", { color: "#8a8a8a" })])).toEqual([]);
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
      [text("b", { color: "#9ca3af", backgroundColor: { $token: "color.surface" } })],
      {
        tokens: [
          ...LIGHT_ONLY.tokens,
          { name: "color.surface", kind: "color", values: { light: "#e5e7eb", dark: "#6b7280" } },
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
        text("b", { color: "#111827", backgroundGradient: "linear-gradient(red, blue)" }),
      ])
    ).toEqual([
      expect.objectContaining({ nodeId: "a", what: "Contrast not checked: text over an image or gradient" }),
      expect.objectContaining({ nodeId: "b", what: "Contrast not checked: text over an image or gradient" }),
    ]);
  });

  it("skips text under a container's opacity, which changes both colours", () => {
    expect(
      findings([
        block("box", "core/box", { opacity: 0.5 }, [text("a", { color: "#e5e7eb" })]),
      ])
    ).toEqual([
      expect.objectContaining({ what: "Contrast not checked: text over an image or gradient" }),
    ]);
  });

  it("judges nothing whose colours come from a shared style", () => {
    expect(findings([text("a", { color: "#e5e7eb" }, { classes: ["c-1"] })])).toEqual([]);
  });

  it("judges nothing it can't resolve, such as a variable the site lacks", () => {
    expect(findings([text("a", { color: { $token: "color.missing" } })])).toEqual([]);
  });

  it("reads the engine's own text and background where the site sets none", () => {
    expect(findings([text("a", { color: "#e5e7eb" })], undefined)).toHaveLength(1);
  });

  it("judges only blocks that draw text", () => {
    expect(
      findings([block("d", "core/divider", { color: "#ffffff" })])
    ).toEqual([]);
  });
});
