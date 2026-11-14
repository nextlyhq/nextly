/**
 * A title or description is judged by how wide it draws on Google's results
 * page, not by how many characters it has. The separating cases are the two
 * a character count gets wrong: narrow letters past 60 characters that fit,
 * and wide capitals short of 60 that Google cuts.
 */
import { describe, expect, it } from "vitest";

import {
  cutToFit,
  SEARCH_TEXT,
  textFit,
  textWidth,
  widthText,
} from "../text-width";

/** 65 characters, mostly narrow letters: past 60, and well inside 600 px. */
const NARROW_TITLE =
  "Little tips: fill it in, lift it, tilt it, till it is still. jilt";

/** 50 characters of wide capitals: short of 60, and past 600 px. */
const WIDE_TITLE = "WOMEN'S WORKWEAR MADE WELL: MEMBER OFFERS AND NEWS";

describe("textWidth", () => {
  it("measures Arial's advance widths at the size given", () => {
    // Arial's "i" is 455 of 2048 units and its "W" 1933, so at 20 px one
    // "i" is about 4.4 px and one "W" about 18.9 px.
    expect(textWidth("i", 20)).toBeCloseTo(4.443, 2);
    expect(textWidth("W", 20)).toBeCloseTo(18.877, 2);
    expect(textWidth("Harbour walk | Example", 20)).toBeCloseTo(211.9, 1);
    // A description is drawn at 14 px, so the same text is narrower.
    expect(textWidth("Harbour walk | Example", 14)).toBeCloseTo(148.4, 1);
  });

  it("measures an accented letter past Latin-1 as wide as its letter", () => {
    expect(textWidth("č", 20)).toBeCloseTo(textWidth("c", 20), 5);
    expect(textWidth("é", 20)).toBeCloseTo(textWidth("e", 20), 5);
  });

  it("measures an emoji, however it is joined, and a Chinese character as one em", () => {
    expect(textWidth("😀", 20)).toBe(20);
    // A family emoji is three pictures joined into what draws as one.
    expect(textWidth("👨‍👩‍👧", 20)).toBe(20);
    expect(textWidth("汉", 20)).toBe(20);
  });
});

describe("textWidth past Latin-1", () => {
  it("measures the punctuation titles use as Arial draws it", () => {
    // An em dash and an ellipsis are a whole em; an en dash an "n".
    expect(textWidth("\u2014", 20)).toBe(20);
    expect(textWidth("\u2026", 20)).toBe(20);
    expect(textWidth("\u2013", 20)).toBeCloseTo(textWidth("n", 20), 5);
  });

  it("measures a letter of another script as an average letter, and a mark or joiner as nothing", () => {
    expect(textWidth("\u0434", 20)).toBeCloseTo(textWidth("n", 20), 5);
    expect(textWidth("\u200B", 20)).toBe(0);
    expect(textWidth("a\u0301", 20)).toBeCloseTo(textWidth("a", 20), 5);
    expect(textWidth("\u0007", 20)).toBe(0);
  });
});

describe("textFit", () => {
  it("fits a title of narrow letters past 60 characters", () => {
    const fit = textFit("title", NARROW_TITLE);
    expect(fit.characters).toBe(65);
    expect(fit.fits).toBe(true);
    expect(fit.pixels).toBe(369);
    expect(fit.limit).toBe(600);
  });

  it("cuts a title of wide capitals short of 60 characters", () => {
    const fit = textFit("title", WIDE_TITLE);
    expect(fit.characters).toBe(50);
    expect(fit.fits).toBe(false);
    expect(fit.pixels).toBe(646);
  });

  it("measures a description at its own size against its own width", () => {
    expect(SEARCH_TEXT.description).toEqual({ fontSize: 14, width: 920 });
    // The wide title as a description fits: 14 px and 920 px.
    expect(textFit("description", WIDE_TITLE)).toMatchObject({
      pixels: 452,
      limit: 920,
      fits: true,
    });
  });

  it("fits at the limit and not one pixel past it", () => {
    // "i" draws 4.443 px at 20 px: 135 of them round to 600, 136 to 604.
    expect(textFit("title", "i".repeat(135))).toMatchObject({
      pixels: 600,
      fits: true,
    });
    expect(textFit("title", "i".repeat(136)).fits).toBe(false);
  });

  it("writes the width as every surface shows it", () => {
    expect(widthText(textFit("title", NARROW_TITLE))).toBe("369 of 600 px");
  });
});

describe("cutToFit", () => {
  it("keeps a title that fits whole", () => {
    expect(cutToFit("title", NARROW_TITLE)).toBe(NARROW_TITLE);
  });

  it("cuts a wide title at the last word that fits, with room for the ellipsis", () => {
    const cut = cutToFit("title", WIDE_TITLE);
    // "… OFFERS AND …" would draw 606 px, so the cut comes a word sooner.
    expect(cut).toBe("WOMEN'S WORKWEAR MADE WELL: MEMBER OFFERS …");
    expect(textWidth(cut, 20)).toBeLessThanOrEqual(600);
    expect(
      textWidth("WOMEN'S WORKWEAR MADE WELL: MEMBER OFFERS AND …", 20)
    ).toBeGreaterThan(600);
  });
});
