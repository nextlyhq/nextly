/**
 * The sign-in page's return address: where a browser goes once it has a
 * session, when the server sent it to sign in from a page it opened (an OAuth
 * callback reached with an expired session, say) and asked to come back.
 *
 * The address arrives in the query string, which anyone can write into a
 * link, so it is held to the admin by core's own rule before it is followed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ROUTES } from "@admin/constants/routes";

import {
  afterSignInAddress,
  landingAfterSignIn,
  returnAddress,
  returnWithSession,
} from "../return-address";

const CALLBACK =
  "/admin/api/plugins/@nextlyhq/plugin-seo/connections/search-console/callback?code=4%2F0Ab&state=s-1";

function at(address: string): void {
  window.history.replaceState(null, "", address);
}

function signInReturningTo(next: string): void {
  at(`${ROUTES.LOGIN}?${new URLSearchParams({ next })}`);
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  at("/");
  vi.useRealTimers();
});

describe("returnAddress", () => {
  it("is the address the sign-in page was asked to return to", () => {
    signInReturningTo(CALLBACK);
    expect(returnAddress()).toBe(CALLBACK);
  });

  it.each([
    ["another site", "https://elsewhere.example/admin"],
    ["an address without a scheme", "//elsewhere.example/admin"],
    ["a backslash that reads as another site", "/\\elsewhere.example"],
    ["a page outside the admin", "/account"],
    ["the sign-in page itself", `${ROUTES.LOGIN}?next=/admin/x`],
    ["the admin root, where sign-in goes anyway", "/admin"],
  ])("is none for %s", (_, next) => {
    signInReturningTo(next);
    expect(returnAddress()).toBeNull();
  });

  it("is none when nothing was asked", () => {
    at(ROUTES.LOGIN);
    expect(returnAddress()).toBeNull();
  });

  it("is none on any page but the sign-in page", () => {
    at(`/admin/collections/posts?${new URLSearchParams({ next: CALLBACK })}`);
    expect(returnAddress()).toBeNull();
  });
});

describe("afterSignInAddress", () => {
  it("is the return address on the sign-in page", () => {
    signInReturningTo(CALLBACK);
    expect(afterSignInAddress()).toBe(CALLBACK);
  });

  it("is the dashboard on the sign-in page with nowhere to return to", () => {
    signInReturningTo("https://elsewhere.example/");
    expect(afterSignInAddress()).toBe(ROUTES.DASHBOARD);
  });

  it("is the screen the sign-in form was drawn in place of", () => {
    at("/admin/collections/posts?page=2");
    expect(afterSignInAddress()).toBe("/admin/collections/posts?page=2");
  });
});

describe("landingAfterSignIn", () => {
  it("is the return address when the server named only the admin root", () => {
    // What the server answers for a login that carried no destination.
    signInReturningTo(CALLBACK);
    expect(landingAfterSignIn("/admin")).toBe(CALLBACK);
    expect(landingAfterSignIn(undefined)).toBe(CALLBACK);
    expect(landingAfterSignIn(null)).toBe(CALLBACK);
  });

  it("is the destination the login carried", () => {
    signInReturningTo(CALLBACK);
    expect(landingAfterSignIn("/admin/collections/posts")).toBe(
      "/admin/collections/posts"
    );
  });

  it("is the dashboard with neither", () => {
    at(ROUTES.LOGIN);
    expect(landingAfterSignIn("/admin")).toBe(ROUTES.DASHBOARD);
  });
});

describe("returnWithSession", () => {
  it("opens the return address in place of the sign-in page", () => {
    signInReturningTo(CALLBACK);
    const open = vi.fn();

    expect(returnWithSession(open)).toBe(true);
    expect(open).toHaveBeenCalledWith(CALLBACK);
  });

  it("opens nothing with nowhere to return to", () => {
    at(ROUTES.LOGIN);
    const open = vi.fn();

    expect(returnWithSession(open)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("does not open the same address again when it sent the browser straight back", () => {
    // The address refused the session the sign-in page found. Opening it
    // again would send the browser round the same two pages for ever.
    vi.useFakeTimers({ toFake: ["Date"] });
    signInReturningTo(CALLBACK);
    const open = vi.fn();
    expect(returnWithSession(open)).toBe(true);

    vi.setSystemTime(Date.now() + 2_000);
    expect(returnWithSession(open)).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens nothing when the return cannot be remembered", () => {
    // Without the record, a return the address refuses would come straight
    // back and be opened again, for ever: the dashboard is the safe answer.
    signInReturningTo(CALLBACK);
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("refused", "SecurityError");
      });
    const open = vi.fn();
    try {
      expect(returnWithSession(open)).toBe(false);
      expect(open).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });

  it("opens it again once that return is long past", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    signInReturningTo(CALLBACK);
    const open = vi.fn();
    returnWithSession(open);

    vi.setSystemTime(Date.now() + 10 * 60_000);
    expect(returnWithSession(open)).toBe(true);
    expect(open).toHaveBeenCalledTimes(2);
  });
});
