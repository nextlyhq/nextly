import { describe, expect, it } from "vitest";

import { parseCatalogue, parseFontMetadata } from "./catalogue";

/** Entries as Fontsource's list answers them, trimmed to three. */
const LIST = [
  {
    id: "inter",
    family: "Inter",
    subsets: ["cyrillic", "latin", "latin-ext"],
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    styles: ["italic", "normal"],
    defSubset: "latin",
    variable: true,
    lastModified: "2025-09-10",
    category: "sans-serif",
    license: "OFL-1.1",
    type: "google",
  },
  {
    id: "material-symbols",
    family: "Material Symbols",
    subsets: ["latin"],
    weights: [400],
    styles: ["normal"],
    defSubset: "latin",
    variable: false,
    category: "icons",
    license: "Apache-2.0",
    type: "google",
  },
  {
    id: "someone-elses",
    family: "Someone Else's",
    subsets: ["latin"],
    weights: [400],
    styles: ["normal"],
    defSubset: "latin",
    variable: false,
    category: "serif",
    license: "OFL-1.1",
    type: "other",
  },
];

describe("parseCatalogue", () => {
  it("keeps Google's text families, in the shape the editor lists", () => {
    const { families } = parseCatalogue(LIST);
    expect(families).toEqual([
      {
        id: "inter",
        family: "Inter",
        category: "sans-serif",
        weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
        styles: ["normal", "italic"],
        subsets: ["cyrillic", "latin", "latin-ext"],
        defSubset: "latin",
        variable: true,
        licence: "OFL-1.1",
      },
    ]);
  });

  it("skips and counts an entry it cannot read, rather than failing the list", () => {
    const { families, skipped } = parseCatalogue([
      ...LIST,
      { id: "../../etc", family: "Bad" },
      "not an entry",
    ]);
    expect(families.map(family => family.id)).toEqual(["inter"]);
    expect(skipped).toBe(2);
  });

  it("drops a weight a family could not be added with", () => {
    const { families } = parseCatalogue([
      { ...LIST[0], weights: [350, 400, 1000] },
    ]);
    expect(families[0]?.weights).toEqual([400]);
  });

  it("reads nothing from something that is not a list", () => {
    expect(parseCatalogue({ fonts: LIST })).toEqual({
      families: [],
      skipped: 0,
      unreadable: true,
    });
  });
});

describe("parseFontMetadata", () => {
  const META = {
    ...LIST[0],
    npmVersion: "5.3.0",
    unicodeRange: {
      latin: "U+0000-00FF,U+0131",
      cyrillic: "U+0301,U+0400-045F",
    },
    variants: { "400": {} },
  };

  it("reads the version files are pinned to and each script's range", () => {
    const meta = parseFontMetadata(META);
    expect(meta?.version).toBe("5.3.0");
    expect(meta?.unicodeRange.latin).toBe("U+0000-00FF,U+0131");
    expect(meta?.type).toBe("google");
  });

  it("refuses a version that is not a plain release number", () => {
    expect(parseFontMetadata({ ...META, npmVersion: "5.3.0/../x" })).toBe(
      undefined
    );
  });

  it("refuses a range that could break out of a stylesheet", () => {
    expect(
      parseFontMetadata({
        ...META,
        unicodeRange: { latin: "U+0000-00FF;}body{color:red" },
      })
    ).toBe(undefined);
  });
});
