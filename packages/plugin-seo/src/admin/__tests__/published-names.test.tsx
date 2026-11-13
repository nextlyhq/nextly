// @vitest-environment jsdom

/**
 * The names the admin entry has published stay importable.
 *
 * A site commits a generated component map that imports each plugin
 * component by name from `@nextlyhq/plugin-seo/admin`. A name the entry stops
 * exporting fails that map's compile, so the admin cannot load at all, and
 * the development check that rewrites the map never runs, since it renders
 * inside the admin that failed to compile. Every value name an earlier
 * release published is therefore held here.
 */

import { describe, expect, it } from "vitest";

import * as admin from "../index";
import { SeoBulkMoved, SeoReceivedMoved } from "../section";

/** Each value `@nextlyhq/plugin-seo/admin` exported in 0.0.2-alpha.75. */
const PUBLISHED_IN_ALPHA_75 = [
  "SeoBulkPage",
  "SeoProblemsPage",
  "SeoReceivedPage",
  "SeoPagesPage",
  "SeoRedirectsPage",
  "SeoSettingsPage",
  "SeoTab",
  "PageBuilderSeoTab",
  "SeoStatusSection",
  "SeoPanel",
  "panelAnswers",
  "SEO_PANEL_FIELDS",
] as const;

describe("the SEO admin entry's published names", () => {
  it.each(PUBLISHED_IN_ALPHA_75)("still exports %s", name => {
    expect(admin).toHaveProperty(name);
    expect((admin as Record<string, unknown>)[name]).toBeDefined();
  });

  it("serves the old Bulk edit and received names as the screens that moved them on", () => {
    expect((admin as Record<string, unknown>).SeoBulkPage).toBe(SeoBulkMoved);
    expect((admin as Record<string, unknown>).SeoReceivedPage).toBe(
      SeoReceivedMoved
    );
  });
});
