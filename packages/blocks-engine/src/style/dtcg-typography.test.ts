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
        fontWeight: "700",
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

  it("reads no text styles from a file that has none", () => {
    const { file } = exported([]);
    expect(dtcgToTokens(file).textStyles).toBeUndefined();
    expect(group(file)).toBeUndefined();
  });
});
