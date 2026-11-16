/**
 * "Try again" must reach the server with new requests wherever the first ones
 * are stuck. Setup status shares one pending request across readers, so this
 * runs the real setup-status module: a hung setup-status request has to be
 * replaced, not joined.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.fn();
vi.mock("@admin/lib/api/publicApi", () => ({
  publicApi: { get: (...args: unknown[]) => mockGet(...args) },
}));

const mockSessionStanding = vi.fn();
vi.mock("@admin/lib/auth/session", () => ({
  sessionStanding: (...args: unknown[]) => mockSessionStanding(...args),
  SessionUnavailableError: class extends Error {},
}));

import {
  beginStartupRequest,
  resetStartupRequestForTests,
  takeStartupResponse,
} from "@admin/lib/api/startup-request";
import { resetSetupStatusCache } from "@admin/lib/auth/setup-status";

import { restartSessionCheck, useAuthSession } from "../useAuthSession";

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.resetAllMocks();
  resetSetupStatusCache();
  resetStartupRequestForTests();
  client = new QueryClient();
});

describe("restartSessionCheck", () => {
  it("replaces a hung setup-status request instead of joining it", async () => {
    mockGet
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValue({ isSetup: true, requiresSetupToken: false });
    mockSessionStanding.mockResolvedValue({
      isAuthenticated: true,
      hasRole: true,
      email: "owner@example.com",
    });

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      await restartSessionCheck(client);
    });

    expect(mockGet).toHaveBeenCalledTimes(2);
    await vi.waitFor(() =>
      expect(result.current.data).toEqual({
        isSetup: true,
        isAuthenticated: true,
        hasRole: true,
        email: "owner@example.com",
      })
    );
  });

  it("stops waiting on a hung startup request, so the session is asked afresh", async () => {
    // The startup request never answers; the session's part is still untaken.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {}))
    );
    beginStartupRequest("/admin/api", ["/auth/session"]);
    mockGet.mockResolvedValue({ isSetup: true, requiresSetupToken: false });

    await act(async () => {
      await restartSessionCheck(client);
    });

    // A read of the session now goes to the server rather than waiting on it.
    expect(takeStartupResponse("/auth/session")).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
