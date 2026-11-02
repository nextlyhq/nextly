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

const mockIsAuthenticated = vi.fn();
vi.mock("@admin/lib/auth/session", () => ({
  isAuthenticated: (...args: unknown[]) => mockIsAuthenticated(...args),
  SessionUnavailableError: class extends Error {},
}));

import { resetSetupStatusCache } from "@admin/lib/auth/setup-status";

import { restartSessionCheck, useAuthSession } from "../useAuthSession";

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.resetAllMocks();
  resetSetupStatusCache();
  client = new QueryClient();
});

describe("restartSessionCheck", () => {
  it("replaces a hung setup-status request instead of joining it", async () => {
    mockGet
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValue({ isSetup: true, requiresSetupToken: false });
    mockIsAuthenticated.mockResolvedValue(true);

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
      })
    );
  });
});
