/**
 * Where one of the site's fonts is used, as the Fonts screen says it: the
 * Body and Headings fonts, read from the rows they are written on, and the
 * font variables whose first family it is, each with the fallback its text
 * gets once the font is gone.
 *
 * @module font-uses.test
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { familyUses, roleRefusal, nowYourFontWords } from "./font-uses";
import { withFontRole } from "./site-font-roles-model";

const BASE: SiteTokenSet = {
  tokens: [
    {
      name: "font.display",
      label: "Display",
      kind: "fontFamily",
      values: { light: '"Lora", Georgia, serif' },
    },
    {
      name: "font.quote",
      label: "Quote",
      kind: "fontFamily",
      values: { light: "Inter, sans-serif", dark: '"Lora", serif' },
    },
    {
      name: "font.code",
      kind: "fontFamily",
      values: { light: "monospace" },
    },
  ],
};

describe("where a font is used", () => {
  it("names nothing for a font nothing uses", () => {
    expect(familyUses("brand", BASE)).toEqual({ roles: [], variables: [] });
  });

  it("names the font variables whose first family it is, in either mode, with each one's fallback", () => {
    const uses = familyUses("lora", BASE);
    expect(uses.roles).toEqual([]);
    expect(uses.variables).toEqual([
      { identity: "font.display", label: "Display", fallback: "Georgia, serif" },
      { identity: "font.quote", label: "Quote", fallback: "serif" },
    ]);
  });

  it("names the Body and Headings fonts, and not the variables that hold them", () => {
    const body = withFontRole(BASE, "body", '"Lora", serif');
    const both = withFontRole(body, "heading", '"Lora", serif');
    expect(familyUses("lora", both).roles).toEqual(["body", "heading"]);
    expect(
      familyUses("lora", both).variables.map(entry => entry.identity)
    ).toEqual(["font.display", "font.quote"]);
    // Headings alone: Body keeps the site's own font.
    const headings = withFontRole(BASE, "heading", '"Lora", serif');
    expect(familyUses("lora", headings).roles).toEqual(["heading"]);
  });

  it("matches a family however its case is written", () => {
    const body = withFontRole(BASE, "body", '"LORA", serif');
    expect(familyUses("lora", body).roles).toEqual(["body"]);
  });

  it("says the browser's own font is the fallback where a stack names nothing after the font", () => {
    const lone: SiteTokenSet = {
      tokens: [
        { name: "font.lone", kind: "fontFamily", values: { light: "Lora" } },
      ],
    };
    expect(familyUses("lora", lone).variables[0]?.fallback).toBe(
      "the browser’s own font"
    );
  });

  it("reads nothing before the variables are read", () => {
    expect(familyUses("lora", undefined)).toEqual({
      roles: [],
      variables: [],
    });
  });
});

describe("refusing to remove the Body or Headings font", () => {
  it("names the role and says to choose another first", () => {
    expect(roleRefusal("Lora", ["body"])).toBe(
      "Lora is your body font. Choose another body font first."
    );
    expect(roleRefusal("Lora", ["heading"])).toBe(
      "Lora is your headings font. Choose another headings font first."
    );
    expect(roleRefusal("Lora", ["body", "heading"])).toBe(
      "Lora is your body and headings font. Choose other body and headings fonts first."
    );
  });

  it("refuses nothing for a font that is neither", () => {
    expect(roleRefusal("Lora", [])).toBeUndefined();
  });
});

describe("what using a new font says", () => {
  it("says which font it now is", () => {
    expect(nowYourFontWords("Inter", ["heading"])).toBe(
      "Inter is now your headings font"
    );
    expect(nowYourFontWords("Inter", ["body"])).toBe("Inter is now your body font");
    expect(nowYourFontWords("Inter", ["body", "heading"])).toBe(
      "Inter is now your body and headings font"
    );
  });
});
