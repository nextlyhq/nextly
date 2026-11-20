// @vitest-environment jsdom
/**
 * The Activity screen when a read fails: a list that has loaded stays on
 * screen with a short note when a later refresh or Load more fails, and only
 * a list with nothing loaded is replaced by the error.
 *
 * @module components/features/email-hub/activity/__tests__/ActivityScreen.test
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  useActivityDetail,
  useEmailActivity,
} from "@admin/hooks/queries/useEmailActivity";

import { activityRow } from "../activity-model";
import { ActivityScreen } from "../ActivityScreen";

vi.mock("@admin/hooks/queries/useEmailActivity", () => ({
  useEmailActivity: vi.fn(),
  useQueuedEmailOverdue: () => ({ data: undefined }),
  useActivityDetail: vi.fn(() => ({ data: undefined, isLoading: false })),
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
// The grants the reader holds; read-email-deliveries alone unless a case adds more.
const held = new Set<string>(["read-email-deliveries"]);
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    hasPermission: (slug: string) => held.has(slug),
    hasAnswer: true,
  }),
}));

const ROW = activityRow({
  kind: "delivery",
  id: "d1",
  createdAt: "2026-11-16T11:00:00.000Z",
  status: "sent",
  template: { slug: "password-reset" },
  provider: { id: null, type: "smtp", origin: "code" },
  recipientKinds: ["to"],
  failureReason: null,
  attempts: null,
  nextAttemptAt: null,
  erased: false,
});

function activity(over: Partial<ReturnType<typeof useEmailActivity>>) {
  vi.mocked(useEmailActivity).mockReturnValue({
    rows: [],
    notice: null,
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

describe("opening a row's detail sheet", () => {
  it("opens the sheet for the row whose email is chosen", () => {
    activity({ rows: [ROW] });
    render(<ActivityScreen />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "password-reset" })[0]
    );
    expect(vi.mocked(useActivityDetail)).toHaveBeenLastCalledWith({
      source: "delivery",
      id: "d1",
    });
  });
});

describe("Fix template", () => {
  const QUEUED_FAILED = {
    source: "queued" as const,
    detail: {
      id: "q1",
      createdAt: "2026-11-16T11:00:00.000Z",
      updatedAt: "2026-11-16T11:00:00.000Z",
      settledAt: null,
      state: "failed" as const,
      attempts: 1,
      nextAttemptAt: null,
      lastFailure: { retryable: false, reason: "Bad Reply-To" },
      messageHeld: true,
      templateSlug: "password-reset",
      queuedBy: "site",
      templateCaused: true,
      templateVersion: null,
      timeline: [],
      timelineTruncated: false,
    },
  };

  function openFailedQueued() {
    vi.mocked(useActivityDetail).mockReturnValue({
      data: QUEUED_FAILED,
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useActivityDetail>);
    cachedTemplates.data = [
      {
        id: "t-9",
        slug: "password-reset",
        name: "Password reset",
        kind: "template",
      },
    ];
    activity({ rows: [ROW] });
    render(<ActivityScreen />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Password reset" })[0]
    );
  }

  it("opens the template's own edit page for a reader who may edit templates", () => {
    held.add("read-email-templates");
    held.add("update-email-templates");
    openFailedQueued();
    expect(
      screen.getByRole("link", { name: "Fix template" }).getAttribute("href")
    ).toBe("/admin/settings/email/messages/edit/t-9");
    held.delete("read-email-templates");
    held.delete("update-email-templates");
    cachedTemplates.data = undefined;
  });

  it("isn't offered to a reader who may read templates but not edit them", () => {
    held.add("read-email-templates");
    openFailedQueued();
    expect(screen.queryByRole("link", { name: "Fix template" })).toBeNull();
    held.delete("read-email-templates");
    cachedTemplates.data = undefined;
  });
});

describe("searching by address", () => {
  function searchFor(address: string) {
    fireEvent.change(
      screen.getByLabelText("Find what was sent to an address"),
      { target: { value: address } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
  }

  it("lists what went to the address, with the server's notice and a count that says so", () => {
    activity({ rows: [ROW], notice: "Older records can't be found this way." });
    render(<ActivityScreen />);
    // The whole Activity first: no notice, no search asked for.
    expect(
      screen.queryByText("Older records can't be found this way.")
    ).toBeNull();
    searchFor("ada@example.test");
    expect(vi.mocked(useEmailActivity)).toHaveBeenLastCalledWith(
      expect.anything(),
      {
        search: expect.objectContaining({
          id: 1,
          address: "ada@example.test",
          filter: { outcome: "any", window: "7d" },
        }),
      }
    );
    expect(
      screen.getByText("Older records can't be found this way.")
    ).toBeTruthy();
    expect(screen.getByText(/found for this address/)).toBeTruthy();
  });

  it("asks again as a new search when a filter changes on a search's results", () => {
    activity({ rows: [ROW] });
    render(<ActivityScreen />);
    searchFor("ada@example.test");
    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    expect(vi.mocked(useEmailActivity)).toHaveBeenLastCalledWith(
      expect.anything(),
      {
        search: expect.objectContaining({
          id: 2,
          address: "ada@example.test",
          filter: { outcome: "any", window: "30d" },
        }),
      }
    );
  });

  it("asks nothing again when a choice changes nothing, as the window already chosen", () => {
    activity({ rows: [ROW] });
    render(<ActivityScreen />);
    searchFor("ada@example.test");
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(vi.mocked(useEmailActivity)).toHaveBeenLastCalledWith(
      expect.anything(),
      { search: expect.objectContaining({ id: 1 }) }
    );
  });

  it("shows no count for a search not answered yet, or one that failed with nothing found", () => {
    activity({ rows: [], isLoading: true });
    const { rerender } = render(<ActivityScreen />);
    searchFor("ada@example.test");
    expect(
      screen.getByText(/found for this address/).closest("[hidden]")
    ).not.toBeNull();
    activity({ rows: [], isError: true, error: new Error("Network down") });
    rerender(<ActivityScreen />);
    expect(
      screen.getByText(/found for this address/).closest("[hidden]")
    ).not.toBeNull();
    activity({ rows: [ROW] });
    rerender(<ActivityScreen />);
    expect(
      screen.getByText(/found for this address/).closest("[hidden]")
    ).toBeNull();
  });

  it("searches the same address again as a new search, and clears back to the whole Activity", () => {
    activity({ rows: [ROW] });
    render(<ActivityScreen />);
    searchFor("ada@example.test");
    searchFor("ada@example.test");
    expect(vi.mocked(useEmailActivity)).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        search: expect.objectContaining({ id: 2, address: "ada@example.test" }),
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(vi.mocked(useEmailActivity)).toHaveBeenLastCalledWith(
      expect.anything(),
      { search: undefined }
    );
  });
});
