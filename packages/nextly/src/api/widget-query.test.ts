import { beforeEach, describe, expect, it, vi } from "vitest";

// `isErrorResponse` keeps its real shape (a plain predicate, not a vi.fn())
// so the mock survives strict typing at the call site the same way
// `plugins/routes/dispatch-auth.test.ts` does -- casting a type-predicate
// import to `ReturnType<typeof vi.fn>` does not type-check.
vi.mock("../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  isErrorResponse: (x: unknown) =>
    !!x && typeof x === "object" && "statusCode" in x,
}));
vi.mock("../auth/middleware/to-nextly-error", () => ({
  toNextlyAuthError: vi.fn((e: unknown) => new Error(String(e))),
}));
vi.mock("../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));

// `vi.hoisted` (rather than a bare top-level `const`) so these survive
// Vitest hoisting `vi.mock` calls above every other statement in the file --
// a bare const referenced inside a factory below its own declaration is a
// TDZ access at the point the hoisted mock runs.
const { executeWidgetQuery } = vi.hoisted(() => ({
  executeWidgetQuery: vi.fn(),
}));
vi.mock("../domains/widgets/execute", () => ({ executeWidgetQuery }));

// `readCaller` resolves role slugs from the database. Mocked so this handler
// test exercises the batching and error isolation, not the auth stack.
const { readCaller } = vi.hoisted(() => ({ readCaller: vi.fn() }));
vi.mock("./authenticated-read", () => ({ readCaller }));

import { requireAuthentication } from "../auth/middleware";
import { clearSources, registerSource } from "../domains/widgets/sources";

import { postWidgetQuery } from "./widget-query";

const reqAuth = vi.mocked(requireAuthentication);

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/dashboard/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // `readCaller` is mocked below, so this auth context is never inspected
  // beyond `isErrorResponse`; shaped fully anyway so the mock stays typed.
  reqAuth.mockResolvedValue({
    userId: "user-1",
    permissions: [],
    roles: [],
    authMethod: "session",
  });
  readCaller.mockResolvedValue({ user: { id: "user-1", roles: ["editor"] } });
  executeWidgetQuery.mockResolvedValue({ op: "count", total: 3 });
  clearSources();
  registerSource({
    id: "collection:posts",
    label: "Posts",
    kind: "collection",
    supports: ["count", "list"],
    fields: [{ name: "status", type: "string" }],
  });
});

describe("POST /api/dashboard/query", () => {
  it("returns one result per query, positionally", async () => {
    const res = await postWidgetQuery(
      makeReq({
        queries: [
          { source: "collection:posts", op: "count" },
          { source: "collection:posts", op: "count" },
        ],
      })
    );
    const body = (await res.json()) as { results: unknown[] };
    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(2);
  });

  it("passes the resolved caller to every execution, resolving it ONCE", async () => {
    await postWidgetQuery(
      makeReq({
        queries: [
          { source: "collection:posts", op: "count" },
          { source: "collection:posts", op: "count" },
        ],
      })
    );

    // Role-slug resolution is a database read; a 20-widget dashboard must not
    // pay for it 20 times.
    expect(readCaller).toHaveBeenCalledTimes(1);
    expect(executeWidgetQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        user: expect.objectContaining({ id: "user-1" }),
      })
    );
  });

  it("isolates one failing query instead of failing the batch", async () => {
    executeWidgetQuery
      .mockResolvedValueOnce({ op: "count", total: 1 })
      .mockRejectedValueOnce(new Error("boom"));

    const res = await postWidgetQuery(
      makeReq({
        queries: [
          { source: "collection:posts", op: "count" },
          { source: "collection:posts", op: "count" },
        ],
      })
    );
    const body = (await res.json()) as {
      results: Array<{ ok: boolean; error?: string }>;
    };
    expect(body.results[0].ok).toBe(true);
    expect(body.results[1].ok).toBe(false);
    // A widget's failure is its own card's problem, not the dashboard's.
    expect(res.status).toBe(200);
  });

  it("reports an invalid query as that query's failure, not a 400 for the batch", async () => {
    const res = await postWidgetQuery(
      makeReq({ queries: [{ source: "collection:nope", op: "count" }] })
    );
    const body = (await res.json()) as {
      results: Array<{ ok: boolean; error?: string }>;
    };
    expect(res.status).toBe(200);
    expect(body.results[0].ok).toBe(false);
    expect(body.results[0].error).toMatch(/collection:nope/);
  });

  it("refuses a batch larger than the cap", async () => {
    const queries = Array.from({ length: 40 }, () => ({
      source: "collection:posts",
      op: "count",
    }));
    const res = await postWidgetQuery(makeReq({ queries }));
    expect(res.status).toBe(400);
  });
});
