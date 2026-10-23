/**
 * A tenant's brand colours as chart marks: held to 3:1 on the surfaces a mark
 * is drawn on, in each mode, by their lightness alone, and never refused.
 */
import { readFileSync } from "node:fs";

import { oklchToRgb, parseHex, type Rgb } from "@nextlyhq/ui/color";
import { getBrandingCss } from "nextly/config";
import { describe, expect, it } from "vitest";

import {
  CHART_SURFACES,
  brandingCss,
  chartColourFor,
  parseBrandColour,
} from "../BrandingProvider";

/** WCAG 2.x contrast, written out here so the test does not grade itself with the code's own. */
function contrast(a: Rgb, b: Rgb): number {
  const lin = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const lum = ({ r, g, b: blue }: Rgb) =>
    0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(blue);
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const rgbOf = (css: string): Rgb => {
  const parsed = parseBrandColour(css);
  if (!parsed) throw new Error(`not a colour: ${css}`);
  return parsed;
};
const lowest = (css: string, mode: "light" | "dark") =>
  Math.min(
    ...CHART_SURFACES[mode].map(surface =>
      contrast(rgbOf(css), oklchToRgb(surface))
    )
  );

/** A pale yellow: under 3:1 on the light card, well over it on the dark one. */
const PALE = "hsl(55 95% 80%)";
/** A deep navy: under 3:1 on the dark card, well over it on the light one. */
const NAVY = "hsl(230 60% 14%)";

describe("the surfaces a chart mark is drawn on", () => {
  it("are the theme's card, track and tooltip in each mode, as theme.css sets them", () => {
    // 🔴 Held to the file, so a theme change cannot leave the adjustment
    // measuring against surfaces the admin no longer draws.
    const theme = readFileSync(
      new URL("../../../../../ui/src/styles/theme.css", import.meta.url),
      "utf8"
    );
    const lightnesses = (token: string) =>
      [
        ...theme.matchAll(
          new RegExp(`--nx-${token}: oklch\\(([\\d.]+) 0 0\\)`, "g")
        ),
      ].map(match => Number(match[1]));
    const [card, muted, popover] = ["card", "muted", "popover"].map(
      lightnesses
    );
    // One value in the light block and one in the dark, in that order.
    expect([card, muted, popover].every(values => values!.length === 2)).toBe(
      true
    );
    expect(CHART_SURFACES.light.map(s => s.l)).toEqual([
      card![0],
      muted![0],
      popover![0],
    ]);
    expect(CHART_SURFACES.dark.map(s => s.l)).toEqual([
      card![1],
      muted![1],
      popover![1],
    ]);
  });
});

describe("a brand colour as a chart mark", () => {
  it("is adjusted to 3:1 in the mode it fails, and left exactly as given in the mode it reads", () => {
    expect(lowest(PALE, "light")).toBeLessThan(3);
    const light = chartColourFor(PALE, "light");
    expect(light).not.toBe(PALE);
    expect(lowest(light, "light")).toBeGreaterThanOrEqual(3);
    expect(chartColourFor(PALE, "dark")).toBe(PALE);

    expect(lowest(NAVY, "dark")).toBeLessThan(3);
    const dark = chartColourFor(NAVY, "dark");
    expect(lowest(dark, "dark")).toBeGreaterThanOrEqual(3);
    expect(chartColourFor(NAVY, "light")).toBe(NAVY);
  });

  it("keeps the brand's hue when it moves it", () => {
    const moved = parseHex(chartColourFor(PALE, "light"));
    expect(moved).not.toBeNull();
    // Still a yellow: red and green well above blue, as the brand's are.
    expect(moved!.r).toBeGreaterThan(moved!.b);
    expect(moved!.g).toBeGreaterThan(moved!.b);
  });

  it("reads the forms the admin is sent, and draws anything else as given", () => {
    expect(parseBrandColour("hsl(239 84.3% 64.7%)")).toBeDefined();
    expect(parseBrandColour("hsl(239, 84.3%, 64.7%)")).toBeDefined();
    expect(parseBrandColour("#6366f1")).toBeDefined();
    expect(chartColourFor("var(--brand)", "light")).toBe("var(--brand)");
  });
});

describe("the brand's stylesheet", () => {
  it("writes the chart slots per mode, each adjusted for that mode, and every other token for both", () => {
    const css = brandingCss({ primary: PALE, accent: NAVY });
    expect(css).toContain(
      `.nextly-admin, .nextly-admin.dark { --nx-primary: ${PALE};`
    );
    expect(css).toContain(
      `.nextly-admin.nextly-admin { --nx-chart-1: ${chartColourFor(PALE, "light")}; --nx-chart-2: ${NAVY}; }`
    );
    expect(css).toContain(
      `.nextly-admin.nextly-admin.dark { --nx-chart-1: ${PALE}; --nx-chart-2: ${chartColourFor(NAVY, "dark")}; }`
    );
    expect(brandingCss({})).toBeUndefined();
  });
});

/** One declaration of a property, with the class-only selectors it is declared under. */
interface Declaration {
  selectors: string[][];
  value: string;
}

/**
 * The classes a class-only selector names, repeats included. Any other
 * selector throws, so a sheet this cannot grade fails the test rather than
 * being misread.
 */
function classesOf(selector: string): string[] {
  if (!/^(\.[\w-]+)+$/.test(selector)) {
    throw new Error(`not a class-only selector: ${selector}`);
  }
  return selector.slice(1).split(".");
}

/** Every declaration of `property` in `sheet`, in the order it is written. */
function declarationsOf(property: string, sheet: string): Declaration[] {
  const declared = new RegExp(`${property}:\\s*([^;]+);`);
  return [...sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)].flatMap(
    ([, selectorList, body]) => {
      const value = declared.exec(body!)?.[1];
      if (value === undefined) return [];
      const selectors = selectorList!.split(",").map(s => classesOf(s.trim()));
      return [{ selectors, value: value.trim() }];
    }
  );
}

