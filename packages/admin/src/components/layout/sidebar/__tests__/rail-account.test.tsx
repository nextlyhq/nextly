// @vitest-environment jsdom
/**
 * The rail's foot holds the reader's Inbox (the notification bell) and their
 * account menu, which used to sit at the right end of the top bar.
 *
 * A plugin's header powers carry over: `header.hide` and `hideDefaults` hide
 * the same items in their new places (the bell here, the help links in the
 * menu). A plugin's own header item stays in the top bar. The bell
 * shows the schema-change journal only where the builder runs. Nothing here
 * is drawn until the answers deciding it are in, so the foot never changes
 * after its first paint.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  NotificationBell: ({
    journalOffered,
    side,
  }: {
    journalOffered?: boolean;
    side?: string;
  }) => (
    <button
      type="button"
      data-testid="bell"
      data-journal={String(journalOffered)}
      data-side={side}
      aria-label="Notifications"
    />
  ),
}));
/** The menu as RailAccount hands it its props, read back by the tests. */
vi.mock("../UserProfileDropdown", () => ({
  UserProfileDropdown: ({
    hidden,
    side,
  }: {
    hidden: ReadonlySet<string>;
    side?: string;
  }) => (
    <div
      data-testid="account-menu"
      data-hidden={[...hidden].sort().join(",")}
      data-side={side}
    />
  ),
}));

import { RailAccount } from "../RailAccount";

const marker = () =>
  screen.getByTestId("rail-account").getAttribute("data-shell-answers");

afterEach(() => {
  mockBranding = undefined;
  mockWorkspacePending = false;
  mockPermissionsLoading = false;
});

describe("the rail's account foot", () => {
  it("offers the bell and the menu, both opening to the right of the rail", () => {
    mockBranding = { plugins: [], showBuilder: true } as AdminBranding;
    render(<RailAccount />);
    expect(screen.getByTestId("bell")).toHaveAttribute("data-side", "right");
    expect(screen.getByTestId("account-menu")).toHaveAttribute(
      "data-side",
      "right"
    );
    expect(screen.getByTestId("account-menu")).toHaveAttribute(
      "data-hidden",
      ""
    );
  });

  it("hides what a plugin's header.hide lists, in their new places", () => {
    mockBranding = {
      plugins: [
        {
          name: "@acme/p",
          collections: [],
          header: { hide: ["github", "notifications"] },
        },
      ],
    } as AdminBranding;
    render(<RailAccount />);
    expect(screen.queryByTestId("bell")).not.toBeInTheDocument();
    expect(screen.getByTestId("account-menu")).toHaveAttribute(
      "data-hidden",
      "github,notifications"
    );
  });

  it("hides every default where a plugin asks hideDefaults", () => {
    mockBranding = {
      plugins: [
        { name: "@acme/p", collections: [], header: { hideDefaults: true } },
      ],
    } as AdminBranding;
    render(<RailAccount />);
    expect(screen.queryByTestId("bell")).not.toBeInTheDocument();
    expect(screen.getByTestId("account-menu")).toHaveAttribute(
      "data-hidden",
      "discord,docs,github,notifications"
    );
  });

  it("shows the bell's schema changes only where the builder runs", () => {
    mockBranding = { plugins: [], showBuilder: false } as AdminBranding;
    const { unmount } = render(<RailAccount />);
    expect(screen.getByTestId("bell")).toHaveAttribute("data-journal", "false");
    unmount();
    mockBranding = { plugins: [], showBuilder: true } as AdminBranding;
    render(<RailAccount />);
    expect(screen.getByTestId("bell")).toHaveAttribute("data-journal", "true");
  });
});

describe("the account controls drawn in the top bar", () => {
  afterEach(() => {
    document.querySelectorAll("nextjs-portal").forEach(node => node.remove());
  });

  it("sit in a row, open downwards and keep no development space", () => {
    document.body.append(document.createElement("nextjs-portal"));
    mockBranding = { plugins: [], showBuilder: true } as AdminBranding;
    render(<RailAccount placement="bar" />);
    const foot = screen.getByTestId("bar-account");
    expect(foot.className).not.toContain("flex-col");
    expect(foot.className).not.toContain("pb-16");
    expect(screen.getByTestId("bell")).toHaveAttribute("data-side", "bottom");
    expect(screen.getByTestId("account-menu")).toHaveAttribute(
      "data-side",
      "bottom"
    );
  });
});

describe("the rail's account foot while its answers arrive", () => {
  it("draws nothing visible, and says so, while the workspace answer is pending", () => {
    mockWorkspacePending = true;
    render(<RailAccount />);
    expect(screen.getByTestId("account-menu")).not.toBeVisible();
    expect(screen.getByTestId("bell")).not.toBeVisible();
    expect(marker()).toBe("pending");
  });

  it("waits on the permissions that decide the bell", () => {
    mockBranding = { plugins: [], showBuilder: true } as AdminBranding;
    mockPermissionsLoading = true;
    render(<RailAccount />);
    expect(screen.getByTestId("account-menu")).not.toBeVisible();
    expect(marker()).toBe("pending");
  });

  it("does not wait on permissions where no bell can be offered", () => {
    mockBranding = {
      plugins: [
        {
          name: "@acme/p",
          collections: [],
          header: { hide: ["notifications"] },
        },
      ],
    } as AdminBranding;
    mockPermissionsLoading = true;
    render(<RailAccount />);
    expect(screen.getByTestId("account-menu")).toBeVisible();
    expect(marker()).toBe("settled");
  });

  it("draws the bell and the menu once both answers are in", () => {
    mockBranding = { plugins: [], showBuilder: true } as AdminBranding;
    render(<RailAccount />);
    expect(screen.getByTestId("bell")).toBeVisible();
    expect(screen.getByTestId("account-menu")).toBeVisible();
    expect(marker()).toBe("settled");
  });
});

describe("the rail's account foot and Next.js's development badge", () => {
  afterEach(() => {
    document.querySelectorAll("nextjs-portal").forEach(node => node.remove());
  });

  it("keeps no space below the avatar where Next.js draws no overlay", () => {
    mockBranding = { plugins: [], showBuilder: true } as AdminBranding;
    render(<RailAccount />);
    expect(screen.getByTestId("rail-account").className).not.toContain("pb-16");
  });

  it("keeps its foot clear once Next.js's development overlay is in the page", async () => {
    mockBranding = { plugins: [], showBuilder: true } as AdminBranding;
    render(<RailAccount />);
    // Next.js adds its overlay after the page has started, as `next dev` does.
    await act(async () => {
      document.body.append(document.createElement("nextjs-portal"));
    });
    expect(screen.getByTestId("rail-account").className).toContain("pb-16");
  });

  it("keeps its foot clear where the overlay was there first", () => {
    document.body.append(document.createElement("nextjs-portal"));
    mockBranding = { plugins: [], showBuilder: true } as AdminBranding;
    render(<RailAccount />);
    expect(screen.getByTestId("rail-account").className).toContain("pb-16");
  });
});
