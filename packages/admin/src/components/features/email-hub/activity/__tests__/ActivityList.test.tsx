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
    expect(text[1]).toContain("Trying again in 10 min");
    expect(text[1]).toContain("Resend answered 503");
    // A template the hub cannot name is shown by its slug.
    expect(text[1]).toContain("order-shipped");

    // A delivery without a template, by a provider deleted since, erased.
    expect(text[2]).toContain("No template");
    expect(text[2]).toContain("postmark (deleted)");
    expect(text[2]).toContain("Erased");
    expect(text[2]).toContain("Mailbox does not exist");
  });

  it("draws a phone card per row carrying the same", () => {
    renderList();
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(3);
    expect(cards[0].textContent).toContain("Password reset");
    expect(cards[0].textContent).toContain("Resend (main)");
    expect(cards[2].textContent).toContain("postmark (deleted)");
  });

  it("says that no address, subject or body is kept", () => {
    renderList();
    expect(
      screen.getByText(/No addresses, subjects or bodies are kept/)
    ).toBeTruthy();
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
