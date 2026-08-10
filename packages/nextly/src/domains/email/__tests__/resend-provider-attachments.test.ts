/**
 * Attachment-forwarding tests for the Resend provider adapter.
 *
 * Resend's REST API takes attachment content as a base64 STRING. This matters
 * more than it looks: `JSON.stringify` turns a Buffer into
 * `{"type":"Buffer","data":[...]}`, so handing the Buffer straight to the API
 * produces a well-formed request carrying an object where bytes belong. These
 * tests assert the encoded string on the wire, not the argument handed to a
 * client library.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createResendProvider } from "../services/providers/resend-provider";

const BASE_OPTIONS = {
  to: "u@e.com",
  from: "a@b.c",
  subject: "x",
  html: "<p>x</p>",
};

function sentBody(): Record<string, unknown> {
  const init = vi.mocked(globalThis.fetch).mock.calls[0][1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function okResponse(id: string) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ id }),
  } as unknown as Response;
}

describe("Resend adapter — attachments", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("base64-encodes content and sends the wire field names", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse("rsnd-1"));
    const adapter = createResendProvider({ apiKey: "k" });

    await adapter.send({
      ...BASE_OPTIONS,
      attachments: [
        {
          filename: "invoice.pdf",
          mimeType: "application/pdf",
          content: Buffer.from("invoice-bytes"),
        },
      ],
    });

    expect(sentBody().attachments).toEqual([
      {
        filename: "invoice.pdf",
        content: Buffer.from("invoice-bytes").toString("base64"),
        content_type: "application/pdf",
      },
    ]);
  });

  it("sends content that decodes back to the original bytes", async () => {
    // The positive control. Asserting the field is "a string" would pass for
    // any string; round-tripping proves the recipient can reconstruct the file.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse("rsnd-2"));
    const adapter = createResendProvider({ apiKey: "k" });
    const original = Buffer.from([0x00, 0xff, 0x10, 0x89, 0x50, 0x4e]);

    await adapter.send({
      ...BASE_OPTIONS,
      attachments: [
        { filename: "logo.png", mimeType: "image/png", content: original },
      ],
    });

    const attachments = sentBody().attachments as Array<{ content: string }>;
    expect(Buffer.from(attachments[0].content, "base64")).toEqual(original);
  });

  it("never sends a serialized Buffer object in place of the bytes", async () => {
    // Pins the specific failure this encoding exists to prevent: a body that
    // is valid JSON and structurally plausible, but carries
    // `{"type":"Buffer","data":[...]}` where the API reads a base64 string.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse("rsnd-3"));
    const adapter = createResendProvider({ apiKey: "k" });

    await adapter.send({
      ...BASE_OPTIONS,
      attachments: [
        {
          filename: "doc.pdf",
          mimeType: "application/pdf",
          content: Buffer.from("bytes"),
        },
      ],
    });

    const init = vi.mocked(globalThis.fetch).mock.calls[0][1];
    expect(String(init?.body)).not.toContain('"type":"Buffer"');
  });

  it("omits the attachments field entirely when none are supplied", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse("rsnd-4"));
    const adapter = createResendProvider({ apiKey: "k" });

    await adapter.send(BASE_OPTIONS);

    expect(sentBody()).not.toHaveProperty("attachments");
  });

  it("forwards every attachment when several are supplied", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse("rsnd-5"));
    const adapter = createResendProvider({ apiKey: "k" });

    await adapter.send({
      ...BASE_OPTIONS,
      attachments: [
        {
          filename: "a.txt",
          mimeType: "text/plain",
          content: Buffer.from("a"),
        },
        {
          filename: "b.txt",
          mimeType: "text/plain",
          content: Buffer.from("b"),
        },
      ],
    });

    const attachments = sentBody().attachments as unknown[];
    expect(attachments).toHaveLength(2);
  });
});
