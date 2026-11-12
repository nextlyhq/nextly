/**
 * One reading of a send's stored outcome: each recipient's status in words,
 * a notification's (Partly sent when its recipients differ), and a
 * recipient's latest result across a notification's sends.
 */
import { describe, expect, it } from "vitest";

import {
  addressableNow,
  cancelText,
  latestByRecipient,
  notificationLook,
  reachedExcept,
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

describe("who Resend can send to now", () => {
  const ADDED = {
    ...TEAM,
    digest: "d-added",
    hint: "a•••@acme.test",
    source: "added" as const,
  };
  const GONE = { ...TEAM, digest: "d-gone", hint: "g•••@acme.test" };
  const of = (
    recipient: typeof TEAM | typeof ADDED,
    state: RecipientStatus["state"]
  ): RecipientStatus => ({ ...recipient, state, retries: 0, at: null });

  it("offers each configured recipient, marked reached by its history", () => {
    expect(
      addressableNow([TEAM, OPS], [of(TEAM, "sent"), of(OPS, "failed")])
    ).toEqual([
      {
        digest: "d-team",
        hint: "t•••@acme.test",
        source: "team",
        reached: true,
      },
      {
        digest: "d-ops",
        hint: "o•••@acme.test",
        source: "team",
        reached: false,
      },
    ]);
  });

  it("adds a recipient a send filter added who missed it, and no other one gone from the notification", () => {
    const now = addressableNow(
      [TEAM],
      [of(TEAM, "sent"), of(ADDED, "failed"), of(GONE, "failed")]
    );
    expect(now).toEqual([
      {
        digest: "d-team",
        hint: "t•••@acme.test",
        source: "team",
        reached: true,
      },
      {
        digest: "d-added",
        hint: "a•••@acme.test",
        source: "added",
        reached: false,
      },
    ]);
  });

  it("stops offering a filter's recipient once it has received it", () => {
    expect(
      addressableNow([TEAM], [of(TEAM, "failed"), of(ADDED, "sent")])
    ).toEqual([
      {
        digest: "d-team",
        hint: "t•••@acme.test",
        source: "team",
        reached: false,
      },
    ]);
  });

  it("leaves out each recipient that received it, unless ticked to send again", () => {
    const history = [of(TEAM, "sent"), of(OPS, "failed"), of(ADDED, "sent")];
    expect(reachedExcept(history, [])).toEqual(["d-team", "d-added"]);
    expect(reachedExcept(history, ["d-team"])).toEqual(["d-added"]);
  });
});
