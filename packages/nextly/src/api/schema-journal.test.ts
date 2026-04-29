// F10 PR 4 — schema-journal route handler tests.
//
// Mocks the auth middleware + super-admin check + DI container so we
// can exercise the handler's auth/permission/validation paths in
// isolation. Real-DB roundtrip is covered by the
// `migration-journal-roundtrip.integration.test.ts` from F10 PR 2.

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

vi.mock("../init", () => ({
  getNextly: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../di", () => ({
  container: {
    get: vi.fn(),
  },
}));

vi.mock("../services/lib/permissions", () => ({
  isSuperAdmin: vi.fn(),
}));

vi.mock("../domains/schema/journal/read-journal.js", () => ({
  readJournal: vi.fn(),
}));

import { requireAuthentication, isErrorResponse } from "../auth/middleware";
import { container } from "../di";
import { readJournal } from "../domains/schema/journal/read-journal.js";
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
    const json = (await res.json()) as { data: unknown };
    expect(json.data).toEqual({
      rows: [{ id: "id-1", source: "ui", status: "success" }],
      hasMore: false,
    });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Vary")).toBe("Cookie");
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

    await getSchemaJournal(
      makeReq("http://x/api/schema/journal?limit=50")
    );

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

    await getSchemaJournal(
      makeReq("http://x/api/schema/journal?limit=20.7")
    );

    expect(readJournal).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20 })
    );
  });
});
