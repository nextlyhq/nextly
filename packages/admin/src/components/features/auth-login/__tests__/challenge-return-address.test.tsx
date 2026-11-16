/**
 * A second-factor sign-in started on a sign-in page that was asked to return
 * somewhere lands there, as a password-only sign-in does.
 *
 * The server sent the browser to `/admin/login?next=…` from a page it opened
 * without a usable session (an OAuth callback, say). A password sign-in
 * carries no destination to the server, so the challenge answer names the
 * admin root; following that dropped the return address and left the person
 * on the dashboard instead of the page they were opening.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChallengeFlow } from "../use-resume-login";

const post = vi.hoisted(() => vi.fn());
vi.mock("@admin/lib/api/publicApi", () => ({
  publicApi: { get: vi.fn().mockResolvedValue(null), post },
}));
vi.mock("@admin/lib/api/csrf", () => ({
  getCsrfToken: async () => "csrf-token",
}));

const CALLBACK =
  "/admin/api/plugins/@nextlyhq/plugin-seo/connections/search-console/callback?code=4%2F0Ab&state=s-1";

/** Where the hook sent the browser, without actually navigating. */
let navigatedTo: string | undefined;

/** The sign-in page at `search`, recording where it is sent. */
function onSignInPage(search: string): void {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      origin: "http://localhost",
      pathname: "/admin/login",
      search,
      get href() {
        return `http://localhost/admin/login${search}`;
      },
      set href(value: string) {
        navigatedTo = value;
      },
    },
  });
}

beforeEach(() => {
  post.mockReset();
  navigatedTo = undefined;
});

describe("a second-factor sign-in on a sign-in page asked to return", () => {
  it("lands on the return address when the login named no destination", async () => {
    onSignInPage(`?${new URLSearchParams({ next: CALLBACK })}`);
    // What the server answers for a login that carried no destination.
    post.mockResolvedValue({ next: "/admin" });

    const { result } = renderHook(() => useChallengeFlow());
    const answer = await result.current.resolve({ code: "123456" });

    expect(answer).toMatchObject({ ok: true, next: CALLBACK });
    expect(navigatedTo).toBe(CALLBACK);
  });

  it("keeps a destination the login carried", async () => {
    // The control: a login that named where it was going (a provider's
    // sign-in, resumed) still goes there.
    onSignInPage(`?${new URLSearchParams({ next: CALLBACK })}`);
    post.mockResolvedValue({ next: "/admin/collections/posts" });

    const { result } = renderHook(() => useChallengeFlow());
    await result.current.resolve({ code: "123456" });

    expect(navigatedTo).toBe("/admin/collections/posts");
  });

  it("lands on the dashboard with nowhere to return to", async () => {
    onSignInPage(
      `?${new URLSearchParams({ next: "https://elsewhere.example/" })}`
    );
    post.mockResolvedValue({ next: "/admin" });

    const { result } = renderHook(() => useChallengeFlow());
    await result.current.resolve({ code: "123456" });

    expect(navigatedTo).toBe("/admin");
  });
});
