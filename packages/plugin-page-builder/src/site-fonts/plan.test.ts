import type { FontFaceDef } from "@nextlyhq/blocks-engine";
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type { FontMetadata } from "./catalogue";
import { planFontAdd, readAddFontBody } from "./plan";

const FILES = "https://cdn.jsdelivr.net";

const LORA: FontMetadata = {
  id: "lora",
  family: "Lora",
  category: "serif",
  weights: [400, 700],
  styles: ["normal", "italic"],
  subsets: ["cyrillic", "latin", "latin-ext"],
  defSubset: "latin",
  variable: false,
  licence: "OFL-1.1",
  type: "google",
  version: "5.2.1",
  unicodeRange: {
    latin: "U+0000-00FF",
    "latin-ext": "U+0100-02BA",
    cyrillic: "U+0400-045F",
  },
};

const INTER: FontMetadata = {
  ...LORA,
  id: "inter",
  family: "Inter",
  category: "sans-serif",
  weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
  variable: true,
  version: "5.3.0",
};

const LIMITS = { filesBase: FILES, maxFiles: 24 };

/** The validation messages a call threw. */
function messagesOf(work: () => unknown): string[] {
  try {
    work();
  } catch (error) {
    if (NextlyError.isValidation(error)) {
      const errors = (
        error.publicData as { errors?: { message: string }[] } | undefined
      )?.errors;
      return (errors ?? []).map(entry => entry.message);
    }
    throw error;
  }
  throw new Error("nothing was refused");
}

describe("readAddFontBody", () => {
  const body = {
    id: "lora",
    weights: [400, 700],
    styles: ["normal"],
    subsets: ["latin"],
  };

  it("reads a family, its weights, styles and scripts", () => {
    expect(readAddFontBody(body)).toEqual(body);
  });

  it.each([
    ["a path", "../lora"],
    ["an escaped slash", "lora%2Fx"],
    ["capitals", "Lora"],
    ["an empty word", "lora--x"],
    ["an address", "https://evil.example.com/lora"],
    ["a version", "lora@1.0.0"],
    ["a long name", "a".repeat(65)],
  ])("refuses an id carrying %s", (_case, id) => {
    expect(messagesOf(() => readAddFontBody({ ...body, id }))).toEqual([
      "That isn’t a font in the catalogue.",
    ]);
  });

  it("refuses a field it does not know, such as an address to fetch", () => {
    expect(() =>
      readAddFontBody({ ...body, url: "https://evil.example.com/x.woff2" })
    ).toThrow();
  });

  it("takes every script a family offers, leaving the download to the file cap", () => {
    const scripts = [
      "cyrillic",
      "cyrillic-ext",
      "greek",
      "greek-ext",
      "latin",
      "latin-ext",
      "vietnamese",
    ];
    expect(readAddFontBody({ ...body, subsets: scripts }).subsets).toEqual(
      scripts
    );
  });

  it("refuses a weight that is not one of the nine", () => {
    expect(() => readAddFontBody({ ...body, weights: [450] })).toThrow();
    expect(() => readAddFontBody({ ...body, weights: [] })).toThrow();
  });
});

