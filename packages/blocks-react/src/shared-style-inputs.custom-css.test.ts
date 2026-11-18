/**
 * A stored sheet is a cache of a compile, so its stamp keys on the custom CSS
 * the compile drew: which checker judged it, and the site's own CSS. A sheet
 * compiled under one is recompiled under another; a page drawn with no checker
 * keeps the stamp it always had.
 */
import type { CustomCssPolicy } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { sharedStyleInputsId } from "./shared-style-inputs";

const BREAKPOINTS = { viewport: [], container: [] };

const stamp = (customCss?: CustomCssPolicy) =>
  sharedStyleInputsId({
    breakpoints: BREAKPOINTS,
    ...(customCss === undefined ? {} : { customCss }),
  });

const policy = (id: string, site?: string): CustomCssPolicy => ({
  id,
  accepts: () => true,
  ...(site === undefined ? {} : { site }),
});

describe("the stamp of a stored sheet, for custom CSS", () => {
  it("is what it always was with no checker", () => {
    expect(stamp()).toBe(sharedStyleInputsId({ breakpoints: BREAKPOINTS }));
  });

  it("moves when a checker judges the compile", () => {
    expect(stamp(policy("css-check-1"))).not.toBe(stamp());
  });

  it("moves when the checker changes", () => {
    expect(stamp(policy("css-check-2"))).not.toBe(stamp(policy("css-check-1")));
  });

  it("moves when the site's CSS changes, and only then", () => {
    const a = stamp(policy("css-check-1", "body { color: red; }"));
    expect(a).not.toBe(stamp(policy("css-check-1", "body { color: blue; }")));
    expect(a).toBe(stamp(policy("css-check-1", "body { color: red; }")));
    expect(a).not.toBe(stamp(policy("css-check-1")));
  });
});
