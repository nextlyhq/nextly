/**
 * P7d — the Next.js middleware helper issues a 301/302 for a matched path and
 * passes through otherwise. Unit test with real next/server + a mocked fetch
 * (the lookup route).
 */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRedirectsMiddleware } from "../middleware";

afterEach(() => vi.restoreAllMocks());

function request(path: string): NextRequest {
  return new NextRequest(new URL(`https://app.test${path}`));
}

function mockLookup(body: unknown) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
}

describe("createRedirectsMiddleware", () => {
  it("redirects to the matched target with the matched status (302)", async () => {
    mockLookup({ to: "/new", type: "302" });
    const res = await createRedirectsMiddleware()(request("/old"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://app.test/new");
  });

  it("defaults to 301 and supports absolute destinations", async () => {
    mockLookup({ to: "https://example.com/", type: "301" });
    const res = await createRedirectsMiddleware()(request("/go"));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://example.com/");
  });

  it("passes through when there is no match", async () => {
    mockLookup(null);
    const res = await createRedirectsMiddleware()(request("/keep"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("passes through (never throws) when the lookup fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const res = await createRedirectsMiddleware()(request("/old"));
    expect(res.headers.get("location")).toBeNull();
  });
});
