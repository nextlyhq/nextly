/**
 * A refusal at the route gate of a history read belongs to one caller.
 *
 * A history page and a comparison answer one person (where they last looked),
 * so their answers carry `private, no-store` and vary on the credentials. A
 * refusal from the gate, before dispatch, is that caller's too: a shared cache
 * replaying one person's 403 to another hides from them what they may read.
 * The collection gate is replaced by one that refuses everyone, so each
 * request is answered by the gate alone, before any database is reached.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("../auth/middleware", async importOriginal => {
  const actual = await importOriginal<typeof import("../auth/middleware")>();
  return {
    ...actual,
    requireCollectionAccess: vi.fn(async () => ({
      statusCode: 403,
      error: "Forbidden",
    })),
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

async function refusal(path: string) {
  const handlers = createDynamicHandlers({
    config: sanitizeConfig({ collections: [] }),
  });
  const response = await handlers.GET(
    new Request(`http://localhost/api/${path}`, { method: "GET" }),
    { params: Promise.resolve({ params: path.split("?")[0]!.split("/") }) }
  );
  expect(response.status).toBe(403);
  return response;
}

describe("a refused history read at the route gate", () => {
  it.each([
    ["an entry's history", "collections/posts/entries/e1/versions"],
    [
      "an entry's comparison",
      "collections/posts/entries/e1/versions/diff?from=1&to=2",
    ],
    ["a Single's history", "singles/masthead/versions"],
    ["a Single's comparison", "singles/masthead/versions/diff?from=1&to=2"],
  ])("is private to its caller on %s", async (_, path) => {
    const response = await refusal(path);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const vary = response.headers.get("vary") ?? "";
    expect(vary).toContain("Cookie");
    expect(vary).toContain("Authorization");
  });

  it("leaves a refusal of a read that answers everyone alike as it was", async () => {
    // The separating half: marking every refusal private would satisfy the
    // cases above while changing how every other route's refusal is cached.
    const response = await refusal("collections/posts/entries/e1");
    expect(response.headers.get("cache-control")).not.toBe("private, no-store");
  });
});
