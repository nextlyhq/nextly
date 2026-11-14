/**
 * Which paths the startup request names for the page a tab opens on: what
 * every screen needs first, and, on a plugin page that declares them, the
 * reads it makes as it opens, from what the admin layout wrote into the page.
 *
 * The function under test is the one the admin calls and the prebuilt page's
 * script runs the source of, so each case below holds for both.
 */
import { describe, expect, it } from "vitest";

import { startupPathsForPage } from "../admin-startup";

const COMMON = ["/auth/session", "/me"];
const PAGE = "/admin/plugins/acme-seo/overview";
const READ = "/plugins/@acme/seo/overview/checklist";
/** The element's text, as the admin layout writes it, with these pages' reads. */
const screensWith = (reads: unknown): string =>
  JSON.stringify({ reads, foldedPanels: [] });
const SCREENS = screensWith({ [PAGE]: [READ] });

describe("the startup request's paths for a page", () => {
  it("adds a plugin page's declared reads after what every screen needs", () => {
    expect(startupPathsForPage(PAGE, COMMON, SCREENS, 16)).toEqual([
      ...COMMON,
      READ,
    ]);
  });

  it.each([
    ["the dashboard", "/admin"],
    ["a collection list", "/admin/collections/posts"],
    ["an edit page", "/admin/collections/posts/1"],
    ["settings", "/admin/settings/general"],
    ["another page of the plugin", "/admin/plugins/acme-seo/settings"],
    ["a page beneath the declaring one", `${PAGE}/more`],
    ["an address no screen has", "/admin/no/such/screen"],
  ])("names only what every screen needs on %s", (_screen, pathname) => {
    expect(startupPathsForPage(pathname, COMMON, SCREENS, 16)).toEqual(COMMON);
  });

  it("finds the page with a trailing slash, or under a prefix", () => {
    for (const pathname of [`${PAGE}/`, `/fr${PAGE}`, `/fr${PAGE}/`]) {
      expect(startupPathsForPage(pathname, COMMON, SCREENS, 16)).toEqual([
        ...COMMON,
        READ,
      ]);
    }
  });

  it("finds a page whose address the browser percent-encodes", () => {
    const page = "/admin/plugins/acme-seo/über";
    const screens = screensWith({ [page]: [READ] });
    expect(startupPathsForPage(encodeURI(page), COMMON, screens, 16)).toContain(
      READ
    );
  });

  it.each([
    ["no element", null],
    ["text that is not JSON", "{not json"],
    ["JSON that is not a map", "[1,2]"],
    ["reads that are not a map", screensWith([READ])],
    ["reads outside `reads`", JSON.stringify({ [PAGE]: [READ] })],
    ["a page whose reads are not a list", screensWith({ [PAGE]: READ })],
    ["reads that are not paths", screensWith({ [PAGE]: [1, null] })],
  ])("names only what every screen needs with %s", (_case, screensJson) => {
    expect(startupPathsForPage(PAGE, COMMON, screensJson, 16)).toEqual(COMMON);
  });

  it("names a path once, and no more than the startup request may carry", () => {
    const screens = screensWith({
      [PAGE]: ["/me", READ, "/plugins/@acme/seo/a", "/plugins/@acme/seo/b"],
    });

    expect(startupPathsForPage(PAGE, COMMON, screens, 16)).toEqual([
      ...COMMON,
      READ,
      "/plugins/@acme/seo/a",
      "/plugins/@acme/seo/b",
    ]);
    expect(startupPathsForPage(PAGE, COMMON, screens, 3)).toEqual([
      ...COMMON,
      READ,
    ]);
  });
});
