/**
 * A new entity is offered an icon from its name. Every icon offered is one the
 * icon picker draws, so the suggestion is never an icon the sidebar cannot show.
 */
import { describe, expect, it } from "vitest";

import { ICON_PICKER_ICONS } from "@admin/components/features/schema-builder/builder-settings-modal/IconPicker";

import { DEFAULT_ENTITY_ICON, suggestIcon } from "../icon-suggestion";

describe("suggestIcon", () => {
  it.each([
    ["Product", "Package"],
    ["Products", "Package"],
    ["Team member", "Users"],
    ["Order", "ShoppingCart"],
    ["Event", "Calendar"],
    ["Blog post", "FileText"],
    ["Photo", "Image"],
    ["Location", "MapPin"],
    ["Category", "Tag"],
    ["Newsletter", "Mail"],
  ])("offers an icon for '%s'", (name, icon) => {
    expect(suggestIcon(name)).toBe(icon);
  });

  it("matches a word, not a part of one", () => {
    // "Reorder" holds "order" inside a word, which says nothing about orders.
    expect(suggestIcon("Reorder rule")).toBe(DEFAULT_ENTITY_ICON);
  });

  it("offers the default when nothing in the name suggests an icon", () => {
    expect(suggestIcon("Widget")).toBe(DEFAULT_ENTITY_ICON);
    expect(suggestIcon("")).toBe(DEFAULT_ENTITY_ICON);
  });

  it("offers only icons the picker draws", () => {
    const drawn = new Set<string>(ICON_PICKER_ICONS.map(icon => icon.name));
    const names = [
      "Product",
      "Team member",
      "Order",
      "Event",
      "Blog post",
      "Photo",
      "Location",
      "Category",
      "Newsletter",
      "Widget",
    ];
    for (const name of names) expect(drawn.has(suggestIcon(name))).toBe(true);
  });
});
