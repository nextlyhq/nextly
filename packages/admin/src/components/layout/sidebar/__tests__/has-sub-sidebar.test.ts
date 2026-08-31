/**
 * The secondary panel and the rail answer to the same list of destinations.
 * These cover the window where they could disagree: a selection that names a
 * category the rail no longer shows.
 */
import { describe, expect, it } from "vitest";

import { isSubSidebarCategory, isSubSidebarOpen } from "../lib/has-sub-sidebar";

const ALL = ["collections", "singles", "media", "plugins", "settings"];

describe("isSubSidebarOpen", () => {
  it("refuses the panel when a surface suppressed it, even where it would open", () => {
    /*
     * The layer was declared in `AdminChromeLayer` and resolved by
     * `resolveSuppressedChrome`, and nothing implemented it: the layout only
     * drops the sidebar COLUMN when `primaryRail` is surrendered as well, so a
     * surface asking for the panel alone got the panel anyway. Both existing
     * consumers suppress all four layers or only `pageFrame`, so the isolated
     * case had never been exercised.
     */
    expect(
      isSubSidebarOpen("settings", ALL, false, new Set(["subSidebar"]))
    ).toBe(false);
  });

  it("opens where the same input suppresses something ELSE", () => {
    // The control. Without it, an implementation that refused on ANY non-empty
    // suppression set would pass the test above just as well.
    expect(
      isSubSidebarOpen("settings", ALL, false, new Set(["pageFrame"]))
    ).toBe(true);
  });

  it("opens when nothing is suppressed, which is every existing caller", () => {
    expect(isSubSidebarOpen("settings", ALL, false, new Set())).toBe(true);
    expect(isSubSidebarOpen("settings", ALL, false)).toBe(true);
  });

  it("opens the panel for a category the rail is showing", () => {
    expect(isSubSidebarOpen("plugins", ALL, false)).toBe(true);
  });

  /**
   * A collection reader clicks Plugins while the collections query is pending,
   * which is what put the entry on the rail; the query then settles with no
   * permitted plugin collection and the entry goes. Nothing resets the
   * selection, so this is the only thing standing between them and a panel
   * with no destinations in it.
   */
  it("closes it once the selected category leaves the rail", () => {
    expect(isSubSidebarOpen("plugins", ["collections", "singles"], false)).toBe(
      false
    );
  });

  /**
   * The same shape, on a category that has nothing to do with plugins. The
   * defect belongs to the selection outliving its rail item, so a fix that
   * only knows about plugins leaves it in place everywhere else.
   */
  it("closes it for any category the rail drops, not only plugins", () => {
    expect(isSubSidebarOpen("collections", ["settings"], false)).toBe(false);
    expect(isSubSidebarOpen("settings", ["collections"], false)).toBe(false);
  });

  it("keeps a standalone plugin's panel only while its rail item is shown", () => {
    // Positive control first: the prefix IS recognised, so the `false` below
    // is about the destination being gone rather than about an id shape this
    // function never accepts.
    expect(
      isSubSidebarOpen("standalone-acme", ["standalone-acme"], false)
    ).toBe(true);
    expect(isSubSidebarOpen("standalone-acme", ALL, false)).toBe(false);
  });

  it("opens Media only while the folder tree is visible", () => {
    expect(isSubSidebarOpen("media", ALL, true)).toBe(true);
    expect(isSubSidebarOpen("media", ALL, false)).toBe(false);
  });

  it("never opens one for a category that owns no panel", () => {
    expect(isSubSidebarOpen("dashboard", [...ALL, "dashboard"], true)).toBe(
      false
    );
  });
});

describe("isSubSidebarCategory", () => {
  /**
   * This one decides whether the MOBILE rail icon is a button or a link, so it
   * asks only whether the category owns a panel at all. Visibility is the
   * caller's question: an icon the rail is not rendering has no behaviour to
   * pick.
   */
  it("answers for the category alone, ignoring what the rail shows", () => {
    expect(isSubSidebarCategory("plugins", false)).toBe(true);
    expect(isSubSidebarCategory("standalone-acme", false)).toBe(true);
    expect(isSubSidebarCategory("dashboard", true)).toBe(false);
    expect(isSubSidebarCategory("media", false)).toBe(false);
    expect(isSubSidebarCategory("media", true)).toBe(true);
  });
});
