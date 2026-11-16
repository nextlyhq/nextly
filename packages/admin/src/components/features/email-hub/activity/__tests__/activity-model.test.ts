/**
 * Activity's model: how the screen's filters reach the two lists the server
 * answers, how the two are merged into one newest-first list, and the words
 * each row says.
 *
 * @module components/features/email-hub/activity/__tests__/activity-model.test
 */
import { describe, expect, it } from "vitest";

import type {
  DeliveryActivity,
  QueuedEmailActivity,
} from "@admin/services/emailActivityApi";

import {
  deliveryRow,
  mergeNewestFirst,
  queuedRow,
  sourcesFor,
  whatHappened,
  type ActivityFilter,
} from "../activity-model";

const NOW = new Date("2026-11-16T12:00:00.000Z");

function delivery(over: Partial<DeliveryActivity> = {}): DeliveryActivity {
  return {
    id: "d1",
    createdAt: "2026-11-16T11:00:00.000Z",
    outcome: "sent",
    templateSlug: "password-reset",
    provider: { id: "p1", type: "resend" },
    recipientKind: "to",
    failureReason: null,
    namedPerson: true,
    erased: false,
    ...over,
  };
}

function queued(over: Partial<QueuedEmailActivity> = {}): QueuedEmailActivity {
  return {
    id: "q1",
    createdAt: "2026-11-16T10:00:00.000Z",
    updatedAt: "2026-11-16T10:00:00.000Z",
    settledAt: null,
    state: "waiting",
    attempts: 0,
    nextAttemptAt: "2026-11-16T10:00:00.000Z",
    lastFailure: null,
    messageHeld: true,
    templateSlug: "order-shipped",
    queuedBy: "plugin:shop",
    ...over,
  };
}

const ANY: ActivityFilter = { outcome: "any", window: "7d" };

describe("sourcesFor", () => {
  it("asks both lists, from the start of the time window, when nothing else is chosen", () => {
    const from = new Date(
      NOW.getTime() - 7 * 24 * 60 * 60 * 1000
    ).toISOString();
    expect(sourcesFor(ANY, NOW)).toEqual({
      deliveries: { from },
      queued: { from },
    });
    expect(sourcesFor({ ...ANY, window: "24h" }, NOW).deliveries?.from).toBe(
      new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString()
    );
  });

  it("asks both lists for sent or failed, each in its own words", () => {
    const sources = sourcesFor({ ...ANY, outcome: "failed" }, NOW);
    expect(sources.deliveries).toMatchObject({ outcome: "failed" });
    expect(sources.queued).toMatchObject({ state: "failed" });
  });

  it("asks only queued email for a state only queued email has", () => {
    for (const outcome of [
      "waiting",
      "retrying",
      "sending",
      "cancelled",
    ] as const) {
      const sources = sourcesFor({ ...ANY, outcome }, NOW);
      expect(sources.deliveries, outcome).toBeNull();
      expect(sources.queued, outcome).toMatchObject({ state: outcome });
    }
  });

  it("passes the template to both lists", () => {
    const sources = sourcesFor({ ...ANY, template: "order-shipped" }, NOW);
    expect(sources.deliveries).toMatchObject({ template: "order-shipped" });
    expect(sources.queued).toMatchObject({ template: "order-shipped" });
  });

  it("filters the delivery log by a stored provider's id, or a deleted one's type, and leaves queued email out", () => {
    const stored = sourcesFor({ ...ANY, provider: { id: "p1" } }, NOW);
    expect(stored.deliveries).toMatchObject({ providerId: "p1" });
    expect(stored.deliveries).not.toHaveProperty("providerType");
    // Queued email cannot be narrowed by provider yet, so it is not listed
    // rather than listed unfiltered.
    expect(stored.queued).toBeNull();
    const deleted = sourcesFor({ ...ANY, provider: { type: "postmark" } }, NOW);
    expect(deleted.deliveries).toMatchObject({ providerType: "postmark" });
    expect(deleted.deliveries).not.toHaveProperty("providerId");
  });
});

