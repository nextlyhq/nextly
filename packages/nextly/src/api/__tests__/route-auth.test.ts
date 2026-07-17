import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext, ErrorResponse } from "../../auth/middleware";
import { NextlyError } from "../../errors/nextly-error";

const middleware = vi.hoisted(() => ({
  requireAuthentication: vi.fn(),
  requirePermission: vi.fn(),
  requireAnyPermission: vi.fn(),
  requireCollectionAccess: vi.fn(),
}));

vi.mock("../../auth/middleware", async importOriginal => {
  const actual = await importOriginal<typeof import("../../auth/middleware")>();
  return { ...actual, ...middleware };
});

import {
  requireRouteAnyPermission,
  requireRouteAuthentication,
  requireRouteCollectionAccess,
  requireRoutePermission,
} from "../route-auth";

const AUTH_CONTEXT: AuthContext = {
  userId: "user-1",
  permissions: [],
  roles: [],
  authMethod: "session",
};

function errorResponse(statusCode: number, code?: string): ErrorResponse {
  return {
    success: false,
    statusCode,
    message: "nope",
    error: "nope",
    data: null,
    ...(code && { code }),
  };
}

const request = new Request("http://localhost/api/test");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("route-auth wrappers", () => {
  it("returns the AuthContext when the middleware authorizes", async () => {
    middleware.requirePermission.mockResolvedValue(AUTH_CONTEXT);
    await expect(
      requireRoutePermission(request, "manage", "settings")
    ).resolves.toBe(AUTH_CONTEXT);
    expect(middleware.requirePermission).toHaveBeenCalledWith(
      request,
      "manage",
      "settings"
    );
  });

  it("throws AUTH_REQUIRED for a 401 middleware response", async () => {
    middleware.requirePermission.mockResolvedValue(
      errorResponse(401, "AUTH_REQUIRED")
    );
    await expect(
      requireRoutePermission(request, "manage", "settings")
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("throws FORBIDDEN for a 403 middleware response", async () => {
    middleware.requireAnyPermission.mockResolvedValue(errorResponse(403));
    await expect(
      requireRouteAnyPermission(request, [
        { action: "read", resource: "settings" },
      ])
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws RATE_LIMITED for a 429 middleware response", async () => {
    middleware.requireCollectionAccess.mockResolvedValue(errorResponse(429));
    await expect(
      requireRouteCollectionAccess(request, "read", "posts")
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("authentication wrapper passes through and maps expired-session 401s", async () => {
    middleware.requireAuthentication.mockResolvedValue(AUTH_CONTEXT);
    await expect(requireRouteAuthentication(request)).resolves.toBe(
      AUTH_CONTEXT
    );

    middleware.requireAuthentication.mockResolvedValue(
      errorResponse(401, "TOKEN_EXPIRED")
    );
    const failure = requireRouteAuthentication(request);
    await expect(failure).rejects.toBeInstanceOf(NextlyError);
    await expect(failure).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});
