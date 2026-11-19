/**
 * Text styles in the design-token file: each a DTCG `typography` value whose
 * parts point at the variables it uses, under a `textStyles` group no
 * variable's name can reach, with every text style kept exactly as Nextly
 * data at the file's root (its sizes per device and its case included).
 */
import { describe, expect, it } from "vitest";

import {
  NEXTLY_EXTENSION,
  dtcgToTokens,
  tokensToDtcg,
  type DtcgNode,
} from "./dtcg";
import {
  DEFAULT_FLUID_RANGE,
  fluidValue,
  type FluidRangeWidths,
} from "./fluid-value";
import type { NamedClass } from "./named-class";
import { defaultSiteTokens, type SiteToken } from "./site-tokens";

const eyebrow: NamedClass = {
  id: "ts-eyebrow",
  slug: "eyebrow",
  label: "Eyebrow",
  orderIndex: 4,
  role: "text",
  styles: {
    base: {
      base: {
        fontFamily: { $token: "font.heading" },
        fontSize: { $token: "font-size.h2" },
        lineHeight: { $token: "line-height.h2" },
        fontWeight: 700,
        letterSpacing: "0.05rem",
        textTransform: "uppercase",
      },
      mobile: { fontSize: "1rem" },
    },
  },
};

/** A text style setting only its size, as a plain value. */
const small: NamedClass = {
  id: "ts-small",
  slug: "small-print",
  label: "Small print",
  orderIndex: 5,
  role: "text",
  styles: { base: { base: { fontSize: "0.75rem" } } },
};

/** A size in em, which a DTCG dimension can't hold. */
const loose: NamedClass = {
  id: "ts-loose",
  slug: "loose",
  label: "Loose",
  orderIndex: 6,
  role: "text",
  styles: { base: { base: { letterSpacing: "0.1em" } } },
};

const tokens: SiteToken[] = defaultSiteTokens();

const exported = (textStyles: readonly NamedClass[]) => {
  const made = tokensToDtcg({ tokens }, { textStyles });
  return {
    issues: made.issues,
    file: JSON.parse(JSON.stringify(made.document)) as DtcgNode,
  };
};

const group = (file: DtcgNode) => file.textStyles as DtcgNode | undefined;

const rootData = (file: DtcgNode) =>
  (file.$extensions as DtcgNode)[NEXTLY_EXTENSION] as DtcgNode;

