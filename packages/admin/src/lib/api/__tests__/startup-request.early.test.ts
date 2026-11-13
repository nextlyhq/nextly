// @vitest-environment jsdom

/**
 * The startup request the prebuilt page's script sent, as the admin meets it
 * once its code runs: taken, with the paths the script named, rather than
 * sent again; and sent again by the admin, once and quietly, when the
 * script's request failed or its answer cannot be read.
 *
 * Observed through the shared fetcher's real calls with `fetch` stood in for,
 * so each case counts what reached the network after the script's request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetcher } from "../fetcher";
import {
  abandonStartupRequest,
  beginStartupRequest,
  EARLY_STARTUP_SLOT,
  resetStartupRequestForTests,
  startupResponseHeaders,
} from "../startup-request";

const BASE = "http://localhost/admin/api";
const fetchSpy = vi.fn();
const slots = window as unknown as Record<string, unknown>;

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const ME_PART = { parts: [{ path: "/me", status: 200, body: { id: "u1" } }] };

/** What the page's script leaves: its paths and its request's response. */
function scriptSent(paths: unknown, response: unknown): void {
  slots[EARLY_STARTUP_SLOT] = { paths, response };
}

/** The paths the admin's code asked the network for. */
const asked = () =>
  fetchSpy.mock.calls.map(([url]) => {
    const parsed = new URL(String(url));
    return parsed.pathname.replace("/admin/api", "") + parsed.search;
  });

/** The admin's own requests answer: a startup request with `/me`, else the server's. */
function serverAnswers(): void {
  fetchSpy.mockImplementation(async (url: string) =>
    String(url).includes("/startup?")
      ? json(ME_PART, 200, { "x-from": "admin" })
      : json({ id: "from-the-server" })
  );
}

beforeEach(() => {
  resetStartupRequestForTests();
  delete slots[EARLY_STARTUP_SLOT];
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete slots[EARLY_STARTUP_SLOT];
});

describe("the startup request the page's script sent", () => {
  it("is taken: the admin sends no startup request of its own", async () => {
    serverAnswers();
    scriptSent(["/me"], Promise.resolve(json(ME_PART)));

    beginStartupRequest(BASE, ["/me"]);

    await expect(fetcher("/me", {}, false)).resolves.toEqual({ id: "u1" });
    expect(asked()).toEqual([]);
  });

  it("hands out the parts the script named, not the admin's own list", async () => {
    serverAnswers();
    // The script never answers: a path it did not name must not wait on it.
    scriptSent(["/me"], new Promise<Response>(() => undefined));

    beginStartupRequest(BASE, ["/me", "/general-settings"]);

    await expect(fetcher("/general-settings", {}, false)).resolves.toEqual({
      id: "from-the-server",
    });
    expect(asked()).toEqual(["/general-settings"]);
  });

  it("is taken once: the next page load sends its own", () => {
    serverAnswers();
    scriptSent(["/me"], Promise.resolve(json(ME_PART)));
    beginStartupRequest(BASE, ["/me"]);

    expect(slots[EARLY_STARTUP_SLOT]).toBeUndefined();
  });

  it("answers the headers from the script's response", async () => {
    serverAnswers();
    scriptSent(
      ["/me"],
      Promise.resolve(json(ME_PART, 200, { "x-from": "script" }))
    );

    beginStartupRequest(BASE, ["/me"]);

    expect((await startupResponseHeaders())?.get("x-from")).toBe("script");
  });
});

describe("a script's request that cannot be used", () => {
  const unusable: Array<[string, () => Promise<Response>]> = [
    ["failed", () => Promise.reject(new TypeError("offline"))],
    [
      "was refused as a whole",
      async () => json({ error: { code: "INTERNAL" } }, 500),
    ],
    [
      "answered with a body that is not JSON",
      async () => new Response("<html>", { status: 200 }),
    ],
    ["answered without parts", async () => json({ items: [] })],
  ];

  for (const [what, response] of unusable) {
    it(`is sent again by the admin, once, when it ${what}`, async () => {
      serverAnswers();
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      scriptSent(["/me"], response());

      beginStartupRequest(BASE, ["/me"]);

      await expect(fetcher("/me", {}, false)).resolves.toEqual({ id: "u1" });
      expect(asked()).toEqual(["/startup?path=%2Fme"]);
      expect((await startupResponseHeaders())?.get("x-from")).toBe("admin");
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    });
  }

  it("leaves each request to the server when the admin's own fails too", async () => {
    fetchSpy.mockImplementation(async (url: string) =>
      String(url).includes("/startup?")
        ? Promise.reject(new TypeError("offline"))
        : json({ id: "from-the-server" })
    );
    scriptSent(["/me"], Promise.reject(new TypeError("offline")));

    beginStartupRequest(BASE, ["/me"]);

    await expect(fetcher("/me", {}, false)).resolves.toEqual({
      id: "from-the-server",
    });
    expect(asked()).toEqual(["/startup?path=%2Fme", "/me"]);
  });

  it("is not sent again once a retry gave up on it", async () => {
    serverAnswers();
    let fail: (reason: unknown) => void = () => undefined;
    scriptSent(
      ["/me"],
      new Promise<Response>((_, reject) => {
        fail = reject;
      })
    );
    beginStartupRequest(BASE, ["/me"]);

    abandonStartupRequest();
    fail(new TypeError("offline"));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(asked()).toEqual([]);
  });
});

describe("what the script left, when it is not a startup request", () => {
  const malformed: Array<[string, unknown]> = [
    ["no paths", { response: Promise.resolve(json(ME_PART)) }],
    [
      "paths that are not strings",
      { paths: [1], response: Promise.resolve(json(ME_PART)) },
    ],
    [
      "no paths at all",
      { paths: [], response: Promise.resolve(json(ME_PART)) },
    ],
    ["a response that is not a promise", { paths: ["/me"], response: "sent" }],
    ["not an object", "sent"],
  ];

  for (const [what, left] of malformed) {
    it(`is ignored, and the admin sends its own, for ${what}`, async () => {
      serverAnswers();
      slots[EARLY_STARTUP_SLOT] = left;

      beginStartupRequest(BASE, ["/me"]);

      await expect(fetcher("/me", {}, false)).resolves.toEqual({ id: "u1" });
      expect(asked()).toEqual(["/startup?path=%2Fme"]);
      expect(slots[EARLY_STARTUP_SLOT]).toBeUndefined();
    });
  }
});
