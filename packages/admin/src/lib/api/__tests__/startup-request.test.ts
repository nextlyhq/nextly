// @vitest-environment jsdom

/**
 * The admin's startup request, as the screens' own requests meet it.
 *
 * A GET for a path the startup request asked for takes its part instead of
 * going to the server, once; a refused part sends the request to the server
 * after all, so its own handling runs; a path it did not ask for goes straight
 * to the server without waiting for it. Observed through the shared fetcher's
 * real calls, with `fetch` stood in for, so each case counts what reached the
 * network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetcher } from "../fetcher";
import {
  beginStartupRequest,
  resetStartupRequestForTests,
} from "../startup-request";

const BASE = "http://localhost/admin/api";
const fetchSpy = vi.fn();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** The paths the network was asked for, startup request included. */
const asked = () =>
  fetchSpy.mock.calls.map(([url]) => {
    const parsed = new URL(String(url));
    return parsed.pathname.replace("/admin/api", "") + parsed.search;
  });

beforeEach(() => {
  resetStartupRequestForTests();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a screen's request after the startup request", () => {
  it("takes its part instead of asking the server, once", async () => {
    fetchSpy.mockImplementation(async (url: string) =>
      String(url).includes("/startup?")
        ? json({ parts: [{ path: "/me", status: 200, body: { id: "u1" } }] })
        : json({ id: "from-the-server" })
    );
    beginStartupRequest(BASE, ["/me"]);

    await expect(fetcher("/me", {}, false)).resolves.toEqual({ id: "u1" });
    // Taken once: the next read of the same path is the server's.
    await expect(fetcher("/me", {}, false)).resolves.toEqual({
      id: "from-the-server",
    });
    expect(asked()).toEqual(["/startup?path=%2Fme", "/me"]);
  });

  it("asks the server itself when its part was refused", async () => {
    fetchSpy.mockImplementation(async (url: string) =>
      String(url).includes("/startup?")
        ? json({
            parts: [
              {
                path: "/general-settings",
                status: 403,
                body: { error: { code: "FORBIDDEN", message: "No." } },
              },
            ],
          })
        : json({ error: { code: "FORBIDDEN", message: "No." } }, 403)
    );
    beginStartupRequest(BASE, ["/general-settings"]);

    await expect(fetcher("/general-settings", {}, false)).rejects.toBeDefined();
    expect(asked()).toEqual([
      "/startup?path=%2Fgeneral-settings",
      "/general-settings",
    ]);
  });

  it("never waits for the startup request on a path it did not ask for", async () => {
    // The startup request never answers; a request for another path must not
    // be held behind it.
    fetchSpy.mockImplementation(async (url: string) =>
      String(url).includes("/startup?")
        ? new Promise<Response>(() => undefined)
        : json({ items: [], meta: {} })
    );
    beginStartupRequest(BASE, ["/me"]);

    await expect(
      fetcher("/collections/posts/entries", {}, false)
    ).resolves.toEqual({ items: [], meta: {} });
  });

  it("sends a write to the server even when its path was asked for", async () => {
    fetchSpy.mockImplementation(async (url: string) =>
      String(url).includes("/startup?")
        ? json({ parts: [{ path: "/me", status: 200, body: { id: "u1" } }] })
        : json({ message: "Saved.", item: { id: "u1" } })
    );
    beginStartupRequest(BASE, ["/me"]);

    await fetcher("/me", { method: "PATCH", body: "{}" }, false);

    expect(asked()).toContain("/me");
  });

  it("asks the server itself when the startup request could not be answered", async () => {
    fetchSpy.mockImplementation(async (url: string) =>
      String(url).includes("/startup?")
        ? Promise.reject(new TypeError("offline"))
        : json({ id: "from-the-server" })
    );
    beginStartupRequest(BASE, ["/me"]);

    await expect(fetcher("/me", {}, false)).resolves.toEqual({
      id: "from-the-server",
    });
  });
});
