// Both REST send routes pass every recipient, the send's From and Reply-To on
// to the email service, and say what happened: the send is synchronous, so the
// answer is "sent" or "could not be sent", never "queued". The fields a caller
// reads today (`success`, `messageId`, and `templateId` on the template route)
// stay where they are.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/middleware", () => ({
  requireAuthentication: vi.fn().mockResolvedValue({ userId: "user-1" }),
  isErrorResponse: vi.fn().mockReturnValue(false),
}));

vi.mock("../../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));

const send = vi.fn();
const sendWithTemplate = vi.fn();
vi.mock("../../di", () => ({
  container: { get: vi.fn(() => ({ send, sendWithTemplate })) },
}));

import { POST as postSend } from "../email-send";
import { POST as postSendTemplate } from "../email-send-template";

function post(body: unknown): Request {
  return new Request("http://x/api/email", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  send.mockReset();
  sendWithTemplate.mockReset();
});

describe("POST /api/email/send", () => {
  it("passes every recipient, from and replyTo to the service", async () => {
    send.mockResolvedValue({ success: true, messageId: "m-1" });

    await postSend(
      post({
        to: ["a@example.com", "b@example.com"],
        subject: "Hi",
        html: "<p>Hi</p>",
        from: "Shop <shop@example.com>",
        replyTo: "help@example.com",
      })
    );

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["a@example.com", "b@example.com"],
        from: "Shop <shop@example.com>",
        replyTo: "help@example.com",
      })
    );
  });

  it("says the email was sent, keeping today's fields", async () => {
    send.mockResolvedValue({ success: true, messageId: "m-1" });

    const res = await postSend(
      post({ to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" })
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json).toEqual({
      message: "Email sent.",
      success: true,
      messageId: "m-1",
    });
  });

  it("says the email could not be sent when it failed", async () => {
    send.mockResolvedValue({ success: false });

    const res = await postSend(
      post({ to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" })
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(json).toEqual({
      message: "Email could not be sent.",
      success: false,
    });
    expect(JSON.stringify(json)).not.toMatch(/queued/i);
  });

  it("refuses a list with an address that is not one, before the service", async () => {
    const res = await postSend(
      post({ to: ["a@example.com", "nope"], subject: "Hi", html: "<p>x</p>" })
    );

    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("POST /api/email/send-with-template", () => {
  it("passes every recipient, from and replyTo to the service", async () => {
    sendWithTemplate.mockResolvedValue({ success: true, messageId: "m-1" });

    await postSendTemplate(
      post({
        to: ["a@example.com", "b@example.com"],
        template: "welcome",
        from: "Shop <shop@example.com>",
        replyTo: "help@example.com",
      })
    );

    expect(sendWithTemplate).toHaveBeenCalledWith(
      "welcome",
      ["a@example.com", "b@example.com"],
      {},
      expect.objectContaining({
        from: "Shop <shop@example.com>",
        replyTo: "help@example.com",
      })
    );
  });

  it("says the email was sent, keeping today's fields", async () => {
    sendWithTemplate.mockResolvedValue({ success: true, messageId: "m-1" });

    const res = await postSendTemplate(
      post({ to: "a@example.com", template: "welcome" })
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(json).toEqual({
      message: "Email sent.",
      success: true,
      messageId: "m-1",
      templateId: "welcome",
    });
  });

  it("says the email could not be sent when it failed", async () => {
    sendWithTemplate.mockResolvedValue({ success: false });

    const res = await postSendTemplate(
      post({ to: "a@example.com", template: "welcome" })
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(json).toEqual({
      message: "Email could not be sent.",
      success: false,
      templateId: "welcome",
    });
  });
});