describe("a text style in the design-token file", () => {
  it("is a typography value whose parts point at the variables it uses", () => {
    const { file, issues } = exported([eyebrow]);
    expect(issues).toEqual([]);
    expect(group(file)?.eyebrow).toEqual({
      $type: "typography",
      $value: {
        fontFamily: "{font.heading}",
        fontSize: "{font-size.h2}",
        fontWeight: 700,
        letterSpacing: { value: 0.05, unit: "rem" },
        lineHeight: "{line-height.h2}",
      },
    });
  });

  it("writes a part a style leaves unset as the text it sits in draws it", () => {
    const { file } = exported([small]);
    expect(group(file)?.["small-print"]).toMatchObject({
      $value: {
        fontFamily: "{font.body}",
        fontSize: { value: 0.75, unit: "rem" },
        fontWeight: 400,
        letterSpacing: { value: 0, unit: "px" },
        lineHeight: 1.2,
      },
    });
  });

  it("keeps every text style exactly as Nextly data, with its sizes per device and its case", () => {
    const { file } = exported([eyebrow, small]);
    expect(rootData(file).textStyles).toEqual([
      {
        id: "ts-eyebrow",
        slug: "eyebrow",
        label: "Eyebrow",
        orderIndex: 4,
        styles: eyebrow.styles,
      },
      {
        id: "ts-small",
        slug: "small-print",
        label: "Small print",
        orderIndex: 5,
        styles: small.styles,
      },
    ]);
  });

  it("keeps a text style whose parts a design tool can't read as Nextly data only, and says which", () => {
    const { file } = exported([loose]);
    expect(group(file)).toBeUndefined();
    expect(rootData(file).textStyles).toHaveLength(1);
    expect(
      tokensToDtcg({ tokens }, { textStyles: [loose] }).keptTextStyles
    ).toEqual(["ts-loose"]);
  });

  it("writes a size scaled from a size variable at its factor", () => {
    const scaledSize: NamedClass = {
      id: "ts-big",
      slug: "big",
      orderIndex: 7,
      role: "text",
      styles: {
        base: { base: { fontSize: { $token: "font-size.h2", times: 2 } } },
      },
    };
    const { file } = exported([scaledSize]);
    const written = group(file)?.big as { $value: DtcgNode } | undefined;
    // `font-size.h2` is 1.75rem, so twice it is 3.5rem.
    expect(written?.$value.fontSize).toEqual({ value: 3.5, unit: "rem" });
  });

  it("keeps a part scaled from a variable of another type as Nextly data only, read back exactly", () => {
    // A size from a number variable, a line height from a size variable and
    // a weight past the format's range: none is a value of its part's type.
    const odd: NamedClass[] = [
      {
        id: "ts-size-of-number",
        slug: "size-of-number",
        orderIndex: 7,
        role: "text",
        styles: {
          base: {
            base: { fontSize: { $token: "line-height.h2", times: 2 } },
          },
        },
      },
      {
        id: "ts-line-of-size",
        slug: "line-of-size",
        orderIndex: 8,
        role: "text",
        styles: {
          base: {
            base: { lineHeight: { $token: "font-size.h2", times: 1.5 } },
          },
        },
      },
      {
        id: "ts-heavy",
        slug: "heavy",
        orderIndex: 9,
        role: "text",
        styles: {
          base: {
            base: { fontWeight: { $token: "type.heavy", times: 3 } },
          },
        },
      },
    ];
    const heavy: SiteToken = {
      name: "type.heavy",
      kind: "fontWeight",
      values: { light: "800" },
    };
    const made = tokensToDtcg(
      { tokens: [...tokens, heavy] },
      { textStyles: odd }
    );
    expect(made.keptTextStyles).toEqual([
      "ts-size-of-number",
      "ts-line-of-size",
      "ts-heavy",
    ]);
    const file = JSON.parse(JSON.stringify(made.document)) as DtcgNode;
    expect(group(file)).toBeUndefined();
    expect(dtcgToTokens(file).textStyles?.map(style => style.styles)).toEqual(
      odd.map(style => style.styles)
    );
  });

  it("never sits where a variable could: no variable's name starts with a capital", () => {
    const { file } = exported([eyebrow]);
    // Every variable path is lower case, so `textStyles` names no variable's group.
    expect(Object.keys(file).filter(key => /[A-Z]/.test(key))).toEqual([
      "textStyles",
    ]);
  });

  it("reads every text style back exactly, as text styles", () => {
    const { file } = exported([eyebrow, small, loose]);
    const read = dtcgToTokens(file);
    expect(read.issues).toEqual([]);
    expect(read.textStyles).toEqual([eyebrow, small, loose]);
    // The typography values are not read as variables.
    expect(read.tokens.map(token => token.name)).not.toContain(
      "textStyles.eyebrow"
    );
  });

  it("skips a text style it can't use, naming it, and reads the rest", () => {
    const { file } = exported([eyebrow, small]);
    const kept = rootData(file).textStyles as DtcgNode[];
    // A colour is outside typography; a text style can't hold one.
    (kept[1] as DtcgNode).styles = { base: { base: { color: "#ff0000" } } };
    const read = dtcgToTokens(file);
    expect(read.textStyles).toEqual([eyebrow]);
    expect(read.issues.map(entry => entry.message)).toContain(
      '"Small print" is not a text style this site can use, so it was skipped.'
    );
  });

  it("skips a text style holding a value the site won't store, naming it, and reads the rest", () => {
    const { file } = exported([eyebrow, small]);
    const kept = rootData(file).textStyles as DtcgNode[];
    // A size the site's own check refuses: the class save would refuse it.
    (kept[1] as DtcgNode).styles = { base: { base: { fontSize: "none" } } };
    const read = dtcgToTokens(file);
    expect(read.textStyles).toEqual([eyebrow]);
    expect(read.issues.map(entry => entry.message)).toContain(
      '"Small print" is not a text style this site can use, so it was skipped.'
    );
  });

  it("reads no text styles from a file that has none", () => {
    const { file } = exported([]);
    expect(dtcgToTokens(file).textStyles).toBeUndefined();
    expect(group(file)).toBeUndefined();
  });
});

/** The site's fluid range in the fixtures below, as the file states it. */
const RANGE = { min: 320, max: 1440 };

/** A text style made with "Fluid…" across `range`, on two devices. */
const fluidHeading = (range: FluidRangeWidths): NamedClass => ({
  id: "ts-fluid",
  slug: "fluid-heading",
  label: "Fluid heading",
  orderIndex: 7,
  role: "text",
  styles: {
    base: {
      base: {
        fontSize: fluidValue({ small: 24, large: 40 }, range),
        fontWeight: 700,
      },
      mobile: { fontSize: fluidValue({ small: 18, large: 28 }, range) },
    },
  },
  fluidSizes: {
    base: { small: 24, large: 40 },
    mobile: { small: 18, large: 28 },
  },
});

/** The file a site on `range` writes with these text styles. */
const exportedOn = (
  range: FluidRangeWidths | undefined,
  textStyles: readonly NamedClass[]
) => {
  const made = tokensToDtcg(
    { tokens, ...(range === undefined ? {} : { fluidRange: range }) },
    { textStyles }
  );
  return JSON.parse(JSON.stringify(made.document)) as DtcgNode;
};

/** The first kept text style's entry in a file, to change by hand. */
const keptEntry = (file: DtcgNode) =>
  (rootData(file).textStyles as DtcgNode[])[0] as DtcgNode;

