/**
 * Setup status falls back to "complete" when the server cannot answer, so a
 * transient failure never drags a signed-in user into the setup wizard. The
 * fallback is not an answer, though: kept for the page's life, a starting
 * server's first failure would decide every later check. These pin that the
 * fallback is marked as such and is asked again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.fn();
vi.mock("../../api/publicApi", () => ({
  publicApi: { get: (...args: unknown[]) => mockGet(...args) },
}));

import {
  checkSetupStatus,
  readSetupState,
  resetSetupStatusCache,
} from "../setup-status";

beforeEach(() => {
  // A reset, not a clear: a queued one-time answer left unread by one test
  // would otherwise be the next test's first answer.
  vi.resetAllMocks();
  resetSetupStatusCache();
});

describe("setup status", () => {
  it("marks the fail-safe default as unanswered", async () => {
    mockGet.mockRejectedValue(new Error("503"));

    await expect(readSetupState()).resolves.toMatchObject({
      answered: false,
      isSetup: true,
    });
  });

  it("asks the server again after a failure instead of keeping the default", async () => {
    mockGet
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce({ isSetup: false, requiresSetupToken: true });

    await expect(checkSetupStatus()).resolves.toBe(true);
    await expect(checkSetupStatus()).resolves.toBe(false);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("keeps a real answer: one request however many ask", async () => {
    mockGet.mockResolvedValue({ isSetup: true, requiresSetupToken: false });

    await checkSetupStatus();
    await expect(readSetupState()).resolves.toMatchObject({
      answered: true,
      isSetup: true,
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
