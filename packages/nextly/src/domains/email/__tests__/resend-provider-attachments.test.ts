/**
 * Attachment-forwarding tests for the Resend provider adapter.
 *
 * Resend SDK accepts `Buffer` directly (Node) or a base64 string for
 * `content`. We pass `Buffer` — no pre-encoding needed.
 */

import { describe, it, expect, vi } from "vitest";

import { createResendProvider } from "../services/providers/resend-provider";

const mockSend = vi.hoisted(() => vi.fn());

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockSend };
  },
}));

describe("Resend adapter — attachments", () => {
  it("forwards attachments as {filename, content: Buffer, contentType}", async () => {
    mockSend.mockResolvedValue({ data: { id: "rsnd-1" }, error: null });
    const adapter = createResendProvider({ apiKey: "k" });
    const content = Buffer.from("invoice-bytes");

    await adapter.send({
      to: "u@e.com",
      from: "a@b.c",
      subject: "x",
      html: "<p>x</p>",
      attachments: [
        {
          filename: "invoice.pdf",
          mimeType: "application/pdf",
          content,
        },
      ],
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          {
            filename: "invoice.pdf",
            content,
            contentType: "application/pdf",
          },
        ],
      })
    );
  });

  it("passes attachments:undefined when none supplied", async () => {
    mockSend.mockResolvedValue({ data: { id: "rsnd-2" }, error: null });
    const adapter = createResendProvider({ apiKey: "k" });
    await adapter.send({
      to: "u@e.com",
      from: "a@b.c",
      subject: "x",
      html: "<p>x</p>",
    });
    const call = mockSend.mock.calls.at(-1)?.[0];
    expect(call?.attachments).toBeUndefined();
  });
});
