/**
 * A refused background query while the sign-in form is drawn in place of a
 * private screen: the visitor is already on the form, so they are not moved
 * to the sign-in page, which would draw it afresh and lose what they typed.
 * Once the form goes, a refusal moves them as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../fetcher", () => ({ BASE_URL: "/admin/api" }));

import { authFetch, holdLoginRedirect } from "../refreshInterceptor";

const fetchSpy = vi.fn();
let navigations: string[] = [];

const refused = () =>
  new Response(
    JSON.stringify({
      error: { code: "AUTH_REQUIRED", message: "Authentication required." },
    }),
    { status: 401, headers: { "Content-Type": "application/json" } }
  );

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  navigations = [];
  // A private screen's address, where a refusal would move the visitor.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      pathname: "/admin/collections/posts",
      get href() {
        return "http://localhost/admin/collections/posts";
      },
      set href(value: string) {
        navigations.push(value);
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a refused request while the sign-in form is drawn in place", () => {
  it("leaves the visitor on the form, and moves them once it has gone", async () => {
    const release = holdLoginRedirect();
    fetchSpy.mockResolvedValueOnce(refused());
    await authFetch("/admin/api/general-settings");
    expect(navigations).toEqual([]);

    release();
    fetchSpy.mockResolvedValueOnce(refused());
    await authFetch("/admin/api/general-settings");
    // The control: with nothing held, the same refusal moves the visitor.
    expect(navigations).toEqual(["/admin/login"]);
  });

  it("releases one hold once, however often its release is called", async () => {
    const first = holdLoginRedirect();
    const second = holdLoginRedirect();
    first();
    first();
    fetchSpy.mockResolvedValueOnce(refused());
    await authFetch("/admin/api/general-settings");
    // The second form is still drawn.
    expect(navigations).toEqual([]);
    second();
  });
});
