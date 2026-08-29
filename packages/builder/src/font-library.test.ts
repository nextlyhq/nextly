/**
 * The font-library rules, asserted on the cases that separate them.
 *
 * Every fixture here is chosen because a plausible wrong implementation gives a
 * different answer on it: a quoted generic, a face whose family IS a generic
 * keyword, a family name containing the separator, and a stack whose later
 * entries rescue a first choice that does not resolve.
 *
 * @module font-library.test
 */
import type { FontFaceDef, SiteTokenSet } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  fontTokenRows,
  readStack,
  rowsNeedingAttention,
  tokenNotes,
  tokenSummary,
} from "./font-library";

const face = (family: string): FontFaceDef => ({
  family,
  src: [{ url: "/fonts/f.woff2", format: "woff2" }],
});

const token = (
  name: string,
  light: string,
  kind: SiteTokenSet["tokens"][number]["kind"] = "fontFamily"
): SiteTokenSet["tokens"][number] => ({ name, kind, values: { light } });

describe("reading a font-family value against the faces a site loads", () => {
  it("calls a generic keyword generic, and the same word QUOTED a name", () => {
    // `font-family: serif` asks the browser for its serif default;
    // `font-family: "serif"` asks for a font somebody called serif. Reading
    // both as the keyword would report a missing font as guaranteed.
    expect(readStack("serif", []).families).toEqual([
      { family: "serif", source: "generic" },
    ]);
    expect(readStack('"serif"', []).families).toEqual([
      { family: "serif", source: "not-provided" },
    ]);
  });

  it("keeps a bare generic generic even when a face claims that name", () => {
    // The engine emits every face family QUOTED — `font-family:"serif"` — and
    // an unquoted `serif` in a stack is the CSS keyword, which no `@font-face`
    // can claim. So a site loading a face it called `serif` still gets the
    // browser default from a bare `serif`, and only a quoted value reaches the
    // file. Reporting it as hosted would tell an author their file is in use
    // when the page never loads it.
    expect(readStack("serif", [face("serif")]).families).toEqual([
      { family: "serif", source: "generic" },
    ]);
    expect(readStack('"serif"', [face("serif")]).families).toEqual([
      { family: "serif", source: "hosted" },
    ]);
  });

  it("treats a family name containing a comma as ONE family", () => {
    // The separating case for the parser: a plain split turns a real company's
    // font into a fallback list failing over to a family called `Inc`.
    const reading = readStack('"ACME, Inc", serif', [face("ACME, Inc")]);
    expect(reading.families).toEqual([
      { family: "ACME, Inc", source: "hosted" },
      { family: "serif", source: "generic" },
    ]);
  });

  it("matches a family case-insensitively, in both directions", () => {
    expect(readStack("Sans-Serif", []).families[0]?.source).toBe("generic");
    expect(readStack("brand", [face("Brand")]).families[0]?.source).toBe(
      "hosted"
    );
  });

  it("reports the FIRST choice separately from whether anything renders", () => {
    // The case the whole module exists for: the page draws, so nothing looks
    // wrong, and the typeface the author picked is not the one on screen.
    const reading = readStack("Brand, serif", []);
    expect(reading.firstChoice).toEqual({
      family: "Brand",
      source: "not-provided",
    });
    expect(reading.guaranteed).toBe(true);
  });

  it("does not guarantee a stack of named families alone", () => {
    const reading = readStack("Brand, Helvetica", []);
    expect(reading.guaranteed).toBe(false);
    expect(reading.kind).toBe("families");
  });

  it("reports a value no browser reads as invalid, and names no families", () => {
    // `10px` tokenizes as a dimension, so the browser drops the declaration.
    // Naming its families would describe a resolution that never happens.
    const reading = readStack("10px, serif", [face("Brand")]);
    expect(reading.kind).toBe("invalid");
    expect(reading.families).toEqual([]);
    expect(reading.firstChoice).toBeUndefined();
  });

  it("reads a var() stack as DYNAMIC, not as broken", () => {
    // The regression this file exists to stop. `var(--font-geist), sans-serif`
    // is valid, common CSS — it is how a host-managed font is wired — and
    // calling it unreadable tells an author their working token applies
    // nothing.
    const reading = readStack("var(--font-geist), sans-serif", []);
    expect(reading.kind).toBe("dynamic");
    expect(reading.families[0]).toEqual({
      family: "var(--font-geist)",
      source: "dynamic",
    });
    expect(reading.guaranteed).toBe(true);
  });

  it("reads a lone CSS-wide keyword as a keyword, and one in a LIST as invalid", () => {
    // `inherit` is a working value naming no family; `inherit, serif` is a
    // parse error. Treating the first as a font called "inherit" invents a
    // problem, and the second as a stack invents a fallback.
    expect(readStack("inherit", []).kind).toBe("keyword");
    expect(readStack("inherit, serif", []).kind).toBe("invalid");
  });

  it("refuses a list with an empty item, however it was written", () => {
    // A stray comma is a parse error the browser drops the whole declaration
    // for. Discarding the empty item reported `Brand,` as the family `Brand` —
    // a value the page never rendered.
    for (const value of ["Brand,", ", Brand", "Brand,, serif"]) {
      expect(readStack(value, [face("Brand")]).kind).toBe("invalid");
    }
  });

  it("reads a MALFORMED var() as invalid, not as dynamic", () => {
    // CSS requires the first argument to be a custom-property name, so
    // `var(foo)` computes to an invalid font-family and the browser drops the
    // declaration rather than falling through to `serif`. Reading every `var(`
    // as dynamic gave a dropped declaration an all-clear.
    expect(readStack("var(foo), serif", []).kind).toBe("invalid");
    expect(readStack("var(--ok), serif", []).kind).toBe("dynamic");
    // One malformed call spoils the value however many good ones sit beside it.
    expect(readStack("var(--a), var(bad)", []).kind).toBe("invalid");
  });

  it("keeps the whitespace inside a QUOTED family name", () => {
    // Inside quotes the spaces are part of the name, so `" Brand "` names a
    // different family from `Brand` and must not match a face called `Brand`.
    expect(readStack('" Brand "', [face("Brand")]).families[0]).toEqual({
      family: " Brand ",
      source: "not-provided",
    });
    // The control: whitespace OUTSIDE the quotes is separation, and still trims.
    expect(readStack(' "Brand" ', [face("Brand")]).families[0]).toEqual({
      family: "Brand",
      source: "hosted",
    });
  });

  it("matches a face whose OWN name carries the edge spaces", () => {
    // `emitFontFaces` writes the family verbatim, so a face called `" Brand "`
    // declares a family whose name holds those spaces and a token quoting them
    // selects it. Both sides have to normalise the same way or a face the
    // browser matches is reported as one the site never loads.
    expect(readStack('" Brand "', [face(" Brand ")]).families[0]).toEqual({
      family: " Brand ",
      source: "hosted",
    });
    // The control, in the other direction: the padded face does NOT answer for
    // the unpadded name.
    expect(readStack("Brand", [face(" Brand ")]).families[0]).toEqual({
      family: "Brand",
      source: "not-provided",
    });
  });

  it("reports only tokens the compiler actually writes", () => {
    // `emitTokenBlocks` refuses a token whose name is not a token name, so it
    // reaches no page. Reporting on it would describe a typeface the site never
    // emits — and claim its hosted family renders when nothing references it.
    const rows = fontTokenRows(
      {
        tokens: [
          { name: "bad name", kind: "fontFamily", values: { light: "Brand" } },
          { name: "brand.ok", kind: "fontFamily", values: { light: "Brand" } },
        ],
      },
      [face("Brand")]
    );
    expect(rows.map(r => r.token.name)).toEqual(["brand.ok"]);
  });

  it("counts only faces the compiler will actually emit", () => {
    // A remote src is refused by `validateFontFace`, so no `@font-face` reaches
    // the sheet. Counting it as hosted marks a token healthy against a file the
    // site never loads.
    const remote: FontFaceDef = {
      family: "Brand",
      src: [{ url: "https://cdn.example.com/brand.woff2", format: "woff2" }],
    };
    expect(readStack("Brand", [remote]).families[0]?.source).toBe(
      "not-provided"
    );
    expect(readStack("Brand", [face("Brand")]).families[0]?.source).toBe(
      "hosted"
    );
  });
});

