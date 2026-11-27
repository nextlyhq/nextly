// @vitest-environment jsdom
/**
 * The phone drawer's Search row: it closes the drawer, opens the command
 * palette, and when the palette closes focus goes back to the menu button
 * the drawer was opened from. The menu button is not the drawer's own
 * trigger, so nothing else would put focus back there.
 */
import { ShortcutProvider, TooltipProvider } from "@nextlyhq/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@admin/components/shared/command-palette/use-palette-results", () => ({
  usePaletteResults: () => ({
    collections: [],
    singles: [],
    pages: [],
    actions: [],
  }),
}));
// The drawer's menu entries are not what is under test here.
vi.mock("./SidebarNavigation", () => ({ SidebarNavigation: () => null }));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({ hasPermission: () => false }),
}));

import { SidebarProvider } from "@admin/components/layout/sidebar";
import { AdminCommandPalette } from "@admin/components/shared/command-palette";
import { setPaletteOpen } from "@admin/components/shared/command-palette/palette-store";

import { MobileSidebarDrawer } from "./MobileSidebarDrawer";

afterEach(() => {
  cleanup();
  act(() => setPaletteOpen(false));
});

/** The header's menu button opens the drawer by state, as the admin's does. */
function Harness(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <ShortcutProvider>
      <TooltipProvider>
        <SidebarProvider defaultOpen>
          <button type="button" onClick={() => setOpen(true)}>
            Open the navigation menu
          </button>
          <MobileSidebarDrawer
            open={open}
            onOpenChange={setOpen}
            navigationItems={[]}
            isActive={() => false}
          />
          <AdminCommandPalette />
        </SidebarProvider>
      </TooltipProvider>
    </ShortcutProvider>
  );
}

describe("the drawer's Search row", () => {
  it("opens the palette, and focus goes back to the menu button on close", async () => {
    render(<Harness />);
    const menu = screen.getByRole("button", {
      name: "Open the navigation menu",
    });
    menu.focus();
    fireEvent.click(menu);
    fireEvent.click(
      await screen.findByRole("button", { name: "Search or jump to…" })
    );
    const field = await screen.findByPlaceholderText("Search or jump to…");
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(menu));
  });
});
