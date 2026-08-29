/**
 * The door tokens leave and arrive through.
 *
 * The property that matters is the round trip: what this system exports, it
 * must read back unchanged. Everything else is about being a good citizen of a
 * format other tools also write.
 */
import { describe, expect, it } from "vitest";

import type { DtcgNode } from "./dtcg";
import {
  NEXTLY_EXTENSION,
  dtcgToTokens,
  readFamilyList,
  tokensToDtcg,
} from "./dtcg";
import type { SiteToken } from "./site-tokens";

import { isTokenName } from "./declarations";
import {
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKEN_NAME_SEGMENTS,
  renameSiteToken,
} from "./site-tokens";

const tokens = (list: SiteToken[]) => ({ tokens: list });

describe("export", () => {
  it("nests a dot path into groups, because DTCG forbids a dot in a name", () => {
    // "the following characters MUST NOT be used anywhere in a token or group
    // name: `{`, `}`, `.`" — so `color.primary` is the token `primary` inside
    // the group `color`, not a name with a dot in it.
    const { document } = tokensToDtcg(
      tokens([
        { name: "color.primary", kind: "color", values: { light: "#2563eb" } },
      ])
    );
    const group = document.color as Record<string, unknown>;
    expect(Object.keys(document)).toEqual(["color"]);
    expect(group.primary).toBeDefined();
  });

  it("writes a dimension as an object, which is what the format now requires", () => {
    const { document } = tokensToDtcg(
      tokens([
        { name: "space.4", kind: "dimension", values: { light: "16px" } },
      ])
    );
    const group = document.space as Record<string, Record<string, unknown>>;
    expect(group["4"]?.$value).toEqual({ value: 16, unit: "px" });
    expect(group["4"]?.$type).toBe("dimension");
  });

  it("writes a colour as components with a hex fallback", () => {
    const { document } = tokensToDtcg(
      tokens([{ name: "brand", kind: "color", values: { light: "#2563eb" } }])
    );
    const token = document.brand as Record<string, unknown>;
    const value = token.$value as Record<string, unknown>;
    expect(value.colorSpace).toBe("srgb");
    expect(value.hex).toBe("#2563eb");
    expect((value.components as number[]).length).toBe(3);
  });

  it("reports a value the format cannot express instead of inventing one", () => {
    // A dimension may only be `px` or `rem`, so a `clamp()` has no conformant
    // shape at all. Emitting it under a type that does not fit would be a lie
    // about what the token holds.
    const { document, issues } = tokensToDtcg(
      tokens([
        {
          name: "content.width",
          kind: "dimension",
          values: { light: "clamp(20rem, 80vw, 72rem)" },
        },
      ])
    );
    expect(document).toEqual({});
    expect(issues[0]?.message).toContain("cannot express");
    // And it says the value is not lost, because the author still has it here.
    expect(issues[0]?.message).toContain("still here in Nextly");
  });

  it("reads rgb() percentages as the colour they are", () => {
    // `rgb(100% 0% 0% / 50%)` is red at half opacity. Read as plain numbers it
    // exports as `rgb(100 0 0)` at full opacity — a dark maroon, opaque, and a
    // design tool importing the standard `$value` sees that instead.
    const { document } = tokensToDtcg(
      tokens([
        {
          name: "brand",
          kind: "color",
          values: { light: "rgb(100% 0% 0% / 50%)" },
        },
      ])
    );
    const value = (document.brand as Record<string, unknown>).$value as Record<
      string,
      unknown
    >;
    expect(value.components).toEqual([1, 0, 0]);
    expect(value.alpha).toBeCloseTo(0.5, 5);
  });

  it("keeps a family name that contains a comma in one piece", () => {
    // The comma only separates families outside quotes. Split blindly, a real
    // company's font becomes a fallback list ending in a family called "Inc".
    const { document } = tokensToDtcg(
      tokens([
        {
          name: "font.body",
          kind: "fontFamily",
          values: { light: `"ACME, Inc", serif` },
        },
      ])
    );
    const group = document.font as Record<string, Record<string, unknown>>;
    expect(group.body?.$value).toEqual(["ACME, Inc", "serif"]);
  });

  it("exports a number whose spelling is not the canonical one", () => {
    // `1.0` and `1e3` are valid CSS numbers DTCG can store. Reporting them as
    // inexpressible drops usable tokens over a formatting preference.
    for (const [css, expected] of [
      ["1.0", 1],
      ["1e3", 1000],
      ["+2", 2],
      [".5", 0.5],
    ] as const) {
      const { document, issues } = tokensToDtcg(
        tokens([{ name: "n", kind: "number", values: { light: css } }])
      );
      expect(issues, css).toEqual([]);
      expect((document.n as Record<string, unknown>)?.$value, css).toBe(
        expected
      );
    }
  });

  it("still refuses text that is not a number at all", () => {
    // The widening above has to stay a widening: `12px` and `1 2` are not
    // numbers, and exporting either under `$type: number` would misdescribe it.
    for (const css of ["12px", "1 2", "abc", ""]) {
      const { document } = tokensToDtcg(
        tokens([{ name: "n", kind: "number", values: { light: css } }])
      );
      expect(document, css).toEqual({});
    }
  });

  it("exports a measure whose number is signed or has an exponent", () => {
    // The same CSS number grammar a `number` token already gets. A narrower one
    // here reports `+16px` and `1e3ms` as something the format cannot express
    // and drops usable spacing and timing tokens from the exported file.
    const measure = (kind: "dimension" | "duration", css: string): unknown =>
      (
        tokensToDtcg(tokens([{ name: "m", kind, values: { light: css } }]))
          .document.m as Record<string, unknown>
      )?.$value;

    expect(measure("dimension", "+16px")).toEqual({ value: 16, unit: "px" });
    expect(measure("dimension", "1e3px")).toEqual({ value: 1000, unit: "px" });
    expect(measure("duration", "-1e3ms")).toEqual({ value: -1000, unit: "ms" });
    // And a unit the format does not allow is still refused.
    expect(measure("dimension", "16vw")).toBeUndefined();
  });

  it("decodes a hex escape inside a family name", () => {
    // `\\26 ` is `&`, so `"ACME\\26 Co"` is the one family `ACME&Co`. Taking the
    // character after the backslash literally exports `ACME26 Co`, a different
    // font to every tool that reads the standard value.
    const { document } = tokensToDtcg(
      tokens([
        {
          name: "f",
          kind: "fontFamily",
          values: { light: `"ACME\\26 Co", serif` },
        },
      ])
    );
    expect((document.f as Record<string, unknown>)?.$value).toEqual([
      "ACME&Co",
      "serif",
    ]);
  });

  it("reports a family list holding a substitution instead of naming a font", () => {
    // DTCG stores family NAMES. Exporting the text would describe a font
    // literally called `var(--brand-font)` to every tool that reads the
    // standard value rather than this vendor's extension.
    const { document, issues } = tokensToDtcg(
      tokens([
        {
          name: "f",
          kind: "fontFamily",
          values: { light: "var(--brand-font), serif" },
        },
      ])
    );
    expect(document).toEqual({});
    expect(issues[0]?.message).toContain("cannot express");
  });

  it("keeps a quoted family that merely looks like one", () => {
    // The quotes say it is a name somebody chose, not syntax.
    const { document } = tokensToDtcg(
      tokens([
        {
          name: "f",
          kind: "fontFamily",
          values: { light: `"var(--x)", serif` },
        },
      ])
    );
    expect((document.f as Record<string, unknown>)?.$value).toEqual([
      "var(--x)",
      "serif",
    ]);
  });

  it("reports a family list CSS itself would drop", () => {
    // `<family-name>` is one string OR a run of identifiers. `"Bad" "Name"` is
    // neither, so a browser drops the declaration; joining them would export a
    // font stack the site never rendered.
    const { document, issues } = tokensToDtcg(
      tokens([
        {
          name: "f",
          kind: "fontFamily",
          values: { light: `"Bad" "Name", serif` },
        },
      ])
    );
    expect(document).toEqual({});
    expect(issues[0]?.message).toContain("cannot express");
  });

  it("reports a family list that is a bare CSS-wide keyword", () => {
    // `font-family: inherit` takes the parent's font. Exported as a `$value` it
    // would describe a font actually named "inherit".
    const { document, issues } = tokensToDtcg(
      tokens([{ name: "f", kind: "fontFamily", values: { light: "inherit" } }])
    );
    expect(document).toEqual({});
    expect(issues[0]?.message).toContain("cannot express");
  });

  it("reports a family list whose bare item is not an identifier run", () => {
    // `10px` tokenizes as a dimension, so a browser drops any declaration
    // reading the token — exporting it shows a stack the site never used.
    const { document } = tokensToDtcg(
      tokens([
        { name: "f", kind: "fontFamily", values: { light: "10px, serif" } },
      ])
    );
    expect(document).toEqual({});
  });

  it("reports a family run separated by whitespace only JavaScript knows", () => {
    // A vertical tab is whitespace to `\s` and a delimiter to CSS, so `My\vFont`
    // is not a run of identifiers and the browser drops the declaration reading
    // it. Judged by the JavaScript set it exports as a font stack the site
    // never rendered.
    const { document } = tokensToDtcg(
      tokens([
        {
          name: "f",
          kind: "fontFamily",
          values: { light: "My\u000bFont, serif" },
        },
      ])
    );
    expect(document).toEqual({});
  });

  it("exports a family run separated by CSS whitespace under its ONE name", () => {
    // The other side of that rule: a form feed IS whitespace to CSS, so the run
    // it separates is two identifiers and the token is expressible.
    //
    // Exported with the separator NORMALISED, because CSS joins the identifiers
    // of an unquoted family with a single space to form the name it matches on.
    // `My\u000cFont` and `My Font` are one family to a browser, so exporting
    // the author's spelling would hand every tool reading the standard value a
    // name carrying a form feed, which matches no installed font — and would
    // make the same value compare unequal against the family a `@font-face`
    // declares. A quoted name is untouched: there the whitespace is the name.
    const { document } = tokensToDtcg(
      tokens([
        {
          name: "f",
          kind: "fontFamily",
          values: { light: "My\u000cFont, serif" },
        },
      ])
    );
    expect((document.f as Record<string, unknown>)?.$value).toEqual([
      "My Font",
      "serif",
    ]);
  });

  it("still exports a quoted item that would be a keyword bare", () => {
    const { document } = tokensToDtcg(
      tokens([
        {
          name: "f",
          kind: "fontFamily",
          values: { light: `"inherit", serif` },
        },
      ])
    );
    expect((document.f as Record<string, unknown>)?.$value).toEqual([
      "inherit",
      "serif",
    ]);
  });

  it("exports a family whose identifier run is spelled with an escape", () => {
    // `\\31 0px` is a legal identifier naming the family `10px`. Checked after
    // decoding it looks like a dimension, and a valid token is lost.
    const { document } = tokensToDtcg(
      tokens([
        {
          name: "f",
          kind: "fontFamily",
          values: { light: "\\31 0px, serif" },
        },
      ])
    );
    expect((document.f as Record<string, unknown>)?.$value).toEqual([
      "10px",
      "serif",
    ]);
  });

  it.each(["--brand, serif", "My  Font, serif"])(
    "exports the valid unquoted family list %s",
    css => {
      // The check has to be CSS's grammar, not a stricter one: an identifier may
      // open with dashes, and any run of whitespace separates two of them.
      const { document } = tokensToDtcg(
        tokens([{ name: "f", kind: "fontFamily", values: { light: css } }])
      );
      expect(document).not.toEqual({});
    }
  );

  it("carries another tool's extension data through untouched", () => {
    // "Tools that process design token files MUST preserve any extension data
    // they do not themselves understand."
    const { document } = tokensToDtcg(
      tokens([
        {
          name: "brand",
          kind: "color",
          values: { light: "#000000" },
          extensions: { "com.figma.thing": { id: 7 } },
        },
      ])
    );
    const token = document.brand as Record<string, Record<string, unknown>>;
    expect(token.$extensions?.["com.figma.thing"]).toEqual({ id: 7 });
  });
});

