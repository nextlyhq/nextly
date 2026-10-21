/**
 * The two REST operations that put several documents into a release in one
 * step: adding several at once, and scheduling a document.
 *
 * What the route owns, and so what is asserted here: the authority it asks
 * the permission gate for, that a malformed body is refused before the
 * service is reached, that the instant and the zone are held to scheduling's
 * own contract, and that the service is called as the caller with
 * `overrideAccess: false`, answered in the mutation envelope. What each step
 * then checks and writes is the service's, and is tested against a real
 * database in `release-batch-and-schedule-document.integration.test.ts`.
 *
 * @module api/__tests__/releases-batch-and-schedule-document.test
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

/** What the namespace answers: the release the step left and its members. */
const STEP = {
  release: { id: "r1", state: "scheduled", kind: "single" },
  members: [{ id: "m1", unpublishedLinks: { links: [], hiddenCount: 0 } }],
};

let addMembers: ReturnType<typeof vi.fn>;
let scheduleDocument: ReturnType<typeof vi.fn>;

beforeEach(() => {
  addMembers = vi.fn(async () => STEP);
  scheduleDocument = vi.fn(async () => STEP);
  getCachedNextly.mockResolvedValue({
    releases: { addMembers, scheduleDocument },
  });
  requireAnyPermission.mockResolvedValue({ userId: "u1", roles: ["editor"] });
  isErrorResponse.mockReturnValue(false);
});

afterEach(() => vi.clearAllMocks());

async function post(
  method: string,
  body: unknown,
  params: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await handleReleaseRequest(
    new Request("https://example.test/api/releases", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    method,
    params
  );
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  };
}

/** The permission the handler asked the gate for. */
function asked(): { action: string; resource: string } {
  const permissions = requireAnyPermission.mock.calls[0]?.[1] as {
    action: string;
    resource: string;
  }[];
  return permissions[0];
}

const DOC = {
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId: "e1",
  action: "publish",
};

describe("adding several documents in one step", () => {
  it("asks create, and hands the service each document as the caller", async () => {
    const answer = await post(
      "addReleaseMembers",
      { members: [DOC, { ...DOC, entryId: "e2", action: "unpublish" }] },
      { releaseId: "r1" }
    );
    expect(asked()).toEqual({ action: "create", resource: "content-releases" });
    expect(answer.status).toBe(201);
    expect(answer.json).toEqual({ message: "Added to release.", item: STEP });
    expect(addMembers).toHaveBeenCalledWith({
      userId: "u1",
      overrideAccess: false,
      authenticatedScope: undefined,
      userRoles: ["editor"],
      apiKeyId: undefined,
      releaseId: "r1",
      // An absent language is the whole document.
      members: [
        { ...DOC, locale: null },
        { ...DOC, entryId: "e2", action: "unpublish", locale: null },
      ],
    });
  });

  it("refuses a body that is not a list of documents, before the service", async () => {
    for (const body of [
      {},
      { members: "e1" },
      { members: [{ ...DOC, action: "publsih" }] },
      { members: [{ ...DOC, scopeKind: "page" }] },
      { members: [{ ...DOC, locale: 3 }] },
      // A field the route does not read is refused, not ignored.
      { members: [DOC], releaseId: "r2" },
      { members: [{ ...DOC, createdBy: "someone-else" }] },
    ]) {
      const answer = await post("addReleaseMembers", body, {
        releaseId: "r1",
      });
      expect(answer.status, JSON.stringify(body)).toBe(400);
    }
    expect(addMembers).not.toHaveBeenCalled();
  });
});

describe("scheduling a document in one step", () => {
  it("asks create, leaving publish to the service, and parses the instant and zone", async () => {
    const answer = await post("scheduleDocument", {
      into: "own",
      document: DOC,
      linked: [
        { scopeKind: "collection", scopeSlug: "authors", entryId: "a1" },
      ],
      title: "Hello world",
      // The shape the admin sends: `toISOString()`, with milliseconds.
      at: "2099-01-10T09:00:00.000Z",
      timezone: "Europe/Berlin",
    });
    expect(asked()).toEqual({ action: "create", resource: "content-releases" });
    expect(answer.status).toBe(201);
    expect(answer.json).toEqual({ message: "Document scheduled.", item: STEP });
    const call = scheduleDocument.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).toMatchObject({
      userId: "u1",
      overrideAccess: false,
      into: "own",
      document: DOC,
      linked: [
        { scopeKind: "collection", scopeSlug: "authors", entryId: "a1" },
      ],
      title: "Hello world",
      timezone: "Europe/Berlin",
    });
    expect(call.at).toEqual(new Date("2099-01-10T09:00:00.000Z"));
  });

  it("holds the instant and the zone to scheduling's contract", async () => {
    const own = {
      into: "own",
      document: DOC,
      title: "Hello world",
      at: "2099-01-10T09:00:00Z",
      timezone: "Europe/Berlin",
    };
    for (const body of [
      // No offset: the server's own zone would decide the instant.
      { ...own, at: "2099-01-10T09:00:00" },
      { ...own, at: "2099-02-30T09:00:00Z" },
      { ...own, timezone: "Europe/Berln" },
      { ...own, at: undefined },
    ]) {
      const answer = await post("scheduleDocument", body);
      expect(answer.status, JSON.stringify(body)).toBe(400);
    }
    expect(scheduleDocument).not.toHaveBeenCalled();
  });

  it("adds to an existing release, and makes a new one, by the body's path", async () => {
    const existing = await post("scheduleDocument", {
      into: "existing",
      document: DOC,
      releaseId: "r9",
    });
    expect(existing.status).toBe(201);
    expect(existing.json).toMatchObject({ message: "Added to release." });
    expect(scheduleDocument.mock.calls[0]?.[0]).toMatchObject({
      into: "existing",
      releaseId: "r9",
      overrideAccess: false,
    });

    const fresh = await post("scheduleDocument", {
      into: "new",
      document: DOC,
      title: "Spring",
      description: null,
    });
    expect(fresh.status).toBe(201);
    expect(scheduleDocument.mock.calls[1]?.[0]).toMatchObject({
      into: "new",
      title: "Spring",
      description: null,
    });
  });

  it("refuses a body that names no path, or a field another path takes", async () => {
    for (const body of [
      { into: "later", document: DOC },
      { document: DOC, releaseId: "r1" },
      { into: "existing", document: DOC },
      // A time belongs to the document's own release, not an existing one.
      {
        into: "existing",
        document: DOC,
        releaseId: "r1",
        at: "2099-01-10T09:00:00Z",
      },
      { into: "new", document: DOC, title: "" },
      { into: "own", document: { ...DOC, action: "go" }, title: "T" },
    ]) {
      const answer = await post("scheduleDocument", body);
      expect(answer.status, JSON.stringify(body)).toBe(400);
    }
    expect(scheduleDocument).not.toHaveBeenCalled();
  });
});
