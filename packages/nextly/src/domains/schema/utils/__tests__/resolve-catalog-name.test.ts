import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  findCaseVariant,
  identifierCaseRules,
  indexCatalog,
  parseLowerCaseTableNames,
  resolveCatalogName,
} from "../resolve-catalog-name";

describe("identifierCaseRules", () => {
  // Every identifier Nextly emits is quoted, so Postgres stores exactly what it
  // was given and never folds. Folding a lookup would merge two real tables.
  it("preserves case on postgres, for tables and columns alike", () => {
    expect(identifierCaseRules({ dialect: "postgresql" })).toEqual({
      tables: "preserve",
      columns: "preserve",
    });
  });

  // SQLite understands upper/lower case for ASCII only, so its fold must not be
  // Unicode-aware.
  it("folds ASCII only on sqlite", () => {
    expect(identifierCaseRules({ dialect: "sqlite" })).toEqual({
      tables: "fold-ascii",
      columns: "fold-ascii",
    });
  });

  // MySQL's table behaviour is server configuration; only 0 is case-sensitive.
  it.each([
    [0, "preserve"],
    [1, "fold-unicode"],
    [2, "fold-unicode"],
  ])(
    "reads mysql lower_case_table_names=%i as %s for tables",
    (setting, expected) => {
      expect(
        identifierCaseRules({
          dialect: "mysql",
          lowerCaseTableNames: setting,
        }).tables
      ).toBe(expected);
    }
  );

  // MySQL compares column names case-insensitively on every server, whatever
  // lower_case_table_names says, so the two rules cannot be one value.
  it.each([0, 1, 2])(
    "folds mysql columns regardless of lower_case_table_names=%i",
    setting => {
      expect(
        identifierCaseRules({ dialect: "mysql", lowerCaseTableNames: setting })
          .columns
      ).toBe("fold-unicode");
    }
  );
});

describe("resolveCatalogName", () => {
  it("returns the exact name when the catalog reports it verbatim", () => {
    const catalog = indexCatalog(["comp_hero"], "fold-ascii");
    expect(resolveCatalogName(catalog, "comp_hero")).toBe("comp_hero");
  });

  it("finds an exact match on a case-preserving server too", () => {
    const catalog = indexCatalog(["comp_hero"], "preserve");
    expect(resolveCatalogName(catalog, "comp_hero")).toBe("comp_hero");
  });

  // MySQL under `lower_case_table_names=1` reports a table created as `SEO_META`
  // as `seo_meta`, so an exact-only lookup would call a table that exists
  // missing and orphan its rows.
  it("falls back to a case-different entry where the server folds", () => {
    const catalog = indexCatalog(["seo_meta"], "fold-unicode");
    expect(resolveCatalogName(catalog, "SEO_META")).toBe("seo_meta");
  });

  // The defect this guards: on Postgres, and MySQL with
  // lower_case_table_names=0, `SEO_META` and `seo_meta` are different tables, so
  // folding reports a missing table as present and the caller then addresses one
  // that is not there.
  it("does not fall back to a case-different entry where case is significant", () => {
    const catalog = indexCatalog(["seo_meta"], "preserve");
    expect(resolveCatalogName(catalog, "SEO_META")).toBeUndefined();
  });

  // A case-preserving server can hold both. Folding first would collapse them
  // and let an operation touch the wrong one, so an exact hit has to win.
  it("prefers the exact match when both spellings exist", () => {
    const catalog = indexCatalog(["SEO_META", "seo_meta"], "preserve");
    expect(resolveCatalogName(catalog, "seo_meta")).toBe("seo_meta");
    expect(resolveCatalogName(catalog, "SEO_META")).toBe("SEO_META");
  });

  // With an ambiguous fold and no exact hit, the lookup must be stable rather
  // than alternating between two real tables.
  it("resolves an ambiguous fold to the first catalog entry, consistently", () => {
    const catalog = indexCatalog(["SEO_META", "seo_META"], "fold-ascii");
    const first = resolveCatalogName(catalog, "Seo_Meta");
    expect(first).toBe("SEO_META");
    expect(resolveCatalogName(catalog, "Seo_Meta")).toBe(first);
  });

  it("returns undefined when nothing matches either way", () => {
    const catalog = indexCatalog(["comp_hero"], "fold-ascii");
    expect(resolveCatalogName(catalog, "comp_other")).toBeUndefined();
  });

  // The resolved value is what later statements must address, so it is always
  // the catalog's spelling and never the caller's.
  it("returns the catalog's spelling, not the requested one", () => {
    const catalog = indexCatalog(["Comp_Hero"], "fold-ascii");
    expect(resolveCatalogName(catalog, "comp_hero")).toBe("Comp_Hero");
  });

  it("handles an empty catalog", () => {
    expect(
      resolveCatalogName(indexCatalog([], "fold-ascii"), "x")
    ).toBeUndefined();
  });
});

