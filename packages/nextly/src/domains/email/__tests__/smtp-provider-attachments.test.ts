/**
 * Attachment-forwarding tests for the SMTP provider adapter.
 *
 * Verifies nodemailer receives the attachments in its expected shape
 * (`{ filename, content, contentType }`).
 */

import { describe, it, expect, vi } from "vitest";

import { createSmtpProvider } from "../services/providers/smtp-provider";

const mockSendMail = vi.hoisted(() => vi.fn());
const mockCreateTransport = vi.hoisted(() =>
  vi.fn(() => ({ sendMail: mockSendMail }))
);

vi.mock("nodemailer", () => ({
  default: { createTransport: mockCreateTransport },
}));

const SMTP_CONFIG = {
  host: "smtp.example.com",
  port: 587,
  secure: false,
  auth: { user: "u@e.com", pass: "pw" },
};

describe("SMTP adapter — attachments", () => {
  it("forwards attachments as {filename, content: Buffer, contentType}", async () => {
    mockSendMail.mockResolvedValue({ messageId: "smtp-1" });
    const adapter = createSmtpProvider(SMTP_CONFIG);
    await adapter.send({
      to: "user@example.com",
      from: "App <a@b.c>",
      subject: "x",
      html: "<p>x</p>",
      attachments: [
        {
          filename: "invoice.pdf",
          mimeType: "application/pdf",
          content: Buffer.from("pdf-content"),
        },
      ],
    });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          {
            filename: "invoice.pdf",
            content: Buffer.from("pdf-content"),
            contentType: "application/pdf",
          },
        ],
      })
    );
  });

  it("passes attachments:undefined when none supplied", async () => {
    mockSendMail.mockResolvedValue({ messageId: "smtp-2" });
    const adapter = createSmtpProvider(SMTP_CONFIG);
    await adapter.send({
      to: "u@e.com",
      from: "a@b.c",
      subject: "x",
      html: "<p>x</p>",
    });
    const call = mockSendMail.mock.calls.at(-1)?.[0];
    expect(call?.attachments).toBeUndefined();
  });
});