describe("the rows a fonts panel draws", () => {
  const tokens: SiteTokenSet = {
    tokens: [
      token("brand.body", "Brand, serif"),
      token("brand.heading", "serif"),
      // A font SIZE is typography and is not a typeface. Its presence is the
      // control: a filter reading the whole set would put it in the list.
      token("brand.size", "16px", "dimension"),
    ],
  };

  it("lists fontFamily tokens ONLY", () => {
    const rows = fontTokenRows(tokens, []);
    expect(rows.map(r => r.token.name)).toEqual([
      "brand.body",
      "brand.heading",
    ]);
  });

  it("answers an absent token set with no rows rather than throwing", () => {
    expect(fontTokenRows(undefined, [])).toEqual([]);
  });

  it("draws attention to the row whose FIRST choice this site does not provide", () => {
    const rows = fontTokenRows(tokens, []);
    expect(rowsNeedingAttention(rows).map(r => r.token.name)).toEqual([
      "brand.body",
    ]);
  });

  it("stops drawing attention once a face for that family is loaded", () => {
    // The must-move half: the same tokens, one face added, and the row leaves
    // the list. Without this the filter could be returning a constant.
    const rows = fontTokenRows(tokens, [face("Brand")]);
    expect(rowsNeedingAttention(rows)).toEqual([]);
  });

  it("draws attention to a value no browser will read", () => {
    const rows = fontTokenRows(
      { tokens: [token("brand.body", "10px, serif")] },
      []
    );
    expect(rowsNeedingAttention(rows).map(r => r.token.name)).toEqual([
      "brand.body",
    ]);
  });

  it("does NOT draw attention to a var() stack", () => {
    // The control for the regression: a host-managed font is wired through a
    // custom property, and flagging it would report working configuration as
    // broken on the most idiomatic Next.js setup there is.
    const rows = fontTokenRows(
      { tokens: [token("brand.body", "var(--font-geist), sans-serif")] },
      []
    );
    expect(rowsNeedingAttention(rows)).toEqual([]);
  });
});