describe("findCaseVariant", () => {
  // A refusal that names the near-miss is the difference between an operator
  // hunting a dropped table and correcting one registry row.
  it("names an entry differing only by case", () => {
    const catalog = indexCatalog(["COMP_HERO"], "preserve");
    expect(findCaseVariant(catalog, "comp_hero")).toBe("COMP_HERO");
  });

  it("reports nothing when the name resolved exactly", () => {
    const catalog = indexCatalog(["comp_hero"], "preserve");
    expect(findCaseVariant(catalog, "comp_hero")).toBeUndefined();
  });

  it("reports nothing when there is no similar entry", () => {
    const catalog = indexCatalog(["comp_other"], "preserve");
    expect(findCaseVariant(catalog, "comp_hero")).toBeUndefined();
  });
});

describe("parseLowerCaseTableNames", () => {
  it("accepts a number", () => {
    expect(parseLowerCaseTableNames(1)).toBe(1);
  });

  // Drivers disagree about whether a server variable comes back as a number or
  // a string.
  it("accepts a numeric string", () => {
    expect(parseLowerCaseTableNames("2")).toBe(2);
  });

  it("accepts the case-insensitive-comparison setting", () => {
    expect(parseLowerCaseTableNames(0)).toBe(0);
  });

  // Refusing rather than defaulting is the point: both defaults are wrong on
  // some server, so a guess here silently picks one.
  //
  // The blank cases are the sharp ones. `Number("")` and `Number("  ")` are both
  // `0`, so a server that answers with nothing would otherwise be read as the
  // case-sensitive setting — a definite answer invented from an absent one.
  // Values outside 0/1/2 are refused for the same reason: sorting an
  // unrecognised setting into one behaviour or the other is a guess.
  it.each([
    [null],
    [undefined],
    [""],
    ["  "],
    ["abc"],
    [3],
    ["3"],
    [1.5],
    [-1],
    [{}],
  ])("refuses an unreadable value (%p)", value => {
    try {
      parseLowerCaseTableNames(value);
    } catch (error) {
      expect(NextlyError.is(error)).toBe(true);
      if (NextlyError.is(error)) {
        expect(error.logContext?.reason).toMatch(/not 0, 1 or 2/);
      }
      return;
    }
    expect.fail("expected a refusal");
  });
});

describe("dialect-specific fold width", () => {
  // SQLite keeps `Ä` and `ä` as separate tables and cannot query one through the
  // other's spelling, so a Unicode fold here would resolve a registry row to an
  // unrelated table — and in teardown that means deleting its rows.
  it("does not merge non-ASCII case under an ASCII fold", () => {
    const catalog = indexCatalog(["comp_\u00e4rea"], "fold-ascii");
    expect(resolveCatalogName(catalog, "comp_\u00c4rea")).toBeUndefined();
  });

  // MySQL lowercases names using the system character set, so the same pair must
  // resolve there or a legitimate upgrade is refused.
  it("merges non-ASCII case under a Unicode fold", () => {
    const catalog = indexCatalog(["comp_\u00e4rea"], "fold-unicode");
    expect(resolveCatalogName(catalog, "comp_\u00c4rea")).toBe(
      "comp_\u00e4rea"
    );
  });

  // ASCII folding still has to work, or the SQLite fix would break the ordinary
  // case it exists to serve.
  it("still folds ASCII case under an ASCII fold", () => {
    const catalog = indexCatalog(["comp_hero"], "fold-ascii");
    expect(resolveCatalogName(catalog, "COMP_HERO")).toBe("comp_hero");
  });
});

describe("simple versus full case mapping", () => {
  // A server maps one character to one character. JavaScript's full Unicode
  // mapping turns `İ` into `i` plus a combining dot, so keying on it would look
  // for `i̇tem` while the catalog reports `item`, and a custom table would be
  // read as missing.
  it("folds a character whose full lowercase mapping expands", () => {
    const catalog = indexCatalog(["item"], "fold-unicode");
    expect(resolveCatalogName(catalog, "\u0130TEM")).toBe("item");
  });

  // The same character under ASCII rules is left alone, because a server that
  // folds ASCII only does not touch it.
  it("leaves an expanding character alone under an ASCII fold", () => {
    const catalog = indexCatalog(["item"], "fold-ascii");
    expect(resolveCatalogName(catalog, "\u0130TEM")).toBeUndefined();
  });
});
