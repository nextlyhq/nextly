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
  NotificationBell: () => null,
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
