// Pins the canonical respondAction wire shape on the success path. The
// service result (`{ success, messageId? }`) is spread onto the action body
// so existing consumers keep working.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  isErrorResponse: vi.fn(),
}));

vi.mock("../auth/middleware/to-nextly-error", () => ({
  toNextlyAuthError: vi.fn((errResponse: unknown) => {
    return new Error(`auth error: ${JSON.stringify(errResponse)}`);
  }),
}));

vi.mock("../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../di", () => ({
  container: {
    get: vi.fn(),
  },
}));

import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { container } from "../di";

import { POST } from "./email-send";

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "user-1",
  });
  (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValue(false);
});

describe("POST /api/email/send", () => {
  it("emits respondAction with messageId and success spread onto the body", async () => {
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      send: vi
        .fn()
        .mockResolvedValue({ success: true, messageId: "msg-123" }),
    });

    const res = await POST(
      new Request("http://x/api/email/send", {
        method: "POST",
        body: JSON.stringify({
          to: "to@example.test",
          subject: "Hi",
          html: "<p>Hi</p>",
        }),
      })
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty("data");
    expect(json.message).toMatch(/queued/i);
    expect(json.messageId).toBe("msg-123");
    expect(json.success).toBe(true);
  });

  it("still emits a non-Boolean-only body when messageId is absent", async () => {
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      send: vi.fn().mockResolvedValue({ success: false }),
    });

    const res = await POST(
      new Request("http://x/api/email/send", {
        method: "POST",
        body: JSON.stringify({
          to: "to@example.test",
          subject: "Hi",
          html: "<p>Hi</p>",
        }),
      })
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty("data");
    expect(json.message).toMatch(/queued/i);
    expect(json.success).toBe(false);
  });
});
