/**
 * "Signed out" and "the server could not answer" lead to different screens:
 * the login form, or a wait with Try again. Reading a starting server's 5xx or
 * a dropped request as "signed out" sends a signed-in person to log in again,
 * so each kind of non-answer is asserted to stay apart from a real "no session".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthFetch = vi.fn();
vi.mock("../../api/refreshInterceptor", () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

import {
  getSession,
  invalidateSessionCache,
  SessionUnavailableError,
  sessionStanding,
} from "../session";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateSessionCache();
});

describe("getSession", () => {
  it("answers null for a request that reached the server and holds no session", async () => {
    mockAuthFetch.mockResolvedValue(
      jsonResponse(401, { error: { code: "AUTH_REQUIRED" } })
    );

    await expect(getSession()).resolves.toBeNull();
  });

  it.each([500, 503, 504, 429])(
    "throws SessionUnavailableError for a %i, never reading it as signed out",
    async status => {
      mockAuthFetch.mockResolvedValue(jsonResponse(status, {}));

      await expect(getSession()).rejects.toBeInstanceOf(
        SessionUnavailableError
      );
    }
  );

  it("throws SessionUnavailableError when the request never reaches the server", async () => {
    mockAuthFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(getSession()).rejects.toBeInstanceOf(SessionUnavailableError);
  });

  it("throws SessionUnavailableError for an OK page that is not the server's JSON", async () => {
    mockAuthFetch.mockResolvedValue(
      new Response("<html>gateway</html>", { status: 200 })
    );

    await expect(getSession()).rejects.toBeInstanceOf(SessionUnavailableError);
  });

  it("does not keep a non-answer: the next call asks the server again", async () => {
    mockAuthFetch
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { user: { id: "u1" } } })
      );

    await expect(getSession()).rejects.toBeInstanceOf(SessionUnavailableError);
    await expect(getSession()).resolves.toEqual({ user: { id: "u1" } });
    expect(mockAuthFetch).toHaveBeenCalledTimes(2);
  });
});

describe("sessionStanding", () => {
  const standing = async (user: Record<string, unknown>) => {
    invalidateSessionCache();
    mockAuthFetch.mockResolvedValueOnce(jsonResponse(200, { data: { user } }));
    return sessionStanding();
  };

  it("is role-less only where the session names its roles and they are none", async () => {
    expect(await standing({ id: "u1", email: "a@x.com", roleIds: [] })).toEqual(
      { isAuthenticated: true, hasRole: false, email: "a@x.com" }
    );
    expect(
      (await standing({ id: "u1", email: "a@x.com", roleIds: ["editor"] }))
        .hasRole
    ).toBe(true);
  });

  it("does not call a session that names no roles at all role-less", async () => {
    // What the app's own determineUser resolves: a person, with no roleIds.
    expect((await standing({ id: "u1", email: "a@x.com" })).hasRole).toBe(true);
  });
});
