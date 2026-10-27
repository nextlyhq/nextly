/**
 * The Direct API returns a send's result as every other surface does: a partly
 * delivered send's per-recipient outcomes come through, and a send whose
 * recipients were all accepted gains nothing.
 */

import { describe, expect, it, vi } from "vitest";

import type { NextlyContext } from "../namespaces/context";
import { createEmailNamespace } from "../namespaces/email";

function namespaceAnswering(result: unknown) {
  const send = vi.fn().mockResolvedValue(result);
  const sendWithTemplate = vi.fn().mockResolvedValue(result);
  const ctx = {
    emailSendService: { send, sendWithTemplate },
  } as unknown as NextlyContext;
  return createEmailNamespace(ctx);
}

const PARTLY = {
  success: false,
  messageId: "m-1",
  failure: {
    retryable: true,
    reason: "The email provider failed.",
  },
  partlyDelivered: true,
  recipients: [
    { kind: "to", position: 0, outcome: "accepted" },
    { kind: "to", position: 1, outcome: "unknown", retryable: true },
  ],
};

describe("a send's result through the Direct API", () => {
  it.each(["send", "sendWithTemplate"] as const)(
    "%s passes a partly delivered send's per-recipient outcomes through",
    async method => {
      const email = namespaceAnswering(PARTLY);

      const result =
        method === "send"
          ? await email.send({
              to: ["a@example.com", "b@example.com"],
              subject: "Hi",
              html: "<p>x</p>",
            })
          : await email.sendWithTemplate({
              to: ["a@example.com", "b@example.com"],
              template: "alert",
            });

      expect(result).toMatchObject({
        success: false,
        partlyDelivered: true,
        recipients: PARTLY.recipients,
      });
    }
  );

  it("returns an all-accepted send's result exactly as before", async () => {
    const email = namespaceAnswering({ success: true, messageId: "m-1" });

    const result = await email.send({
      to: ["a@example.com", "b@example.com"],
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(result).toEqual({ success: true, messageId: "m-1" });
  });
});
