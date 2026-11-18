/**
 * The page builder's custom CSS source for a pages route: its one checker, so
 * a published page draws the page's and the blocks' CSS it accepts.
 */
import { describe, expect, it } from "vitest";

import { pageBuilderCustomCss } from "./custom-css";
import { CUSTOM_CSS_CHECKER_ID } from "./site-code/css-check";
import { SITE_CODE_SLUG } from "./site-code/storage";

describe("pageBuilderCustomCss", () => {
  it("is the one checker", () => {
    const source = pageBuilderCustomCss();
    expect(source.id).toBe(CUSTOM_CSS_CHECKER_ID);
    expect(source.accepts("selector { color: red; }", "block")).toBe(true);
    expect(source.accepts("@import url(/a.css);", "page")).toBe(false);
    expect(source.accepts("h2 { color: red; }", "block")).toBe(false);
  });

  it("reads no site-wide CSS, and tags the site's code settings", async () => {
    const source = pageBuilderCustomCss();
    expect(await source.readSite()).toBeUndefined();
    expect(source.singles).toEqual([SITE_CODE_SLUG]);
  });
});