describe("import", () => {
  it("flattens groups back into dot paths", () => {
    const { tokens: read } = dtcgToTokens({
      color: {
        primary: {
          $type: "color",
          $value: { colorSpace: "srgb", components: [0, 0, 0], hex: "#000000" },
        },
      },
    });
    expect(read[0]?.name).toBe("color.primary");
  });

  it("inherits a type down through groups that do not restate it", () => {
    // "the token's type is inherited from the CLOSEST parent group with a
    // `$type`" — so it travels past intermediate groups rather than stopping
    // at the immediate parent. A test that put the type one level up would
    // pass without the chain ever being walked.
    const { tokens: read } = dtcgToTokens({
      space: {
        $type: "dimension",
        inset: { small: { $value: { value: 16, unit: "px" } } },
      },
    });
    expect(read[0]?.name).toBe("space.inset.small");
    expect(read[0]?.kind).toBe("dimension");
    expect(read[0]?.values.light).toBe("16px");
  });

  it("takes the closest type when an inner group overrides an outer one", () => {
    const { tokens: read } = dtcgToTokens({
      outer: {
        $type: "dimension",
        inner: {
          $type: "duration",
          fast: { $value: { value: 150, unit: "ms" } },
        },
      },
    });
    expect(read[0]?.kind).toBe("duration");
    expect(read[0]?.values.light).toBe("150ms");
  });

  it("prefers a supplied hex over recomputing it from components", () => {
    // The format says `hex` is the fallback representation; taking it keeps a
    // colour byte-identical rather than round-tripping it through arithmetic.
    const { tokens: read } = dtcgToTokens({
      brand: {
        $type: "color",
        $value: {
          colorSpace: "srgb",
          components: [0.1, 0.2, 0.3],
          hex: "#1a334d",
        },
      },
    });
    expect(read[0]?.values.light).toBe("#1a334d");
  });

  it("keeps the alpha of a colour that also supplies a hex", () => {
    // `hex` is the six-digit fallback for the colour WITHOUT its alpha, so
    // taking it alone imports a half-transparent red as an opaque one. It
    // renders, it looks deliberate, and it is not what the file said.
    const { tokens: read } = dtcgToTokens({
      brand: {
        $type: "color",
        $value: {
          colorSpace: "srgb",
          components: [1, 0, 0],
          hex: "#ff0000",
          alpha: 0.5,
        },
      },
    });
    expect(read[0]?.values.light).toBe("rgb(255 0 0 / 0.5)");
  });

  it("reads a colour with no hex from its components", () => {
    const { tokens: read } = dtcgToTokens({
      brand: {
        $type: "color",
        $value: { colorSpace: "srgb", components: [1, 0, 0] },
      },
    });
    expect(read[0]?.values.light).toBe("rgb(255 0 0)");
  });

  it("writes an imported family name as CSS that means the same name", () => {
    // A DTCG family value is a NAME, not CSS. `ACME,Inc` unquoted is two
    // fallback families rather than the one the file described, and a name
    // holding a quote produces a declaration that does not parse.
    const read = (value: unknown): string | undefined =>
      dtcgToTokens({ f: { $type: "fontFamily", $value: value } }).tokens[0]
        ?.values.light;

    expect(read("ACME,Inc")).toBe('"ACME,Inc"');
    expect(read('say "hi"')).toBe('"say \\"hi\\""');
    expect(read(["ACME, Inc", "serif"])).toBe('"ACME, Inc", serif');
  });

  it("leaves a family name that needs no quotes unquoted", () => {
    // Generic families mean the generic only while bare: quoting `serif` asks
    // for a font actually installed under that name and loses the fallback.
    const read = (value: unknown): string | undefined =>
      dtcgToTokens({ f: { $type: "fontFamily", $value: value } }).tokens[0]
        ?.values.light;

    expect(read("serif")).toBe("serif");
    expect(read("system-ui")).toBe("system-ui");
    expect(read("My Font")).toBe("My Font");
  });

  it("quotes an imported family whose name is a CSS-wide keyword", () => {
    // Bare, `inherit` takes the parent's font rather than naming one. The
    // generics are the opposite case and have to stay bare.
    const read = (value: unknown): string | undefined =>
      dtcgToTokens({ f: { $type: "fontFamily", $value: value } }).tokens[0]
        ?.values.light;
    expect(read("inherit")).toBe('"inherit"');
    expect(read("revert-layer")).toBe('"revert-layer"');
    expect(read("serif")).toBe("serif");
  });

  it("refuses an sRGB component outside the range rather than clamping it", () => {
    // Clamped, `[2, 0, 0]` imports as red — a colour the file did not describe,
    // rendered and believed with nothing reported.
    const { tokens: read, issues } = dtcgToTokens({
      c: {
        $type: "color",
        $value: { colorSpace: "srgb", components: [2, 0, 0] },
      },
    });
    expect(read).toEqual([]);
    expect(issues[0]?.message).toContain("could not be read");
  });

  it("refuses a colour whose hex contradicts its components", () => {
    // The hex is a FALLBACK for the components, not an alternative to them.
    // Taking it imports black for a token that describes red.
    const { tokens: read, issues } = dtcgToTokens({
      c: {
        $type: "color",
        $value: {
          colorSpace: "srgb",
          components: [1, 0, 0],
          hex: "#000000",
        },
      },
    });
    expect(read).toEqual([]);
    expect(issues[0]?.message).toContain("could not be read");
  });

  it("still accepts a hex that merely rounded from its components", () => {
    const { tokens: read } = dtcgToTokens({
      c: {
        $type: "color",
        $value: {
          colorSpace: "srgb",
          components: [1, 0, 0],
          hex: "#ff0000",
        },
      },
    });
    expect(read[0]?.values.light).toBe("#ff0000");
  });

  it("does not compare non-sRGB components to an sRGB hex", () => {
    // In another space the components are not sRGB channels, so a file giving
    // display-p3 components beside their converted sRGB fallback is valid and
    // must import.
    const { tokens: read } = dtcgToTokens({
      c: {
        $type: "color",
        $value: {
          colorSpace: "display-p3",
          components: [1, 0, 0],
          hex: "#fa0f00",
        },
      },
    });
    expect(read[0]?.values.light).toBe("#fa0f00");
  });

  it("skips a type it has no kind for, and says so", () => {
    const { tokens: read, issues } = dtcgToTokens({
      curve: { $type: "cubicBezier", $value: [0, 0, 1, 1] },
    });
    expect(read).toEqual([]);
    expect(issues[0]?.message).toContain("cubicBezier");
  });

  it("keeps another tool's extensions but not its own", () => {
    const { tokens: read } = dtcgToTokens({
      brand: {
        $type: "color",
        $value: { colorSpace: "srgb", components: [0, 0, 0], hex: "#000000" },
        $extensions: {
          "com.figma.thing": { id: 7 },
          [NEXTLY_EXTENSION]: { css: { light: "#000" }, kind: "color" },
        },
      },
    });
    expect(read[0]?.extensions).toEqual({ "com.figma.thing": { id: 7 } });
    // Its own key is consumed rather than carried, or every round trip would
    // nest one copy inside the next.
    expect(read[0]?.extensions?.[NEXTLY_EXTENSION]).toBeUndefined();
  });

  it("refuses a unit the export side would never have written", () => {
    // Export restricts the unit to `px`/`rem` and `ms`/`s`; import concatenated
    // whatever string the file carried, so the two directions disagreed and a
    // unit could smuggle text into a stored value.
    const read = (unit: string): unknown =>
      dtcgToTokens({
        d: { $type: "dimension", $value: { value: 16, unit } },
      }).tokens[0]?.values.light;

    expect(read("px")).toBe("16px");
    expect(read("rem")).toBe("16rem");
    expect(read("px;color:red")).toBeUndefined();
    expect(read("vw")).toBeUndefined();
  });

  it("reports a value it could never write, at the file that carried it", () => {
    // The emitter refuses these anyway, so nothing unsafe reaches a stylesheet
    // either way. What changes is where the author is told: once, naming the
    // import, instead of on every page compile from then on.
    const fetching = dtcgToTokens({
      bg: {
        $type: "color",
        $value: { colorSpace: "srgb", components: [0, 0, 0] },
        $extensions: {
          [NEXTLY_EXTENSION]: {
            css: { light: "url(https://evil.example/a.png)" },
            kind: "color",
          },
        },
      },
    });
    expect(fetching.tokens).toEqual([]);
    expect(fetching.issues[0]?.message).toContain("load a file");

    const unwritable = dtcgToTokens({
      x: {
        $type: "color",
        $value: { colorSpace: "srgb", components: [0, 0, 0] },
        $extensions: {
          [NEXTLY_EXTENSION]: {
            css: { light: "red}body{display:none" },
            kind: "color",
          },
        },
      },
    });
    expect(unwritable.tokens).toEqual([]);
    expect(unwritable.issues[0]?.message).toContain("cannot be written");
  });

  it("refuses a document that is not one", () => {
    expect(dtcgToTokens("nope").issues).toHaveLength(1);
    expect(dtcgToTokens(null).tokens).toEqual([]);
  });
});

