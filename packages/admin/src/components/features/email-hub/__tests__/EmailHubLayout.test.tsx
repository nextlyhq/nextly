// @vitest-environment jsdom
/**
 * The hub's tabs run across the top, each shown only to a reader holding a
 * grant that reads what it shows, and choosing one navigates to its route.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMAIL_HUB_PERMISSIONS } from "@admin/constants/email-hub";
import { MAIN_MENU_ITEMS } from "@admin/components/layout/sidebar/sidebar-types";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";

import { EmailHubLayout } from "../EmailHubLayout";

vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: vi.fn(),
}));

const navigateTo = vi.fn();
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (path: string) => navigateTo(path),
}));

function holding(slugs: string[], hasAnswer = true) {
  vi.mocked(useCurrentUserPermissions).mockReturnValue({
    hasPermission: (slug: string) => slugs.includes(slug),
    isLoading: !hasAnswer,
    hasAnswer,
    error: null,
  } as unknown as ReturnType<typeof useCurrentUserPermissions>);
}

function tabs(): string[] {
  return screen.getAllByRole("tab").map(tab => tab.textContent ?? "");
}

function renderHub() {
  render(
    <EmailHubLayout tab="messages">
      <p>the tab</p>
    </EmailHubLayout>
  );
}

beforeEach(() => {
  navigateTo.mockClear();
});

describe("the Email hub's tabs", () => {
  it("shows every tab to someone who may see templates and providers", () => {
    holding(["read-email-templates", "read-email-providers"]);
    renderHub();
    expect(tabs()).toEqual(["Messages", "Design", "Sending"]);
    expect(screen.getByText("the tab")).toBeTruthy();
  });

  it("shows only Messages and Design to someone who may see templates", () => {
    holding(["manage-email-templates"]);
    renderHub();
    expect(tabs()).toEqual(["Messages", "Design"]);
  });

  it("shows only Sending to someone who may see providers", () => {
    holding(["read-email-providers"]);
    renderHub();
    expect(tabs()).toEqual(["Sending"]);
  });

  it("does not let a create-only grant reveal a list it can't read", () => {
    holding(["create-email-templates"]);
    renderHub();
    expect(screen.queryAllByRole("tab")).toEqual([]);
  });

  it("shows every tab while the grants are loading, as the rail does", () => {
    holding([], false);
    renderHub();
    expect(tabs()).toEqual(["Messages", "Design", "Sending"]);
  });

  it("navigates to a tab's route when it's chosen", () => {
    holding(["read-email-templates", "read-email-providers"]);
    renderHub();
    const sending = screen.getByRole("tab", { name: "Sending" });
    fireEvent.mouseDown(sending, { button: 0 });
    fireEvent.click(sending);
    expect(navigateTo).toHaveBeenCalledWith("/admin/email/sending");
  });
});

describe("the hub's rail entry", () => {
  it("is shown to anyone holding a grant that shows a tab", () => {
    const entry = MAIN_MENU_ITEMS.find(item => item.id === "email");
    expect(entry?.href).toBe("/admin/email");
    expect(entry?.requiredPermission).toEqual([...EMAIL_HUB_PERMISSIONS]);
    expect(EMAIL_HUB_PERMISSIONS).toEqual(
      expect.arrayContaining([
        "read-email-templates",
        "manage-email-templates",
        "read-email-providers",
        "manage-email-providers",
      ])
    );
  });
});
