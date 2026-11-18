// @vitest-environment jsdom
/**
 * The Activity list draws each delivery and queued email with its time,
 * outcome, email, provider, recipient and what happened, as a table and as
 * phone cards carrying the same, and says what it does not keep.
 *
 * @module components/features/email-hub/activity/__tests__/ActivityList.test
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { deliveryRow, queuedRow } from "../activity-model";

// The admin's own formatter, which writes times in the General Settings time
// zone; marked here so a row shown in the browser's zone can't pass.
vi.mock("@admin/hooks/useAdminDateFormatter", () => ({
  formatDateWithAdminTimezone: (value: Date | string) =>
    `ADMIN-TZ ${new Date(value).toISOString()}`,
}));
import { ActivityList, type ActivityListProps } from "../ActivityList";

const NOW = new Date("2026-11-16T12:00:00.000Z");

const ROWS = [
  deliveryRow({
    id: "d1",
    createdAt: "2026-11-16T11:00:00.000Z",
    outcome: "sent",
    templateSlug: "password-reset",
    provider: { id: "p1", type: "resend" },
    recipientKind: "cc",
    failureReason: null,
    namedPerson: true,
    erased: false,
  }),
  queuedRow({
    id: "q1",
    createdAt: "2026-11-16T10:30:00.000Z",
    updatedAt: "2026-11-16T11:40:00.000Z",
    settledAt: null,
    state: "retrying",
    attempts: 2,
    nextAttemptAt: "2026-11-16T12:10:00.000Z",
    lastFailure: {
      retryable: true,
      status: 503,
      reason: "Resend answered 503",
    },
    messageHeld: true,
    templateSlug: "order-shipped",
    queuedBy: "plugin:shop",
  }),
  deliveryRow({
    id: "d2",
    createdAt: "2026-11-16T09:00:00.000Z",
    outcome: "failed",
    templateSlug: null,
    provider: { id: null, type: "postmark" },
    recipientKind: "to",
    failureReason: "Mailbox does not exist",
    namedPerson: false,
    erased: true,
  }),
];

function renderList(over: Partial<ActivityListProps> = {}) {
  const props: ActivityListProps = {
    rows: ROWS,
    names: {
      template: slug =>
        slug === "password-reset" ? "Password reset" : undefined,
      provider: id => (id === "p1" ? "Resend (main)" : undefined),
    },
    now: NOW,
    isLoading: false,
    filtered: false,
    hasMore: false,
    isLoadingMore: false,
    onLoadMore: vi.fn(),
    ...over,
  };
  render(<ActivityList {...props} />);
  return props;
}

describe("the Activity list", () => {
  it("draws each row in the table, newest first, with what it knows of each", () => {
    renderList();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    const text = rows.map(row => row.textContent ?? "");

    // A delivery: the template's name, the provider's name, Cc, a person.
    expect(text[0]).toContain("Password reset");
    expect(text[0]).toContain("Resend (main)");
    expect(text[0]).toContain("Cc");
    expect(text[0]).toContain("Named a person");
    expect(text[0]).toContain("Sent");

    // A queued email: its state, its attempt, and when it tries next.
    expect(text[1]).toContain("Retrying");
    expect(text[1]).toContain("Attempt 2");
    expect(text[1]).toContain("Queued");
    expect(text[1]).toContain("Next attempt in 10 min");
    expect(text[1]).toContain("Resend answered 503");
    // A template the hub cannot name is shown by its slug.
    expect(text[1]).toContain("order-shipped");

    // A delivery without a template, by a provider that isn't stored (set in
    // code, or deleted since: the log doesn't say which), erased.
    expect(text[2]).toContain("No template");
    expect(text[2]).toContain("postmark (not stored)");
    expect(text[2]).not.toContain("deleted");
    expect(text[2]).toContain("Erased");
    expect(text[2]).toContain("Mailbox does not exist");
  });

  it("keeps provider and recipient in the table below the width that shows their columns", () => {
    renderList();
    const firstRow = within(screen.getByRole("table")).getAllByRole("row")[1];
    // Shown only where the Provider and Recipient columns are hidden.
    const compact = firstRow.querySelector("[data-compact-details]");
    expect(compact?.className).toContain("xl:hidden");
    expect(compact?.textContent).toContain("Resend (main)");
    expect(compact?.textContent).toContain("Cc");
  });

  it("writes each row's time with the admin's formatter, in the site's time zone", () => {
    renderList();
    const firstRow = within(screen.getByRole("table")).getAllByRole("row")[1];
    expect(firstRow.textContent).toContain("ADMIN-TZ 2026-11-16T11:00:00.000Z");
  });

  it("draws a phone card per row carrying the same", () => {
    renderList();
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(3);
    expect(cards[0].textContent).toContain("Password reset");
    expect(cards[0].textContent).toContain("Resend (main)");
    expect(cards[2].textContent).toContain("postmark (not stored)");
  });

  it("says what this log keeps, and that a queued email's message is held only while it can be sent", () => {
    renderList();
    const line = screen.getByText(
      /This log keeps no addresses, subjects or bodies/
    );
    expect(line.textContent).toContain(
      "message is held, encrypted, only while it can still be sent"
    );
  });

  it("says a queued email without a template slug has none recorded, which is true of both causes", () => {
    renderList({
      rows: [
        queuedRow({
          id: "q9",
          createdAt: "2026-11-16T10:00:00.000Z",
          updatedAt: "2026-11-16T10:00:00.000Z",
          settledAt: null,
          state: "waiting",
          attempts: 0,
          nextAttemptAt: "2026-11-16T12:05:00.000Z",
          lastFailure: null,
          messageHeld: true,
          templateSlug: null,
          queuedBy: "site",
        }),
      ],
    });
    const row = within(screen.getByRole("table")).getAllByRole("row")[1];
    expect(row.textContent).toContain("No template recorded");
  });

  it("says why it is empty, filtered or not", () => {
    renderList({ rows: [] });
    expect(
      screen.getByText("No email has been sent in this time.")
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says nothing matches when filters leave it empty", () => {
    renderList({ rows: [], filtered: true });
    expect(screen.getByText("Nothing matches these filters.")).toBeTruthy();
  });

  it("loads more at its end while more is left", () => {
    const props = renderList({ hasMore: true });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("offers no Load more once everything is shown", () => {
    renderList({ hasMore: false });
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
