import { describe, expect, it } from "vitest";

import { indexCatalog, resolveCatalogName } from "../resolve-catalog-name";

describe("resolveCatalogName", () => {
  it("returns the exact name when the catalog reports it verbatim", () => {
    const catalog = indexCatalog(["comp_hero"]);
    expect(resolveCatalogName(catalog, "comp_hero")).toBe("comp_hero");
  });

  // MySQL under `lower_case_table_names` reports a verbatim `SEO_META` as
  // `seo_meta`, so an exact-only lookup would call a table that exists missing
  // and orphan its rows.
  it("falls back to a case-different catalog entry", () => {
    const catalog = indexCatalog(["seo_meta"]);
    expect(resolveCatalogName(catalog, "SEO_META")).toBe("seo_meta");
  });

  // Postgres, and MySQL with `lower_case_table_names=0`, hold both as distinct
  // quoted tables. Folding first would collapse them and let an operation touch
  // the wrong one, so an exact hit has to win.
  it("prefers the exact match when both spellings exist", () => {
    const catalog = indexCatalog(["SEO_META", "seo_meta"]);
    expect(resolveCatalogName(catalog, "seo_meta")).toBe("seo_meta");
    expect(resolveCatalogName(catalog, "SEO_META")).toBe("SEO_META");
  });

  // With an ambiguous fold and no exact hit, the lookup must be stable rather
  // than alternating between two real tables.
  it("resolves an ambiguous fold to the first catalog entry, consistently", () => {
    const catalog = indexCatalog(["SEO_META", "seo_META"]);
    const first = resolveCatalogName(catalog, "Seo_Meta");
    expect(first).toBe("SEO_META");
    expect(resolveCatalogName(catalog, "Seo_Meta")).toBe(first);
  });

  it("returns undefined when nothing matches either way", () => {
    const catalog = indexCatalog(["comp_hero"]);
    expect(resolveCatalogName(catalog, "comp_other")).toBeUndefined();
  });

  // The resolved value is what later statements must address, so it is always
  // the catalog's spelling and never the caller's.
  it("returns the catalog's spelling, not the requested one", () => {
    const catalog = indexCatalog(["Comp_Hero"]);
    expect(resolveCatalogName(catalog, "comp_hero")).toBe("Comp_Hero");
  });

  it("handles an empty catalog", () => {
    expect(resolveCatalogName(indexCatalog([]), "anything")).toBeUndefined();
  });
});
