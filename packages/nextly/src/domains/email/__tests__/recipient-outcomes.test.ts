/**
 * What a send reports about each recipient, and what a keyed retry sends.
 *
 * A send whose recipients all fare alike keeps the result it always had; a
 * partly delivered one lists each recipient by line and position; a retry
 * leaves out the recipients an earlier attempt had accepted and reports them
 * in its result as accepted.
 */

import { describe, expect, it, vi } from "vitest";

import {
  pendingEnvelope,
  recipientSlot,
  sendResultOf,
  type CallOutcome,
} from "../services/recipient-outcomes";
import type { SendEnvelope } from "../services/recipients";

vi.mock("../../../lib/env", () => ({
  env: { NEXTLY_SECRET: "test-secret-that-is-long-enough-for-derivation" },
}));

const ENVELOPE: SendEnvelope = {
  to: ["a@example.com", "b@example.com"],
  cc: ["c@example.com"],
  from: "shop@example.com",
  subject: "Hi",
  html: "<p>x</p>",
};

/** One call of a split send: its message, and what the provider answered. */
function call(
  to: string,
  answer: Partial<CallOutcome> & { outcome: CallOutcome["outcome"] },
  copies: { cc?: string[] } = {}
): CallOutcome {
  return {
    message: { ...ENVELOPE, to: [to], cc: copies.cc },
    accepted: answer.accepted ?? answer.outcome.success,
    outcome: answer.outcome,
  };
}

describe("the recipients a keyed retry sends to", () => {
  it("is the envelope itself when none was accepted", () => {
    expect(pendingEnvelope(ENVELOPE, new Set())).toBe(ENVELOPE);
  });

  it("leaves out each recipient accepted before, by line and position", () => {
    const pending = pendingEnvelope(
      ENVELOPE,
      new Set([recipientSlot("to", 0), recipientSlot("cc", 0)])
    );

    expect(pending.to).toEqual(["b@example.com"]);
    expect(pending.cc).toEqual([]);
  });
});

describe("a send's result", () => {
  it("is unchanged when every recipient was accepted", () => {
    const calls = [
      call(
        "a@example.com",
        { outcome: { success: true, messageId: "m-1" } },
        { cc: ["c@example.com"] }
      ),
      call("b@example.com", { outcome: { success: true, messageId: "m-2" } }),
    ];

    expect(sendResultOf(ENVELOPE, new Set(), calls).outcome).toEqual({
      success: true,
      messageId: "m-1",
    });
  });

  it("is unchanged for one message whose `to` the provider refused", () => {
    const refused = {
      success: false,
      failure: { retryable: false, status: 550, reason: "refused" },
      refused: [{ kind: "to" as const, position: 0, retryable: false }],
    };
    const calls = [
      {
        message: { ...ENVELOPE, to: ["a@example.com"], cc: undefined },
        accepted: true,
        outcome: refused,
      },
    ];

    expect(
      sendResultOf(
        { ...ENVELOPE, to: ["a@example.com"], cc: undefined },
        new Set(),
        calls
      ).outcome
    ).toBe(refused);
  });

  it("lists each recipient for a partly delivered send, the unanswered one as unknown", () => {
    const calls = [
      call(
        "a@example.com",
        { outcome: { success: true, messageId: "m-1" } },
        { cc: ["c@example.com"] }
      ),
      call("b@example.com", {
        outcome: {
          success: false,
          failure: {
            retryable: true,
            reason: "The email provider did not answer in time.",
            unknown: true,
          },
        },
      }),
    ];

    const { outcome, accepted } = sendResultOf(ENVELOPE, new Set(), calls);

    expect(outcome).toMatchObject({
      success: false,
      partlyDelivered: true,
      recipients: [
        { kind: "to", position: 0, outcome: "accepted" },
        { kind: "to", position: 1, outcome: "unknown", retryable: true },
        { kind: "cc", position: 0, outcome: "accepted" },
      ],
    });
    expect(accepted).toEqual(["to:0", "cc:0"]);
  });

  it("calls a definite refusal refused, with its classification", () => {
    const calls = [
      call(
        "a@example.com",
        { outcome: { success: true, messageId: "m-1" } },
        { cc: ["c@example.com"] }
      ),
      call("b@example.com", {
        outcome: {
          success: false,
          failure: { retryable: false, status: 422, reason: "refused" },
        },
      }),
    ];

    expect(
      sendResultOf(ENVELOPE, new Set(), calls).outcome.recipients?.[1]
    ).toEqual({
      kind: "to",
      position: 1,
      outcome: "refused",
      retryable: false,
      status: 422,
    });
  });

  it("reports a retry's earlier recipients as accepted, and succeeds once every `to` is", () => {
    const pending = new Set([recipientSlot("to", 0), recipientSlot("cc", 0)]);
    const calls = [
      call("b@example.com", { outcome: { success: true, messageId: "m-3" } }),
    ];

    const { outcome, accepted } = sendResultOf(ENVELOPE, pending, calls);

    expect(outcome).toEqual({ success: true, messageId: "m-3" });
    expect(accepted).toEqual(["to:0", "to:1", "cc:0"]);
  });
});
