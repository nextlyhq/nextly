/**
 * A named entry the caller may not read is answered as missing, and that
 * answer belongs to one caller.
 *
 * The REST entry point tells the route gate whether the request's PATH names
 * one entry, never a query parameter: a list's `?entryId=` names nothing. And
 * a refusal answered 404 is kept private: a 404 is cacheable by default, and a
 * shared cache must not replay one caller's answer to another who may read
 * the entry. The gate is replaced by one that records what it is asked and
 * answers as the test says, so each request stops at the gate.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({
  answer: { statusCode: 404, error: "Not found.", code: "NOT_FOUND" } as {
    statusCode: number;
    error: string;
    code?: string;
  },
  asked: [] as Array<{ namesOne?: boolean } | undefined>,
}));

vi.mock("../auth/middleware", async importOriginal => {
  const actual = await importOriginal<typeof import("../auth/middleware")>();
  return {
    ...actual,
    requireCollectionAccess: vi.fn(
      async (
        _req: Request,
        _action: string,
        _slug: string,
        operation?: { namesOne?: boolean }
      ) => {
        gate.asked.push(operation);
        return gate.answer;
      }
    ),
  };
});

import { createDynamicHandlers } from "../routeHandler";
import { sanitizeConfig } from "../shared/types/config";

const ORIGINAL_DB_DIALECT = process.env.DB_DIALECT;

// sqlite is the one dialect that needs no connection string.
process.env.DB_DIALECT = "sqlite";

afterAll(() => {
  if (ORIGINAL_DB_DIALECT === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = ORIGINAL_DB_DIALECT;
});

beforeEach(() => {
  gate.asked = [];
  gate.answer = { statusCode: 404, error: "Not found.", code: "NOT_FOUND" };
});

async function get(path: string) {
  const handlers = createDynamicHandlers({
    config: sanitizeConfig({ collections: [] }),
  });
  return handlers.GET(
    new Request(`http://localhost/api/${path}`, { method: "GET" }),
    { params: Promise.resolve({ params: path.split("?")[0]!.split("/") }) }
  );
}

describe("a named entry answered as missing at the route gate", () => {
  it("is private to its caller", async () => {
    const response = await get("collections/posts/entries/e1");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary") ?? "").toContain("Cookie");
  });
});

describe("what the route gate is told a request names", () => {
  it("names one entry for a path that names one", async () => {
    await get("collections/posts/entries/e1");
    expect(gate.asked.at(-1)?.namesOne).toBe(true);
  });

  it("names none for a list, whatever its query carries", async () => {
    gate.answer = { statusCode: 403, error: "You can't do that." };
    await get("collections/posts/entries?entryId=e1");
    expect(gate.asked.at(-1)?.namesOne).toBe(false);
  });
});
