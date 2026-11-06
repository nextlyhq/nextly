/**
 * How a page and the regions of its Layout share one site sheet and keep their
 * own styles apart. The published route and the editor's canvas both ask this,
 * so these are the answers both draw with.
 */
import type { StyleCompileContext } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { layoutPartSheets } from "./page-parts";

const breakpoints = { viewport: [], container: [] };
const context = { breakpoints } as StyleCompileContext;
const site = { breakpoints };

describe("layoutPartSheets", () => {
  it("lets the first part drawn emit the site sheet, and only that one", () => {
    const sheets = layoutPartSheets({
      parts: ["header", "page", "footer"],
      styleContext: context,
      siteStyles: site,
    });
    expect(sheets.map(sheet => sheet.siteStyles)).toEqual([site, false, false]);
  });

  it("gives every part a scope of its own", () => {
    const scopes = layoutPartSheets({
      parts: ["header", "page", "footer"],
      styleContext: context,
      siteStyles: site,
    }).map(sheet => sheet.styleContext?.scope);
    expect(scopes).toEqual([
      "nx-pb-part-header",
      "nx-pb-part-page",
      "nx-pb-part-footer",
    ]);
  });

  it("scopes the part that emits the site sheet when the route states only site styles", () => {
    // A route that serves a stored artifact names its breakpoints through
    // `siteStyles` and states no compile context of its own.
    const scopes = layoutPartSheets({
      parts: ["header", "page", "footer"],
      styleContext: undefined,
      siteStyles: site,
    }).map(sheet => sheet.styleContext?.scope);
    expect(scopes).toEqual([
      "nx-pb-part-header",
      "nx-pb-part-page",
      "nx-pb-part-footer",
    ]);
  });

  it("keeps the scope the page's stored sheet was compiled under", () => {
    const [, page] = layoutPartSheets({
      parts: ["header", "page"],
      styleContext: context,
      siteStyles: site,
      pageScope: "stored-scope",
    });
    expect(page?.styleContext?.scope).toBe("stored-scope");
  });

  it("keeps a host's refusal of the site sheet on every part", () => {
    const sheets = layoutPartSheets({
      parts: ["header", "page"],
      styleContext: context,
      siteStyles: false,
    });
    expect(sheets.map(sheet => sheet.siteStyles)).toEqual([false, false]);
  });

  it("states no sheet and compiles nothing where no breakpoints are known", () => {
    expect(
      layoutPartSheets({
        parts: ["page", "footer"],
        styleContext: undefined,
        siteStyles: undefined,
      })
    ).toEqual([{}, {}]);
  });
});
