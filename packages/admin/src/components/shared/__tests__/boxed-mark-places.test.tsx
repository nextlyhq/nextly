// @vitest-environment jsdom
/**
 * With no logo configured, every place that draws the product's mark draws the
 * same boxed mark from the first paint: the rail (covered by the rail's own
 * tests), the sign-in card, and the phone header a screen falls back to when
 * it takes the top bar away. With a logo configured, each draws that logo.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminBranding } from "@admin/types/branding";

let mockBranding: AdminBranding = {};
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
  useAppName: () => mockBranding.logoText ?? "Nextly",
}));
vi.mock("@admin/context/providers/ThemeProvider", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("@admin/components/layout/sidebar/DualSidebar", () => ({
  DualSidebar: () => null,
}));
vi.mock("@admin/components/layout/header", () => ({
  DashboardHeader: () => <header>bar</header>,
}));
vi.mock("@admin/components/layout/sidebar", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@admin/context/providers/MediaProvider", () => ({
  MediaProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@admin/hooks/useRouter", () => ({
  useRouter: () => ({ pathname: "/admin/collections/posts" }),
}));

import { useSuppressAdminChrome } from "@admin/components/layout/ChromeSuppression";
import { AuthFormCard } from "@admin/components/shared/auth/AuthFormCard";
import { DashboardLayout } from "@admin/layout/DashboardLayout";

/** A screen that takes the top bar away, as a document view does. */
function BarTakingSurface() {
  useSuppressAdminChrome({ layers: ["header"], canExit: true });
  return <p>document view</p>;
}

/** The boxed tile the built-in mark is drawn on. */
const isBoxedMark = (element: HTMLElement) =>
  element.tagName === "SPAN" &&
  element.className.includes("bg-primary") &&
  element.querySelector("svg") !== null;

afterEach(() => {
  cleanup();
  mockBranding = {};
});

describe("the sign-in card's mark", () => {
  it("is the boxed mark where no logo is configured", () => {
    render(
      <AuthFormCard title="Sign in" description="Welcome back">
        <form />
      </AuthFormCard>
    );
    expect(isBoxedMark(screen.getByRole("img", { name: "Nextly" }))).toBe(true);
  });

  it("is the configured logo where one is set", () => {
    mockBranding = { logoUrl: "/brand/logo.svg", logoText: "Acme" };
    render(
      <AuthFormCard title="Sign in" description="Welcome back">
        <form />
      </AuthFormCard>
    );
    expect(screen.getByRole("img", { name: "Acme" })).toHaveAttribute(
      "src",
      "/brand/logo.svg"
    );
  });
});

describe("the phone header's mark", () => {
  it("is the boxed mark where no logo is configured", () => {
    render(
      <DashboardLayout>
        <BarTakingSurface />
      </DashboardLayout>
    );
    expect(isBoxedMark(screen.getByRole("img", { name: "Logo" }))).toBe(true);
  });

  it("is the configured logo where one is set", () => {
    mockBranding = { logoUrl: "/brand/logo.svg", logoText: "Acme" };
    render(
      <DashboardLayout>
        <BarTakingSurface />
      </DashboardLayout>
    );
    expect(screen.getByRole("img", { name: "Acme" })).toHaveAttribute(
      "src",
      "/brand/logo.svg"
    );
  });
});
