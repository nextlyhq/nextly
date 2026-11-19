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

describe("a text style's fluid sizes in the stored site style", () => {
  /** A text style whose Desktop size was made fluid from these sizes. */
  const fluid = (sizes: unknown, extra: Record<string, unknown> = {}) =>
    ({
      ...textStyle({ fontSize: "clamp(1rem, 0.6087rem + 1.7391vw, 2rem)" }),
      fluidSizes: { base: sizes },
      ...extra,
    }) as unknown as NamedClass;

  it("are admitted and kept as stored", () => {
    const stored = fluid({ small: 16, large: 32 });
    const { value, issues } = checkStoredClasses([stored]);
    expect(issues).toEqual([]);
    expect(value).toEqual([stored]);
    expect(value?.[0]?.fluidSizes).toEqual({ base: { small: 16, large: 32 } });
  });

  it("may shrink: a larger size on small screens is one the editor makes", () => {
    expect(
      checkStoredClasses([fluid({ small: 32, large: 16 })]).issues
    ).toEqual([]);
  });

  it("are refused unless each is two sizes above zero, and dropped on a read", () => {
    for (const sizes of [
      { small: 0, large: 32 },
      { small: -1, large: 32 },
      { small: 16, large: Number.NaN },
      { small: 16, large: Infinity },
      { small: "16", large: 32 },
      { small: 16 },
      { small: 16, large: 32, unit: "px" },
      "16 32",
    ]) {
      const { value, issues } = checkStoredClasses([fluid(sizes)]);
      expect(issues, JSON.stringify(sizes)).toEqual([
        "classes[0] has fluid sizes that cannot be used: each device's two sizes must be numbers of px above zero, on a text style.",
      ]);
      // The class is kept for a read; only what cannot be used goes.
      expect(value?.[0]?.id).toBe("t-eyebrow");
      expect(value?.[0]).not.toHaveProperty("fluidSizes");
    }
  });

  it("are refused when not a record of devices, or on a class that is no text style", () => {
    const notRecord = {
      ...textStyle({ fontSize: "16px" }),
      fluidSizes: [{ small: 16, large: 32 }],
    } as unknown as NamedClass;
    const shared = {
      id: "c-card",
      slug: "card",
      orderIndex: 1,
      styles: { base: { base: { fontSize: "16px" } } },
      fluidSizes: { base: { small: 16, large: 32 } },
    } as unknown as NamedClass;
    const { issues } = checkStoredClasses([notRecord, shared]);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatch(/^classes\[0\] has fluid sizes that cannot/);
    expect(issues[1]).toMatch(/^classes\[1\] has fluid sizes that cannot/);
  });

  it("are refused past one per device a site can have", () => {
    const many = Object.fromEntries(
      Array.from({ length: 15 }, (_, at) => [
        `d${String(at)}`,
        { small: 16, large: 32 },
      ])
    );
    expect(
      checkStoredClasses([fluid(undefined, { fluidSizes: many })]).issues
    ).toHaveLength(1);
  });

  it("leave a class stored without them exactly as it was", () => {
    const { value, issues } = checkStoredClasses([EYEBROW]);
    expect(issues).toEqual([]);
    // The same object: nothing was added, removed or rewritten.
    expect(value?.[0]).toBe(EYEBROW);
    expect(EYEBROW).not.toHaveProperty("fluidSizes");
  });
});
