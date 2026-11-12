// The send phase of a submission's notifications: each one is queued through
// the email service's queued send, which retries what a retry can help, with
// the rule's settings and a key per submission and notification. It is logged
// as queued, or as failed when its first attempt failed for good or the queue
// refused it, and no log line ever names a recipient.

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "@nextlyhq/plugin-sdk";

import { queueNotificationEmails } from "../plugin";
import type { FormEmailNotification } from "../types";

const TO = "owner@example.com";
const CC = "team@example.com";
const BCC = "audit@example.com";

/** The short digest of a notification's id that its key carries. */
function digest(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 16);
}

const notification: FormEmailNotification = {
  to: TO,
  cc: [CC],
  bcc: [BCC],
  replyTo: "visitor@example.com",
  templateSlug: "form-notification",
  variables: { name: "Visitor" },
  notificationId: "notify-owner",
  providerId: "provider-1",
  from: "forms@example.com",
};

function run(
  queueWithTemplate: ReturnType<typeof vi.fn>,
  emails: FormEmailNotification[] = [notification]
) {
  const logger = { info: vi.fn(), error: vi.fn() };
  const done = queueNotificationEmails({
    emails,
    emailService: { queueWithTemplate } as never,
    logger,
    formSlug: "contact",
    submissionId: "sub-1",
    fileAttachments: [{ mediaId: "media-1" }],
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

/** The idempotency key of each queued email, in order. */
function keys(queue: ReturnType<typeof vi.fn>): string[] {
  return queue.mock.calls.map(
    call => (call[3] as { idempotencyKey: string }).idempotencyKey
  );
}

describe("queueing a form's notifications", () => {
  it("queues each with its rule's settings and a key per submission and notification", async () => {
    const queue = vi.fn().mockResolvedValue({ id: "q-1", state: "sent" });
    const { done } = run(queue);
    await done;

    expect(queue).toHaveBeenCalledWith(
      "form-notification",
      TO,
      { name: "Visitor" },
      {
        providerId: "provider-1",
        from: "forms@example.com",
        replyTo: "visitor@example.com",
        cc: [CC],
        bcc: [BCC],
        attachments: [{ mediaId: "media-1" }],
        idempotencyKey: `form-notification:sub-1:0:${digest("notify-owner")}`,
      }
    );
  });

  it("keys a notification with no id by its place, so two are never one", async () => {
    const queue = vi.fn().mockResolvedValue({ id: "q", state: "waiting" });
    const { done } = run(queue, [
      { ...notification, notificationId: undefined },
      { ...notification, notificationId: undefined },
    ]);
    await done;

    expect(keys(queue)).toEqual([
      `form-notification:sub-1:0:${digest("")}`,
      `form-notification:sub-1:1:${digest("")}`,
    ]);
  });

  it("keys two emails of one notification apart, as when a hook adds a copy", async () => {
    const queue = vi.fn().mockResolvedValue({ id: "q", state: "waiting" });
    const { done } = run(queue, [
      notification,
      { ...notification, to: "second@example.com" },
    ]);
    await done;

    const [first, second] = keys(queue);
    expect(first).not.toBe(second);
  });

  it("keeps a key short whatever its notification's id, and apart from a near one", async () => {
    const long = "n".repeat(400);
    const queue = vi.fn().mockResolvedValue({ id: "q", state: "waiting" });
    const { done } = run(queue, [
      { ...notification, notificationId: long },
      { ...notification, notificationId: `${long}x` },
    ]);
    await done;

    const [first, second] = keys(queue);
    // The email service takes keys of up to 256 characters.
    expect(first.length).toBeLessThanOrEqual(256);
    expect(second.length).toBeLessThanOrEqual(256);
    expect(first.replace(/^form-notification:sub-1:0:/, "")).not.toBe(
      second.replace(/^form-notification:sub-1:1:/, "")
    );
  });

  it("logs a queued notification with where it stands, naming no recipient", async () => {
    const { logger, done } = run(
      vi.fn().mockResolvedValue({ id: "q-1", state: "waiting" })
    );
    await done;

    expect(logger.info).toHaveBeenCalledWith(
      "Form Builder: notification queued",
      expect.objectContaining({
        formSlug: "contact",
        notificationId: "notify-owner",
        queuedId: "q-1",
        state: "waiting",
      })
    );
    expect(logger.error).not.toHaveBeenCalled();
    for (const address of [TO, CC, BCC, "visitor@example.com"]) {
      expect(logged(logger)).not.toContain(address);
    }
  });

  it("logs one whose first attempt failed for good as failed", async () => {
    const { logger, done } = run(
      vi.fn().mockResolvedValue({ id: "q-1", state: "failed" })
    );
    await done;

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Form Builder: notification failed",
      expect.objectContaining({
        notificationId: "notify-owner",
        queuedId: "q-1",
        retryable: false,
      })
    );
  });

  it("logs a refusal to queue as not retryable, and any other thrown failure as retryable", async () => {
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
    expect(logged(outage.logger)).not.toContain(TO);
  });

  it("queues each email with its own files, and the marked ones for an email a filter added", async () => {
    const queueWithTemplate = vi.fn(async () => ({
      id: "queued-1",
      state: "sent",
    }));
    const { done } = run(queueWithTemplate, [
      {
        ...notification,
        notificationId: "team",
        attachments: [{ mediaId: "cv" }],
      },
      {
        ...notification,
        notificationId: "security",
        attachments: [{ mediaId: "photo" }],
      },
      { ...notification, notificationId: "visitor", attachments: [] },
      { ...notification, notificationId: undefined },
    ]);
    await done;

    const attached = queueWithTemplate.mock.calls.map(
      call => (call[3] as { attachments?: unknown }).attachments
    );
    expect(attached).toEqual([
      [{ mediaId: "cv" }],
      [{ mediaId: "photo" }],
      undefined,
      [{ mediaId: "media-1" }],
    ]);
  });
});
