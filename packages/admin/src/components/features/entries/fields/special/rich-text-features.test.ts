/**
 * One reading of a rich-text field's `features`, shared by the toolbar and
 * the editor's plugins: none listed offers them all, a list offers what it
 * names.
 */
import { describe, expect, it } from "vitest";

import { offersRichTextFeature } from "./rich-text-features";

describe("offersRichTextFeature", () => {
  it("offers every feature where none is listed", () => {
    expect(offersRichTextFeature(undefined, "link")).toBe(true);
    expect(offersRichTextFeature([], "link")).toBe(true);
  });

  it("offers only what a list names", () => {
    expect(offersRichTextFeature(["bold", "link"], "link")).toBe(true);
    expect(offersRichTextFeature(["bold", "italic"], "link")).toBe(false);
  });
});