describe("the round trip", () => {
  it("reads back exactly what it wrote", () => {
    const original: SiteToken[] = [
      {
        name: "color.primary",
        kind: "color",
        values: { light: "#2563eb", dark: "#60a5fa" },
      },
      { name: "space.4", kind: "dimension", values: { light: "1rem" } },
      { name: "font.body", kind: "fontFamily", values: { light: "system-ui" } },
      { name: "font.heavy", kind: "fontWeight", values: { light: "700" } },
      { name: "motion.fast", kind: "duration", values: { light: "150ms" } },
      {
        name: "scale.ratio",
        kind: "number",
        values: { light: "1.5" },
        description: "Type scale.",
      },
    ];
    const { document, issues } = tokensToDtcg(tokens(original));
    expect(issues).toEqual([]);
    const { tokens: read } = dtcgToTokens(document);
    expect(read).toEqual(original);
  });

  it("survives the exact values DTCG could not have expressed", () => {
    // The point of carrying the CSS in the extension: `#2563eb` exports as
    // components and comes back as the string that was written, not as an
    // arithmetically equivalent `rgb()`.
    const original: SiteToken[] = [
      {
        name: "brand",
        kind: "color",
        values: { light: "rgb(37 99 235 / 0.5)" },
      },
    ];
    const { document } = tokensToDtcg(tokens(original));
    expect(dtcgToTokens(document).tokens).toEqual(original);
  });

  it("does not accumulate its own extension over repeated trips", () => {
    const original: SiteToken[] = [
      { name: "brand", kind: "color", values: { light: "#000000" } },
    ];
    let carried = original;
    for (let pass = 0; pass < 3; pass++) {
      carried = dtcgToTokens(tokensToDtcg(tokens(carried)).document).tokens;
    }
    expect(carried).toEqual(original);
  });
});

