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
import { ActivityScreen, ProviderFilterNote } from "../ActivityScreen";

vi.mock("@admin/hooks/queries/useEmailActivity", () => ({
  useEmailActivity: vi.fn(),
  useQueuedEmailOverdue: () => ({ data: undefined }),
}));
// What the template read holds in its cache: TanStack Query keeps answering
// it after the query is disabled, as when a reader's grant ends.
const cachedTemplates: { data: unknown } = { data: undefined };
vi.mock("@admin/hooks/queries/useEmailTemplates", () => ({
  useEmailTemplates: () => cachedTemplates,
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

describe("the note shown while a provider is chosen", () => {
  it("says every queued email is left out, not only those waiting for a first attempt", () => {
    render(<ProviderFilterNote provider={{ type: "smtp" }} />);
    const note = screen.getByText(/queued email/i);
    expect(note.textContent).toMatch(/no queued email is listed/i);
    expect(note.textContent).not.toMatch(/waiting for its first attempt/i);
  });

  it("is not shown while no provider is chosen", () => {
    const { container } = render(<ProviderFilterNote provider={undefined} />);
    expect(container.textContent).toBe("");
  });
});

describe("names from a list the reader may no longer read", () => {
  it("never shows a cached template name once the template grant is gone", () => {
    // The reader holds only read-email-deliveries (the permissions mock), yet
    // the template list is still in the cache from when they held its grant.
    cachedTemplates.data = [
      { slug: "password-reset", name: "Password reset", kind: "template" },
    ];
    activity({ rows: [ROW] });
    render(<ActivityScreen />);
    expect(screen.queryAllByText("Password reset")).toHaveLength(0);
    expect(screen.getAllByText("password-reset").length).toBeGreaterThan(0);
    cachedTemplates.data = undefined;
  });
});
