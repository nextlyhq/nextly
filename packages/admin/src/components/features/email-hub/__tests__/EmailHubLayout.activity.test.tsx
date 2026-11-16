// @vitest-environment jsdom
/**
 * The Activity tab: shown only to a reader who may read deliveries, and
 * marked while queued email is overdue, so the late queue is seen from every
 * tab. Nobody without the grant asks the server whether it is.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useQueuedEmailOverdue } from "@admin/hooks/queries/useEmailActivity";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { holdsPermission } from "@admin/lib/permissions/holds-permission";

import { EmailHubLayout } from "../EmailHubLayout";

vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: vi.fn(),
}));
vi.mock("@admin/hooks/queries/useEmailActivity", () => ({
  useQueuedEmailOverdue: vi.fn(),
}));
vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));

function holding(slugs: string[]) {
  vi.mocked(useCurrentUserPermissions).mockReturnValue({
    hasPermission: (slug: string) => holdsPermission(new Set(slugs), slug),
    isLoading: false,
    hasAnswer: true,
    error: null,
  } as unknown as ReturnType<typeof useCurrentUserPermissions>);
}

function overdue(count: number) {
  vi.mocked(useQueuedEmailOverdue).mockReturnValue({
    data: { overdue: count, capped: false, warningAfterMinutes: 15 },
  } as unknown as ReturnType<typeof useQueuedEmailOverdue>);
}

function renderHub() {
  render(
    <EmailHubLayout tab="messages">
      <p>the tab</p>
    </EmailHubLayout>
  );
}

function tabs(): string[] {
  return screen
    .getAllByRole("tab")
    .map(tab => tab.firstChild?.textContent ?? "");
}

beforeEach(() => {
  vi.mocked(useQueuedEmailOverdue).mockReset();
});

describe("the Activity tab", () => {
  it("shows to a reader who may read deliveries, after the other tabs", () => {
    holding([
      "read-email-templates",
      "read-email-providers",
      "read-email-deliveries",
    ]);
    overdue(0);
    renderHub();
    expect(tabs()).toEqual(["Messages", "Design", "Sending", "Activity"]);
  });

  it("is the only tab of a reader who may read deliveries and nothing else", () => {
    holding(["read-email-deliveries"]);
    overdue(0);
    renderHub();
    expect(tabs()).toEqual(["Activity"]);
  });

  it("is hidden from a reader who may not read deliveries, who asks nothing of the queue", () => {
    holding(["read-email-templates", "read-email-providers"]);
    renderHub();
    expect(tabs()).not.toContain("Activity");
    expect(useQueuedEmailOverdue).not.toHaveBeenCalled();
  });

  it("is marked while queued email is overdue, and not otherwise", () => {
    holding(["read-email-deliveries"]);
    overdue(3);
    const { unmount } = render(
      <EmailHubLayout tab="messages">
        <p>the tab</p>
      </EmailHubLayout>
    );
    expect(screen.getByLabelText("Queued email is overdue")).toBeTruthy();
    unmount();

    overdue(0);
    renderHub();
    expect(screen.queryByLabelText("Queued email is overdue")).toBeNull();
  });
});
