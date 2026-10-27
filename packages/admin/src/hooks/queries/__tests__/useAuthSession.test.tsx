/**
 * The session query decides between three screens: the admin, login (or
 * setup), and "the server could not answer". These pin the third: a server
 * that cannot answer is retried and then reported as an error, never as
 * "signed out", and a sign-in check that cannot tell login from setup does
 * not guess login.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { FakeUnavailable } = vi.hoisted(() => ({
  FakeUnavailable: class FakeUnavailable extends Error {},
}));

const mockIsAuthenticated = vi.fn();
vi.mock("@admin/lib/auth/session", () => ({
  isAuthenticated: (...args: unknown[]) => mockIsAuthenticated(...args),
  SessionUnavailableError: FakeUnavailable,
}));

const mockReadSetupState = vi.fn();
vi.mock("@admin/lib/auth/setup-status", () => ({
  readSetupState: (...args: unknown[]) => mockReadSetupState(...args),
}));

import { restartSessionCheck, useAuthSession } from "../useAuthSession";

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Runs the query's retries (React Query waits 1 s, then 2 s) to completion. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  client = new QueryClient();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAuthSession", () => {
  it("retries a server that cannot answer, then reports an error, not signed out", async () => {
    mockReadSetupState.mockResolvedValue({ answered: true, isSetup: true });
    mockIsAuthenticated.mockRejectedValue(new FakeUnavailable("503"));

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await settle();

    expect(result.current.status).toBe("error");
    expect(result.current.data).toBeUndefined();
    // The first request and two retries.
    expect(mockIsAuthenticated).toHaveBeenCalledTimes(3);
  });

  it("never retries a definite signed-out answer", async () => {
    mockReadSetupState.mockResolvedValue({ answered: true, isSetup: true });
    mockIsAuthenticated.mockResolvedValue(false);

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await settle();

    expect(result.current.data).toEqual({
      isSetup: true,
      isAuthenticated: false,
    });
    expect(mockIsAuthenticated).toHaveBeenCalledTimes(1);
  });

  it("does not guess login when setup went unanswered and nobody is signed in", async () => {
    mockReadSetupState.mockResolvedValue({ answered: false, isSetup: true });
    mockIsAuthenticated.mockResolvedValue(false);

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await settle();

    expect(result.current.status).toBe("error");
  });

  it("trusts a signed-in answer even when setup went unanswered", async () => {
    mockReadSetupState.mockResolvedValue({ answered: false, isSetup: true });
    mockIsAuthenticated.mockResolvedValue(true);

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await settle();

    expect(result.current.data).toEqual({
      isSetup: true,
      isAuthenticated: true,
    });
  });

  it("restarts a hung check with a new request, rather than joining the one still out", async () => {
    // The first request never answers, as a starting server holds it.
    mockReadSetupState.mockResolvedValue({ answered: true, isSetup: true });
    mockIsAuthenticated
      .mockReturnValueOnce(new Promise<boolean>(() => {}))
      .mockResolvedValue(true);

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(mockIsAuthenticated).toHaveBeenCalledTimes(1);

    await act(async () => {
      await restartSessionCheck(client);
    });
    await settle();

    expect(mockIsAuthenticated).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual({
      isSetup: true,
      isAuthenticated: true,
    });
  });
});
