/**
 * The jobs read surface, at the two places a list can lie quietly.
 *
 * A monitor that shows fifty rows out of five hundred and reports itself
 * complete is worse than one that shows nothing: an operator hunting a failed
 * release reads the absence as proof it never ran. And `lastError` is whatever
 * a handler threw, so a message quoting a timestamp is the record being
 * inspected — it must arrive as it was written, not shifted into the
 * installation's timezone by a pass that cannot know what the string means.
 *
 * The permission is driven through a REAL check rather than a spy, as the run
 * route's tests are: the fake grants exactly what the caller says it holds, so
 * the ROUTE's choice of permission decides the outcome.
 */

import { describe, expect, it, vi } from "vitest";

import type { JobSummaryRow } from "../../domains/jobs/jobs-repository";

const HELD = "x-test-permissions";

/** What `listRecent` was asked for, so the probe row can be asserted. */
let requestedLimit = 0;

/** Rows the fake repository holds; each test sets its own count. */
let stored: JobSummaryRow[] = [];

function job(id: string, lastError: string | null = null): JobSummaryRow {
  const at = new Date("2026-01-01T00:00:00.000Z");
  return {
    id,
    slug: "releases:drain",
    state: "failed",
    attemptCount: 1,
    runAt: null,
    nextAttemptAt: null,
    lockedUntil: null,
    lastError,
    createdAt: at,
    updatedAt: at,
  };
}

const repository = {
  listRecent: async (input: { limit: number }): Promise<JobSummaryRow[]> => {
    requestedLimit = input.limit;
    return stored.slice(0, input.limit);
  },
};

vi.mock("../../di", () => ({
  container: { get: () => repository },
}));

vi.mock("../../init", () => ({ getCachedNextly: async () => ({}) }));

vi.mock("../../auth/middleware", () => ({
  isErrorResponse: (r: { statusCode?: number }) => "statusCode" in r,
  requireAnyPermission: async (
    req: Request,
    needed: Array<{ action: string; resource: string }>
  ) => {
    const held = (req.headers.get(HELD) ?? "").split(",").filter(Boolean);
    const ok = needed.some(n => held.includes(`${n.action}-${n.resource}`));
    return ok
      ? { userId: "u1", permissions: held, roles: [], authMethod: "session" }
      : {
          success: false,
          statusCode: 403,
          message: "Forbidden",
          error: "Forbidden",
          data: null,
        };
  },
}));

const { listJobsRoute } = await import("../jobs-list-route");
const { withTimezoneFormatting } = await import(
  "../../shared/lib/date-formatting"
);

function request(query = ""): Request {
  return new Request(`http://localhost/api/jobs${query}`, {
    headers: { [HELD]: "manage-background-jobs" },
  });
}

async function meta(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as { meta: Record<string, unknown> };
  return body.meta;
}

describe("GET /api/jobs", () => {
  it("reports a TRUNCATED window as having more", async () => {
    // The failure this closes: `hasNext` was the literal `false`, so a queue of
    // any size answered "this is all of it".
    stored = Array.from({ length: 60 }, (_, i) => job(`j${i}`));

    const response = await listJobsRoute(request("?limit=10"));
    const body = (await response.clone().json()) as { items: unknown[] };

    expect((await meta(response)).hasNext).toBe(true);
    // The probe row is not handed to the caller: it exists to be counted.
    expect(body.items).toHaveLength(10);
    expect(requestedLimit).toBe(11);
  });

  it("reports an EXACTLY FULL window as complete", async () => {
    // The control, and the reason for a probe row rather than a full-page test:
    // inferring truncation from a full page claims a next page whenever the
    // queue length is an exact multiple of the limit, sending an operator to an
    // empty screen.
    stored = Array.from({ length: 10 }, (_, i) => job(`j${i}`));

    const response = await listJobsRoute(request("?limit=10"));
    const body = (await response.clone().json()) as { items: unknown[] };

    expect((await meta(response)).hasNext).toBe(false);
    expect(body.items).toHaveLength(10);
  });

  it("delivers a date-shaped lastError exactly as it was recorded", async () => {
    // Asserted through the pass that would rewrite it, not by looking for the
    // opt-out header: a header assertion passes while the pass is bypassed for
    // some other reason, and it is the surviving TEXT that operators need.
    // The value IS a timestamp, which is the case the rewrite acts on: a
    // handler that surfaces a remote endpoint's response verbatim, or a
    // deadline echoed back as the whole message. A date embedded in a sentence
    // is not rewritten, so asserting with one would pass without the opt-out
    // and prove nothing.
    const recorded = "2026-09-01T12:00:00Z";
    stored = [job("j1", recorded)];

    const response = await withTimezoneFormatting(
      await listJobsRoute(request())
    );
    const body = (await response.json()) as {
      items: Array<{ lastError: string }>;
    };

    expect(body.items[0].lastError).toBe(recorded);
    // The premise: the internal marker never reaches a client.
    expect(response.headers.get("x-nextly-skip-timezone-format")).toBeNull();
  });

  it("refuses a caller without the jobs permission", async () => {
    stored = [job("j1")];
    const response = await listJobsRoute(
      new Request("http://localhost/api/jobs", { headers: { [HELD]: "" } })
    );
    expect(response.status).toBe(403);
  });
});
