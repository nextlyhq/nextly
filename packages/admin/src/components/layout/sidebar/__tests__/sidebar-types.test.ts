import { describe, expect, it } from "vitest";

import { ROUTES } from "@admin/constants/routes";

import { getFilteredMenuItems } from "../sidebar-types";

describe("getFilteredMenuItems", () => {
  it("lists plugins whether or not the builder is shown", () => {
    expect(getFilteredMenuItems(false).map(i => i.id)).toContain("plugins");
    expect(getFilteredMenuItems(true).map(i => i.id)).toContain("plugins");
  });

  // Positive controls for the case above: the helper still filters something,
  // so a version that stopped filtering entirely cannot pass this file by
  // returning every item unconditionally.
  it("hides the builders item when the builder is off", () => {
    expect(getFilteredMenuItems(false).map(i => i.id)).not.toContain(
      "builders"
    );
  });

  it("shows the builders item when the builder is on", () => {
    expect(getFilteredMenuItems(true).map(i => i.id)).toContain("builders");
  });

  it("puts Translations in the rail that is actually rendered", () => {
    // The rail renders from THIS list. A destination declared only in
    // `SIDEBAR_NAVIGATION` — which the rail reads for active state and nothing
    // else — has no link anywhere, so the page is reachable only by someone
    // who already knows its URL. That is how the translation worklist shipped
    // in review: present, routable, and undiscoverable.
    const translations = getFilteredMenuItems(false).find(
      i => i.id === "translations"
    );
    expect(translations?.href).toBe(ROUTES.TRANSLATIONS);
  });

  it("gives every rail entry a real destination or an explicit panel marker", () => {
    // The general form of the case above, so the next entry added cannot land
    // half-wired: a rail item either navigates somewhere or opens a sub-panel
    // (`#`), and an empty or undefined href is neither.
    for (const item of getFilteredMenuItems(true)) {
      expect(item.href, `rail entry "${item.id}"`).toBeTruthy();
    }
  });
});
