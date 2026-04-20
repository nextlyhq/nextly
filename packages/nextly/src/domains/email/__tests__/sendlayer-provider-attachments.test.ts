/**
 * Attachment-forwarding tests for the SendLayer provider adapter.
 *
 * SendLayer's API expects attachments in `Attachments: [{ Name, Content,
 * Type }]` shape, with `Content` base64-encoded.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSendLayerProvider } from "../services/providers/sendlayer-provider";

describe("SendLayer adapter — attachments", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards attachments as {Name, Content (base64), Type}", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ MessageID: "sl-1" }),
      text: async () => "",
    });
    const adapter = createSendLayerProvider({ apiKey: "k" });
    const content = Buffer.from("payload-bytes");

    await adapter.send({
      to: "u@e.com",
      from: "App <a@b.c>",
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

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.Attachments).toEqual([
      {
        Name: "invoice.pdf",
        Content: content.toString("base64"),
        Type: "application/pdf",
      },
    ]);
  });

  it("omits Attachments key when none supplied", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ MessageID: "sl-2" }),
      text: async () => "",
    });
    const adapter = createSendLayerProvider({ apiKey: "k" });
    await adapter.send({
      to: "u@e.com",
      from: "a@b.c",
      subject: "x",
      html: "<p>x</p>",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("Attachments");
  });
});
