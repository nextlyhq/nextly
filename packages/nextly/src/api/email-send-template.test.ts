// Phase 4 Task 11: email-send-template handler tests pin the canonical
// respondAction wire shape. The body adds `templateId` so callers can
// correlate the queued message back to the template slug.

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

import { POST } from "./email-send-template";

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "user-1",
  });
  (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValue(false);
});

describe("POST /api/email/send-with-template", () => {
  it("emits respondAction with messageId, success, and templateId in the body", async () => {
    (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
      sendWithTemplate: vi
        .fn()
        .mockResolvedValue({ success: true, messageId: "msg-456" }),
    });

    const res = await POST(
      new Request("http://x/api/email/send-with-template", {
        method: "POST",
        body: JSON.stringify({
          to: "to@example.test",
          template: "welcome",
          variables: { firstName: "Mobeen" },
        }),
      })
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty("data");
    expect(json.message).toMatch(/queued/i);
    expect(json.messageId).toBe("msg-456");
    expect(json.success).toBe(true);
    expect(json.templateId).toBe("welcome");
  });
});
