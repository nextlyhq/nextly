/**
 * The rail folds the `collections` and `singles` sections into one Content
 * item while routes and the panel keep the two sections. These pin that fold:
 * the rail's item list, which item a section selects, and which sections keep
 * the panel open.
 */
import { describe, expect, it } from "vitest";

import { Feather } from "@admin/components/icons";

import {
  CONTENT_RAIL_ID,
  panelSectionIds,
  railItemOf,
} from "../lib/content-rail";
import { getFilteredMenuItems } from "../sidebar-types";

describe("the Content rail item", () => {
  it("replaces the Collections and Singles items with one Content item", () => {
    const items = getFilteredMenuItems(true);
    const ids = items.map(i => i.id);
    expect(ids).toContain(CONTENT_RAIL_ID);
    expect(ids).not.toContain("collections");
    expect(ids).not.toContain("singles");

    const content = items.find(i => i.id === CONTENT_RAIL_ID);
    expect(content?.label).toBe("Content");
    expect(content?.icon).toBe(Feather);
    // Where Collections was: straight after Dashboard.
    expect(ids.indexOf(CONTENT_RAIL_ID)).toBe(ids.indexOf("dashboard") + 1);
  });

  it("is the rail item for both content sections, and only for them", () => {
    expect(railItemOf("collections")).toBe(CONTENT_RAIL_ID);
    expect(railItemOf("singles")).toBe(CONTENT_RAIL_ID);
    expect(railItemOf("media")).toBe("media");
    expect(railItemOf("standalone-shop")).toBe("standalone-shop");
  });

  it("keeps the panel open for the content sections the reader can see", () => {
    const rail = ["dashboard", CONTENT_RAIL_ID, "media"];
    expect(panelSectionIds(rail, { collections: true, singles: true })).toEqual(
      ["dashboard", "collections", "singles", "media"]
    );
    expect(
      panelSectionIds(rail, { collections: false, singles: true })
    ).toEqual(["dashboard", "singles", "media"]);
  });
});
