/**
 * The admin shell's skip link: the first thing Tab reaches on every page, ahead
 * of the rail, the sidebar and the header, and it moves focus into the page's
 * one main region. Without it a keyboard user tabs through every collection
 * and Single in the sidebar before reaching the page, and the sidebar grows
 * with the schema.
 *
 * The rail and the header are stand-ins with one focusable control each, so
 * the order Tab takes through them is observed, not assumed.
 *
 * @module layout/__tests__/DashboardLayout.skip-link.test
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@admin/components/layout/sidebar/DualSidebar", () => ({
  DualSidebar: () => (
    <nav aria-label="Rail">
      <a href="/admin/collections/posts">Posts</a>
    </nav>
  ),
}));
vi.mock("@admin/components/layout/header", () => ({
  DashboardHeader: () => (
    <header>
      <button type="button">Account</button>
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
  useBranding: () => ({}),
}));
vi.mock("@admin/components/shared/ThemeAwareLogo", () => ({
  ThemeAwareLogo: () => null,
}));
vi.mock("@admin/hooks/useRouter", () => ({
  useRouter: () => ({ pathname: "/admin/releases" }),
}));

const { DashboardLayout } = await import("../DashboardLayout");

afterEach(cleanup);

function drawPage() {
  render(
    <DashboardLayout>
      <button type="button">On the page</button>
    </DashboardLayout>
  );
}

describe("the admin shell's skip link", () => {
  it("is the first thing Tab reaches, ahead of the menu, the rail and the header", async () => {
    drawPage();
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "Skip to content" })
    );
    // Without it, the next stops are the chrome's, in document order.
    await user.tab();
    expect(document.activeElement).not.toBe(
      screen.getByRole("button", { name: "On the page" })
    );
  });

  it("moves focus into the page's one main region, from where Tab reaches the page", async () => {
    drawPage();
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard("{Enter}");
    const main = screen.getByRole("main");
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(document.activeElement).toBe(main);
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(
      screen.getByRole("link", { name: "Skip to content" })
    ).toHaveAttribute("href", `#${main.id}`);
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "On the page" })
    );
  });
});
