/**
 * Retry Utility Tests
 *
 * Tests for the exponential backoff retry logic used by storage adapters.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  withRetry,
  isTransientError,
  createRetryable,
  type RetryOptions,
} from "../retry";

describe("retry utility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("isTransientError", () => {
    it("should return true for timeout errors", () => {
      expect(isTransientError(new Error("Request timeout"))).toBe(true);
      expect(isTransientError(new Error("Connection timed out"))).toBe(true);
      expect(isTransientError(new Error("ETIMEDOUT"))).toBe(true);
    });

    it("should return true for network errors", () => {
      expect(isTransientError(new Error("ECONNRESET"))).toBe(true);
      expect(isTransientError(new Error("ECONNREFUSED"))).toBe(true);
      expect(isTransientError(new Error("ENOTFOUND"))).toBe(true);
      expect(isTransientError(new Error("Socket hang up"))).toBe(true);
      expect(isTransientError(new Error("Network error"))).toBe(true);
    });

    it("should return true for rate limiting errors", () => {
      expect(isTransientError(new Error("Rate limit exceeded"))).toBe(true);
      expect(isTransientError(new Error("Too many requests"))).toBe(true);
    });

    it("should return true for 429 status code", () => {
      expect(isTransientError({ statusCode: 429 })).toBe(true);
      expect(isTransientError({ status: 429 })).toBe(true);
      expect(isTransientError({ $metadata: { httpStatusCode: 429 } })).toBe(
        true
      );
    });

    it("should return true for 5xx status codes", () => {
      expect(isTransientError({ statusCode: 500 })).toBe(true);
      expect(isTransientError({ statusCode: 502 })).toBe(true);
      expect(isTransientError({ statusCode: 503 })).toBe(true);
      expect(isTransientError({ statusCode: 504 })).toBe(true);
    });

    it("should return false for 4xx status codes (except 429)", () => {
      expect(isTransientError({ statusCode: 400 })).toBe(false);
      expect(isTransientError({ statusCode: 401 })).toBe(false);
      expect(isTransientError({ statusCode: 403 })).toBe(false);
      expect(isTransientError({ statusCode: 404 })).toBe(false);
    });

    it("should return true for AWS throttling errors", () => {
      expect(isTransientError({ code: "ThrottlingException" })).toBe(true);
      expect(isTransientError({ code: "ServiceUnavailable" })).toBe(true);
      expect(isTransientError({ code: "SlowDown" })).toBe(true);
    });

    it("should return false for non-transient errors", () => {
      expect(isTransientError(new Error("Invalid file format"))).toBe(false);
      expect(isTransientError(new Error("Permission denied"))).toBe(false);
      expect(
        isTransientError({ statusCode: 400, message: "Bad request" })
      ).toBe(false);
    });

    it("should return false for null/undefined", () => {
      expect(isTransientError(null)).toBe(false);
      expect(isTransientError(undefined)).toBe(false);
    });
  });

  describe("withRetry", () => {
    it("should succeed on first try without retrying", async () => {
      const fn = vi.fn().mockResolvedValue("success");

      const result = await withRetry(fn);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry on transient error and succeed", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce("success");

      const resultPromise = withRetry(fn, {
        baseDelayMs: 100,
        jitter: false,
      });

      // Fast-forward through retry delay
      await vi.advanceTimersByTimeAsync(100);

      const result = await resultPromise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should throw after max attempts exceeded", async () => {
      const error = new Error("ECONNRESET");
      const fn = vi.fn().mockRejectedValue(error);

      // Use real timers for this test to avoid unhandled rejection issues with fake timers
      vi.useRealTimers();

      await expect(
        withRetry(fn, {
          maxAttempts: 3,
          baseDelayMs: 10, // Use small delays for faster test
          jitter: false,
        })
      ).rejects.toThrow("ECONNRESET");
      expect(fn).toHaveBeenCalledTimes(3);

      // Restore fake timers for other tests
      vi.useFakeTimers();
    });

    it("should not retry on non-transient error", async () => {
      const error = new Error("Invalid file format");
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withRetry(fn)).rejects.toThrow("Invalid file format");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should call onRetry callback before each retry", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce("success");

      const onRetry = vi.fn();

      const resultPromise = withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 100,
        jitter: false,
        onRetry,
      });

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(200);

      await resultPromise;

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 100);
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 2, 200);
    });

    it("should use custom shouldRetry function", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("Custom error"))
        .mockResolvedValueOnce("success");

      const shouldRetry = vi.fn().mockReturnValue(true);

      const resultPromise = withRetry(fn, {
        baseDelayMs: 100,
        jitter: false,
        shouldRetry,
      });

      await vi.advanceTimersByTimeAsync(100);

      const result = await resultPromise;

      expect(result).toBe("success");
      expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error), 1);
    });

    it("should respect maxDelayMs cap", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce("success");

      const onRetry = vi.fn();

      const resultPromise = withRetry(fn, {
        maxAttempts: 4,
        baseDelayMs: 10000,
        maxDelayMs: 5000,
        jitter: false,
        onRetry,
      });

      // All delays should be capped at 5000ms
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      await resultPromise;

      // Check all delays are capped
      onRetry.mock.calls.forEach(([, , delay]) => {
        expect(delay).toBeLessThanOrEqual(5000);
      });
    });
  });

  describe("createRetryable", () => {
    it("should create a retryable version of a function", async () => {
      const fn = vi.fn().mockResolvedValue("success");
      const retryableFn = createRetryable(fn);

      const result = await retryableFn();

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should pass arguments to the original function", async () => {
      const fn = vi.fn().mockResolvedValue("success");
      const retryableFn = createRetryable(fn);

      await retryableFn("arg1", "arg2", { option: true });

      expect(fn).toHaveBeenCalledWith("arg1", "arg2", { option: true });
    });

    it("should apply retry options", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce("success");

      const retryableFn = createRetryable(fn, {
        baseDelayMs: 100,
        jitter: false,
      });

      const resultPromise = retryableFn();

      await vi.advanceTimersByTimeAsync(100);

      const result = await resultPromise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