describe("planFontAdd", () => {
  it("builds every address from the template, pinned to the family's release", () => {
    const plan = planFontAdd(
      {
        id: "lora",
        weights: [400, 700],
        styles: ["normal"],
        subsets: ["latin"],
      },
      LORA,
      LIMITS,
      []
    );
    expect(plan.files.map(file => file.url)).toEqual([
      "https://cdn.jsdelivr.net/fontsource/fonts/lora@5.2.1/latin-400-normal.woff2",
      "https://cdn.jsdelivr.net/fontsource/fonts/lora@5.2.1/latin-700-normal.woff2",
    ]);
    expect(plan.files[0]?.face).toEqual({
      family: "Lora",
      weight: "400",
      style: "normal",
      unicodeRange: "U+0000-00FF",
      display: "swap",
      source: {
        kind: "google",
        id: "lora",
        licence: "OFL-1.1",
        category: "serif",
        // Which script the file covers, so the editor can tell a face the
        // site has from the same cut in another language.
        subset: "latin",
      },
    });
    expect(plan.files[0]?.fileName).toBe("lora-latin-400-normal.woff2");
  });

  it("uses one file per style and script for a variable family, covering its weights", () => {
    const plan = planFontAdd(
      {
        id: "inter",
        weights: "variable",
        styles: ["normal", "italic"],
        subsets: ["latin"],
      },
      INTER,
      LIMITS,
      []
    );
    expect(plan.files.map(file => file.url)).toEqual([
      "https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@5.3.0/latin-wght-normal.woff2",
      "https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@5.3.0/latin-wght-italic.woff2",
    ]);
    expect(plan.files[0]?.face.weight).toBe("100 900");
  });

  it.each([
    [{ weights: [300] }, "Lora has no 300 weight."],
    [{ subsets: ["arabic"] }, "Lora isn’t available for arabic."],
    [
      { weights: "variable" as const },
      "Lora has no single file for every weight; choose its weights.",
    ],
  ])("refuses what the family does not offer, naming it", (change, message) => {
    expect(
      messagesOf(() =>
        planFontAdd(
          {
            id: "lora",
            weights: [400],
            styles: ["normal"],
            subsets: ["latin"],
            ...change,
          },
          LORA,
          LIMITS,
          []
        )
      )
    ).toEqual([message]);
  });

  it("refuses an italic a family does not have", () => {
    expect(
      messagesOf(() =>
        planFontAdd(
          {
            id: "lora",
            weights: [400],
            styles: ["italic"],
            subsets: ["latin"],
          },
          { ...LORA, styles: ["normal"] },
          LIMITS,
          []
        )
      )
    ).toEqual(["Lora has no italic style."]);
  });

  it("refuses a family that is not from Google Fonts", () => {
    expect(
      messagesOf(() =>
        planFontAdd(
          {
            id: "lora",
            weights: [400],
            styles: ["normal"],
            subsets: ["latin"],
          },
          { ...LORA, type: "other" },
          LIMITS,
          []
        )
      )
    ).toEqual(["That isn’t a font in the catalogue."]);
  });

  it("refuses more files than one add allows, before any is fetched", () => {
    expect(
      messagesOf(() =>
        planFontAdd(
          {
            id: "lora",
            weights: [400, 700],
            styles: ["normal", "italic"],
            subsets: ["latin", "latin-ext", "cyrillic"],
          },
          LORA,
          { filesBase: FILES, maxFiles: 8 },
          []
        )
      )
    ).toEqual([
      "That’s more styles than one add allows (8). Choose fewer weights or languages.",
    ]);
  });

  it("counts only the files it would download against the cap", () => {
    // Latin is on the site already; the editor still names it, because its
    // held boxes stay checked. Only the Cyrillic files are new.
    const stored: FontFaceDef[] = [400, 700].map(weight => ({
      family: "Lora",
      src: [{ url: `/api/media/l${String(weight)}/raw`, format: "woff2" }],
      weight: String(weight),
      style: "normal",
      unicodeRange: "U+0000-00FF",
    }));
    const plan = planFontAdd(
      {
        id: "lora",
        weights: [400, 700],
        styles: ["normal"],
        subsets: ["cyrillic", "latin"],
      },
      LORA,
      { filesBase: FILES, maxFiles: 2 },
      stored
    );
    expect(plan.files.map(file => file.fileName)).toEqual([
      "lora-cyrillic-400-normal.woff2",
      "lora-cyrillic-700-normal.woff2",
    ]);
    expect(plan.skipped).toBe(2);
  });

  it("skips a face the site already has, however its family is spelled", () => {
    const stored: FontFaceDef = {
      family: "LORA",
      src: [{ url: "/api/media/m1/raw", format: "woff2" }],
      weight: "400",
      style: "normal",
      unicodeRange: "U+0000-00FF",
    };
    const plan = planFontAdd(
      {
        id: "lora",
        weights: [400, 700],
        styles: ["normal"],
        subsets: ["latin"],
      },
      LORA,
      LIMITS,
      [stored]
    );
    expect(plan.files.map(file => file.face.weight)).toEqual(["700"]);
    expect(plan.skipped).toBe(1);
  });
});
