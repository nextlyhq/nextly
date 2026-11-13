/**
 * The router starts fetching a screen's code as soon as it resolves the
 * screen's address, not when the screen first renders.
 *
 * A private screen renders only once the server has confirmed the session, so
 * a page fetched on render waits for that answer before its download begins.
 * Driven through the real `useRouter` with no session at all: the page's
 * `preload` must be asked for regardless. The browser suite
 * (`e2e/tests/route-code-at-boot.spec.ts`) shows the same in a real browser
 * with the session check held.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ROUTES } from "@admin/constants/routes";
import { resolveRoute } from "@admin/lib/routing";

import { useRouter } from "../useRouter";

vi.mock("../useHydration", () => ({ useHydration: () => true }));

/** The `preload` of the page an address leads to, spied on. */
function spyOnPreload(pathname: string) {
  const page = resolveRoute(pathname, "").Component as {
    preload?: () => void;
  };
  expect(page.preload, `${pathname} is not a lazily loaded page`).toBeTypeOf(
    "function"
  );
  return vi.spyOn(page as { preload: () => void }, "preload");
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("useRouter fetching a screen's code", () => {
  it("starts the page of the address it opens on as it resolves it", () => {
    window.history.replaceState(null, "", `${ROUTES.MEDIA}?page=2`);
    const preload = spyOnPreload(ROUTES.MEDIA);

    const { unmount } = renderHook(() => useRouter());

    expect(preload).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("starts the page of each address it moves to", () => {
    window.history.replaceState(null, "", ROUTES.MEDIA);
    const { unmount } = renderHook(() => useRouter());
    const preload = spyOnPreload(ROUTES.USERS);

    window.history.pushState(null, "", ROUTES.USERS);
    window.dispatchEvent(new Event("locationchange"));

    expect(preload).toHaveBeenCalled();
    unmount();
  });

  it("starts nothing for an address outside the admin", () => {
    window.history.replaceState(null, "", "/blog");
    const preload = spyOnPreload(ROUTES.MEDIA);

    const { unmount } = renderHook(() => useRouter());

    expect(preload).not.toHaveBeenCalled();
    unmount();
  });
});
