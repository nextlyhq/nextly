/**
 * One reading of a send's stored outcome: each recipient's status in words,
 * a notification's (Partly sent when its recipients differ), and a
 * recipient's latest result across a notification's sends.
 */
import { describe, expect, it } from "vitest";

import {
  cancelText,
  latestByRecipient,
  notificationLook,
  recipientLook,
  type RecipientStatus,
  type StoredSend,
} from "./send-status";

const TEAM = {
  digest: "d-team",
  hint: "t•••@acme.test",
  kind: "to" as const,
  source: "team" as const,
};
const OPS = { ...TEAM, digest: "d-ops", hint: "o•••@acme.test" };

const status = (
  state: RecipientStatus["state"],
  retries = 0
): RecipientStatus => ({ ...TEAM, state, retries, at: null });

describe("a send's outcome in words", () => {
  it.each([
    ["waiting", 0, "Waiting"],
    ["retrying", 0, "Retrying"],
    ["sending", 0, "Sending"],
    ["sent", 0, "Sent"],
    ["sent", 1, "Sent after 1 retry"],
    ["sent", 2, "Sent after 2 retries"],
    ["failed", 0, "Failed"],
    ["cancelled", 0, "Cancelled"],
  ] as const)("reads %s with %d retries as %s", (state, retries, label) => {
    expect(recipientLook(status(state, retries)).label).toBe(label);
  });

  it("reads a notification whose recipients differ as Partly sent", () => {
    expect(notificationLook([status("sent"), status("failed")]).label).toBe(
      "Partly sent"
    );
    // All sent, one after a retry: sent, as the slower one was.
    expect(notificationLook([status("sent"), status("sent", 1)]).label).toBe(
      "Sent after 1 retry"
    );
  });

  it("says why a send was cancelled", () => {
    expect(cancelText({ by: "person", userId: "u1" })).toBe(
      "Cancelled in Settings › Email"
    );
    expect(cancelText({ by: "spam" })).toBe(
      "Cancelled when the submission was marked Spam"
    );
    expect(cancelText({ by: "erasure" })).toBe(
      "Cancelled when the address was erased"
    );
  });
});

describe("a recipient's latest result across a notification's sends", () => {
  it("reads the configured recipients as waiting before the first attempt", () => {
    const send: StoredSend = { queuedId: "q1", configured: [TEAM, OPS] };
    expect(latestByRecipient([send]).map(each => each.state)).toEqual([
      "waiting",
      "waiting",
    ]);
  });

  it("reads a recipient refused by a send that went out as failed", () => {
    const send: StoredSend = {
      queuedId: "q1",
      state: "sent",
      attempts: 1,
      recipients: [
        { ...TEAM, outcome: "accepted", retries: 0 },
        { ...OPS, outcome: "refused" },
      ],
    };
    expect(
      latestByRecipient([send]).map(each => [each.hint, each.state])
    ).toEqual([
      ["t•••@acme.test", "sent"],
      ["o•••@acme.test", "failed"],
    ]);
  });

  it("keeps a recipient a later send left out as it was, and takes the later result of one it sent", () => {
    const first: StoredSend = {
      queuedId: "q1",
      state: "failed",
      recipients: [
        { ...TEAM, outcome: "accepted", retries: 1 },
        { ...OPS, outcome: "refused" },
      ],
    };
    const again: StoredSend = {
      queuedId: "q2",
      state: "sent",
      recipients: [
        { ...TEAM, outcome: "skipped" },
        { ...OPS, outcome: "accepted", retries: 0 },
      ],
    };
    expect(
      latestByRecipient([first, again]).map(each => [
        each.hint,
        recipientLook(each).label,
      ])
    ).toEqual([
      ["t•••@acme.test", "Sent after 1 retry"],
      ["o•••@acme.test", "Sent"],
    ]);
  });

  it("carries a cancelled send's cause to its recipients", () => {
    const send: StoredSend = {
      queuedId: "q1",
      state: "cancelled",
      cancel: { by: "spam" },
      configured: [TEAM],
    };
    expect(latestByRecipient([send])[0]?.cancel).toEqual({ by: "spam" });
  });
});
