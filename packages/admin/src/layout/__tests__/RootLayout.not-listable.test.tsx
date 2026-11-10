/**
 * The admin is never a page for search results, whatever plugins the site
 * runs. The app's admin layout exports `adminMetadata`, which puts the robots
 * tag in the head of the first HTML; `RootLayout` adds the same tag in the
 * browser only where the page has none, for an app whose layout predates that
 * export. Never a second tag, and only its own taken away again.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { ADMIN_ROBOTS, adminMetadata } from "nextly/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RootLayout } from "../RootLayout";

vi.mock("@admin/hooks/useRouter", () => ({
  useRouter: () => ({ route: null, isHydrated: false }),
}));

const layout = () => (
  <QueryClientProvider client={new QueryClient()}>
    <RootLayout />
  </QueryClientProvider>
);

/** The contents of the robots tags in the document's head. */
const robots = (): (string | null)[] =>
  Array.from(document.head.querySelectorAll('meta[name="robots"]'), tag =>
    tag.getAttribute("content")
  );

afterEach(() => {
  for (const tag of document.head.querySelectorAll("meta")) tag.remove();
});

describe("the admin's robots tag", () => {
  it("is noindex, nofollow, the same value the layout's metadata exports", () => {
    expect(ADMIN_ROBOTS).toBe("noindex, nofollow");
    expect(adminMetadata).toEqual({ robots: ADMIN_ROBOTS });
  });

  it("is added to the head where the page has none, and taken away with the admin", () => {
    const { unmount } = render(layout());
    expect(robots()).toEqual(["noindex, nofollow"]);
    unmount();
    expect(robots()).toEqual([]);
  });

  it("is not added a second time where the layout already put one in the head", () => {
    const own = document.createElement("meta");
    own.name = "robots";
    own.content = "noindex, nofollow";
    document.head.append(own);

    const { unmount } = render(layout());
    expect(robots()).toEqual(["noindex, nofollow"]);
    unmount();
    // The layout's own tag is not the admin's to take away.
    expect(document.head.contains(own)).toBe(true);
  });
});
