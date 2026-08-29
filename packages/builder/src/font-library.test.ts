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
  tokenNote,
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

  it("prefers a HOSTED face over the generic of the same name", () => {
    // A site may load a face called `serif`. That face is what renders, so
    // reporting the browser default would name the wrong source.
    expect(readStack("serif", [face("serif")]).families).toEqual([
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
    expect(reading.usable).toBe(true);
  });

  it("reports an unusable value as unusable and names no families", () => {
    // A stack carrying `var()` is not a family list the browser reads. Naming
    // its families would describe a resolution that never happens.
    const reading = readStack("var(--brand-font)", [face("Brand")]);
    expect(reading.usable).toBe(false);
    expect(reading.families).toEqual([]);
    expect(reading.firstChoice).toBeUndefined();
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

  it("draws attention to an unusable value too", () => {
    const rows = fontTokenRows(
      { tokens: [token("brand.body", "var(--x)")] },
      []
    );
    expect(rowsNeedingAttention(rows).map(r => r.token.name)).toEqual([
      "brand.body",
    ]);
  });
});

describe("the sentence the panel draws", () => {
  const rowsFor = (stacks: readonly string[], faces: FontFaceDef[] = []) =>
    fontTokenRows({ tokens: stacks.map((v, i) => token(`t${i}`, v)) }, faces);

  it("says the check ran even when nothing needs attention", () => {
    // Silence is also what a panel that never checked would show, so a count of
    // zero has to be stated rather than left off.
    const rows = rowsFor(["serif"]);
    expect(tokenSummary(rows, rowsNeedingAttention(rows))).toBe(
      "1 typeface token, each asking first for a family this site provides."
    );
  });

  it("counts the rows needing attention against the whole set", () => {
    const rows = rowsFor(["Brand, serif", "serif"]);
    expect(tokenSummary(rows, rowsNeedingAttention(rows))).toBe(
      "1 of 2 ask first for a typeface this site provides no file for."
    );
  });

  it("points at the Tokens panel when there is nothing to report on", () => {
    expect(tokenSummary([], [])).toContain("Tokens panel");
  });

  it("never calls a family missing or unavailable", () => {
    // The wording rule, asserted rather than trusted to review: a family this
    // site loads no face for may still be installed on the reader's device.
    const rows = rowsFor(["Brand, serif"]);
    const note = tokenNote(rows[0]!) ?? "";
    expect(note).toContain("provides no font file for it");
    expect(note.toLowerCase()).not.toContain("missing");
    expect(note.toLowerCase()).not.toContain("unavailable");
    expect(
      tokenSummary(rows, rowsNeedingAttention(rows)).toLowerCase()
    ).not.toContain("missing");
  });

  it("says a DIFFERENT thing for an unusable value than for an unprovided one", () => {
    // They are different outcomes: one applies nothing at all, the other
    // applies the next family. One sentence for both would misdescribe one.
    const unusable = tokenNote(rowsFor(["var(--x)"])[0]!) ?? "";
    const unprovided = tokenNote(rowsFor(["Brand, serif"])[0]!) ?? "";
    expect(unusable).toContain("applies nothing");
    expect(unprovided).toContain("see the next family");
    expect(unusable).not.toBe(unprovided);
  });

  it("says nothing about a row that is working as written", () => {
    expect(tokenNote(rowsFor(["serif"])[0]!)).toBeUndefined();
    expect(tokenNote(rowsFor(["Brand"], [face("Brand")])[0]!)).toBeUndefined();
  });
});
