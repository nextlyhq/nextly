// @vitest-environment jsdom
/**
 * The layout mounts a plugin's rail-foot item once, for as long as it is
 * mounted itself, and moves it into the rail foot that shows: the rail beside
 * the page (hidden by CSS below 1024px, still mounted), and the drawer's copy
 * of the rail while the menu button has it open. Its effect runs once, with
 * no menu open, and is never cleaned up while the drawer opens and closes.
 *
 * The rail is a stand-in that draws only the foot's place, as the real rail's
 * account foot does, so what is observed is the layout's own wiring.
 *
 * @module layout/__tests__/DashboardLayout.rail-foot.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, type JSX, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerComponent } from "@admin/lib/plugins/component-registry";

vi.mock("@admin/components/layout/sidebar/DualSidebar", async () => {
  const { RailFootPluginPlace } = await import(
    "@admin/components/layout/sidebar/RailFootPluginItems"
  );
  return {
    DualSidebar: ({ isMobile }: { isMobile?: boolean }) => (
      <aside data-testid={isMobile ? "drawer-rail" : "rail"}>
        <RailFootPluginPlace />
      </aside>
    ),
  };
});
vi.mock("@admin/components/layout/header", () => ({
  DashboardHeader: ({ onOpenMenu }: { onOpenMenu: () => void }) => (
    <header>
      <button type="button" onClick={onOpenMenu}>
        Open the navigation menu
      </button>
    </header>
  ),
}));
vi.mock("@admin/components/layout/sidebar", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@admin/context/providers/MediaProvider", () => ({
  MediaProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({
    plugins: [
      {
        name: "@acme/helper",
        collections: [],
        header: { slot: "@acme/helper/admin#Helper", place: "rail-foot" },
      },
    ],
  }),
}));
vi.mock("@admin/components/shared/ThemeAwareLogo", () => ({
  ThemeAwareLogo: () => null,
}));
vi.mock("@admin/hooks/useRouter", () => ({
  useRouter: () => ({ pathname: "/admin/releases" }),
}));

const { DashboardLayout } = await import("../DashboardLayout");

const effects = { runs: 0, cleanups: 0 };
/** How many times the fixture button's own handler ran. */
let clicks = 0;

function Helper(): JSX.Element {
  useEffect(() => {
    effects.runs += 1;
    return () => {
      effects.cleanups += 1;
    };
  }, []);
  return (
    <button type="button" onClick={() => (clicks += 1)}>
      Helper
    </button>
  );
}

beforeEach(() => {
  effects.runs = 0;
  effects.cleanups = 0;
  clicks = 0;
  registerComponent("@acme/helper/admin#Helper", Helper);
});
afterEach(cleanup);

describe("a plugin's rail-foot item in the layout", () => {
  it("is mounted in the rail, and moves into the drawer and back without remounting", async () => {
    render(
      <DashboardLayout>
        <p>Page</p>
      </DashboardLayout>
    );
    const helper = screen.getByRole("button", { name: "Helper" });
    expect(screen.getByTestId("rail")).toContainElement(helper);
    expect(effects).toEqual({ runs: 1, cleanups: 0 });

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Open the navigation menu" })
    );
    expect(await screen.findByTestId("drawer-rail")).toContainElement(helper);

    await user.keyboard("{Escape}");
    await vi.waitFor(() =>
      expect(screen.queryByTestId("drawer-rail")).toBeNull()
    );
    expect(screen.getByTestId("rail")).toContainElement(helper);
    expect(effects).toEqual({ runs: 1, cleanups: 0 });
  });

  it("takes a press inside the open drawer without closing it", async () => {
    render(
      <DashboardLayout>
        <p>Page</p>
      </DashboardLayout>
    );
    const helper = screen.getByRole("button", { name: "Helper" });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Open the navigation menu" })
    );
    const drawer = await screen.findByRole("dialog", {
      name: "Navigation menu",
    });
    expect(drawer).toContainElement(helper);

    // A pointer press and its focus, then the click, on the moved item.
    await user.click(helper);

    expect(clicks).toBe(1);
    expect(
      screen.getByRole("dialog", { name: "Navigation menu" })
    ).toContainElement(helper);
    expect(screen.getByTestId("drawer-rail")).toContainElement(helper);
    expect(effects).toEqual({ runs: 1, cleanups: 0 });

    // The control: a press outside the drawer does close it, so the drawer
    // staying open above is its own reading of the press as inside, not a
    // dismissal this test cannot see. The page behind is inert to the
    // pointer while the drawer is open, so the press is dispatched directly.
    fireEvent.pointerDown(screen.getByText("Page"));
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Navigation menu" })
      ).toBeNull()
    );
    expect(screen.getByTestId("rail")).toContainElement(helper);
    expect(effects).toEqual({ runs: 1, cleanups: 0 });
  });
});