describe("mergeNewestFirst", () => {
  const at = (iso: string, id: string) =>
    deliveryRow(delivery({ id, createdAt: iso }));
  const q = (iso: string, id: string) =>
    queuedRow(queued({ id, createdAt: iso }));

  it("interleaves the two lists newest first", () => {
    const rows = mergeNewestFirst([
      {
        rows: [
          at("2026-11-16T11:00:00Z", "d1"),
          at("2026-11-16T09:00:00Z", "d2"),
        ],
        more: false,
      },
      { rows: [q("2026-11-16T10:00:00Z", "q1")], more: false },
    ]);
    expect(rows.map(row => row.id)).toEqual(["d1", "q1", "d2"]);
  });

  it("holds back what a list with more to load could still precede", () => {
    // The queued list has more beyond 10:00, so a delivery at 09:00 could be
    // preceded by a queued email not loaded yet: it waits for the next page,
    // as does the queued email at 10:00 itself, which another at 10:00 on
    // that page could precede.
    const rows = mergeNewestFirst([
      {
        rows: [
          at("2026-11-16T11:00:00Z", "d1"),
          at("2026-11-16T09:00:00Z", "d2"),
        ],
        more: false,
      },
      { rows: [q("2026-11-16T10:00:00Z", "q1")], more: true },
    ]);
    expect(rows.map(row => row.id)).toEqual(["d1"]);
  });

  it("holds back a row at the very time a list with more stopped at", () => {
    // The queued list stopped at 10:00 with more to load: its next page can
    // hold another email at 10:00 that sorts before the delivery at 10:00.
    const rows = mergeNewestFirst([
      {
        rows: [
          at("2026-11-16T11:00:00Z", "d1"),
          at("2026-11-16T10:00:00Z", "d0"),
        ],
        more: false,
      },
      {
        rows: [
          q("2026-11-16T10:30:00Z", "q2"),
          q("2026-11-16T10:00:00Z", "q1"),
        ],
        more: true,
      },
    ]);
    expect(rows.map(row => row.id)).toEqual(["d1", "q2"]);
  });

  it("shows every row once no list has more", () => {
    const rows = mergeNewestFirst([
      { rows: [], more: false },
      { rows: [q("2026-11-16T10:00:00Z", "q1")], more: false },
    ]);
    expect(rows.map(row => row.id)).toEqual(["q1"]);
  });
});

describe("whatHappened", () => {
  it("says a delivery was sent, or why it failed", () => {
    expect(whatHappened(deliveryRow(delivery()), NOW)).toEqual({
      title: "Sent",
    });
    expect(
      whatHappened(
        deliveryRow(
          delivery({ outcome: "failed", failureReason: "Mailbox unavailable" })
        ),
        NOW
      )
    ).toEqual({ title: "Failed", detail: "Mailbox unavailable" });
  });

  it("says when a retrying email tries next, and why the last attempt failed", () => {
    const row = queuedRow(
      queued({
        state: "retrying",
        attempts: 2,
        nextAttemptAt: "2026-11-16T12:10:00.000Z",
        lastFailure: {
          retryable: true,
          status: 503,
          reason: "Resend answered 503",
        },
      })
    );
    expect(whatHappened(row, NOW)).toEqual({
      title: "Next attempt in 10 min",
      detail: "Resend answered 503",
    });
  });

  it("says when a waiting email's first attempt is due, or how late it is", () => {
    expect(
      whatHappened(
        queuedRow(queued({ nextAttemptAt: "2026-11-16T12:05:00.000Z" })),
        NOW
      ).title
    ).toBe("First attempt in 5 min");
    expect(
      whatHappened(
        queuedRow(queued({ nextAttemptAt: "2026-11-16T11:00:00.000Z" })),
        NOW
      ).title
    ).toBe("First attempt overdue by 1 h");
  });

  it("says a late retry is late", () => {
    const row = queuedRow(
      queued({
        state: "retrying",
        attempts: 1,
        nextAttemptAt: "2026-11-16T11:30:00.000Z",
        lastFailure: { retryable: true, reason: "Timed out" },
      })
    );
    expect(whatHappened(row, NOW).title).toBe("Next attempt overdue by 30 min");
  });

  it("says a failed queued email whose message was cleared can no longer be sent", () => {
    const row = queuedRow(
      queued({
        state: "failed",
        attempts: 5,
        messageHeld: false,
        lastFailure: { retryable: false, reason: "Mailbox does not exist" },
      })
    );
    expect(whatHappened(row, NOW)).toEqual({
      title: "Failed",
      detail: "Mailbox does not exist",
      note: "Its message was cleared, so it can't be sent again.",
    });
  });

  it("keeps a cancelled email's last failure on the record", () => {
    const row = queuedRow(
      queued({
        state: "cancelled",
        attempts: 1,
        lastFailure: { retryable: true, reason: "Internal server error" },
      })
    );
    expect(whatHappened(row, NOW)).toEqual({
      title: "Cancelled",
      detail: "Last failure: Internal server error",
    });
  });
});
