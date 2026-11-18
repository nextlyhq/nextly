/**
 * What the design-token file carries for Nextly beyond each variable's value:
 * a colour's group, a fluid size's two sizes, and, at the file's root, the
 * site text rows, the colour order, the fluid range and the built-in colours
 * setting. All of it is Nextly-only data under the engine's extension key,
 * which other tools keep and ignore, and all of it reads back exactly.
 */
import { describe, expect, it } from "vitest";

import {
  NEXTLY_EXTENSION,
  dtcgToTokens,
  tokensToDtcg,
  type DtcgNode,
} from "./dtcg";
import type { SiteToken, SiteTokenSet } from "./site-tokens";

const brand: SiteToken = {
  id: "c-brand",
  name: "color.brand",
  label: "Brand",
  kind: "color",
  group: "Brand",
  values: { light: "#336699", dark: "#99bbdd" },
};

const roomy: SiteToken = {
  name: "space.roomy",
  kind: "dimension",
  fluid: { small: 16, large: 24 },
  values: { light: "clamp(1rem, 0.6087rem + 1.7391vw, 1.5rem)" },
};

const set: SiteTokenSet = {
  tokens: [brand, roomy],
  siteText: {
    body: { fontFamily: { $token: "font.body" }, fontSize: "1.0625rem" },
    h2: { fontSize: { $token: "font-size.h2" }, textStyle: "ts-display" },
  },
  order: ["c-brand", "color.text"],
  fluidRange: { min: 320, max: 1440 },
  builtInColoursShown: false,
};

/** The engine's own data at the file's root. */
function rootData(document: DtcgNode): DtcgNode {
  return (document.$extensions as DtcgNode)[NEXTLY_EXTENSION] as DtcgNode;
}

/** The file as another tool receives it: plain JSON. */
const written = (from: SiteTokenSet = set): DtcgNode =>
  JSON.parse(JSON.stringify(tokensToDtcg(from).document)) as DtcgNode;

describe("a colour's group and a fluid size's sizes", () => {
  it("travel in each variable's own Nextly data", () => {
    const file = written();
    const own = (node: unknown) =>
      ((node as DtcgNode).$extensions as DtcgNode)[
        NEXTLY_EXTENSION
      ] as DtcgNode;
    expect(own((file.color as DtcgNode).brand)).toMatchObject({
      group: "Brand",
    });
    expect(own((file.space as DtcgNode).roomy)).toMatchObject({
      fluid: { small: 16, large: 24 },
    });
  });

  it("read back onto the variables", () => {
    const read = dtcgToTokens(written());
    expect(read.issues).toEqual([]);
    expect(read.tokens).toEqual([brand, roomy]);
  });

  it("skip a group or sizes in a shape they can't take, saying so", () => {
    const file = written({ tokens: [brand, roomy] });
    const own = (node: unknown) =>
      ((node as DtcgNode).$extensions as DtcgNode)[
        NEXTLY_EXTENSION
      ] as DtcgNode;
    own((file.color as DtcgNode).brand).group = 7;
    own((file.space as DtcgNode).roomy).fluid = { small: "16", large: 24 };
    const read = dtcgToTokens(file);
    expect(read.tokens.map(token => [token.group, token.fluid])).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ]);
    const said = read.issues.map(entry => entry.message).join(" ");
    expect(said).toContain('"color.brand" has a group that is not a name');
    expect(said).toContain(
      '"space.roomy" has fluid sizes that are not two sizes in px'
    );
  });
});

describe("the site's own design data at the file's root", () => {
  it("writes site text, the colour order, the fluid range and the built-in colours setting", () => {
    expect(rootData(written()).site).toEqual({
      siteText: set.siteText,
      order: set.order,
      fluidRange: set.fluidRange,
      builtInColoursShown: false,
    });
  });

  it("writes and reads the site's variable prefix, so a var() in the file can be followed", () => {
    const file = written({ ...set, prefix: "--brand-" });
    expect(rootData(file).site).toMatchObject({ prefix: "--brand-" });
    expect(dtcgToTokens(file).site?.prefix).toBe("--brand-");
  });

  it("writes none of it for a site that states none", () => {
    const file = written({ tokens: [brand] });
    expect(file.$extensions).toBeUndefined();
  });

  it("reads it all back, with nothing said", () => {
    const read = dtcgToTokens(written());
    expect(read.issues).toEqual([]);
    expect(read.site).toEqual({
      siteText: set.siteText,
      order: set.order,
      fluidRange: set.fluidRange,
      builtInColoursShown: false,
    });
  });

  it("reads no site data from a file that has none", () => {
    expect(dtcgToTokens(written({ tokens: [brand] })).site).toBeUndefined();
  });

  it("skips each part it can't read, saying which, and keeps the rest", () => {
    const file = written();
    rootData(file).site = {
      siteText: { footer: { fontSize: "1rem" } },
      order: "c-brand",
      fluidRange: { min: 900, max: 300 },
      builtInColoursShown: "no",
    };
    const read = dtcgToTokens(file);
    expect(read.site).toBeUndefined();
    const said = read.issues.map(entry => entry.message).join(" ");
    expect(said).toContain("Site text in the file could not be read");
    expect(said).toContain("The colour order in the file could not be read");
    expect(said).toContain("The fluid range in the file could not be read");
    expect(said).toContain(
      "The built-in colours setting in the file could not be read"
    );
    // The variables still arrive.
    expect(read.tokens.map(token => token.name)).toEqual([
      "color.brand",
      "space.roomy",
    ]);
  });
});

describe("the order of the variables", () => {
  it("reads back in the site's order, whichever group or extension each is written under", () => {
    const list: SiteToken[] = [
      { name: "color.a", kind: "color", values: { light: "#111111" } },
      { name: "space.em", kind: "dimension", values: { light: "1.5em" } },
      { name: "space.px", kind: "dimension", values: { light: "4px" } },
      { name: "color.b", kind: "color", values: { light: "#222222" } },
    ];
    const read = dtcgToTokens(written({ tokens: list }));
    expect(read.issues).toEqual([]);
    expect(read.tokens.map(token => token.name)).toEqual([
      "color.a",
      "space.em",
      "space.px",
      "color.b",
    ]);
  });
  it("puts a variable the sequence doesn't name after every one it does, a name listed twice or not", () => {
    const list: SiteToken[] = [
      { name: "color.a", kind: "color", values: { light: "#111111" } },
      { name: "color.b", kind: "color", values: { light: "#222222" } },
      { name: "color.c", kind: "color", values: { light: "#333333" } },
    ];
    const file = written({ tokens: list });
    const own = (file.$extensions ?? {}) as Record<string, DtcgNode>;
    file.$extensions = {
      ...own,
      [NEXTLY_EXTENSION]: {
        ...own[NEXTLY_EXTENSION],
        sequence: ["color.b", "color.b", "color.b", "color.a"],
      },
    };
    expect(dtcgToTokens(file).tokens.map(token => token.name)).toEqual([
      "color.b",
      "color.a",
      "color.c",
    ]);
  });
});
