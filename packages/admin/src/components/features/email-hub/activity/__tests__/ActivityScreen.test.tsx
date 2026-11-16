// @vitest-environment jsdom
/**
 * The Activity screen when a read fails: a list that has loaded stays on
 * screen with a short note when a later refresh or Load more fails, and only
 * a list with nothing loaded is replaced by the error.
 *
 * @module components/features/email-hub/activity/__tests__/ActivityScreen.test
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useEmailActivity } from "@admin/hooks/queries/useEmailActivity";

import { deliveryRow } from "../activity-model";
import { ActivityScreen } from "../ActivityScreen";

vi.mock("@admin/hooks/queries/useEmailActivity", () => ({
  useEmailActivity: vi.fn(),
  useQueuedEmailOverdue: () => ({ data: undefined }),
}));
vi.mock("@admin/hooks/queries/useEmailTemplates", () => ({
  useEmailTemplates: () => ({ data: undefined }),
}));
vi.mock("@admin/hooks/queries/useEmailProviders", () => ({
  useEmailProviders: () => ({ data: undefined }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    hasPermission: (slug: string) => slug === "read-email-deliveries",
    hasAnswer: true,
  }),
}));

const ROW = deliveryRow({
  id: "d1",
  createdAt: "2026-11-16T11:00:00.000Z",
  outcome: "sent",
  templateSlug: "password-reset",
  provider: { id: null, type: "smtp" },
  recipientKind: "to",
  failureReason: null,
  namedPerson: false,
  erased: false,
});

function activity(over: Partial<ReturnType<typeof useEmailActivity>>) {
  vi.mocked(useEmailActivity).mockReturnValue({
    rows: [],
    isLoading: false,
    isError: false,
    error: null,
    hasMore: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
    refetch: vi.fn(),
    ...over,
  });
}

describe("the Activity screen when a read fails", () => {
  it("keeps the rows it has, with a short note, when a later read fails", () => {
    activity({ rows: [ROW], isError: true, error: new Error("Network down") });
    render(<ActivityScreen />);
    expect(screen.getAllByText("password-reset").length).toBeGreaterThan(0);
    expect(screen.getByText(/Couldn.t refresh/)).toBeTruthy();
    expect(screen.queryByText(/Activity couldn.t be loaded/)).toBeNull();
  });

  it("shows the error in place of the list only when nothing has loaded", () => {
    activity({ rows: [], isError: true, error: new Error("Network down") });
    render(<ActivityScreen />);
    expect(screen.getByText(/Activity couldn.t be loaded/)).toBeTruthy();
  });
});
