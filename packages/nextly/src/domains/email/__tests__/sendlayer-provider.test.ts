/**
 * Tests for the SendLayer email provider adapter.
 *
 * Covers:
 * - Successful send — returns success + messageId, correct fetch args
 * - Parses "Name <email>" from address format
 * - Parses plain email (no name) from address
 * - Includes CC/BCC when provided
 * - Omits CC/BCC when not provided or empty
 * - HTTP error response — throws with provider prefix
 * - Network failure — throws with provider prefix
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import { createSendLayerProvider } from "../services/providers/sendlayer-provider";

// ── Mock global fetch ────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ──────────────────────────────────────────────────────────────────

const SENDLAYER_API_URL = "https://console.sendlayer.com/api/v1/email";
const TEST_API_KEY = "sl_test_key_123";

const BASE_OPTIONS = {
  to: "recipient@example.com",
  from: "App Name <noreply@example.com>",
  subject: "Hello",
  html: "<p>Hello World</p>",
};

function createSuccessResponse(messageId: string): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ MessageID: messageId }),
    text: () => Promise.resolve(""),
  } as unknown as Response;
}

function createErrorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    statusText: "Bad Request",
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("createSendLayerProvider", () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  it("returns success and messageId on a successful send", async () => {
    mockFetch.mockResolvedValueOnce(createSuccessResponse("msg_abc123"));

    const adapter = createSendLayerProvider({ apiKey: TEST_API_KEY });
    const result = await adapter.send(BASE_OPTIONS);

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("msg_abc123");
  });

  it("calls fetch with the correct URL, method, headers, and body", async () => {
    mockFetch.mockResolvedValueOnce(createSuccessResponse("msg_xyz"));

    const adapter = createSendLayerProvider({ apiKey: TEST_API_KEY });
    await adapter.send(BASE_OPTIONS);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(SENDLAYER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
      body: JSON.stringify({
        From: { name: "App Name", email: "noreply@example.com" },
        To: [{ name: "", email: "recipient@example.com" }],
        Subject: "Hello",
        ContentType: "HTML",
        HTMLContent: "<p>Hello World</p>",
      }),
    });
  });

  it('parses "Name <email>" format correctly in the From field', async () => {
    mockFetch.mockResolvedValueOnce(createSuccessResponse("msg_1"));

    const adapter = createSendLayerProvider({ apiKey: TEST_API_KEY });
    await adapter.send({
      ...BASE_OPTIONS,
      from: "My Application <hello@app.io>",
    });

    const callBody = JSON.parse(
      mockFetch.mock.calls[0][1].body as string
    ) as Record<string, unknown>;

    expect(callBody.From).toEqual({
      name: "My Application",
      email: "hello@app.io",
    });
  });

  it("parses a plain email address (no name) in the From field", async () => {
    mockFetch.mockResolvedValueOnce(createSuccessResponse("msg_2"));

    const adapter = createSendLayerProvider({ apiKey: TEST_API_KEY });
    await adapter.send({
      ...BASE_OPTIONS,
      from: "noreply@example.com",
    });

    const callBody = JSON.parse(
      mockFetch.mock.calls[0][1].body as string
    ) as Record<string, unknown>;

    expect(callBody.From).toEqual({ name: "", email: "noreply@example.com" });
  });

  it("includes CC recipients when provided", async () => {
    mockFetch.mockResolvedValueOnce(createSuccessResponse("msg_cc"));

    const adapter = createSendLayerProvider({ apiKey: TEST_API_KEY });
    await adapter.send({
      ...BASE_OPTIONS,
      cc: ["cc1@example.com", "cc2@example.com"],
    });

    const callBody = JSON.parse(
      mockFetch.mock.calls[0][1].body as string
    ) as Record<string, unknown>;

    expect(callBody.CC).toEqual([
      { name: "", email: "cc1@example.com" },
      { name: "", email: "cc2@example.com" },
    ]);
  });

  it("includes BCC recipients when provided", async () => {
    mockFetch.mockResolvedValueOnce(createSuccessResponse("msg_bcc"));

    const adapter = createSendLayerProvider({ apiKey: TEST_API_KEY });
    await adapter.send({
      ...BASE_OPTIONS,
      bcc: ["bcc1@example.com"],
    });

    const callBody = JSON.parse(
      mockFetch.mock.calls[0][1].body as string
    ) as Record<string, unknown>;

    expect(callBody.BCC).toEqual([{ name: "", email: "bcc1@example.com" }]);
  });

  it("omits CC and BCC when not provided", async () => {
    mockFetch.mockResolvedValueOnce(createSuccessResponse("msg_no_cc"));

    const adapter = createSendLayerProvider({ apiKey: TEST_API_KEY });
    await adapter.send(BASE_OPTIONS);

    const callBody = JSON.parse(
      mockFetch.mock.calls[0][1].body as string
    ) as Record<string, unknown>;

    expect(callBody).not.toHaveProperty("CC");
    expect(callBody).not.toHaveProperty("BCC");
  });

  it("omits CC and BCC when provided as empty arrays", async () => {
    mockFetch.mockResolvedValueOnce(createSuccessResponse("msg_empty_cc"));

    const adapter = createSendLayerProvider({ apiKey: TEST_API_KEY });
    await adapter.send({
      ...BASE_OPTIONS,
      cc: [],
      bcc: [],
    });

    const callBody = JSON.parse(
      mockFetch.mock.calls[0][1].body as string
    ) as Record<string, unknown>;

    expect(callBody).not.toHaveProperty("CC");
    expect(callBody).not.toHaveProperty("BCC");
  });

  it("throws a provider-prefixed error on HTTP error response", async () => {
    mockFetch.mockResolvedValueOnce(
      createErrorResponse(422, "Invalid recipient address")
    );

    const adapter = createSendLayerProvider({ apiKey: TEST_API_KEY });

    await expect(adapter.send(BASE_OPTIONS)).rejects.toThrow(
      "SendLayer provider error: HTTP 422: Invalid recipient address"
    );
  });

  it("uses statusText as fallback when error body is empty", async () => {
    const response = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(""),
    } as unknown as Response;

    mockFetch.mockResolvedValueOnce(response);

    const adapter = createSendLayerProvider({ apiKey: TEST_API_KEY });

    await expect(adapter.send(BASE_OPTIONS)).rejects.toThrow(
      "SendLayer provider error: HTTP 500: Internal Server Error"
    );
  });

  it("throws a provider-prefixed error on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const adapter = createSendLayerProvider({ apiKey: TEST_API_KEY });

    await expect(adapter.send(BASE_OPTIONS)).rejects.toThrow(
      "SendLayer provider error: ECONNREFUSED"
    );
  });
});
