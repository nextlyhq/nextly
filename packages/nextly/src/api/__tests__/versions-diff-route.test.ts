/**
 * The published diff handler answers a comparison exactly as the catch-all
 * REST route does: the same parsing, validation and baseline resolution.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { gate, compare } = vi.hoisted(() => ({
  gate: vi.fn(),
  compare: vi.fn(),
}));

vi.mock("../versions-access", async importOriginal => ({
  ...(await importOriginal<typeof import("../versions-access")>()),
  requireRouteVersionReadAccess: gate,
  compareDocumentVersions: compare,
}));

import { NextlyError } from "../../errors";
import { GET } from "../versions-diff";

function call(query: string) {
  return GET(
    new Request(
      `http://localhost/api/versions/collection/posts/e1/diff?${query}`
    ),
    { params: Promise.resolve({ kind: "collection", slug: "posts", id: "e1" }) }
  );
}

describe("GET versions diff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gate.mockResolvedValue({
      user: { id: "u1" },
      authenticatedScope: undefined,
    });
    compare.mockResolvedValue({
      from: 5,
      to: 6,
      locale: null,
      hasChanges: false,
      fields: [],
    });
  });

  it("resolves a target and a baseline through the shared comparison", async () => {
    const response = await call("to=6&baseline=previous");

    expect(response.status).toBe(200);
    expect(compare).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeKind: "collection",
        slug: "posts",
        entryId: "e1",
        query: expect.objectContaining({ to: 6, baseline: "previous" }),
      })
    );
  });

  it("answers privately to the session, its refusals included", async () => {
    // A comparison from where this person last looked differs from one
    // person to the next, and so does its NO_BASELINE.
    expect(
      (await call("to=6&baseline=previous")).headers.get("cache-control")
    ).toMatch(/private/);
    compare.mockRejectedValueOnce(
      NextlyError.validation({
        errors: [{ path: "baseline", code: "NO_BASELINE", message: "none" }],
      })
    );
    const refused = await call("to=6&baseline=last-viewed");
    expect(refused.status).toBe(400);
    expect(refused.headers.get("cache-control")).toMatch(/private/);
  });

  it("still compares an explicit pair", async () => {
    await call("from=4&to=6");

    expect(compare).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ from: 4, to: 6 }),
      })
    );
  });

  it("refuses a malformed target before the read gate runs", async () => {
    const response = await call("to=abc&baseline=previous");

    expect(response.status).toBe(400);
    expect(gate).not.toHaveBeenCalled();
    expect(compare).not.toHaveBeenCalled();
  });
});
