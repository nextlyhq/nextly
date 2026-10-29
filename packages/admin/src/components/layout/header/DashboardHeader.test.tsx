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
let mockWorkspacePending = false;
let mockPermissionsLoading = false;
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
  useBrandingStatus: () => ({
    isPending: mockWorkspacePending,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({ isLoading: mockPermissionsLoading }),
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({ user: null }),
}));
vi.mock("@admin/hooks/useLogout", () => ({
  useLogout: () => () => {},
}));
vi.mock("@admin/components/features/notifications", () => ({
  NotificationBell: () => (
    <button
      type="button"
      data-testid="bell"
      aria-label="Recent schema changes"
    />
  ),
}));
vi.mock("../sidebar/UserProfileDropdown", () => ({
  UserProfileDropdown: () => <div data-testid="account-menu" />,
}));

import { DashboardHeader } from "./DashboardHeader";

afterEach(() => {
  clearRegistry();
  mockBranding = undefined;
  mockWorkspacePending = false;
  mockPermissionsLoading = false;
  vi.restoreAllMocks();
});

describe("DashboardHeader plugin header slot", () => {
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

  it("hides the bell where the builder is disabled", () => {
    mockBranding = { plugins: [], showBuilder: false } as AdminBranding;
    render(<DashboardHeader />);
    expect(screen.queryByTestId("bell")).not.toBeInTheDocument();
    // Only the bell is builder-dependent; the rest of the bar is unaffected.
    expect(screen.getByTitle("GitHub Repository")).toBeInTheDocument();
    expect(screen.getByTitle("Documentation")).toBeInTheDocument();
  });

  it("shows the bell where the builder is enabled", () => {
    mockBranding = { plugins: [], showBuilder: true } as AdminBranding;
    render(<DashboardHeader />);
    expect(screen.getByTestId("bell")).toBeInTheDocument();
  });

  it("keeps the bell while the builder flag is still in flight", () => {
    mockBranding = { plugins: [] } as AdminBranding;
    render(<DashboardHeader />);
    expect(screen.getByTestId("bell")).toBeInTheDocument();
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

/**
 * The row is right-aligned: a control appearing after the first paint pushes every control to its
 * left sideways. So the controls beside the account menu are shown only once the answers deciding
 * them are in, and never on a guess that might be taken back. Until then they are mounted but
 * hidden, so they are out of the accessibility tree, which the role queries below read: a query by
 * role skips a hidden element, and the settled cases show the same queries find them once shown.
 */
describe("DashboardHeader while its answers arrive", () => {
  const BESIDE_THE_MENU = [
    "GitHub Repository",
    "Discord Community",
    "Documentation",
  ];

  it("shows only the account menu while the workspace answer is pending", () => {
    mockWorkspacePending = true;
    render(<DashboardHeader />);
    expect(screen.getByTestId("account-menu")).toBeVisible();
    for (const title of BESIDE_THE_MENU) {
      expect(
        screen.queryByRole("link", { name: title })
      ).not.toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: "Choose theme" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Recent schema changes" })
    ).not.toBeInTheDocument();
    // Mounted from the first paint, so it reads the permissions while the first request is out.
    expect(screen.getByTestId("bell")).not.toBeVisible();
  });

  it("holds the row while the permissions that decide the bell load", () => {
    mockBranding = { plugins: [], showBuilder: true } as AdminBranding;
    mockPermissionsLoading = true;
    render(<DashboardHeader />);
    expect(screen.getByTestId("account-menu")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "GitHub Repository" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Recent schema changes" })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("bell")).not.toBeVisible();
  });

  it("does not wait on permissions where no bell can be offered", () => {
    mockBranding = { plugins: [], showBuilder: false } as AdminBranding;
    mockPermissionsLoading = true;
    render(<DashboardHeader />);
    for (const title of BESIDE_THE_MENU) {
      expect(screen.getByRole("link", { name: title })).toBeVisible();
    }
    expect(screen.getByRole("button", { name: "Choose theme" })).toBeVisible();
  });

  it("marks the row pending while its answers arrive and settled once they are in", () => {
    const marker = () =>
      document
        .querySelector("[data-shell-answers]")
        ?.getAttribute("data-shell-answers");
    mockWorkspacePending = true;
    const { unmount } = render(<DashboardHeader />);
    expect(marker()).toBe("pending");
    unmount();
    mockWorkspacePending = false;
    mockBranding = { plugins: [], showBuilder: true } as AdminBranding;
    mockPermissionsLoading = true;
    const second = render(<DashboardHeader />);
    expect(marker()).toBe("pending");
    second.unmount();
    mockPermissionsLoading = false;
    render(<DashboardHeader />);
    expect(marker()).toBe("settled");
  });

  it("draws the whole row, the menu last, once both answers are in", () => {
    mockBranding = { plugins: [], showBuilder: true } as AdminBranding;
    render(<DashboardHeader />);
    const menu = screen.getByTestId("account-menu");
    const bell = screen.getByRole("button", { name: "Recent schema changes" });
    expect(bell).toBeVisible();
    // The bell precedes the menu in the row, so the menu stays its right end.
    expect(
      bell.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    for (const title of BESIDE_THE_MENU) {
      expect(screen.getByRole("link", { name: title })).toBeVisible();
    }
  });
});
