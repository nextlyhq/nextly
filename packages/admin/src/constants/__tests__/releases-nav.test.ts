/**
 * That the Releases section can actually be reached.
 *
 * Two failures are guarded here and they are silent in different ways.
 *
 * A destination declared only in `SIDEBAR_NAVIGATION` has no link anywhere: the
 * rail renders from `MAIN_MENU_ITEMS` and reads `SIDEBAR_NAVIGATION` for active
 * state and nothing else, so the page stays routable and undiscoverable. That
 * is how the translation worklist shipped once already.
 *
 * A rail entry gated on a permission whose resource is not seeded matches no
 * user at all, so the item is invisible to everyone including an administrator.
 * Nothing errors and no test of the page itself fails.
 *
 * @module constants/__tests__/releases-nav.test
 */
import { describe, expect, it } from "vitest";

import {
  getFilteredMenuItems,
  MAIN_MENU_ITEMS,
} from "@admin/components/layout/sidebar/sidebar-types";

import { isNavSection, NAV_SECTIONS } from "../nav-sections";
import { SIDEBAR_NAVIGATION } from "../navigation";
import { SYSTEM_RESOURCES_IN_DISPLAY_ORDER } from "../permissions";
import { ROUTES } from "../routes";

/** The rail as an editor sees it, taken from the list the component renders. */
const rail = getFilteredMenuItems(true);
const railReleases = rail.find(item => item.id === "releases");

describe("the Releases nav entry", () => {
  it("is in the rail that is actually rendered", () => {
    // A release is a first-class object with its own lifecycle, so it lives in
    // the rail rather than inside a document. Asserted against
    // `getFilteredMenuItems` because that is what `DualSidebar` maps over.
    expect(railReleases).toBeDefined();
    expect(railReleases?.href).toBe(ROUTES.RELEASES);
  });

  it("gates on a permission whose RESOURCE is actually registered", () => {
    // `read-content-releases` is seeded; `read-releases` is not, and would hide
    // this from everyone. Checked against the one list the permission screens
    // derive from, so a typo cannot agree with itself.
    expect(railReleases?.requiredPermission).toBe("read-content-releases");
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
    expect(railReleases?.id).toBe("releases");
    expect(isNavSection("releases")).toBe(true);
    expect(NAV_SECTIONS).toContain("releases");
  });

  it("takes every field from the canonical declaration", () => {
    // The rail entry is DERIVED from `SIDEBAR_NAVIGATION`, so this asserts the
    // derivation happened rather than that two literals agree today. Label and
    // href carry the discrimination — icon identity would also hold for two
    // independent imports of the same lucide component — so an entry written
    // out by hand fails here the moment either changes on one side.
    const declared = SIDEBAR_NAVIGATION.find(
      item => item.href === ROUTES.RELEASES
    );
    expect(declared).toBeDefined();
    expect(railReleases?.label).toBe(declared?.title);
    expect(railReleases?.href).toBe(declared?.href);
    expect(railReleases?.icon).toBe(declared?.icon);
    expect(railReleases?.requiredPermission).toBe(declared?.requiredPermission);
    expect(declared?.category).toBe("releases");
  });
});

describe("the rail's coverage of the section vocabulary", () => {
  it("gives every declarable section a rail entry", () => {
    // The general form, and the case above is one instance of it. A section can
    // be added to the vocabulary, given routes and given pages while the rail is
    // never touched — and every other test still passes, because each one asks
    // about a section that IS present. Only comparing the two sets can see an
    // absence.
    //
    // Reported as the missing NAMES rather than as a count, so a failure says
    // which section has no way in.
    const railIds = new Set(MAIN_MENU_ITEMS.map(item => item.id));
    const unreachable = NAV_SECTIONS.filter(section => !railIds.has(section));
    expect(unreachable).toEqual([]);
  });

  it("gives every rail entry a destination or an explicit panel marker", () => {
    // The other direction: an entry that is present but points nowhere renders
    // a link that does nothing. `#` is the deliberate marker for an item that
    // opens a sub-panel instead of navigating.
    for (const item of MAIN_MENU_ITEMS) {
      expect(item.href, `rail entry "${item.id}"`).toBeTruthy();
    }
  });
});

describe("the routes the Releases section needs", () => {
  it("declares a list route and a detail template that cannot collide", () => {
    expect(ROUTES.RELEASES).toBe("/admin/releases");
    // The detail route is a template, so the list route must not swallow it.
    expect(ROUTES.RELEASES_DETAIL).toBe("/admin/releases/[id]");
  });
});
