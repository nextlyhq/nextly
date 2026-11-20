/**
 * Activity's model: how the screen's filters reach the merged Activity, where
 * its window starts, how a provider is named by where it came from, and the
 * words each row says.
 *
 * @module components/features/email-hub/activity/__tests__/activity-model.test
 */
import { describe, expect, it } from "vitest";

import type { ActivityEntry } from "@admin/services/emailActivityApi";

import {
  activityQuery,
  activityRow,
  holdsUnsettledQueued,
  providerLabel,
  whatHappened,
  windowStart,
  type ActivityFilter,
} from "../activity-model";

const NOW = new Date("2026-11-16T12:00:00.000Z");

function delivery(over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    kind: "delivery",
    id: "d1",
    createdAt: "2026-11-16T11:00:00.000Z",
    status: "sent",
    template: { slug: "password-reset" },
    provider: { id: "p1", type: "resend", origin: "stored" },
    recipientKinds: ["to"],
    failureReason: null,
    attempts: null,
    nextAttemptAt: null,
    erased: false,
    ...over,
  };
}

function queued(over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    kind: "queued",
    id: "q1",
    createdAt: "2026-11-16T10:00:00.000Z",
    status: "waiting",
    template: { slug: "order-shipped" },
    provider: null,
    recipientKinds: null,
    failureReason: null,
    attempts: 0,
    nextAttemptAt: "2026-11-16T10:00:00.000Z",
    erased: false,
    ...over,
  };
}

const ANY: ActivityFilter = { outcome: "any", window: "7d" };

describe("activityQuery", () => {
  it("asks for everything when nothing is chosen, leaving the window to each read", () => {
    expect(activityQuery(ANY)).toEqual({});
  });

  it("passes the outcome, template, provider type and origin as the server names them", () => {
    expect(
      activityQuery({
        ...ANY,
        outcome: "retrying",
        template: "order-shipped",
        providerType: "smtp",
        providerOrigin: "code",
      })
    ).toEqual({
      status: "retrying",
      template: "order-shipped",
      providerType: "smtp",
      providerOrigin: "code",
    });
  });
});

describe("windowStart", () => {
  it("starts the window its length before the moment it is read", () => {
    expect(windowStart("7d", NOW)).toBe(
      new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    );
    expect(windowStart("24h", NOW)).toBe("2026-11-15T12:00:00.000Z");
    // Read later, the same window starts later: it rolls with the clock.
    const later = new Date(NOW.getTime() + 60 * 60 * 1000);
    expect(windowStart("24h", later)).toBe("2026-11-15T13:00:00.000Z");
  });
});

describe("providerLabel", () => {
  const names = (id: string) => (id === "p1" ? "Transactional" : undefined);

  it("names a stored provider by its name, or its type when the reader can't see it", () => {
    expect(
      providerLabel({ id: "p1", type: "resend", origin: "stored" }, names)
    ).toBe("Transactional");
    expect(
      providerLabel({ id: "p2", type: "resend", origin: "stored" }, names)
    ).toBe("resend");
  });

  it("says where any other provider came from", () => {
    expect(
      providerLabel({ id: null, type: "smtp", origin: "code" }, names)
    ).toBe("smtp (in code)");
    expect(
      providerLabel({ id: null, type: "smtp", origin: "deleted" }, names)
    ).toBe("smtp (deleted)");
    expect(
      providerLabel({ id: null, type: "smtp", origin: "not-recorded" }, names)
    ).toBe("smtp (origin not recorded)");
    expect(providerLabel(null, names)).toBe("—");
  });
});

describe("whatHappened", () => {
  it("says a delivery was sent, or why it failed", () => {
    expect(whatHappened(activityRow(delivery()), NOW)).toEqual({
      title: "Sent",
    });
    expect(
      whatHappened(
        activityRow(
          delivery({ status: "failed", failureReason: "Mailbox unavailable" })
        ),
        NOW
      )
    ).toEqual({ title: "Failed", detail: "Mailbox unavailable" });
  });

  it("says when a retrying email tries next, and why the last attempt failed", () => {
    const row = activityRow(
      queued({
        status: "retrying",
        attempts: 2,
        nextAttemptAt: "2026-11-16T12:10:00.000Z",
        failureReason: "Resend answered 503",
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
        activityRow(queued({ nextAttemptAt: "2026-11-16T12:05:00.000Z" })),
        NOW
      ).title
    ).toBe("First attempt in 5 min");
    expect(
      whatHappened(
        activityRow(queued({ nextAttemptAt: "2026-11-16T11:00:00.000Z" })),
        NOW
      ).title
    ).toBe("First attempt overdue by 1 h");
  });

  it("says a late retry is late", () => {
    const row = activityRow(
      queued({
        status: "retrying",
        attempts: 1,
        nextAttemptAt: "2026-11-16T11:30:00.000Z",
        failureReason: "Timed out",
      })
    );
    expect(whatHappened(row, NOW).title).toBe("Next attempt overdue by 30 min");
  });

  it("says why a queued email failed for good", () => {
    const row = activityRow(
      queued({
        status: "failed",
        attempts: 5,
        nextAttemptAt: null,
        failureReason: "Mailbox does not exist",
      })
    );
    expect(whatHappened(row, NOW)).toEqual({
      title: "Failed",
      detail: "Mailbox does not exist",
    });
  });

  it("keeps a cancelled email's last failure on the record", () => {
    const row = activityRow(
      queued({
        status: "cancelled",
        attempts: 1,
        failureReason: "Internal server error",
      })
    );
    expect(whatHappened(row, NOW)).toEqual({
      title: "Cancelled",
      detail: "Last failure: Internal server error",
    });
  });
});

describe("holdsUnsettledQueued", () => {
  it("is true while a queued email can still change by itself, and not for settled rows", () => {
    for (const status of ["waiting", "retrying", "sending"] as const) {
      expect(
        holdsUnsettledQueued([activityRow(queued({ status }))]),
        status
      ).toBe(true);
    }
    for (const status of ["sent", "failed", "cancelled"] as const) {
      expect(
        holdsUnsettledQueued([activityRow(queued({ status }))]),
        status
      ).toBe(false);
    }
    // A delivery's "failed" is settled for good, never a queued state.
    expect(
      holdsUnsettledQueued([activityRow(delivery({ status: "failed" }))])
    ).toBe(false);
  });
});
