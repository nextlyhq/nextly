// The restriction this route exists to carry, on the surface an app mounts
// itself: a test send goes to the signed-in person's own address, an address
// the caller writes is ignored, and an API key, which names no person and no
// address, is refused. The dispatcher's catch-all route answers the same way;
// these pins keep the two surfaces from drifting apart.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/middleware", () => ({
  requireAnyPermission: vi.fn(),
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
    has: vi.fn().mockReturnValue(false),
  },
}));

import { requireAnyPermission } from "../auth/middleware";
import { container } from "../di";

import { POST } from "./email-providers-test";

/** A signed-in person, as the permission gate answers them. */
const asSession = (): void => {
  (requireAnyPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    userId: "user-1",
    authMethod: "session",
  });
};

/** An API key with the permission: the gate passes, the actor is no person. */
const asApiKey = (): void => {
  (requireAnyPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    userId: "user-1",
    authMethod: "api-key",
  });
};

const testProvider = vi.fn();
const findById = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (container.get as ReturnType<typeof vi.fn>).mockImplementation(
    (key: string) =>
      key === "emailProviderService"
        ? { testProvider }
        : key === "userService"
          ? { findById }
          : undefined
  );
});

const post = (body: unknown, id = "p1") =>
  POST(
    new Request(`http://x/api/email-providers/${id}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );

describe("the mounted provider test route", () => {
  it("sends to the signed-in person's own address, ignoring one in the body", async () => {
    asSession();
    findById.mockResolvedValue({ email: "owner@example.com" });
    testProvider.mockResolvedValue({ success: true });

    const res = await post({ email: "someone-else@example.com" });

    expect(res.status).toBe(200);
    expect(testProvider).toHaveBeenCalledWith("p1", "owner@example.com");
  });

  it("refuses an API key, which names no person and no address", async () => {
    asApiKey();

    const res = await post({});

    expect(res.status).toBe(403);
    expect(testProvider).not.toHaveBeenCalled();
  });

  it("refuses a session whose user has no address", async () => {
    asSession();
    findById.mockResolvedValue({ email: null });

    const res = await post({});

    expect(res.status).toBe(403);
    expect(testProvider).not.toHaveBeenCalled();
  });
});
