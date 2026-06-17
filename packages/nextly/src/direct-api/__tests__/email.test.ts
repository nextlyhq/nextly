/**
 * Direct API - Email Namespace Tests
 *
 * Verifies that `nextly.email.send` and `nextly.email.sendWithTemplate`
 * forward cc/bcc (alongside the existing providerId/attachments) down to the
 * underlying EmailService. The namespace previously dropped cc/bcc silently.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { NextlyContext } from "../namespaces/context";
import { createEmailNamespace } from "../namespaces/email";

function build() {
  const send = vi
    .fn()
    .mockResolvedValue({ success: true, messageId: "m-send" });
  const sendWithTemplate = vi
    .fn()
    .mockResolvedValue({ success: true, messageId: "m-tpl" });

  // Only emailSendService is exercised by this namespace; cast a minimal ctx.
  const ctx = {
    emailSendService: { send, sendWithTemplate },
  } as unknown as NextlyContext;

  return { email: createEmailNamespace(ctx), send, sendWithTemplate };
}

describe("Direct API - Email namespace", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("sendWithTemplate()", () => {
    it("forwards cc/bcc to the email service", async () => {
      const { email, sendWithTemplate } = build();

      await email.sendWithTemplate({
        to: "user@example.com",
        template: "welcome",
        variables: { name: "Sam" },
        cc: ["cc@example.com"],
        bcc: ["bcc@example.com"],
      });

      expect(sendWithTemplate).toHaveBeenCalledWith(
        "welcome",
        "user@example.com",
        { name: "Sam" },
        expect.objectContaining({
          cc: ["cc@example.com"],
          bcc: ["bcc@example.com"],
        })
      );
    });

    it("omits cc/bcc from options when not provided", async () => {
      const { email, sendWithTemplate } = build();

      await email.sendWithTemplate({
        to: "user@example.com",
        template: "welcome",
      });

      // No cc/bcc supplied and no other options -> options stays undefined.
      expect(sendWithTemplate).toHaveBeenCalledWith(
        "welcome",
        "user@example.com",
        {},
        undefined
      );
    });

    it("does not forward empty cc/bcc arrays (keeps options undefined)", async () => {
      const { email, sendWithTemplate } = build();

      await email.sendWithTemplate({
        to: "user@example.com",
        template: "welcome",
        cc: [],
        bcc: [],
      });

      // Empty arrays must not make the options object truthy.
      expect(sendWithTemplate).toHaveBeenCalledWith(
        "welcome",
        "user@example.com",
        {},
        undefined
      );
    });

    it("forwards cc together with providerId", async () => {
      const { email, sendWithTemplate } = build();

      await email.sendWithTemplate({
        to: "user@example.com",
        template: "welcome",
        providerId: "prov-1",
        cc: ["cc@example.com"],
      });

      expect(sendWithTemplate).toHaveBeenCalledWith(
        "welcome",
        "user@example.com",
        {},
        expect.objectContaining({
          providerId: "prov-1",
          cc: ["cc@example.com"],
        })
      );
    });

    it("uses the first recipient when given an array of addresses", async () => {
      const { email, sendWithTemplate } = build();

      await email.sendWithTemplate({
        to: ["first@example.com", "second@example.com"],
        template: "welcome",
        cc: ["cc@example.com"],
      });

      expect(sendWithTemplate).toHaveBeenCalledWith(
        "welcome",
        "first@example.com",
        {},
        expect.objectContaining({ cc: ["cc@example.com"] })
      );
    });
  });

  describe("send()", () => {
    it("forwards cc/bcc to the email service", async () => {
      const { email, send } = build();

      await email.send({
        to: "user@example.com",
        subject: "Hi",
        html: "<p>Hi</p>",
        cc: ["cc@example.com"],
        bcc: ["bcc@example.com"],
      });

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          cc: ["cc@example.com"],
          bcc: ["bcc@example.com"],
        })
      );
    });
  });
});
