import type { NamedClass, NodeStyles } from "@nextlyhq/blocks-engine";
import { defaultSiteTokens, textStylesOf } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { checkStoredClasses } from "./site-style-record";
import { resolveSiteStyle } from "./site-style";

/** A text style holding these values at the widest breakpoint, at rest. */
const textStyle = (
  values: Record<string, unknown>,
  id = "t-eyebrow"
): NamedClass => ({
  id,
  slug: id.replace(/^t-/, ""),
  label: "Eyebrow",
  orderIndex: 0,
  role: "text",
  styles: { base: { base: values } } as unknown as NodeStyles,
});

const EYEBROW = textStyle({
  fontSize: "12px",
  lineHeight: 1.4,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
});

describe("text styles in the stored site style", () => {
  it("are accepted holding typography only", () => {
    const { value, issues } = checkStoredClasses([EYEBROW]);
    expect(issues).toEqual([]);
    expect(value).toEqual([EYEBROW]);
  });

  it("are refused holding anything else, naming what is not typography", () => {
    const { issues } = checkStoredClasses([
      textStyle({ fontSize: "12px", color: "red", paddingTop: "4px" }),
    ]);
    expect(issues).toEqual([
      'classes[0] is a text style, which holds typography only: "color" and "paddingTop" are not typography.',
    ]);
  });

  it("refuse a role other than a text style's, and a text style bound to a block", () => {
    const { issues } = checkStoredClasses([
      { ...EYEBROW, role: "colour" },
      { ...EYEBROW, id: "t-two", slug: "two", blockType: "core/button" },
    ]);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatch(/^classes\[0\] has the role "colour"/);
    expect(issues[1]).toMatch(
      /^classes\[1\] is a text style, which no block type owns/
    );
  });

  it("start empty: a site that states none has no text styles", () => {
    expect(
      textStylesOf(resolveSiteStyle(undefined, undefined).classes)
    ).toEqual([]);
    expect(textStylesOf(undefined)).toEqual([]);
  });

  it("list in the order they override one another, and leave out a block style and a shared style", () => {
    const display = {
      ...textStyle({ fontSize: "56px" }, "t-display"),
      orderIndex: 2,
    };
    const card: NamedClass = {
      id: "c-card",
      slug: "card",
      orderIndex: 0,
      styles: { base: { base: { color: "blue" } } } as unknown as NodeStyles,
    };
    expect(
      textStylesOf([display, card, { ...EYEBROW, orderIndex: 1 }]).map(
        cls => cls.id
      )
    ).toEqual(["t-eyebrow", "t-display"]);
  });

  it("keep every variable one value per mode: a text style is never a variable", () => {
    const tokens = { tokens: defaultSiteTokens() };
    const site = resolveSiteStyle(undefined, {
      tokens,
      classes: [textStyle({ fontSize: { $token: "font-size.h1" } })],
    });
    // Making a text style changes no variable, and adds none.
    expect(site.tokens).toEqual(resolveSiteStyle(undefined, { tokens }).tokens);
    const held = site.tokens?.tokens ?? [];
    expect(held.length).toBeGreaterThan(0);
    for (const token of held) {
      expect(
        Object.keys(token.values).every(
          mode => mode === "light" || mode === "dark"
        )
      ).toBe(true);
      expect(
        Object.values(token.values).every(value => typeof value === "string")
      ).toBe(true);
    }
  });
});
