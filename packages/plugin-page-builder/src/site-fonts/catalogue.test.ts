import { describe, expect, it } from "vitest";

import {
  parseCatalogue,
  parseCatalogueStats,
  parseFontMetadata,
  parseVariableVersion,
  withPopularity,
} from "./catalogue";

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

  it("offers no script the catalogue splits into numbered files, and starts from Latin instead", () => {
    // Fontsource serves Japanese, Korean and Chinese as a hundred numbered
    // files with no single range, which one add cannot download.
    const notoJp = {
      ...LIST[0],
      id: "noto-sans-jp",
      family: "Noto Sans JP",
      subsets: ["cyrillic", "japanese", "latin", "latin-ext", "vietnamese"],
      defSubset: "japanese",
    };
    const onlyKorean = {
      ...LIST[0],
      id: "nanum-myeongjo",
      family: "Nanum Myeongjo",
      subsets: ["korean"],
      defSubset: "korean",
    };
    const { families } = parseCatalogue([notoJp, onlyKorean]);
    expect(families.map(family => family.id)).toEqual(["noto-sans-jp"]);
    expect(families[0]?.subsets).toEqual([
      "cyrillic",
      "latin",
      "latin-ext",
      "vietnamese",
    ]);
    expect(families[0]?.defSubset).toBe("latin");
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

describe("parseVariableVersion", () => {
  it("reads the variable package's own release, which may differ from the static one", () => {
    expect(
      parseVariableVersion({ latest: "5.2.1", latestVariable: "5.2.6" })
    ).toBe("5.2.6");
  });

  it("reads nothing when there is no variable package, or its version is not a plain release", () => {
    expect(parseVariableVersion({ latest: "5.2.1" })).toBeUndefined();
    expect(
      parseVariableVersion({ latestVariable: "../5.2.6" })
    ).toBeUndefined();
    expect(parseVariableVersion("5.2.6")).toBeUndefined();
  });
});

describe("parseCatalogueStats", () => {
  /** Two families as Fontsource's stats answer them, trimmed. */
  const STATS = {
    inter: {
      total: { npmDownloadMonthly: 2_400_000, npmDownloadTotal: 9 },
      static: { npmDownloadMonthly: 1_000_000 },
      variable: { npmDownloadMonthly: 1_400_000 },
    },
    lora: { total: { npmDownloadMonthly: 52_000 } },
  };

  it("reads each family's total monthly downloads, by its id", () => {
    const stats = parseCatalogueStats(STATS);
    expect(stats?.get("inter")).toBe(2_400_000);
    expect(stats?.get("lora")).toBe(52_000);
  });

  it("counts a family whose figure is missing or unreadable as 0, without losing the others", () => {
    const stats = parseCatalogueStats({
      ...STATS,
      quiet: { static: { npmDownloadMonthly: 5 } },
      garbled: { total: { npmDownloadMonthly: "lots" } },
      negative: { total: { npmDownloadMonthly: -3 } },
      odd: "not an entry",
    });
    expect(stats?.get("quiet")).toBe(0);
    expect(stats?.get("garbled")).toBe(0);
    expect(stats?.get("negative")).toBe(0);
    expect(stats?.get("odd")).toBe(0);
    expect(stats?.get("inter")).toBe(2_400_000);
  });

  it("reads the total from two families exactly as GET /v1/stats answered them", () => {
    // Copied verbatim from https://api.fontsource.org/v1/stats on 2026-11-03,
    // whose whole answer (about 590 KB) keys 2,123 families by id. The
    // static, variable and total figures all differ, so a read of the wrong
    // one, or of a field the answer does not have, gives another number.
    const live = {
      inter: {
        static: {
          npmDownloadMonthly: 7209595,
          npmDownloadTotal: 79537744,
          jsDelivrHitsMonthly: 149841880,
          jsDelivrHitsTotal: 266676192,
        },
        variable: {
          npmDownloadMonthly: 7871827,
          npmDownloadTotal: 35765761,
          jsDelivrHitsMonthly: 349284410,
          jsDelivrHitsTotal: 352746729,
        },
        total: {
          npmDownloadMonthly: 15081422,
          npmDownloadTotal: 115303505,
          jsDelivrHitsMonthly: 499126290,
          jsDelivrHitsTotal: 619422921,
        },
      },
      lora: {
        static: {
          npmDownloadMonthly: 242453,
          npmDownloadTotal: 2593672,
          jsDelivrHitsMonthly: 13270057,
          jsDelivrHitsTotal: 14541573,
        },
        variable: {
          npmDownloadMonthly: 174844,
          npmDownloadTotal: 546155,
          jsDelivrHitsMonthly: 9268536,
          jsDelivrHitsTotal: 9299429,
        },
        total: {
          npmDownloadMonthly: 417297,
          npmDownloadTotal: 3139827,
          jsDelivrHitsMonthly: 22538593,
          jsDelivrHitsTotal: 23841002,
        },
      },
    };
    const stats = parseCatalogueStats(live);
    expect(stats?.get("inter")).toBe(15081422);
    expect(stats?.get("lora")).toBe(417297);
  });

  it("reads nothing from an answer that is not an object of families", () => {
    expect(parseCatalogueStats([STATS])).toBeUndefined();
    expect(parseCatalogueStats("2400000")).toBeUndefined();
    expect(parseCatalogueStats(null)).toBeUndefined();
  });
});

describe("withPopularity", () => {
  it("gives every family its figure, and 0 to one the stats do not name", () => {
    const { families } = parseCatalogue([
      LIST[0],
      { ...LIST[0], id: "lora", family: "Lora" },
    ]);
    const ranked = withPopularity(families, new Map([["inter", 7]]));
    expect(ranked.map(family => [family.id, family.popularity])).toEqual([
      ["inter", 7],
      ["lora", 0],
    ]);
  });

  it("leaves the families without a figure when there are no stats", () => {
    const { families } = parseCatalogue([LIST[0]]);
    const ranked = withPopularity(families, undefined);
    expect(ranked[0]).not.toHaveProperty("popularity");
  });
});
