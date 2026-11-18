/**
 * The page builder's custom CSS source for a pages route: its one checker, and
 * the site's CSS read from the site code Single as the system, so a visitor's
 * page draws what the site saved.
 */
import { describe, expect, it, vi } from "vitest";

import { pageBuilderCustomCss } from "./custom-css";
import { CUSTOM_CSS_CHECKER_ID } from "./site-code/css-check";
import { SITE_CODE_SLUG } from "./site-code/storage";

const reader = (doc: Record<string, unknown> | null) => ({
  findSingle: vi.fn(async () => doc),
});

describe("pageBuilderCustomCss", () => {
  it("is the one checker, and names the Single the site's CSS lives in", () => {
    const source = pageBuilderCustomCss({ nextly: reader(null) });
    expect(source.id).toBe(CUSTOM_CSS_CHECKER_ID);
    expect(source.singles).toEqual([SITE_CODE_SLUG]);
    expect(source.accepts("selector { color: red; }", "block")).toBe(true);
    expect(source.accepts("@import url(/a.css);", "site")).toBe(false);
  });

  it("reads the site's CSS as the system, from the site code Single", async () => {
    const nextly = reader({ css: "body { margin: 0; }" });
    expect(await pageBuilderCustomCss({ nextly }).readSite()).toBe(
      "body { margin: 0; }"
    );
    expect(nextly.findSingle).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: SITE_CODE_SLUG,
        overrideAccess: true,
        user: undefined,
        req: undefined,
      })
    );
  });

  it("reads none where the site saved none", async () => {
    expect(
      await pageBuilderCustomCss({ nextly: reader(null) }).readSite()
    ).toBeUndefined();
    expect(
      await pageBuilderCustomCss({ nextly: reader({ css: 7 }) }).readSite()
    ).toBeUndefined();
  });
});
