// @vitest-environment jsdom
/**
 * A plugin's own header item (`header.slot`, or the deprecated `headerSlot`)
 * is drawn at the top bar's right end on every page, mounted for as long as
 * the bar is, as it always was. Some plugins draw a button there; some draw
 * nothing and register what a page needs (the Page Builder's delete action
 * for a host's component store), so the item must not live anywhere that
 * mounts only on demand, such as a closed menu.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminBranding } from "@admin/types/branding";

let mockBranding: AdminBranding = {};
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
}));
vi.mock("@admin/components/shared/plugin-slot", () => ({
  PluginSlot: ({ path }: { path: string }) => (
    <span data-testid="plugin-slot" data-path={path} />
  ),
}));

import { DashboardHeader } from "./DashboardHeader";

afterEach(() => {
  cleanup();
  mockBranding = {};
});

describe("a plugin's own item in the top bar", () => {
  it("is drawn at the bar's right end, the current spelling first", () => {
    mockBranding = {
      plugins: [
        {
          name: "@acme/a",
          collections: [],
          header: { slot: "@acme/a/admin#Publish" },
          headerSlot: "@acme/a/admin#Old",
        },
        { name: "@acme/b", collections: [], headerSlot: "@acme/b/admin#Badge" },
      ],
    } as AdminBranding;
    render(<DashboardHeader />);
    const items = screen.getByTestId("plugin-header-items");
    expect(screen.getByRole("banner")).toContainElement(items);
    expect(
      screen.getAllByTestId("plugin-slot").map(slot => slot.dataset.path)
    ).toEqual(["@acme/a/admin#Publish", "@acme/b/admin#Badge"]);
  });

  it("draws only the items that chose the bar, by plugin order", () => {
    mockBranding = {
      plugins: [
        {
          name: "@acme/late",
          collections: [],
          order: 200,
          header: { slot: "@acme/late/admin#Late" },
        },
        {
          name: "@acme/rail",
          collections: [],
          header: { slot: "@acme/rail/admin#Helper", place: "rail-foot" },
        },
        {
          name: "@acme/menu",
          collections: [],
          header: {
            place: "menu",
            item: {
              id: "acme-menu.user-menu",
              label: "Help",
              icon: "BookOpen",
              to: "/x",
            },
          },
        },
        {
          name: "@acme/early",
          collections: [],
          order: 10,
          headerSlot: "@acme/early/admin#Early",
        },
      ],
    } as AdminBranding;
    render(<DashboardHeader />);
    expect(
      screen.getAllByTestId("plugin-slot").map(slot => slot.dataset.path)
    ).toEqual(["@acme/early/admin#Early", "@acme/late/admin#Late"]);
  });

  it("draws nothing where no plugin has an item", () => {
    mockBranding = {
      plugins: [
        { name: "@acme/c", collections: [], header: { hide: ["docs"] } },
      ],
    } as AdminBranding;
    render(<DashboardHeader />);
    expect(screen.queryByTestId("plugin-header-items")).toBeNull();
  });
});
