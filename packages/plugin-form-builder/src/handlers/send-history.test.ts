/**
 * How a change of a queued email is folded into its send's row: where it
 * stands, its retries, each recipient's outcome and where it came from, and
 * a cancel's cause, including one asked while an attempt was in flight and
 * one that retires a failed send.
 */
import type { QueuedEmailChange } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type { StoredSend } from "../utils/send-status";

import { foldChange } from "./send-history";

const at = new Date("2026-11-12T10:00:00.000Z");
const TEAM = { digest: "d-team", hint: "t•••@acme.test", kind: "to" as const };
const ADDED = {
  digest: "d-added",
  hint: "a•••@acme.test",
  kind: "bcc" as const,
};

const stored = (more: Partial<StoredSend> = {}): StoredSend => ({
  queuedId: "q1",
  state: "waiting",
  configured: [{ ...TEAM, source: "team" }],
  ...more,
});

const change = (more: Partial<QueuedEmailChange>): QueuedEmailChange => ({
  queuedId: "q1",
  state: "sending",
  attempt: 1,
  at,
  ...more,
});

describe("folding a change into its send", () => {
  it("keeps each recipient with where it came from, a filter's as added", () => {
    const patch = foldChange(
      stored(),
      change({
        state: "sent",
        recipients: [
          { ...TEAM, outcome: "accepted" },
          { ...ADDED, outcome: "accepted" },
        ],
      })
    );
    expect(patch).toMatchObject({
      state: "sent",
      attempts: 1,
      recipients: [
        { digest: "d-team", source: "team", retries: 0 },
        { digest: "d-added", source: "added", retries: 0 },
      ],
    });
  });

  it("counts a retry, and a recipient taken after it as sent after one", () => {
    const retrying = foldChange(
      stored(),
      change({
        state: "retrying",
        recipients: [{ ...TEAM, outcome: "refused" }],
      })
    );
    expect(retrying).toMatchObject({ state: "retrying", retries: 1 });
    const sent = foldChange(
      stored({ ...(retrying as Partial<StoredSend>), state: "retrying" }),
      change({
        state: "sent",
        attempt: 2,
        recipients: [{ ...TEAM, outcome: "accepted" }],
      })
    );
    expect(sent).toMatchObject({
      attempts: 2,
      recipients: [{ digest: "d-team", retries: 1 }],
    });
  });

  it("reads a send whose record of acceptance was undone, and made again, as sent the first time", () => {
    // Attempt 1 began; its sent change rolled back; attempt 2 finds it sent.
    const patch = foldChange(
      stored({ state: "sending", attempts: 2 }),
      change({
        state: "sent",
        attempt: 2,
        recipients: [{ ...TEAM, outcome: "accepted" }],
      })
    );
    expect(patch).toMatchObject({ recipients: [{ retries: 0 }] });
  });

  it("keeps a cancel asked during an attempt, and names it when that attempt fails", () => {
    const asked = foldChange(
      stored({ state: "sending" }),
      change({
        state: "sending",
        cancelRequested: { by: "person", userId: "u1" },
      })
    );
    expect(asked).toMatchObject({
      cancelRequested: { by: "person", userId: "u1" },
    });
    const settled = foldChange(
      stored({
        state: "sending",
        cancelRequested: { by: "person", userId: "u1" },
      }),
      change({ state: "cancelled", cancel: { by: "request" } })
    );
    expect(settled).toMatchObject({
      state: "cancelled",
      cancel: { by: "person", userId: "u1" },
    });
  });

  it("keeps the outcomes recorded when an attempt reports nobody", () => {
    const reached = [
      {
        ...TEAM,
        source: "team" as const,
        outcome: "accepted" as const,
        retries: 0,
      },
    ];
    const patch = foldChange(
      stored({
        state: "retrying",
        attempts: 1,
        retries: 1,
        recipients: reached,
      }),
      // Failed before asking the provider: a template deleted meanwhile.
      change({ state: "failed", attempt: 2, recipients: [] })
    );
    expect(patch).toMatchObject({ state: "failed", attempts: 2 });
    expect(patch).not.toHaveProperty("recipients");
  });

  it("leaves a failed send failed when Resend retires it", () => {
    expect(
      foldChange(
        stored({ state: "failed", retiredBy: "r1" }),
        change({ state: "cancelled", cancel: { by: "sender" } })
      )
    ).toEqual({});
  });

  it("records a failed send cancelled otherwise, as marking Spam does", () => {
    expect(
      foldChange(
        stored({ state: "failed" }),
        change({ state: "cancelled", cancel: { by: "sender" } })
      )
    ).toMatchObject({ state: "cancelled", cancel: { by: "sender" } });
  });
});
