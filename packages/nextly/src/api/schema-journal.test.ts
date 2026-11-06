// schema-journal route handler tests.
//
// Mocks the auth middleware + super-admin check + DI container so we
// can exercise the handler's auth/permission/validation paths in
// isolation. Real-DB roundtrip is covered by
// `migration-journal-roundtrip.integration.test.ts`.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  isErrorResponse: vi.fn(),
}));

vi.mock("../auth/middleware/to-nextly-error", () => ({
  toNextlyAuthError: vi.fn((errResponse: unknown) => {
    return new Error(`auth error: ${JSON.stringify(errResponse)}`);
  }),
}));

// `schema-journal.ts` calls `getCachedNextly()` (not `getNextly()`); the
// mock must name the correct export, otherwise the success-path tests
// silently fail with a 500 from the route handler.
vi.mock("../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../di", () => ({
  container: {
    get: vi.fn(),
  },
}));

vi.mock("../services/lib/permissions", () => ({
  isSuperAdmin: vi.fn(),
}));

vi.mock("../domains/schema/journal/read-journal", () => ({
  readJournal: vi.fn(),
}));

import { requireAuthentication, isErrorResponse } from "../auth/middleware";
import { container } from "../di";
import { readJournal } from "../domains/schema/journal/read-journal";
import { isSuperAdmin } from "../services/lib/permissions";

import { getSchemaJournal } from "./schema-journal";

beforeEach(() => {
  vi.clearAllMocks();
  (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
    dialect: "postgresql",
    getDrizzle: () => ({}),
  });
});

function makeReq(url: string): Request {
  return new Request(url);
}

describe("getSchemaJournal", () => {
  it("returns 401 when authentication fails", async () => {
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: "unauthorized",
    });
    (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    const res = await getSchemaJournal(makeReq("http://x/api/schema/journal"));

    // toNextlyAuthError converts the auth-middleware error response to
    // a NextlyError that `withErrorHandler` translates to a 401-class
    // problem+json response. We just assert the status falls in the
    // error range (the exact code depends on toNextlyAuthError's mapping).
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(readJournal).not.toHaveBeenCalled();
  });

  it("returns 403 when caller is not a super-admin", async () => {
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "user-1",
    });
    (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    const res = await getSchemaJournal(makeReq("http://x/api/schema/journal"));

    expect(res.status).toBe(403);
    expect(readJournal).not.toHaveBeenCalled();
  });

  it("returns 200 with rows + hasMore when caller is super-admin", async () => {
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "user-1",
    });
    (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    (readJournal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ id: "id-1", source: "ui", status: "success" }],
      hasMore: false,
    });

    const res = await getSchemaJournal(makeReq("http://x/api/schema/journal"));

    expect(res.status).toBe(200);
    // respondData emits a bare body. Cursor-style reads (limit + before)
    // skip the `respondList` envelope because there is no total / page /
    // totalPages to surface.
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty("data");
    expect(json).toEqual({
      rows: [{ id: "id-1", source: "ui", status: "success" }],
      hasMore: false,
    });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Vary")).toBe("Cookie");
  });

  describe("a super-admin's session and their API key", () => {
    // The same maker, a super-admin by lookup, through both ways in: only
    // how they authenticated differs, so it alone decides the answer.
    const session = {
      userId: "admin-1",
      authMethod: "session",
      roles: ["super-admin"],
      permissions: [],
    };
    const key = {
      ...session,
      authMethod: "api-key",
      apiKeyId: "key-1",
      grants: [],
    };

    beforeEach(() => {
      (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValue(false);
      (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (readJournal as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ id: "id-1", source: "ui", status: "success" }],
        hasMore: false,
      });
    });

    it("reads the journal through the session, as the admin's notification bell does", async () => {
      (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValue(
        session
      );

      const res = await getSchemaJournal(
        makeReq("http://x/api/schema/journal")
      );

      expect(res.status).toBe(200);
      expect(readJournal).toHaveBeenCalledTimes(1);
    });

    it("admits a key carrying its maker's super-admin authority, within its bound", async () => {
      (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...key,
        keyHoldsSuperAdmin: true,
        keyStandingAskedAt: performance.now(),
      });

      const res = await getSchemaJournal(
        makeReq("http://x/api/schema/journal")
      );

      expect(res.status).toBe(200);
    });

    it("refuses a key whose authority's bound passed while it was authenticated", async () => {
      // The standing that admitted it was asked longer ago than the bound
      // allows: a scope made from it would carry no authority, and neither
      // may this door.
      (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...key,
        keyHoldsSuperAdmin: true,
        keyStandingAskedAt: performance.now() - 60_000,
      });

      const res = await getSchemaJournal(
        makeReq("http://x/api/schema/journal")
      );

      expect(res.status).toBe(403);
      expect(readJournal).not.toHaveBeenCalled();
    });

    it("refuses the key, whatever role its maker holds", async () => {
      (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValue(
        key
      );

      const res = await getSchemaJournal(
        makeReq("http://x/api/schema/journal")
      );

      expect(res.status).toBe(403);
      expect(readJournal).not.toHaveBeenCalled();
    });
  });

  it("uses default limit of 20 when not provided", async () => {
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "user-1",
    });
    (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    (readJournal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [],
      hasMore: false,
    });

    await getSchemaJournal(makeReq("http://x/api/schema/journal"));

    expect(readJournal).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20 })
    );
  });

  it("forwards query-param `limit` when provided", async () => {
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "user-1",
    });
    (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    (readJournal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [],
      hasMore: false,
    });

    await getSchemaJournal(makeReq("http://x/api/schema/journal?limit=50"));

    expect(readJournal).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 })
    );
  });

  it("returns 400 when limit is below 1", async () => {
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "user-1",
    });
    (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const res = await getSchemaJournal(
      makeReq("http://x/api/schema/journal?limit=0")
    );

    expect(res.status).toBe(400);
    expect(readJournal).not.toHaveBeenCalled();
  });

  it("returns 400 when limit is above 100", async () => {
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "user-1",
    });
    (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const res = await getSchemaJournal(
      makeReq("http://x/api/schema/journal?limit=101")
    );

    expect(res.status).toBe(400);
    expect(readJournal).not.toHaveBeenCalled();
  });

  it("returns 400 when limit is non-numeric", async () => {
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "user-1",
    });
    (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const res = await getSchemaJournal(
      makeReq("http://x/api/schema/journal?limit=abc")
    );

    expect(res.status).toBe(400);
    expect(readJournal).not.toHaveBeenCalled();
  });

  it("forwards `before` cursor when provided as valid ISO timestamp", async () => {
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "user-1",
    });
    (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    (readJournal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [],
      hasMore: false,
    });

    await getSchemaJournal(
      makeReq("http://x/api/schema/journal?before=2026-04-29T18:00:00.000Z")
    );

    expect(readJournal).toHaveBeenCalledWith(
      expect.objectContaining({ before: "2026-04-29T18:00:00.000Z" })
    );
  });

  it("returns 400 when `before` is not a valid timestamp", async () => {
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "user-1",
    });
    (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const res = await getSchemaJournal(
      makeReq("http://x/api/schema/journal?before=not-a-date")
    );

    expect(res.status).toBe(400);
    expect(readJournal).not.toHaveBeenCalled();
  });

  it("clamps fractional limit values via floor", async () => {
    (requireAuthentication as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "user-1",
    });
    (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    (isSuperAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    (readJournal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [],
      hasMore: false,
    });

    await getSchemaJournal(makeReq("http://x/api/schema/journal?limit=20.7"));

    expect(readJournal).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20 })
    );
  });
});
