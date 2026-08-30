/**
 * Which authority each release route demands.
 *
 * This is the security-bearing half of the HTTP surface. The route table names
 * dispatcher operations — list, single, create, update, delete — which cannot
 * express `publish`, so the mapping from method to release authority lives in
 * the handler. A mapping that quietly said `create` for scheduling would hand
 * everyone who can assemble a release the power to ship it, and every route
 * would still work, so nothing else would notice.
 *
 * Asserted on WHAT WAS ASKED of the permission gate rather than on the response,
 * because a refusal and a wrong-permission grant can produce the same status.
 *
 * @module api/__tests__/releases-route-authority.test
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

const { handleReleaseRequest } = await import("../releases");

/** Every namespace call the handler can make, all inert. */
function namespace() {
  return {
    // The member add resolves its target document before accepting it, so the
    // fake has to answer that read. Present rather than absent: a missing
    // reader would make the case fail for a reason unrelated to authority.
    findByID: vi.fn(async (): Promise<{ id: string } | null> => ({ id: "e1" })),
    findSingle: vi.fn(
      async (): Promise<{ id: string } | null> => ({ id: "e1" })
    ),
    releases: {
      find: vi.fn(async () => []),
      findByID: vi.fn(async () => ({ id: "r1" })),
      create: vi.fn(async () => ({ id: "r1" })),
      addMember: vi.fn(async () => ({ id: "m1" })),
      removeMember: vi.fn(async () => undefined),
      listMembers: vi.fn(async () => []),
      schedule: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
    },
  };
}

let api: ReturnType<typeof namespace>;

beforeEach(() => {
  api = namespace();
  getCachedNextly.mockResolvedValue(api);
  requireAnyPermission.mockResolvedValue({ userId: "u1" });
  isErrorResponse.mockReturnValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
});

/** The single permission the handler demanded for this call. */
async function authorityFor(
  method: string,
  init?: { body?: unknown; params?: Record<string, string> }
): Promise<{ action: string; resource: string }> {
  const req = new Request("https://example.test/api/releases?limit=5", {
    method: init?.body === undefined ? "GET" : "POST",
    ...(init?.body === undefined
      ? {}
      : {
          body: JSON.stringify(init.body),
          headers: { "Content-Type": "application/json" },
        }),
  });
  await handleReleaseRequest(req, method, init?.params ?? { releaseId: "r1" });
  const asked = requireAnyPermission.mock.calls[0]?.[1] as {
    action: string;
    resource: string;
  }[];
  return asked[0];
}

describe("release route authority", () => {
  it("demands publish to schedule, not create", async () => {
    // THE case. Scheduling is the act that puts content live later; the seed
    // defines `publish-content-releases` as "schedule or cancel" precisely so it
    // can be withheld from someone allowed to assemble a release.
    expect(
      await authorityFor("scheduleRelease", {
        body: { at: "2026-09-01T09:00:00Z", timezone: "Europe/Berlin" },
      })
    ).toEqual({ action: "publish", resource: "content-releases" });
  });

  it("demands publish to cancel", async () => {
    // Someone who could cancel but not schedule could still silently stop a
    // launch, so the two share one authority.
    expect(await authorityFor("cancelRelease", { body: {} })).toEqual({
      action: "publish",
      resource: "content-releases",
    });
  });

  it("demands create to assemble, never publish", async () => {
    for (const [method, body] of [
      ["createRelease", { title: "Launch" }],
      [
        "addReleaseMember",
        {
          scopeKind: "collection",
          scopeSlug: "posts",
          entryId: "e1",
          action: "publish",
        },
      ],
    ] as const) {
      vi.clearAllMocks();
      requireAnyPermission.mockResolvedValue({ userId: "u1" });
      isErrorResponse.mockReturnValue(false);
      getCachedNextly.mockResolvedValue(api);
      expect(await authorityFor(method, { body })).toEqual({
        action: "create",
        resource: "content-releases",
      });
    }
  });

  it("demands only read to look", async () => {
    expect(await authorityFor("listReleases")).toEqual({
      action: "read",
      resource: "content-releases",
    });
  });

  it("turns the service's checks ON rather than trusting the route gate", async () => {
    // The route can only express the SYSTEM authority. Whether this caller may
    // publish the document they are adding is a question only the service can
    // ask, and it asks it only when `overrideAccess` is false.
    await authorityFor("addReleaseMember", {
      body: {
        scopeKind: "collection",
        scopeSlug: "posts",
        entryId: "e1",
        action: "publish",
      },
    });
    expect(api.releases.addMember).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", overrideAccess: false })
    );
  });

  it("refuses an unmapped method before authenticating", async () => {
    // A route added without an entry in the authority table would otherwise run
    // unauthorized. Refusing first makes the omission a 400, not a hole.
    const res = await handleReleaseRequest(
      new Request("https://example.test/api/releases"),
      "totallyNewRoute",
      {}
    );
    expect(res.status).toBe(400);
    expect(requireAnyPermission).not.toHaveBeenCalled();
  });
});

describe("release route input at the untyped boundary", () => {
  it("refuses an unrecognised state rather than widening the query", async () => {
    // A query string is whatever was sent. Dropping an unrecognised filter
    // WIDENS the request — the caller asked for one state and would receive
    // every release — and a client paging through what it believes is a
    // filtered list has no way to notice.
    const res = await handleReleaseRequest(
      new Request("https://example.test/api/releases?state=schedule"),
      "listReleases",
      {}
    );
    expect(res.status).toBe(400);
    expect(api.releases.find).not.toHaveBeenCalled();
  });

  it("passes a recognised state through", async () => {
    // The control: the guard must not refuse every state, which would make the
    // filter unusable and still pass the case above.
    await handleReleaseRequest(
      new Request("https://example.test/api/releases?state=scheduled"),
      "listReleases",
      {}
    );
    expect(api.releases.find).toHaveBeenCalledWith(
      expect.objectContaining({ state: "scheduled" })
    );
  });
});

