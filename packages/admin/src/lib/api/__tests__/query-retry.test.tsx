/**
 * The admin sends a failed read again only when another try could answer
 * differently: a lost response, a server error, a timeout or a rate limit. A
 * refusal (signed out, not allowed, not found, invalid) answers the same the
 * second time, so sending it again only costs a round trip and a second wait.
 *
 * Observed through the admin's own query client: each case is fetched with
 * the provider's defaults, and the number of times the read was sent is
 * counted.
 */
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { QueryProvider } from "@admin/context/providers/QueryProvider";

import { parseApiError } from "../parseApiError";

afterEach(cleanup);

/** The error the admin's fetcher raises for a canonical error response. */
function apiError(status: number, code: string) {
  return parseApiError(
    { error: { code, message: "refused", requestId: "r1" } },
    status
  );
}

/** The query client the admin's provider makes. */
function adminQueryClient(): QueryClient {
  let client: QueryClient | undefined;
  function ReadClient() {
    client = useQueryClient();
    return null;
  }
  render(
    <QueryProvider>
      <ReadClient />
    </QueryProvider>
  );
  if (!client) throw new Error("the provider gave no query client");
  return client;
}

/** How many times a read that always fails with `error` is sent. */
async function timesSent(error: unknown): Promise<number> {
  const client = adminQueryClient();
  let sent = 0;
  await client
    .fetchQuery({
      queryKey: ["retry-probe"],
      queryFn: () => {
        sent += 1;
        return Promise.reject(error);
      },
      // The provider's retry rule decides whether; the wait between tries is
      // taken out so the test does not sit through it.
      retryDelay: 0,
    })
    .catch(() => undefined);
  return sent;
}

describe("a read the server refused", () => {
  const REFUSED = [
    { name: "401, signed out", error: apiError(401, "AUTH_REQUIRED") },
    { name: "403, not allowed", error: apiError(403, "FORBIDDEN") },
    { name: "404, not found", error: apiError(404, "NOT_FOUND") },
    { name: "422, invalid", error: apiError(422, "VALIDATION_ERROR") },
  ];

  for (const { name, error } of REFUSED) {
    it(`is sent once for a ${name}`, async () => {
      expect(await timesSent(error)).toBe(1);
    });
  }
});

describe("a read another try may answer", () => {
  const RETRIED = [
    { name: "408, timed out", error: apiError(408, "REQUEST_TIMEOUT") },
    { name: "429, rate limited", error: apiError(429, "RATE_LIMITED") },
    { name: "500, server error", error: apiError(500, "INTERNAL_ERROR") },
    { name: "503, unavailable", error: apiError(503, "SERVICE_UNAVAILABLE") },
    {
      // fetch rejects with a TypeError when no response arrives.
      name: "network failure with no response",
      error: new TypeError("Failed to fetch"),
    },
  ];

  for (const { name, error } of RETRIED) {
    it(`is sent again once for a ${name}`, async () => {
      expect(await timesSent(error)).toBe(2);
    });
  }
});
