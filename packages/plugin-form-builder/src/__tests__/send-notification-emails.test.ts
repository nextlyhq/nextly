// The send phase of a submission's notifications: each one is logged as sent
// only when the provider took it, as failed with whether a retry can help when
// it did not, and no log line ever names a recipient.

import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "@nextlyhq/plugin-sdk";

import { sendNotificationEmails } from "../plugin";
import type { FormEmailNotification } from "../types";

const TO = "owner@example.com";
const CC = "team@example.com";
const BCC = "audit@example.com";

const notification: FormEmailNotification = {
  to: TO,
  cc: [CC],
  bcc: [BCC],
  replyTo: "visitor@example.com",
  templateSlug: "form-notification",
  variables: { name: "Visitor" },
  notificationId: "notify-owner",
};

function run(sendWithTemplate: ReturnType<typeof vi.fn>) {
  const logger = { info: vi.fn(), error: vi.fn() };
  const done = sendNotificationEmails({
    emails: [notification],
    emailService: { sendWithTemplate } as never,
    logger,
    formSlug: "contact",
    fileAttachments: [],
  });
  return { logger, done };
}

/** Every value every log line carried, as text. */
function logged(logger: {
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}) {
  return JSON.stringify([
    ...logger.info.mock.calls,
    ...logger.error.mock.calls,
  ]);
}

describe("sending a form's notifications", () => {
  it("logs a notification the provider took as sent, naming no recipient", async () => {
    const { logger, done } = run(
      vi.fn().mockResolvedValue({ success: true, messageId: "m-1" })
    );
    await done;

    expect(logger.info).toHaveBeenCalledWith(
      "Form Builder: notification sent",
      expect.objectContaining({
        formSlug: "contact",
        notificationId: "notify-owner",
      })
    );
    expect(logger.error).not.toHaveBeenCalled();
    for (const address of [TO, CC, BCC, "visitor@example.com"]) {
      expect(logged(logger)).not.toContain(address);
    }
  });

  it("logs a notification the provider refused as failed, with its kind", async () => {
    // The service returns a failure rather than throwing, so a phase that only
    // caught exceptions logged this as sent.
    const { logger, done } = run(
      vi.fn().mockResolvedValue({
        success: false,
        failure: {
          retryable: false,
          status: 422,
          reason: "The email provider refused the message (status 422).",
        },
      })
    );
    await done;

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Form Builder: notification failed",
      expect.objectContaining({
        notificationId: "notify-owner",
        retryable: false,
        status: 422,
      })
    );
    for (const address of [TO, CC, BCC]) {
      expect(logged(logger)).not.toContain(address);
    }
  });

  it("logs a failure the provider did not classify as retryable", async () => {
    const { logger, done } = run(vi.fn().mockResolvedValue({ success: false }));
    await done;

    expect(logger.error).toHaveBeenCalledWith(
      "Form Builder: notification failed",
      expect.objectContaining({ retryable: true })
    );
  });

  it("logs a validation refusal as not retryable, and any other thrown failure as retryable", async () => {
    const refused = run(
      vi.fn().mockRejectedValue(
        NextlyError.validation({
          errors: [
            { path: "to", code: "INVALID", message: "Invalid address." },
          ],
        })
      )
    );
    await refused.done;
    expect(refused.logger.error).toHaveBeenCalledWith(
      "Form Builder: notification failed",
      expect.objectContaining({ retryable: false })
    );

    const outage = run(
      vi.fn().mockRejectedValue(new Error("storage read timed out"))
    );
    await outage.done;
    expect(outage.logger.error).toHaveBeenCalledWith(
      "Form Builder: notification failed",
      expect.objectContaining({ retryable: true })
    );
  });

  it("logs a send refused before sending as failed, naming no recipient", async () => {
    const { logger, done } = run(
      vi.fn().mockRejectedValue(new Error("Validation failed."))
    );
    await done;

    expect(logger.error).toHaveBeenCalledWith(
      "Form Builder: notification failed",
      expect.objectContaining({ notificationId: "notify-owner" })
    );
    expect(logged(logger)).not.toContain(TO);
  });
});