describe("release route input validation", () => {
  async function post(
    method: string,
    body: unknown,
    params = { releaseId: "r1" }
  ) {
    return handleReleaseRequest(
      new Request("https://example.test/api/releases", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
      method,
      params
    );
  }

  it("refuses an instant that parses but is not ISO 8601", async () => {
    // `new Date("1")` is 2001-01-01 and `new Date("09/01/2026")` is
    // locale-dependent. Both are valid Dates at an instant the author never
    // chose — and a release publishes at it.
    for (const at of ["1", "09/01/2026", "next friday"]) {
      const res = await post("scheduleRelease", { at, timezone: "UTC" });
      expect(res.status, `accepted ${at}`).toBe(400);
    }
    expect(api.releases.schedule).not.toHaveBeenCalled();
  });

  it("refuses an instant with no zone, which the server would resolve in its own", async () => {
    // The case only the SHAPE check catches. "2026-09-01T09:00:00" parses, and
    // round-trips to the same calendar day, so every other guard admits it —
    // but it carries no zone, so the server resolves it locally and the same
    // request schedules different instants on two deployments.
    //
    // Added after a break-verify: disabling the shape check left the other
    // cases green, which meant the suite proved the round-trip guard and said
    // nothing about the shape one.
    const res = await post("scheduleRelease", {
      at: "2026-09-01T09:00:00",
      timezone: "UTC",
    });
    expect(res.status).toBe(400);
    expect(api.releases.schedule).not.toHaveBeenCalled();
  });

  it("refuses a date that does not exist", async () => {
    // 2026-02-30 is well-formed and normalises silently to March 2.
    const res = await post("scheduleRelease", {
      at: "2026-02-30T09:00:00Z",
      timezone: "UTC",
    });
    expect(res.status).toBe(400);
  });

  it("accepts a real ISO instant", async () => {
    // The control: the guard must not refuse every instant, which would make
    // scheduling impossible and still pass the cases above.
    const res = await post("scheduleRelease", {
      at: "2026-09-01T09:00:00Z",
      timezone: "Europe/Berlin",
    });
    expect(res.status).toBe(200);
    expect(api.releases.schedule).toHaveBeenCalled();
  });

  it("refuses a timezone the platform cannot format in", async () => {
    // A length check accepts `Europe/Berln`, which is stored, shown back to the
    // author as their intent, and throws whenever anything formats with it.
    const res = await post("scheduleRelease", {
      at: "2026-09-01T09:00:00Z",
      timezone: "Europe/Berln",
    });
    expect(res.status).toBe(400);
    expect(api.releases.schedule).not.toHaveBeenCalled();
  });

  it("refuses a non-string locale rather than widening the member", async () => {
    // Coercing a numeric locale id to `null` silently widens the member from
    // one language to the WHOLE document — the opposite of the request, and
    // indistinguishable downstream from a legitimate document-wide member.
    const res = await post("addReleaseMember", {
      scopeKind: "collection",
      scopeSlug: "posts",
      entryId: "e1",
      action: "publish",
      locale: 42,
    });
    expect(res.status).toBe(400);
    expect(api.releases.addMember).not.toHaveBeenCalled();
  });

  it("refuses a member whose target document is not there", async () => {
    // Nothing joins a member to a document, so a typo is accepted by the write
    // path and fails at the scheduled instant instead — holding the release
    // open and reporting a failure nobody is watching for.
    api.findByID.mockResolvedValueOnce(null);
    const res = await post("addReleaseMember", {
      scopeKind: "collection",
      scopeSlug: "posts",
      entryId: "gone",
      action: "publish",
    });
    expect(res.status).toBe(404);
    expect(api.releases.addMember).not.toHaveBeenCalled();
  });

  it("binds a member removal to the release in the path", async () => {
    await handleReleaseRequest(
      new Request("https://example.test/api/releases/r1/members/m1", {
        method: "DELETE",
      }),
      "removeReleaseMember",
      { releaseId: "r1", memberId: "m1" }
    );
    // Without the releaseId, `/releases/A/members/B` removes B even when it
    // belongs to release C, and the response says it worked.
    expect(api.releases.removeMember).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: "m1", releaseId: "r1" })
    );
  });

  it("forwards an API key's own grants rather than its owner's", async () => {
    requireAnyPermission.mockResolvedValueOnce({
      userId: "owner",
      authMethod: "api-key",
      permissions: ["read-content-releases"],
    });
    await handleReleaseRequest(
      new Request("https://example.test/api/releases"),
      "listReleases",
      {}
    );
    expect(api.releases.find).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["read-content-releases"],
        },
      })
    );
  });

  it("carries no scope for a session, so ordinary RBAC applies", async () => {
    // The control: stamping a scope on a session request would make every
    // session resolve against an empty permission list and be refused.
    requireAnyPermission.mockResolvedValueOnce({
      userId: "u1",
      authMethod: "session",
      permissions: [],
    });
    await handleReleaseRequest(
      new Request("https://example.test/api/releases"),
      "listReleases",
      {}
    );
    expect(api.releases.find).toHaveBeenCalledWith(
      expect.objectContaining({ authenticatedScope: undefined })
    );
  });
});
