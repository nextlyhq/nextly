/**
 * The person's menu draws its help links from the admin's one list of them,
 * the list the command palette reads too: a link changed there changes here.
 * The list is replaced with a different one, so a menu keeping a copy of its
 * own would still show the real links and fail.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { AdminI18nProvider } from "@admin/context/providers/AdminI18nProvider";

import { UserProfileDropdown } from "../UserProfileDropdown";

vi.mock("@admin/components/shared/command-palette/help-links", () => ({
  HELP_LINKS: [
    { id: "docs", label: "Handbook", href: "https://example.com/handbook" },
  ],
}));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [] }),
}));
vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));
vi.mock("@admin/hooks/queries/useAuthSession", () => ({
  useAuthSession: () => ({ data: { isSetup: true, isAuthenticated: true } }),
}));
vi.mock("@admin/hooks/useApi", () => ({
  useApi: () => ({
    api: {
      protected: {
        get: async () => ({
          id: "u1",
          name: "Ada",
          email: "ada@example.com",
          interfaceLanguage: null,
        }),
        patch: async () => ({ message: "Profile updated.", item: {} }),
      },
    },
  }),
}));

describe("the person's menu and the help links", () => {
  it("draws the admin's one list of help links", async () => {
    const user = userEvent.setup();
    render(
      <AdminI18nProvider signedIn>
        <UserProfileDropdown
          user={{ id: "u1", name: "Ada", email: "ada@example.com" }}
          onLogout={() => {}}
        />
      </AdminI18nProvider>
    );
    await user.click(screen.getByRole("button", { name: "User profile menu" }));
    const link = await screen.findByRole("menuitem", { name: "Handbook" });
    expect(link.getAttribute("href")).toBe("https://example.com/handbook");
    expect(screen.queryByRole("menuitem", { name: "GitHub" })).toBeNull();
  });
});