describe("the sentence the panel draws", () => {
  const rowsFor = (stacks: readonly string[], faces: FontFaceDef[] = []) =>
    fontTokenRows({ tokens: stacks.map((v, i) => token(`t${i}`, v)) }, faces);

  it("says the check ran even when nothing needs attention", () => {
    const rows = rowsFor(["serif"]);
    expect(tokenSummary(rows, rowsNeedingAttention(rows))).toBe(
      "1 typeface token, none asking first for a typeface this site provides no file for."
    );
  });

  it("does not claim a dynamic or keyword row asks for a provided family", () => {
    // The all-clear must report what was CHECKED, not more. A var() stack has
    // an unknown first choice and a lone `inherit` names no family at all, so
    // "each asking first for a family this site provides" would claim something
    // about rows this code cannot resolve.
    const rows = rowsFor(["var(--x), serif", "inherit"]);
    const summary = tokenSummary(rows, rowsNeedingAttention(rows));
    expect(summary).toContain(
      "none asking first for a typeface this site provides no file for"
    );
    expect(summary).not.toContain(
      "each asking first for a family this site provides"
    );
  });

  it("counts a token failing DIFFERENTLY in each mode under both headings", () => {
    // Invalid in light and unprovided in dark. Deriving one count as
    // `attention.length - other` forced this row into one heading and out of
    // the other, omitting a problem `tokenNotes` reports on the same row.
    const rows = fontTokenRows(
      {
        tokens: [
          {
            name: "brand.body",
            kind: "fontFamily",
            values: { light: "10px, serif", dark: "Ghost, serif" },
          },
        ],
      },
      []
    );
    const summary = tokenSummary(rows, rowsNeedingAttention(rows));
    expect(summary).toContain("1 ask first for a typeface");
    expect(summary).toContain("1 hold a value no browser will read");
  });

  it("counts UNREADABLE and UNPROVIDED separately", () => {
    // They have different remedies. One count covering both sends an author to
    // fix the wrong thing: an unreadable value applies nothing at all, while an
    // unprovided first family applies the next one.
    const rows = rowsFor(["Brand, serif", "10px, serif", "serif"]);
    const summary = tokenSummary(rows, rowsNeedingAttention(rows));
    expect(summary).toContain(
      "1 ask first for a typeface this site provides no file for"
    );
    expect(summary).toContain("1 hold a value no browser will read");
  });

  it("points at the Tokens panel when there is nothing to report on", () => {
    expect(tokenSummary([], [])).toContain("Tokens panel");
  });

  it("never calls a family missing or unavailable", () => {
    const rows = rowsFor(["Brand, serif"]);
    const text = tokenNotes(rows[0]!)[0]?.text ?? "";
    expect(text).toContain("provides no font file for it");
    expect(text.toLowerCase()).not.toContain("missing");
    expect(text.toLowerCase()).not.toContain("unavailable");
  });

  it("says a DIFFERENT thing for an unreadable value than an unprovided one", () => {
    const unreadable = tokenNotes(rowsFor(["10px, serif"])[0]!)[0]?.text ?? "";
    const unprovided = tokenNotes(rowsFor(["Brand, serif"])[0]!)[0]?.text ?? "";
    expect(unreadable).toContain("applies nothing");
    expect(unprovided).toContain("see the next family");
    expect(unreadable).not.toBe(unprovided);
  });

  it("does not promise a next family when the stack has none", () => {
    // `Brand` alone has no later entry, so telling the author readers see "the
    // next family in the list" names something that is not there.
    const single = tokenNotes(rowsFor(["Brand"])[0]!)[0]?.text ?? "";
    expect(single).toContain("the browser's default typeface");
    expect(single).not.toContain("next family in the list");
  });

  it("says nothing about a row that is working as written", () => {
    expect(tokenNotes(rowsFor(["serif"])[0]!)).toEqual([]);
    expect(tokenNotes(rowsFor(['"Brand"'], [face("Brand")])[0]!)).toEqual([]);
    // A lone CSS-wide keyword is a deliberate working value, not a fault.
    expect(tokenNotes(rowsFor(["inherit"])[0]!)).toEqual([]);
    // And a var() stack is readable; reporting it would be the false claim.
    expect(tokenNotes(rowsFor(["var(--x), serif"])[0]!)).toEqual([]);
  });

  it("reads the DARK value too, and names the mode when one is declared", () => {
    // The emitter applies `values.dark` in dark mode, so a token sound in light
    // and unprovided in dark would otherwise report an all-clear while every
    // dark-mode reader gets a substitution.
    const rows = fontTokenRows(
      {
        tokens: [
          {
            name: "brand.body",
            kind: "fontFamily",
            values: { light: '"Brand", serif', dark: "Ghost, serif" },
          },
        ],
      },
      [face("Brand")]
    );
    const notes = tokenNotes(rows[0]!);
    expect(notes.map(n => n.mode)).toEqual(["dark"]);
    expect(notes[0]?.text).toContain("Ghost");
    expect(rowsNeedingAttention(rows)).toHaveLength(1);
  });
});