describe("a token's stable identity across the format", () => {
  // The identity DTCG itself cannot express: the format knows a token by its
  // path, so this rides in `$extensions` under the vendor key the spec asks
  // for and the spec guarantees other tools preserve.
  const renamed = renameSiteToken(
    { name: "color.primary", kind: "color", values: { light: "#2563eb" } },
    "brand.main"
  );

  const own = (
    document: DtcgNode,
    ...path: string[]
  ): Record<string, unknown> => {
    let node: Record<string, unknown> = document;
    for (const segment of path) node = node[segment] as Record<string, unknown>;
    const extensions = node.$extensions as Record<string, unknown>;
    return extensions[NEXTLY_EXTENSION] as Record<string, unknown>;
  };

  it("nests under the CURRENT name and carries the identity in the extension", () => {
    // Both halves matter and they pull apart. The path is what a designer reads
    // in Figma, so it has to be the name the author sees; the identity is what
    // a document and a compiled sheet key off, so it cannot be the path.
    const { document, issues } = tokensToDtcg(tokens([renamed]));

    expect(issues).toEqual([]);
    expect(Object.keys(document)).toEqual(["brand"]);
    expect(own(document, "brand", "main").id).toBe("color.primary");
  });

  it("reads the identity back, so a rename survives a trip through the format", () => {
    // Exporting to Style Dictionary and importing the result must not quietly
    // re-point a token at its own label — every reference written against the
    // old identity would stop resolving, and stop resolving silently.
    const { tokens: read } = dtcgToTokens(
      tokensToDtcg(tokens([renamed])).document
    );

    expect(read).toEqual([renamed]);
    expect(read[0]?.id).toBe("color.primary");
    expect(read[0]?.name).toBe("brand.main");
  });

  it("writes no id at all for a token that never moved", () => {
    // A field present on every token says nothing about identity and everything
    // about which exporter ran, and it is data another tool must then carry.
    const { document } = tokensToDtcg(
      tokens([
        { name: "color.primary", kind: "color", values: { light: "#2563eb" } },
      ])
    );

    expect(own(document, "color", "primary")).not.toHaveProperty("id");
  });

  it("invents no identity for a file that came from somewhere else", () => {
    // A file from Figma carries no vendor key of ours to read one out of.
    // Minting one here would be this importer deciding what a token IS on the
    // strength of nothing, and the honest answer — the name — is what an absent
    // id already means everywhere else in the model.
    const { tokens: read } = dtcgToTokens({
      color: {
        primary: {
          $type: "color",
          $value: { colorSpace: "srgb", components: [0, 0, 0], hex: "#000000" },
        },
      },
    });

    expect(read[0]).not.toHaveProperty("id");
    expect(read[0]?.name).toBe("color.primary");
  });

  it("normalises away an id that merely repeats the name", () => {
    // `id === name` states exactly what an absent id states. Keeping it would
    // leave the model with two spellings of one fact, and a reader deciding
    // which of them means "never renamed".
    const { tokens: read } = dtcgToTokens({
      brand: {
        $type: "color",
        $value: { colorSpace: "srgb", components: [0, 0, 0], hex: "#000000" },
        $extensions: {
          [NEXTLY_EXTENSION]: {
            css: { light: "#000" },
            kind: "color",
            id: "brand",
          },
        },
      },
    });

    expect(read[0]).not.toHaveProperty("id");
  });

  it("refuses to EXPORT an id it would refuse to import, so a file survives its own round trip", () => {
    // The three readers of a token have to agree about what an unusable id
    // means. `emitTokenBlocks` refuses the token and the importer below refuses
    // it; an exporter that wrote it anyway would produce a document this very
    // module rejects on the way back in — and reject the WHOLE token, because
    // an id it cannot read is an identity it cannot honour.
    const bad: SiteToken[] = [
      {
        id: "color}primary",
        name: "brand.main",
        kind: "color",
        values: { light: "#2563eb" },
      },
    ];
    const { document, issues } = tokensToDtcg(tokens(bad));

    expect(Object.keys(document)).toEqual([]);
    expect(issues.some(i => i.message.includes("id"))).toBe(true);
    // The round trip is the property, so it is asserted as one rather than
    // inferred from the export being empty.
    expect(dtcgToTokens(document).tokens).toEqual([]);
  });

  it("skips a token whose stated id could never be written, rather than dropping the id", () => {
    // Importing it WITHOUT the id is the tempting repair and it is the wrong
    // one: the token would arrive with its name for an identity, emit a
    // different custom property from the one the file describes, and every
    // reference written against the stated identity would resolve to nothing.
    const { tokens: read, issues } = dtcgToTokens({
      brand: {
        $type: "color",
        $value: { colorSpace: "srgb", components: [0, 0, 0], hex: "#000000" },
        $extensions: {
          [NEXTLY_EXTENSION]: {
            css: { light: "#000" },
            kind: "color",
            id: "color}primary",
          },
        },
      },
    });

    expect(read).toEqual([]);
    expect(issues.some(i => i.message.includes("id"))).toBe(true);
  });
});

