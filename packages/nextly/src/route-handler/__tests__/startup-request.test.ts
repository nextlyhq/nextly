/**
 * The startup request answers each named path through its own route, part by
 * part: one part's refusal or failure is that part's alone, the cookies a part
 * sets are passed on, and only plain paths within the admin API are answered.
 *
 * The routes are stood in for by `answer`, the function each path is sent
 * through, so what is under test is the fan-out and the assembly, not any one
 * route's checks.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import { handleStartupRequest, MAX_STARTUP_PATHS } from "../startup-request";

const BASE = "http://localhost/admin/api";

/** A startup request naming `paths`, carrying the caller's cookie. */
function startup(paths: string[]): Request {
  const query = paths.map(path => `path=${encodeURIComponent(path)}`).join("&");
  return new Request(`${BASE}/startup?${query}`, {
    headers: { cookie: "nextly_session=abc" },
  });
}

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/** The parts of a startup answer, by path. */
async function partsOf(response: Response) {
  const body = (await response.json()) as {
    parts: { path: string; status: number; body: unknown }[];
  };
  return new Map(body.parts.map(part => [part.path, part]));
}

describe("the startup request", () => {
  it("sends each path through its own route as the caller, and answers each in its own part", async () => {
    const answer = vi.fn(async (request: Request, params: string[]) =>
      json({
        asked: params,
        url: new URL(request.url).pathname + new URL(request.url).search,
        cookie: request.headers.get("cookie"),
      })
    );

    const response = await handleStartupRequest(
      startup(["/me", "/collections?limit=100&page=1"]),
      answer
    );
    const parts = await partsOf(response);

    expect(answer).toHaveBeenCalledTimes(2);
    expect(parts.get("/me")).toEqual({
      path: "/me",
      status: 200,
      body: {
        asked: ["me"],
        url: "/admin/api/me",
        cookie: "nextly_session=abc",
      },
    });
    expect(parts.get("/collections?limit=100&page=1")?.body).toMatchObject({
      asked: ["collections"],
      url: "/admin/api/collections?limit=100&page=1",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("answers a refused part with its own refusal, and the other parts as usual", async () => {
    const response = await handleStartupRequest(
      startup(["/me", "/general-settings"]),
      async (_request, params) =>
        params[0] === "general-settings"
          ? json({ error: { code: "FORBIDDEN", message: "No." } }, 403)
          : json({ id: "user-1" })
    );
    const parts = await partsOf(response);

    expect(response.status).toBe(200);
    expect(parts.get("/general-settings")).toMatchObject({
      status: 403,
      body: { error: { code: "FORBIDDEN" } },
    });
    expect(parts.get("/me")).toMatchObject({
      status: 200,
      body: { id: "user-1" },
    });
  });

  it("answers a part whose route throws with that part's error alone", async () => {
    const response = await handleStartupRequest(
      startup(["/me", "/singles?limit=100&page=1"]),
      async (_request, params) => {
        if (params[0] === "singles") throw new Error("the database went away");
        return json({ id: "user-1" });
      }
    );
    const parts = await partsOf(response);

    expect(parts.get("/singles?limit=100&page=1")).toMatchObject({
      status: 500,
      body: { error: { code: "INTERNAL_ERROR" } },
    });
    // Nothing of the cause reaches the body.
    expect(
      JSON.stringify(parts.get("/singles?limit=100&page=1"))
    ).not.toContain("database went away");
    expect(parts.get("/me")?.status).toBe(200);
  });

  it("passes on every cookie a part sets", async () => {
    const response = await handleStartupRequest(
      startup(["/auth/session", "/me"]),
      async (_request, params) => {
        const headers = new Headers({ "content-type": "application/json" });
        if (params[1] === "session") {
          headers.append("Set-Cookie", "nextly_session=new; Path=/; HttpOnly");
          headers.append("Set-Cookie", "nextly_refresh=r; Path=/; HttpOnly");
        }
        return new Response("{}", { headers });
      }
    );

    expect(response.headers.getSetCookie()).toEqual([
      "nextly_session=new; Path=/; HttpOnly",
      "nextly_refresh=r; Path=/; HttpOnly",
    ]);
  });

  it.each([
    ["no path", []],
    ["a path outside the admin API", ["https://elsewhere.test/me"]],
    ["a step up", ["/me/../../secrets"]],
    ["this route again", ["/startup?path=/me"]],
    [
      "too many paths",
      Array.from({ length: MAX_STARTUP_PATHS + 1 }, (_, i) => `/p${i}`),
    ],
  ])("refuses %s, sending nothing", async (_case, paths) => {
    const answer = vi.fn();

    // Answered with the canonical refusal, not thrown: the route's handler
    // has no boundary of its own to turn a throw into a response.
    const response = await handleStartupRequest(startup(paths), answer);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(answer).not.toHaveBeenCalled();
  });
});
