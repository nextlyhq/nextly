/**
 * Unit tests for resolveSingleTableName.
 *
 * The helper is the single source of truth for single-table naming across
 * the registry-insert path and the DDL-create path. Tests lock in the
 * contract so future changes can't re-introduce the naming drift that
 * caused `no such table: single_site_settings` bugs on fresh installs.
 */

import { describe, it, expect } from "vitest";

import { resolveSingleTableName } from "./resolve-single-table-name";

describe("resolveSingleTableName", () => {
  it("prefixes a hyphenated slug with single_ and converts hyphens to underscores", () => {
    expect(resolveSingleTableName({ slug: "site-settings" })).toBe(
      "single_site_settings"
    );
  });

  it("preserves an underscored slug without double-converting", () => {
    expect(resolveSingleTableName({ slug: "site_settings" })).toBe(
      "single_site_settings"
    );
  });

  it("handles multi-hyphen slugs", () => {
    expect(resolveSingleTableName({ slug: "my-long-complex-single" })).toBe(
      "single_my_long_complex_single"
    );
  });

  it("honors an explicit dbName that already includes the prefix", () => {
    expect(
      resolveSingleTableName({
        slug: "site-settings",
        dbName: "single_site_settings",
      })
    ).toBe("single_site_settings");
  });

  it("adds the prefix to a dbName that is missing it", () => {
    // Historical configs may pass dbName without the single_ prefix.
    // The helper silently corrects this so the on-disk table and the
    // registry row always agree.
    expect(
      resolveSingleTableName({ slug: "anything", dbName: "site_settings" })
    ).toBe("single_site_settings");
  });

  it("lowercases the final name", () => {
    expect(resolveSingleTableName({ slug: "SITE-Settings" })).toBe(
      "single_site_settings"
    );
  });

  it("collapses non-alphanumeric sequences to a single underscore", () => {
    expect(resolveSingleTableName({ slug: "site--settings!!page" })).toBe(
      "single_site_settings_page"
    );
  });

  it("strips leading and trailing underscores after normalization", () => {
    expect(resolveSingleTableName({ slug: "--weird--" })).toBe("single_weird");
  });

  it("rejects an empty slug", () => {
    expect(() => resolveSingleTableName({ slug: "" })).toThrow();
  });

  it("rejects a whitespace-only slug", () => {
    expect(() => resolveSingleTableName({ slug: "   " })).toThrow();
  });
});
