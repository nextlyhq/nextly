/**
 * A link hands its address to the router's preloader, which starts fetching
 * the page that address leads to: so hovering or focusing a link to a page
 * not yet visited begins its download before the click.
 */
import { describe, expect, it, vi } from "vitest";

import { preloadRoute } from "../route-preload";
import { resolveRoute } from "../routing";
import { ROUTES } from "../../constants/routes";

describe("preloading a route", () => {
  it("starts fetching the page an admin address leads to", () => {
    // The router registers its own preloader as it loads.
    const page = resolveRoute(ROUTES.MEDIA, "").Component as {
      preload?: () => void;
    };
    const preload = vi.spyOn(page, "preload");

    preloadRoute(`${ROUTES.MEDIA}?page=2`);

    expect(preload).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an address outside the admin", () => {
    const page = resolveRoute(ROUTES.MEDIA, "").Component as {
      preload?: () => void;
    };
    const preload = vi.spyOn(page, "preload");

    preloadRoute("https://example.com/admin/media");

    expect(preload).not.toHaveBeenCalled();
  });
});