describe("a renamed token's long label", () => {
  // A token's identity is its id, so a renamed token is written under that id
  // and its display name reaches neither a stylesheet nor an exported file.
  // Both DTCG gates therefore hold the label to the grammar and the identity to
  // the emission cap — capping the label would drop a working token from an
  // export and refuse it on the way back in, silently in both directions.
  const longLabel = `label.${"a".repeat(MAX_TOKEN_NAME_LENGTH)}`;

  it("straddles the cap, so the cases below mean what they say", () => {
    expect(longLabel.length).toBeGreaterThan(MAX_TOKEN_NAME_LENGTH);
    expect("color.primary".length).toBeLessThanOrEqual(MAX_TOKEN_NAME_LENGTH);
  });

  it("survives an export, because the id is what it is written under", () => {
    const { document, issues } = tokensToDtcg({
      tokens: [
        {
          id: "color.primary",
          name: longLabel,
          kind: "color",
          values: { light: "#000000" },
        },
      ],
    });
    expect(issues).toEqual([]);
    expect(JSON.stringify(document)).toContain("color.primary");
  });

  it("imports a token whose stated id is short, however deep its group path", () => {
    // The import side of the same rule. A file may nest a token so deeply that
    // its dot path exceeds the cap while stating a short id in the extension —
    // that id is the identity, so the token is written under it and the path is
    // only a label.
    const deep = "g".repeat(MAX_TOKEN_NAME_LENGTH);
    const { tokens: read, issues } = dtcgToTokens({
      [deep]: {
        primary: {
          $type: "color",
          $value: { colorSpace: "srgb", components: [0, 0, 0], hex: "#000000" },
          $extensions: { [NEXTLY_EXTENSION]: { id: "color.primary" } },
        },
      },
    });
    expect(issues).toEqual([]);
    expect(read[0]?.id).toBe("color.primary");
  });

  it("skips an imported token whose path is the identity and exceeds the cap", () => {
    // With no stated id the path IS what the token is written under, so the cap
    // applies to it. Without this the import gate has no coverage at all: the
    // case above passes whether or not the cap is applied there.
    const deep = "g".repeat(MAX_TOKEN_NAME_LENGTH);
    const { tokens: read, issues } = dtcgToTokens({
      [deep]: {
        primary: {
          $type: "color",
          $value: { colorSpace: "srgb", components: [0, 0, 0], hex: "#000000" },
        },
      },
    });
    expect(read).toEqual([]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("is refused when the LABEL is the identity, which is when it is written", () => {
    // The control on the other side: with no id the label is the identity, so
    // the same string is capped. Without this, a gate that accepted everything
    // would satisfy the case above perfectly.
    const { issues } = tokensToDtcg({
      tokens: [
        { name: longLabel, kind: "color", values: { light: "#000000" } },
      ],
    });
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("a label deep enough to break the reader", () => {
  // The exporter writes one nested group per dot-separated segment and the
  // reader walks those groups, so a deep label produces a file this package
  // cannot read back. An exporter emitting a document that fails its own round
  // trip is the shape this module exists to prevent, and a renamed token's
  // label is free of the LENGTH cap — so depth needs its own bound.
  const deepLabel = Array.from(
    { length: MAX_TOKEN_NAME_SEGMENTS + 1 },
    () => "a"
  ).join(".");

  it("is refused at export rather than written", () => {
    const { issues } = tokensToDtcg({
      tokens: [
        {
          id: "short.id",
          name: deepLabel,
          kind: "color",
          values: { light: "#000000" },
        },
      ],
    });
    expect(issues.length).toBeGreaterThan(0);
  });

  it("still exports a label at the depth bound, so the refusal is not blanket", () => {
    // The control. Without it a gate refusing every renamed token would satisfy
    // the case above and look correct.
    const atBound = Array.from(
      { length: MAX_TOKEN_NAME_SEGMENTS },
      () => "a"
    ).join(".");
    const { document, issues } = tokensToDtcg({
      tokens: [
        {
          id: "short.id",
          name: atBound,
          kind: "color",
          values: { light: "#000000" },
        },
      ],
    });
    expect(issues).toEqual([]);
    expect(dtcgToTokens(document).tokens).toHaveLength(1);
  });
});

describe("a name the object prototype already answers for", () => {
  /*
   * A document node is an ordinary object, so reading a segment directly finds
   * whatever `Object.prototype` supplies. `node["constructor"]` is a function
   * rather than `undefined`, so the emitter concluded the path was already
   * taken and refused a token nothing had written — the document came back
   * `{}` with "exported more than once" beside it, and the token could not
   * leave this system at all.
   *
   * DERIVED rather than listed, so this widens with the grammar instead of
   * pinning today's answer. The name rule is lowercase-only, which is why
   * `constructor` is currently the only prototype key a token name can spell:
   * `toString` and the rest carry capitals and are refused as names long
   * before they reach the emitter.
   */
  const REACHABLE = Object.getOwnPropertyNames(Object.prototype).filter(
    isTokenName
  );

  it("has something to test", () => {
    // The positive control on the fixture itself. Filtered to nothing, every
    // `it.each` below would silently run zero times and read as a pass.
    expect(REACHABLE).toContain("constructor");
  });

  it.each(REACHABLE)("writes a token named %s", name => {
    const { document, issues } = tokensToDtcg({
      tokens: [{ name, kind: "number", values: { light: "1" } }],
    });
    expect(issues).toEqual([]);
    // Asserted as an OWN key, because `document[name]` is truthy for every one
    // of these whether or not anything was written.
    expect(Object.hasOwn(document, name)).toBe(true);
    expect(JSON.parse(JSON.stringify(document))).toHaveProperty([name]);
  });

  it("writes a token whose PATH passes through such a name", () => {
    // The same lookup runs at every segment on the way down, not only the leaf.
    const { document, issues } = tokensToDtcg({
      tokens: [
        { name: "a.constructor.b", kind: "number", values: { light: "1" } },
      ],
    });
    expect(issues).toEqual([]);
    const written = JSON.parse(JSON.stringify(document)) as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(written["a"]?.["constructor"]?.["b"]).toBeDefined();
  });

  it("round-trips such a token back to the same name", () => {
    const { document } = tokensToDtcg({
      tokens: [{ name: "constructor", kind: "number", values: { light: "1" } }],
    });
    const read = dtcgToTokens(JSON.parse(JSON.stringify(document)));
    expect(read.issues).toEqual([]);
    expect(read.tokens.map(token => token.name)).toEqual(["constructor"]);
  });

  it("still refuses a genuine duplicate at such a name", () => {
    // The control. Own-key lookups must not stop the emitter noticing a path
    // it really has written already.
    const { issues } = tokensToDtcg({
      tokens: [
        { name: "constructor", kind: "number", values: { light: "1" } },
        {
          id: "other",
          name: "constructor",
          kind: "number",
          values: { light: "2" },
        },
      ],
    });
    expect(issues.map(issue => issue.message).join(" ")).toContain(
      "exported more than once"
    );
  });
});

describe("a file describing one token twice", () => {
  const withBoth = (value: unknown, stored: string, type: string): unknown => ({
    one: {
      $type: type,
      $value: value,
      $extensions: {
        [NEXTLY_EXTENSION]: { css: { light: stored }, kind: type },
      },
    },
  });

  it("names a value the file states and this system did not use", () => {
    /*
     * The extension wins, which is right — it holds what the author typed. But
     * when the two genuinely disagree the file's value is discarded, the next
     * export rewrites `$value` to match, and a hand-edited file loses the edit
     * while reporting success.
     */
    const read = dtcgToTokens(
      withBoth(
        { colorSpace: "srgb", components: [0, 0, 0] },
        "#111111",
        "color"
      )
    );
    // The behaviour is unchanged: the stored value is still the one taken.
    expect(read.tokens[0]?.values.light).toBe("#111111");
    expect(read.issues.map(issue => issue.message).join(" ")).toContain(
      "was not used"
    );
  });

  it.each(["#111", "rgb(17 17 17)"])(
    "stays silent when the two only SPELL it differently (%s)",
    stored => {
      /*
       * The control this whole check turns on. A token stored in either of
       * these spellings comes back from `$value` as `#111111`, so comparing the
       * two as text reports a disagreement on files this system wrote itself —
       * and a report that fires on correct files is the one that gets ignored.
       */
      const read = dtcgToTokens(
        withBoth(
          {
            colorSpace: "srgb",
            components: [0.0667, 0.0667, 0.0667],
            hex: "#111111",
          },
          stored,
          "color"
        )
      );
      expect(read.tokens[0]?.values.light).toBe(stored);
      expect(read.issues).toEqual([]);
    }
  );

  it("stays silent for a kind it cannot compare by meaning", () => {
    /*
     * The documented gap, asserted so it is visible here and not only in a
     * comment. Only colour has a normaliser to hand, and text differing is not
     * enough on its own — `1rem` and `1.0rem` are the same dimension — so every
     * other kind errs toward saying nothing. This fixture DOES disagree, and is
     * still not reported.
     */
    const read = dtcgToTokens(
      withBoth({ value: 1, unit: "rem" }, "2rem", "dimension")
    );
    expect(read.tokens[0]?.values.light).toBe("2rem");
    expect(read.issues).toEqual([]);
  });

  it("says nothing about a token this system exported itself", () => {
    // The round trip, end to end: our own file must never carry this line.
    const { document } = tokensToDtcg({
      tokens: [
        {
          name: "brand",
          kind: "color",
          values: { light: "#111", dark: "#eee" },
        },
      ],
    });
    const read = dtcgToTokens(JSON.parse(JSON.stringify(document)));
    expect(read.issues).toEqual([]);
    expect(read.tokens[0]?.values).toEqual({ light: "#111", dark: "#eee" });
  });
});

describe("this system's own extension, on the way in", () => {
  it("keeps a field this version does not read, and says nothing", () => {
    /*
     * This key is SPLIT, where another vendor's block is carried whole: the
     * fields the reader knows are taken into the model, and the rest is kept
     * beside them. A field a newer build wrote survives an import by an older
     * one, so there is no loss to report.
     */
    const read = dtcgToTokens({
      one: {
        $type: "number",
        $value: 1,
        $extensions: {
          [NEXTLY_EXTENSION]: { id: "stable", future: "keep-me" },
        },
      },
    });
    expect(read.tokens[0]?.id).toBe("stable");
    expect(read.tokens[0]?.unreadExtension).toEqual({ future: "keep-me" });
    expect(read.issues).toEqual([]);
  });

  it("writes that field back out where it was found", () => {
    /*
     * Keeping it is only half the requirement — the point of preserving is that
     * the NEXT export carries it, which is what makes an older build safe to
     * round-trip a newer file. Read back rather than compared as an object, so
     * the assertion is about the key the field lands under and not only about
     * its presence somewhere.
     */
    const { document } = tokensToDtcg({
      tokens: [
        {
          name: "one",
          kind: "number",
          values: { light: "1" },
          unreadExtension: { future: "keep-me" },
        },
      ],
    });
    const written = (document.one as { $extensions: Record<string, unknown> })
      .$extensions[NEXTLY_EXTENSION] as Record<string, unknown>;
    expect(written.future).toBe("keep-me");
    // And the fields the model states are still there beside it.
    expect(written.kind).toBe("number");
    expect(written.css).toEqual({ light: "1" });
  });

  it("does not let a stored copy shadow a field the model states", () => {
    /*
     * The staleness case, and the reason the filter runs on the way OUT as well
     * as on the way in. A token stored by a build that could not read `css`
     * carries a copy of it; this build reads `css` into the model, so the copy
     * is a stale statement of a value the site may since have changed. The live
     * value has to win.
     *
     * Population first: the fixture really does carry the colliding keys, so a
     * pass cannot come from an empty preserved set.
     */
    const stale = { css: { light: "#stale" }, kind: "color", future: "keep" };
    expect(Object.keys(stale)).toEqual(["css", "kind", "future"]);

    const { document } = tokensToDtcg({
      tokens: [
        {
          name: "one",
          kind: "number",
          values: { light: "1" },
          unreadExtension: stale,
        },
      ],
    });
    const written = (document.one as { $extensions: Record<string, unknown> })
      .$extensions[NEXTLY_EXTENSION] as Record<string, unknown>;
    expect(written.css).toEqual({ light: "1" });
    expect(written.kind).toBe("number");
    // The field that is genuinely unread still survives.
    expect(written.future).toBe("keep");
  });

  it("keeps a field named `__proto__` rather than losing it to the prototype", () => {
    /*
     * A file is arbitrary JSON, and `JSON.parse` makes `__proto__` an ordinary
     * own property. Building the preserved set by ASSIGNMENT would reach
     * `Object.prototype`'s setter instead of storing anything, so the one name
     * that most needs preserving would be the one silently dropped.
     *
     * Parsed rather than written as a literal, because `{ __proto__: x }` in
     * source sets the prototype and would make this test pass against a
     * fixture that never held the key. Asserted before it is used.
     */
    const own = JSON.parse(
      '{"kind":"number","css":{"light":"1"},"__proto__":7}'
    );
    expect(Object.hasOwn(own, "__proto__")).toBe(true);

    const read = dtcgToTokens({
      one: {
        $type: "number",
        $value: 1,
        $extensions: { [NEXTLY_EXTENSION]: own },
      },
    });
    const kept = read.tokens[0]?.unreadExtension;
    expect(kept === undefined ? [] : Object.keys(kept)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(kept)).toBe(Object.prototype);
  });

  it("names a per-mode value it has no mode for, rather than keeping it", () => {
    /*
     * The boundary of what preserving reaches, stated so it is a known limit
     * rather than a surprise. A member added INSIDE `css` by a newer build is
     * not preserved, because `css` is the token's value and a member written
     * back beside a value the author has since edited would state a mode for a
     * colour that no longer exists.
     *
     * Population first: the top-level field beside it IS preserved, so this
     * asserts a difference between the two levels and not a failure to preserve
     * anything at all.
     */
    const read = dtcgToTokens({
      one: {
        $type: "color",
        $value: "#111111",
        $extensions: {
          [NEXTLY_EXTENSION]: {
            kind: "color",
            css: { light: "#111111", highContrast: "#000000" },
            future: "keep-me",
          },
        },
      },
    });
    expect(read.tokens[0]?.unreadExtension).toEqual({ future: "keep-me" });
    expect(read.issues.map(i => i.message).join(" ")).toContain("highContrast");
  });

  it("writesNoFieldItDoesNotDeclare: a round trip preserves nothing", () => {
    /*
     * What holds the named field set to the emitter, asserted by BUILDING a
     * file rather than by reading the set. Every field the emitter writes under
     * this key is one the reader takes into the model, so re-importing this
     * system's own export must find nothing left over — a field added to the
     * emitter and not to the set arrives here as preserved data and fails this.
     *
     * Two tokens, so the assertion covers the branch that writes an id and the
     * branch that omits it.
     */
    const { document } = tokensToDtcg({
      tokens: [
        {
          id: "color.primary",
          name: "brand.main",
          kind: "color",
          values: { light: "#111111", dark: "#eeeeee" },
        },
        { name: "space.4", kind: "dimension", values: { light: "1rem" } },
      ],
    });
    const read = dtcgToTokens(JSON.parse(JSON.stringify(document)));
    expect(read.issues).toEqual([]);
    expect(read.tokens).toHaveLength(2);
    expect(read.tokens.map(token => token.unreadExtension)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("says nothing about ANOTHER vendor's fields", () => {
    // The control: those are carried, not consumed, so nothing is lost and a
    // report would fire on every file from every other tool.
    const read = dtcgToTokens({
      one: {
        $type: "number",
        $value: 1,
        $extensions: { "com.figma": { anything: "at all" } },
      },
    });
    expect(read.issues).toEqual([]);
    expect(read.tokens[0]?.extensions).toEqual({
      "com.figma": { anything: "at all" },
    });
  });
});

describe("a var() substitution CSS will actually make", () => {
  it("reads a well-formed call as dynamic, closed either way", () => {
    // The two legal terminators: the closing paren, and a comma opening a
    // fallback. Both are values a browser substitutes into, so neither is a
    // fault to report.
    expect(readFamilyList("var(--brand)").kind).toBe("dynamic");
    expect(readFamilyList("var(--brand, serif)").kind).toBe("dynamic");
    expect(readFamilyList("var(--a, var(--b))").kind).toBe("dynamic");
  });

  it("refuses a name that is not a custom property", () => {
    // `--` is what makes an identifier a custom property. `var(foo)` computes
    // to nothing, so the declaration is dropped rather than falling through.
    expect(readFamilyList("var(foo)").kind).toBe("invalid");
  });

  it("refuses a space between the name and the paren", () => {
    // CSS produces a function token only when the identifier TOUCHES the `(`.
    // `var (--brand)` is an identifier beside a parenthesised block, which the
    // font-family grammar has no reading for at all.
    expect(readFamilyList("var (--brand)").kind).toBe("invalid");
  });

  it("refuses a first argument that never terminates", () => {
    // After the custom-property name only a comma or the closing paren may
    // follow; anything else is a syntax error, and the browser drops the
    // declaration rather than reading the name and ignoring the rest.
    expect(readFamilyList("var(--brand extra)").kind).toBe("invalid");
    expect(readFamilyList("var(--brand serif)").kind).toBe("invalid");
  });

  it("refuses a call that never closes", () => {
    // Checking the first argument alone accepted this: the name and its comma
    // are both well formed, and the declaration is still a syntax error the
    // browser drops.
    expect(readFamilyList("var(--brand, serif").kind).toBe("invalid");
    expect(readFamilyList("var(--brand").kind).toBe("invalid");
    // A close with nothing open is as broken as one that never closes.
    expect(readFamilyList("var(--brand))").kind).toBe("invalid");
  });

  it("keeps an ESCAPED space inside a custom-property name", () => {
    /*
     * `--brand\ face` is one identifier to a browser. The reader decodes that
     * escape before the name exists, where a literal space is indistinguishable
     * from the whitespace that ends an argument — so the check reads the RAW
     * spelling, where the backslash is still there.
     */
    const escaped = `var(--brand${String.fromCharCode(92)} face)`;
    expect(readFamilyList(escaped).kind).toBe("dynamic");
  });

  it("lets one malformed call spoil the list it sits in", () => {
    // A declaration is dropped whole, so a good call beside a bad one does not
    // rescue it.
    expect(readFamilyList("var(--ok), var(bad)").kind).toBe("invalid");
    expect(readFamilyList("var(--ok), var (--also-ok)").kind).toBe("invalid");
  });
});