describe("a text style's fluid sizes in the design-token file", () => {
  it("are kept in Nextly's extension beside the style, never in the typography value", () => {
    const file = exportedOn(RANGE, [fluidHeading(RANGE)]);
    expect(keptEntry(file).fluidSizes).toEqual(fluidHeading(RANGE).fluidSizes);
    const entry = group(file)?.["fluid-heading"] as DtcgNode | undefined;
    const value = entry?.$value;
    // The value design tools read holds the format's five parts and nothing else.
    expect(Object.keys(value as DtcgNode).sort()).toEqual([
      "fontFamily",
      "fontSize",
      "fontWeight",
      "letterSpacing",
      "lineHeight",
    ]);
    expect(JSON.stringify(group(file))).not.toContain("fluidSizes");
  });

  it("leave the typography value exactly as a style without them writes it", () => {
    const { fluidSizes: _sizes, ...plain } = fluidHeading(RANGE);
    expect(group(exportedOn(RANGE, [fluidHeading(RANGE)]))).toEqual(
      group(exportedOn(RANGE, [plain]))
    );
  });

  it("are read back with the style, across the range the file states", () => {
    const read = dtcgToTokens(exportedOn(RANGE, [fluidHeading(RANGE)]));
    expect(read.issues).toEqual([]);
    expect(read.textStyles).toEqual([fluidHeading(RANGE)]);
  });

  it("are read back across the default range where the file states none", () => {
    const style = fluidHeading(DEFAULT_FLUID_RANGE);
    const read = dtcgToTokens(exportedOn(undefined, [style]));
    expect(read.issues).toEqual([]);
    expect(read.textStyles).toEqual([style]);
  });

  it("leave out a device's sizes that don't make its size across the file's range, keeping the size and saying so", () => {
    const file = exportedOn(RANGE, [fluidHeading(RANGE)]);
    const styles = keptEntry(file).styles as {
      base: Record<string, Record<string, unknown>>;
    };
    // A size typed by hand beside the sizes, as a file edited by hand can hold.
    styles.base.mobile = { fontSize: "1.25rem" };
    const read = dtcgToTokens(file);
    expect(read.textStyles?.[0]?.styles.base?.mobile?.fontSize).toBe("1.25rem");
    expect(read.textStyles?.[0]?.fluidSizes).toEqual({
      base: { small: 24, large: 40 },
    });
    expect(read.issues.map(entry => entry.message)).toEqual([
      "\"Fluid heading\" keeps its sizes as they are, but its fluid sizes for a size they don't make across the file's fluid range were left out, so that size won't follow a change of the range.",
    ]);
  });

  it("are left out where the style's sizes were made across another range than the file states", () => {
    const file = exportedOn(RANGE, [fluidHeading(DEFAULT_FLUID_RANGE)]);
    const read = dtcgToTokens(file);
    expect(read.textStyles?.[0]?.styles).toEqual(
      fluidHeading(DEFAULT_FLUID_RANGE).styles
    );
    expect(read.textStyles?.[0]).not.toHaveProperty("fluidSizes");
    expect(read.issues).toHaveLength(1);
  });

  it.each([
    ["not a record", "24px"],
    ["a list", [{ small: 24, large: 40 }]],
    ["a size of zero", { base: { small: 0, large: 40 } }],
    ["a size as text", { base: { small: "24", large: 40 } }],
    ["a missing size", { base: { small: 24 } }],
    ["an extra key", { base: { small: 24, large: 40, unit: "px" } }],
  ])(
    "are ignored where they can't be read (%s), and the style still arrives",
    (_what, sizes) => {
      const file = exportedOn(RANGE, [fluidHeading(RANGE)]);
      keptEntry(file).fluidSizes = sizes;
      const read = dtcgToTokens(file);
      const { fluidSizes: _sizes, ...plain } = fluidHeading(RANGE);
      expect(read.textStyles).toEqual([plain]);
      expect(read.issues.map(entry => entry.message)).toEqual([
        "\"Fluid heading\"'s fluid sizes could not be read, so they were ignored: its sizes arrive as they are, and won't follow a change of the fluid range.",
      ]);
    }
  );

  it("are left out for a device the style has no size on", () => {
    const file = exportedOn(RANGE, [fluidHeading(RANGE)]);
    keptEntry(file).fluidSizes = {
      ...fluidHeading(RANGE).fluidSizes,
      tablet: { small: 20, large: 30 },
    };
    const read = dtcgToTokens(file);
    expect(read.textStyles?.[0]?.fluidSizes).toEqual(
      fluidHeading(RANGE).fluidSizes
    );
    expect(read.issues).toHaveLength(1);
  });

  it("leave a file without them read exactly as before", () => {
    const { fluidSizes: _sizes, ...plain } = fluidHeading(RANGE);
    const file = exportedOn(RANGE, [plain]);
    expect(keptEntry(file)).not.toHaveProperty("fluidSizes");
    const read = dtcgToTokens(file);
    expect(read.issues).toEqual([]);
    expect(read.textStyles).toEqual([plain]);
  });
});
