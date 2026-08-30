/**
 * That the Releases section can actually be reached.
 *
 * The failure this guards is silent and total: `SidebarNavigation` filters nav
 * items by capability, so an item declaring a permission that is not seeded
 * matches nothing and is invisible to EVERY user, administrators included.
 * Nothing errors, no test of the page itself fails, and the feature simply
 * does not appear. That is exactly what #1375 fixed for background jobs.
 *
 * @module constants/__tests__/releases-nav.test
 */
import { describe, expect, it } from "vitest";

import { SIDEBAR_NAVIGATION } from "../navigation";
import { isNavSection, NAV_SECTIONS } from "../nav-sections";
import { SYSTEM_RESOURCES_IN_DISPLAY_ORDER } from "../permissions";
import { ROUTES } from "../routes";

const releases = SIDEBAR_NAVIGATION.find(item => item.href === ROUTES.RELEASES);

describe("the Releases nav entry", () => {
  it("exists as a top-level item", () => {
    // The founder's decision: a release is a first-class object with its own
    // lifecycle, so it lives in the rail rather than inside a document.
    expect(releases).toBeDefined();
  });

  it("gates on a permission whose RESOURCE is actually registered", () => {
    // The whole failure. `read-content-releases` is seeded; `read-releases` is
    // not, and would hide this from everyone. Checked against the one list the
    // permission screens derive from, so a typo cannot agree with itself.
    expect(releases?.requiredPermission).toBe("read-content-releases");
    expect(SYSTEM_RESOURCES_IN_DISPLAY_ORDER).toContain("content-releases");
  });

  it("does not reserve the word a site would use for content", () => {
    // "Press releases" is among the most common collections on a corporate
    // site, which is why the resource is `content-releases`.
    expect(SYSTEM_RESOURCES_IN_DISPLAY_ORDER).not.toContain("releases");
  });

  it("names a rail section the vocabulary declares", () => {
    // A section string the rail does not know highlights nothing, so the item
    // renders and then fails to indicate where the reader is.
    expect(releases?.category).toBe("releases");
    expect(isNavSection("releases")).toBe(true);
    expect(NAV_SECTIONS).toContain("releases");
  });

  it("points at a route the registry can resolve", () => {
    expect(ROUTES.RELEASES).toBe("/admin/releases");
    // The detail route is a template, so the list route must not swallow it.
    expect(ROUTES.RELEASES_DETAIL).toBe("/admin/releases/[id]");
  });
});
