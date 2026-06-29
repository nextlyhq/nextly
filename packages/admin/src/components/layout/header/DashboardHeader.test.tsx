/**
 * C9-A — plugin header slot renders in the admin top bar.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearRegistry,
  registerComponent,
} from "@admin/lib/plugins/component-registry";
import type { AdminBranding } from "@admin/types/branding";

let mockBranding: AdminBranding | undefined;
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({ user: null }),
}));
vi.mock("@admin/hooks/useLogout", () => ({
  useLogout: () => () => {},
}));
vi.mock("@admin/components/features/notifications", () => ({
  NotificationBell: () => <div data-testid="bell" />,
}));
vi.mock("../sidebar/UserProfileDropdown", () => ({
  UserProfileDropdown: () => null,
}));

import { DashboardHeader } from "./DashboardHeader";

afterEach(() => {
  clearRegistry();
  mockBranding = undefined;
  vi.restoreAllMocks();
});

describe("DashboardHeader plugin header slot (C9-A)", () => {
  it("renders a plugin's contributed headerSlot component", () => {
    registerComponent("@acme/p/admin#HeaderBadge", () => (
      <div>plugin header badge</div>
    ));
    mockBranding = {
      plugins: [
        {
          name: "@acme/p",
          collections: [],
          headerSlot: "@acme/p/admin#HeaderBadge",
        },
      ],
    } as AdminBranding;

    render(<DashboardHeader />);
    expect(screen.getByText("plugin header badge")).toBeInTheDocument();
  });
});

describe("DashboardHeader default-button visibility", () => {
  it("renders all built-ins when no plugin hides them", () => {
    mockBranding = { plugins: [] } as AdminBranding;
    render(<DashboardHeader />);
    expect(screen.getByTitle("GitHub Repository")).toBeInTheDocument();
    expect(screen.getByTitle("Discord Community")).toBeInTheDocument();
    expect(screen.getByTitle("Documentation")).toBeInTheDocument();
    expect(screen.getByTestId("bell")).toBeInTheDocument();
  });

  it("hides the buttons a plugin's header.hide lists", () => {
    mockBranding = {
      plugins: [
        {
          name: "@acme/p",
          collections: [],
          header: { hide: ["github", "notifications"] },
        },
      ],
    } as AdminBranding;
    render(<DashboardHeader />);
    expect(screen.queryByTitle("GitHub Repository")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bell")).not.toBeInTheDocument();
    expect(screen.getByTitle("Discord Community")).toBeInTheDocument();
    expect(screen.getByTitle("Documentation")).toBeInTheDocument();
  });

  it("hideDefaults hides all four built-ins", () => {
    mockBranding = {
      plugins: [
        { name: "@acme/p", collections: [], header: { hideDefaults: true } },
      ],
    } as AdminBranding;
    render(<DashboardHeader />);
    expect(screen.queryByTitle("GitHub Repository")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Discord Community")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Documentation")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bell")).not.toBeInTheDocument();
  });

  it("renders a header.slot component (supersedes headerSlot)", () => {
    registerComponent("@acme/p/admin#Publish", () => <div>publish btn</div>);
    mockBranding = {
      plugins: [
        {
          name: "@acme/p",
          collections: [],
          header: { slot: "@acme/p/admin#Publish" },
        },
      ],
    } as AdminBranding;
    render(<DashboardHeader />);
    expect(screen.getByText("publish btn")).toBeInTheDocument();
  });
});
