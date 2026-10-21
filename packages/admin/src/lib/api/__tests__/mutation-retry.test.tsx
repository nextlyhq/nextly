/**
 * The admin sends a failed write again only when the server said nothing ran
 * and to try again. Every other failure may follow a saved change, and
 * sending it again would make the change a second time.
 */
import { useQueryClient } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MUTATION_RETRY_COUNT } from "@admin/constants/query";
import { QueryProvider } from "@admin/context/providers/QueryProvider";

import { shouldRetryMutation } from "../mutation-retry";
import { parseApiError } from "../parseApiError";

afterEach(cleanup);

/** The error the admin's fetcher raises for a canonical error response. */
function apiError(
  status: number,
  code: string,
  data?: Record<string, unknown>
) {
  return parseApiError(
    {
      error: {
        code,
        message: "refused",
        requestId: "r1",
        ...(data ? { data } : {}),
      },
    },
    status
  );
}

describe("a failed write the server refused before running it", () => {
  const RETRIED = [
    {
      name: "DATABASE_BUSY",
      error: apiError(503, "DATABASE_BUSY", { retryAfterSeconds: 5 }),
    },
    {
      name: "RATE_LIMITED without a hint",
      error: apiError(429, "RATE_LIMITED"),
    },
    {
      name: "another code carrying a retry hint",
      error: apiError(503, "SERVICE_UNAVAILABLE", { retryAfterSeconds: 30 }),
    },
  ];

  for (const { name, error } of RETRIED) {
    it(`is sent again for ${name}, up to the retry count`, () => {
      for (let count = 0; count < MUTATION_RETRY_COUNT; count++) {
        expect(shouldRetryMutation(count, error)).toBe(true);
      }
      expect(shouldRetryMutation(MUTATION_RETRY_COUNT, error)).toBe(false);
    });
  }
});

describe("a failed write that may have changed data", () => {
  const NOT_RETRIED = [
    {
      name: "a change that was saved before the request failed",
      error: apiError(500, "INTERNAL_ERROR"),
    },
    {
      name: "a DATABASE_ERROR whose message says to try again",
      error: apiError(500, "DATABASE_ERROR"),
    },
    {
      name: "a SERVICE_UNAVAILABLE with no hint",
      error: apiError(503, "SERVICE_UNAVAILABLE"),
    },
    { name: "a validation refusal", error: apiError(400, "VALIDATION_ERROR") },
    { name: "a conflict", error: apiError(409, "CONFLICT") },
    {
      // fetch rejects with a TypeError when no response arrives; the request
      // may have reached the server and committed before its answer was lost.
      name: "a network failure with no response",
      error: new TypeError("Failed to fetch"),
    },
    { name: "a thrown non-error", error: "boom" },
  ];

  for (const { name, error } of NOT_RETRIED) {
    it(`is not sent again for ${name}`, () => {
      expect(shouldRetryMutation(0, error)).toBe(false);
    });
  }
});

describe("the admin's query client", () => {
  it("decides a mutation's retry with this rule", () => {
    let retry: unknown;
    function ReadDefaults() {
      retry = useQueryClient().getDefaultOptions().mutations?.retry;
      return null;
    }
    render(
      <QueryProvider>
        <ReadDefaults />
      </QueryProvider>
    );

    expect(retry).toBe(shouldRetryMutation);
  });
});
