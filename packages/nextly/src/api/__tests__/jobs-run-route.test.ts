/**
 * The background job trigger route.
 *
 * The permission is driven through a REAL check rather than a spy: the fake
 * `requireAnyPermission` grants what the caller actually holds, so these assert
 * that a caller WITHOUT `manage-background-jobs` is refused — not merely that
 * some permission function was called. A spy would pass just as happily if the
 * route asked for the wrong permission.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const HELD = "x-test-permissions";

const runJobsPass = vi.fn(
  async (
    _adapter: unknown,
    _registry: unknown,
    _options: { batchSize?: number; maxDurationMs?: number }
  ) => ({
    claimed: 2,
    succeeded: 2,
    failed: 0,
    retried: 0,
  })
);

const registry = { get: () => undefined, slugs: () => [] };
const adapter = { select: async () => [] };

vi.mock("../../di", () => ({
  container: {
    get: (name: string) => (name === "jobRegistry" ? registry : adapter),
  },
}));

vi.mock("../../init", () => ({ getCachedNextly: async () => ({}) }));

vi.mock("../../domains/jobs/jobs-runner", () => ({
  runJobsPass: (...args: unknown[]) =>
    (runJobsPass as unknown as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("../../auth/middleware", () => ({
  isErrorResponse: (r: { statusCode?: number }) => "statusCode" in r,
  // Grants exactly the permissions the request says it holds, so the ROUTE's
  // choice of permission is what decides the outcome.
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

vi.mock("../../shared/lib/env", () => ({
  env: { NEXTLY_ALLOWED_ORIGINS_PARSED: [] },
}));

vi.mock("../../auth/csrf/validate", () => ({ validateOrigin: () => true }));

const { runJobsRoute } = await import("../jobs-run-route");

function post(permissions?: string): Request {
  return new Request("https://example.com/api/jobs/run", {
    method: "POST",
    headers: permissions ? { [HELD]: permissions } : {},
  });
}

beforeEach(() => {
  runJobsPass.mockClear();
});

describe("runJobsRoute", () => {
  it("refuses an unauthenticated caller and runs nothing", async () => {
    // A public job-drain endpoint is both a denial-of-service primitive and an
    // information leak, so the refusal must happen BEFORE any work.
    const response = await runJobsRoute(post());

    expect(response.status).toBe(403);
    expect(runJobsPass).not.toHaveBeenCalled();
  });

  it("refuses a caller holding a different administrative permission", async () => {
    // `manage-settings` is the nearest existing umbrella and deliberately does
    // NOT open this trigger; if it did, the new permission would be decorative.
    const response = await runJobsRoute(post("manage-settings"));

    expect(response.status).toBe(403);
    expect(runJobsPass).not.toHaveBeenCalled();
  });

  it("runs a pass for a caller holding manage-background-jobs", async () => {
    const response = await runJobsRoute(post("manage-background-jobs"));

    expect(response.status).toBe(200);
    expect(runJobsPass).toHaveBeenCalledTimes(1);
  });

  it("returns the pass summary as the mutation item", async () => {
    const response = await runJobsRoute(post("manage-background-jobs"));
    const body = (await response.json()) as {
      item: { claimed: number; succeeded: number };
    };

    expect(body.item).toEqual({
      claimed: 2,
      succeeded: 2,
      failed: 0,
      retried: 0,
    });
  });

  it("runs the pass against the SHARED registry, not one of its own", async () => {
    // A registry built per request would answer only for the job types that
    // request happened to import, so a job queued elsewhere would be deferred
    // forever while the queue looked empty.
    await runJobsRoute(post("manage-background-jobs"));

    expect(runJobsPass.mock.calls[0]?.[1]).toBe(registry);
  });

  it("bounds the pass so a serverless invocation cannot be killed mid-flight", async () => {
    await runJobsRoute(post("manage-background-jobs"));

    const options = runJobsPass.mock.calls[0]?.[2];
    expect(options?.batchSize).toBeGreaterThan(0);
    expect(options?.maxDurationMs).toBeGreaterThan(0);
    expect(options?.maxDurationMs).toBeLessThan(60_000);
  });
});
