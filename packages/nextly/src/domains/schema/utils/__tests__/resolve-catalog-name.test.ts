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

  it("folds both on sqlite, where names match case-insensitively", () => {
    expect(identifierCaseRules({ dialect: "sqlite" })).toEqual({
      tables: "fold",
      columns: "fold",
    });
  });

  // MySQL's table behaviour is server configuration; only 0 is case-sensitive.
  it.each([
    [0, "preserve"],
    [1, "fold"],
    [2, "fold"],
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
      ).toBe("fold");
    }
  );
});

describe("resolveCatalogName", () => {
  it("returns the exact name when the catalog reports it verbatim", () => {
    const catalog = indexCatalog(["comp_hero"], "fold");
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
    const catalog = indexCatalog(["seo_meta"], "fold");
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
    const catalog = indexCatalog(["SEO_META", "seo_META"], "fold");
    const first = resolveCatalogName(catalog, "Seo_Meta");
    expect(first).toBe("SEO_META");
    expect(resolveCatalogName(catalog, "Seo_Meta")).toBe(first);
  });

  it("returns undefined when nothing matches either way", () => {
    const catalog = indexCatalog(["comp_hero"], "fold");
    expect(resolveCatalogName(catalog, "comp_other")).toBeUndefined();
  });

  // The resolved value is what later statements must address, so it is always
  // the catalog's spelling and never the caller's.
  it("returns the catalog's spelling, not the requested one", () => {
    const catalog = indexCatalog(["Comp_Hero"], "fold");
    expect(resolveCatalogName(catalog, "comp_hero")).toBe("Comp_Hero");
  });

  it("handles an empty catalog", () => {
    expect(resolveCatalogName(indexCatalog([], "fold"), "x")).toBeUndefined();
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

  // Refusing rather than defaulting is the point: both defaults are wrong on
  // some server, so a guess here silently picks one.
  it.each([[null], [undefined], ["abc"], [1.5], [-1], [{}]])(
    "refuses an unreadable value (%p)",
    value => {
      try {
        parseLowerCaseTableNames(value);
      } catch (error) {
        expect(NextlyError.is(error)).toBe(true);
        if (NextlyError.is(error)) {
          expect(error.logContext?.reason).toMatch(
            /not a non-negative integer/
          );
        }
        return;
      }
      expect.fail("expected a refusal");
    }
  );
});
