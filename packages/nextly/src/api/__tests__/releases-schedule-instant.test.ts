/**
 * The instant a caller may schedule a release for.
 *
 * This contract had no coverage at all, and the gap was not academic: the one
 * string shape the ADMIN actually sends — `Date.prototype.toISOString()`, which
 * always emits milliseconds — reached a fixed-index offset parse and threw a
 * `RangeError` out of the route as a 500. Scheduling was unusable from the
 * product while every test passed, because every test hand-wrote an instant
 * without milliseconds, a shape the product never produces.
 *
 * So the cases below are written from what the CLIENT sends rather than from
 * what is convenient to type, and `ADMIN_SHAPE` names it explicitly.
 *
 * @module api/__tests__/releases-schedule-instant.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireAnyPermission, isErrorResponse, getCachedNextly } = vi.hoisted(
  () => ({
    requireAnyPermission: vi.fn(),
    isErrorResponse: vi.fn(() => false),
    getCachedNextly: vi.fn(),
  })
);

vi.mock("../../auth/middleware", () => ({
  requireAnyPermission,
  isErrorResponse,
}));
vi.mock("../../auth/middleware/to-nextly-error", () => ({
  toNextlyAuthError: (e: unknown) => e,
}));
vi.mock("../../init", () => ({ getCachedNextly }));
vi.mock("../../di", () => ({
  container: {
    has: () => true,
    get: () => ({
      getCollectionBySlug: async () => ({ status: true }),
      getSingleBySlug: async () => ({ status: true }),
    }),
  },
}));

const { handleReleaseRequest } = await import("../releases");

let schedule: ReturnType<typeof vi.fn>;

beforeEach(() => {
  schedule = vi.fn(async () => undefined);
  getCachedNextly.mockResolvedValue({ releases: { schedule } });
  requireAnyPermission.mockResolvedValue({ userId: "u1" });
  isErrorResponse.mockReturnValue(false);
});

afterEach(() => vi.clearAllMocks());

/** Post a schedule request and report whether the service was reached. */
async function scheduleWith(at: string): Promise<{
  status: number;
  reached: boolean;
  instant: Date | undefined;
}> {
  const response = await handleReleaseRequest(
    new Request("https://example.test/api/releases", {
      method: "POST",
      body: JSON.stringify({ at, timezone: "Europe/Berlin" }),
      headers: { "Content-Type": "application/json" },
    }),
    "scheduleRelease",
    { releaseId: "r1" }
  );
  // The namespace takes ONE object, so the instant is a named field rather
  // than a positional argument.
  const call = schedule.mock.calls[0]?.[0] as { at?: Date } | undefined;
  return {
    status: response.status,
    reached: schedule.mock.calls.length > 0,
    instant: call?.at,
  };
}

/**
 * What the admin actually puts on the wire.
 *
 * `toISOString()` always renders milliseconds, so this — not the tidier
 * `…T09:00:00Z` — is the shape every real schedule request carries.
 */
const ADMIN_SHAPE = new Date("2026-09-01T09:00:00Z").toISOString();

describe("the instant shapes a client actually sends", () => {
  it("accepts the string the admin sends, milliseconds and all", async () => {
    // The regression. This threw `RangeError: Invalid time value` from
    // `toISOString` on a date shifted by a NaN offset, and the route answered
    // 500 for every schedule attempt made from the product.
    expect(ADMIN_SHAPE).toBe("2026-09-01T09:00:00.000Z");
    const result = await scheduleWith(ADMIN_SHAPE);
    expect(result.reached).toBe(true);
    expect(result.instant?.toISOString()).toBe(ADMIN_SHAPE);
  });

  it("accepts an offset instant with milliseconds, and honours the OFFSET", async () => {
    // The silent half, and the one that did not throw. With milliseconds
    // present the offset was read as `0`, so this instant — half past midnight
    // on the 1st in Berlin, still the 31st in UTC — was judged against the
    // wrong calendar day and refused as a date that does not exist.
    const result = await scheduleWith("2026-09-01T00:30:00.000+02:00");
    expect(result.reached).toBe(true);
    expect(result.instant?.toISOString()).toBe("2026-08-31T22:30:00.000Z");
  });

  it("accepts an instant with no seconds", async () => {
    // The shape's optional seconds, which the fixed-index parse also mishandled
    // — from the other side, by reading an empty offset.
    const result = await scheduleWith("2026-09-01T09:00Z");
    expect(result.reached).toBe(true);
  });

  it("accepts a plain second-precision instant", async () => {
    // The control: the one shape that always worked must still work, or the
    // fix would have traded one broken input for another.
    const result = await scheduleWith("2026-09-01T09:00:00Z");
    expect(result.reached).toBe(true);
  });
});

describe("an instant that names no real moment is still refused", () => {
  it("refuses an impossible date carrying milliseconds", async () => {
    // The check the silent bug disabled. February 30th parses and normalises
    // to March 2nd, so without this a release ships on a day nobody chose —
    // and the millisecond form is exactly the one the admin sends.
    const result = await scheduleWith("2026-02-30T09:00:00.000Z");
    expect(result.reached).toBe(false);
    expect(result.status).toBe(400);
  });

  it("refuses an impossible date without milliseconds", async () => {
    const result = await scheduleWith("2026-02-30T09:00:00Z");
    expect(result.reached).toBe(false);
    expect(result.status).toBe(400);
  });

  it("refuses a local-time string that states no zone", async () => {
    // No offset means the server would resolve it in its own, so one request
    // schedules different instants on two deployments.
    const result = await scheduleWith("2026-09-01T09:00:00");
    expect(result.reached).toBe(false);
    expect(result.status).toBe(400);
  });
});
