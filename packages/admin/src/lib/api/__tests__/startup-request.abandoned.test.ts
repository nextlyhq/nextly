// @vitest-environment jsdom

/**
 * A startup request abandoned for a retry ("Try again" while it hangs) lets go
 * of everything waiting on it, its headers included: the device memory then
 * asks for them with a request of its own, so the page that recovers still
 * learns the site's switch and the versions its memory is labelled with.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  confirmLabels,
  recallMenu,
  rememberMenu,
  resetDeviceMemoryForTests,
  type RememberedMenu,
} from "../../device-memory/device-memory";
import { confirmDeviceMemory } from "../../device-memory/server-answer";
import {
  abandonStartupRequest,
  beginStartupRequest,
  resetStartupRequestForTests,
  startupResponseHeaders,
} from "../startup-request";

const BASE = "http://localhost/admin/api";
const fetchSpy = vi.fn();

const MENU: RememberedMenu = {
  rail: [{ id: "dashboard", label: "Dashboard", href: "/admin" }],
  parts: { collections: true, singles: false },
  collections: [{ slug: "posts", label: "Posts" }],
  singles: [],
};

/** Settles within `ms`, or says it never did. */
function within<T>(promise: Promise<T>, ms = 500): Promise<T | "never"> {
  return Promise.race([
    promise,
    new Promise<"never">(resolve => setTimeout(() => resolve("never"), ms)),
  ]);
}

beforeEach(() => {
  window.localStorage.clear();
  resetStartupRequestForTests();
  resetDeviceMemoryForTests();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a startup request abandoned for a retry", () => {
  it("answers whoever waits on its headers with no answer", async () => {
    fetchSpy.mockImplementation(() => new Promise(() => {}));
    beginStartupRequest(BASE, ["/auth/session", "/me"]);
    const waiting = startupResponseHeaders();

    abandonStartupRequest();

    expect(await within(waiting)).toBeNull();
    expect(await within(startupResponseHeaders())).toBeNull();
  });

  it("lets the device memory learn the versions from a request of its own", async () => {
    fetchSpy.mockImplementation((url: string) =>
      String(url).includes("/startup?path=%2Fauth%2Fsession&")
        ? new Promise(() => {})
        : Promise.resolve(
            new Response("{}", {
              headers: {
                "X-Nextly-Device-Memory": "on",
                "X-Nextly-Schema-Version": "4",
                "X-Nextly-Permission-Version": "p1",
              },
            })
          )
    );
    beginStartupRequest(BASE, ["/auth/session", "/me"]);
    abandonStartupRequest();

    expect(await within(confirmDeviceMemory("u1"))).toBeUndefined();
    // Labelled by the versions it learnt, the menu is kept at once.
    rememberMenu(MENU);
    resetDeviceMemoryForTests();
    confirmLabels({ user: "u1", schemaVersion: "4", permissionVersion: "p1" });
    expect(recallMenu()).toEqual(MENU);
  });
});
