import { describe, expect, it } from "vitest";

import {
  CATALOG_VERSION,
  COMMAND_ROLES,
  INSTALL_SECTIONS,
  INSTALL_STEPS,
  SITE_ROLES,
  USAGE_EVENTS,
  countRange,
  pageLabelFrom,
  pluginsOn,
  usageCatalogData,
} from "../index.js";

// Facts about the catalog's lists that its types cannot hold, and the
// builders that turn raw values into catalog values.

describe("the catalog's lists", () => {
  it("names exactly the nine events agreed", () => {
    expect(Object.keys(USAGE_EVENTS).sort()).toEqual(
      [
        "install_started",
        "install_step",
        "install_completed",
        "install_failed",
        "command_run",
        "admin_first_opened",
        "first_collection_created",
        "first_page_published",
        "daily_summary",
      ].sort()
    );
  });

  it("lets an install stop at any of its sections", () => {
    expect(INSTALL_STEPS.slice(0, INSTALL_SECTIONS.length)).toEqual([
      ...INSTALL_SECTIONS,
    ]);
  });

  it("gives a command every site role, plus none", () => {
    expect([...COMMAND_ROLES]).toEqual([...SITE_ROLES, "none"]);
  });

  it("hands out the same catalog as plain data", () => {
    const data = usageCatalogData();
    expect(data.catalog_version).toBe(CATALOG_VERSION);
    expect(Object.keys(data.events)).toEqual(Object.keys(USAGE_EVENTS));
    expect(data.events).toEqual(JSON.parse(JSON.stringify(USAGE_EVENTS)));
    expect(data.base_properties.tools.required.catalog_version).toEqual({
      type: "enum",
      values: [CATALOG_VERSION],
    });
    // A reader's change does not reach the catalog itself.
    data.events.command_run = { sources: [], required: {}, optional: {} };
    expect(usageCatalogData().events.command_run?.sources).toEqual(["cli"]);
  });
});

describe("the builders", () => {
  it.each([
    [0, "0"],
    [-3, "0"],
    [Number.NaN, "0"],
    [1, "1-10"],
    [10, "1-10"],
    [11, "11-100"],
    [100, "11-100"],
    [101, "101-1000"],
    [1000, "101-1000"],
    [1001, "1001-10000"],
    [10_000, "1001-10000"],
    [10_001, "more"],
  ])("puts %d in the range %s", (count, range) => {
    expect(countRange(count)).toBe(range);
  });

  it.each([
    [undefined, "none"],
    ["", "none"],
    ["quickstart", "quickstart"],
    [" Docs ", "docs"],
    ["none", "other"],
    ["other", "other"],
    ["home-page", "other"],
    ["someone@example.com", "other"],
  ])("reads the page label %j as %s", (raw, label) => {
    expect(pageLabelFrom(raw)).toBe(label);
  });

  it("names Nextly's own plugins and only counts the rest", () => {
    expect(
      pluginsOn([
        "@nextlyhq/plugin-seo",
        "@nextlyhq/plugin-page-builder",
        "@nextlyhq/plugin-seo",
        "@acme/plugin",
        "nextly-plugin-x",
        "@nextlyhq/Bad_Name",
      ])
    ).toEqual({
      plugins_official: [
        "@nextlyhq/plugin-page-builder",
        "@nextlyhq/plugin-seo",
      ],
      plugins_other: 3,
    });
  });
});