/**
 * The value of `property` that wins on a wrapper carrying `classes`, when the
 * sheets are applied in the order given.
 *
 * The cascade worked out from the selectors, because the test DOM's computed
 * style gives the last matching rule whatever its specificity. A class-only
 * selector's specificity is the number of classes it names, repeats included;
 * a rule takes the most specific of its selectors that match, and a tie goes
 * to the later rule.
 */
function winningValue(
  property: string,
  classes: readonly string[],
  sheets: readonly string[]
): string | undefined {
  let winner: { specificity: number; value: string } | undefined;
  for (const { selectors, value } of sheets.flatMap(sheet =>
    declarationsOf(property, sheet)
  )) {
    const matching = selectors.filter(named =>
      named.every(name => classes.includes(name))
    );
    if (matching.length === 0) continue;
    const specificity = Math.max(...matching.map(named => named.length));
    if (!winner || specificity >= winner.specificity) {
      winner = { specificity, value };
    }
  }
  return winner?.value;
}

const LIGHT = ["nextly-admin"];
const DARK = ["nextly-admin", "dark"];

describe("the adjusted chart slots beside the server-rendered stylesheet", () => {
  // The same brand as the server renders it: `getBrandingCss` writes the
  // unadjusted slots, and the admin is sent the colours it wrote.
  const serverSheet = getBrandingCss({
    colors: { primary: "#fcf49c", accent: "#0e1539" },
  })!;
  const sent = (token: string) =>
    new RegExp(`--nx-${token}: ([^;]+);`).exec(serverSheet)![1]!;
  const primary = sent("primary");
  const accent = sent("accent");
  const clientSheet = brandingCss({ primary, accent })!;

  it("win in each mode, though the server's sheet comes later", () => {
    // The adjustment has something to win: each colour fails one mode.
    expect(lowest(primary, "light")).toBeLessThan(3);
    expect(lowest(accent, "dark")).toBeLessThan(3);

    // The admin's sheet is in the head; the server's is in the layout's body.
    const sheets = [clientSheet, serverSheet];
    expect(winningValue("--nx-chart-1", LIGHT, sheets)).toBe(
      chartColourFor(primary, "light")
    );
    expect(winningValue("--nx-chart-2", DARK, sheets)).toBe(
      chartColourFor(accent, "dark")
    );
    // And the mode a colour reads in keeps it as given.
    expect(winningValue("--nx-chart-1", DARK, sheets)).toBe(primary);
    expect(winningValue("--nx-chart-2", LIGHT, sheets)).toBe(accent);
  });

  it("would lose to the server's sheet at its specificity, which is why they repeat the class", () => {
    // The control: the reading above can tell the two apart. At one
    // `.nextly-admin` (and `.nextly-admin.dark`) the later server sheet wins,
    // and the unadjusted colour is drawn.
    const atServerSpecificity = clientSheet.replaceAll(
      ".nextly-admin.nextly-admin",
      ".nextly-admin"
    );
    const sheets = [atServerSpecificity, serverSheet];
    expect(winningValue("--nx-chart-1", LIGHT, sheets)).toBe(primary);
    expect(winningValue("--nx-chart-2", DARK, sheets)).toBe(accent);
  });
});
