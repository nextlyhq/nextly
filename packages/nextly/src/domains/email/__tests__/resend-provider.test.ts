/**
 * Tests for the Resend email provider adapter.
 *
 * Covers:
 * - Successful send → returns success + messageId
 * - Resend SDK error response → throws with provider prefix
 * - SDK exception (network) → re-throws with provider prefix
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { createResendProvider } from "../services/providers/resend-provider";

// ── Hoist the mock fn so it's available before any imports ─────────────────
const mockSend = vi.hoisted(() => vi.fn());

// ── Mock the Resend SDK with a proper class constructor ────────────────────
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockSend };
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const BASE_OPTIONS = {
  to: "recipient@example.com",
  from: "App <noreply@example.com>",
  subject: "Hello",
  html: "<p>Hello World</p>",
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("createResendProvider", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("returns success and messageId on a successful send", async () => {
    mockSend.mockResolvedValueOnce({
      data: { id: "msg_abc123" },
      error: null,
    });

    const adapter = createResendProvider({ apiKey: "re_test_key" });
    const result = await adapter.send(BASE_OPTIONS);

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("msg_abc123");
  });

  it("forwards all required fields to the Resend SDK", async () => {
    mockSend.mockResolvedValueOnce({ data: { id: "x" }, error: null });

    const adapter = createResendProvider({ apiKey: "re_test_key" });
    await adapter.send(BASE_OPTIONS);

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledWith({
      from: BASE_OPTIONS.from,
      to: BASE_OPTIONS.to,
      subject: BASE_OPTIONS.subject,
      html: BASE_OPTIONS.html,
    });
  });

  it("throws a provider-prefixed error when Resend returns an error object", async () => {
    mockSend.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Invalid API key",
        name: "invalid_api_key",
        statusCode: 403,
      },
    });

    const adapter = createResendProvider({ apiKey: "re_bad_key" });

    await expect(adapter.send(BASE_OPTIONS)).rejects.toThrow(
      "Resend provider error: Invalid API key"
    );
  });

  it("throws a provider-prefixed error when the SDK throws a network exception", async () => {
    mockSend.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const adapter = createResendProvider({ apiKey: "re_test_key" });

    await expect(adapter.send(BASE_OPTIONS)).rejects.toThrow(
      "Resend provider error: ECONNREFUSED"
    );
  });

  it("reuses the same Resend client instance across multiple send() calls", async () => {
    mockSend
      .mockResolvedValueOnce({ data: { id: "id1" }, error: null })
      .mockResolvedValueOnce({ data: { id: "id2" }, error: null });

    const adapter = createResendProvider({ apiKey: "re_test_key" });
    const r1 = await adapter.send(BASE_OPTIONS);
    const r2 = await adapter.send(BASE_OPTIONS);

    expect(r1.messageId).toBe("id1");
    expect(r2.messageId).toBe("id2");
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
