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

/** What task the QUERY was narrowed to, if any. */
let requestedSlug: string | undefined;

/** Which stored states the QUERY was narrowed to, if any. */
let requestedStates: readonly string[] | undefined;

/** Rows the fake repository holds; each test sets its own count. */
let stored: JobSummaryRow[] = [];

function job(
  id: string,
  lastError: string | null = null,
  slug = "releases:drain"
): JobSummaryRow {
  const at = new Date("2026-01-01T00:00:00.000Z");
  return {
    id,
    slug,
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
  listRecent: async (input: {
    limit: number;
    slug?: string;
    states?: readonly string[];
  }): Promise<JobSummaryRow[]> => {
    requestedLimit = input.limit;
    requestedSlug = input.slug;
    requestedStates = input.states;
    // Narrowed HERE, before the limit, exactly as the repository does it.
    const matching =
      input.slug === undefined
        ? stored
        : stored.filter(row => row.slug === input.slug);
    return matching.slice(0, input.limit);
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

  it("narrows to one task in the QUERY, not after the window", async () => {
    /*
     * The failure this closes: a caller wanting one task's recent jobs read the
     * global window and filtered it afterwards. A busier task fills that window
     * first, so the requested task's rows are simply not in it — and a caller
     * asking "did releases:drain fail" gets "no" from a result that never
     * looked.
     *
     * Fifty webhook jobs are more recent than the one release job here, so a
     * window of ten cannot contain the release job unless the narrowing
     * happened in the query.
     */
    stored = [
      ...Array.from({ length: 50 }, (_, i) =>
        job(`w${i}`, null, "webhooks:drain")
      ),
      job("r1", "boom", "releases:drain"),
    ];

    const response = await listJobsRoute(
      request("?limit=10&slug=releases:drain")
    );
    const body = (await response.json()) as {
      items: Array<{ id: string; slug: string }>;
    };

    expect(requestedSlug).toBe("releases:drain");
    expect(body.items.map(item => item.id)).toEqual(["r1"]);
  });

  it("treats a blank slug as no filter rather than a task named nothing", async () => {
    // A form submitting an empty field must not silently ask for jobs of a
    // task that cannot exist, which would answer "nothing failed" forever.
    stored = [job("j1")];
    await listJobsRoute(request("?slug="));
    expect(requestedSlug).toBeUndefined();
  });

  it("narrows to the asked-for stored states", async () => {
    // How a caller asks "did anything fail" without scanning a window: N
    // healthy jobs running after a failure would push it out of the recent
    // rows, and the caller would report nothing wrong.
    stored = [job("j1")];
    await listJobsRoute(request("?state=failed"));
    expect(requestedStates).toEqual(["failed"]);
  });

  it("REFUSES a state name it does not recognise", async () => {
    /*
     * Dropping the unknown name looks conservative and inverts the request: with
     * every name dropped the filter disappears, so a caller asking to narrow
     * receives a successful read of EVERY state — the widest possible answer to
     * a request for a narrower one, with a 200 on it.
     */
    stored = [job("j1")];
    requestedStates = undefined;

    const response = await listJobsRoute(request("?state=faield"));

    expect(response.status).toBe(400);
    // And the query was never issued, so nothing widened on the way to failing.
    expect(requestedStates).toBeUndefined();
  });

  it("refuses a partially unknown filter rather than honouring half of it", async () => {
    stored = [job("j1")];
    const response = await listJobsRoute(request("?state=failed,faield"));
    expect(response.status).toBe(400);
  });

  it("still accepts every name it does recognise", async () => {
    // The control: without it the two cases above pass against a route that
    // refuses all filters.
    stored = [job("j1")];
    await listJobsRoute(request("?state=failed,pending"));
    expect(requestedStates).toEqual(["pending", "failed"]);
  });

  it("refuses a caller without the jobs permission", async () => {
    stored = [job("j1")];
    const response = await listJobsRoute(
      new Request("http://localhost/api/jobs", { headers: { [HELD]: "" } })
    );
    expect(response.status).toBe(403);
  });
});
