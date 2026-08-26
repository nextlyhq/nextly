/**
 * The viewports a preview offers, resolved from what a collection declared.
 *
 * The cases that matter are the ones where a declaration is WRONG rather than
 * absent, because a bad viewport is not a missing feature — it is a preset that
 * sizes the frame to a width the site never uses, and an author who trusts it
 * checks a layout no visitor will see. Every rejection below is therefore a
 * silent drop of one entry rather than a refusal of the whole list: one broken
 * row must not cost an author the others.
 */
import { describe, expect, it, vi } from "vitest";

import { resolvePreviewViewports } from "../preview-viewports";

describe("resolvePreviewViewports", () => {
  it("answers with nothing when a collection declares no viewports", async () => {
    await expect(resolvePreviewViewports(undefined)).resolves.toEqual([]);
  });

  it("passes a static list through in the order it was declared", async () => {
    /*
     * Order is the author's and is not sorted here. A list read widest-first or
     * narrowest-first is a claim about how they want to work, and re-sorting it
     * would silently overrule that.
     */
    const declared = [
      { label: "Phone", width: 390 },
      { label: "Desktop", width: 1280 },
      { label: "Tablet", width: 768 },
    ];

    await expect(resolvePreviewViewports(declared)).resolves.toEqual(declared);
  });

  it("CALLS a function declaration, so it can read state that changes", async () => {
    /*
     * The whole reason a function is accepted. A site's breakpoints live in
     * stored data an author edits, so a value captured once at boot goes stale;
     * the function is evaluated per mint, where the current value is readable.
     */
    const declaration = vi.fn(() => [{ label: "Wide", width: 1440 }]);

    await expect(resolvePreviewViewports(declaration)).resolves.toEqual([
      { label: "Wide", width: 1440 },
    ]);
    expect(declaration).toHaveBeenCalledTimes(1);
  });

  it("awaits an async declaration", async () => {
    // Reading stored data is asynchronous, so the synchronous form alone would
    // force every real source through a cache nobody asked for.
    await expect(
      resolvePreviewViewports(async () => [{ label: "Wide", width: 1440 }])
    ).resolves.toEqual([{ label: "Wide", width: 1440 }]);
  });

  it("drops a row whose width is not a usable number, and KEEPS the rest", async () => {
    /*
     * The separating property. Refusing the whole list on one bad row would let
     * a single typo remove every working preset, which is the opposite of what
     * an author wants from a list.
     */
    await expect(
      resolvePreviewViewports([
        { label: "Good", width: 390 },
        { label: "Zero", width: 0 },
        { label: "Negative", width: -100 },
        { label: "NaN", width: Number.NaN },
        { label: "Infinite", width: Number.POSITIVE_INFINITY },
        { label: "Also good", width: 1280 },
      ])
    ).resolves.toEqual([
      { label: "Good", width: 390 },
      { label: "Also good", width: 1280 },
    ]);
  });

  it("drops a row with no usable label rather than showing a blank option", async () => {
    // An unlabelled option is unpickable: the control renders text, so a blank
    // one is a row the author can see and cannot identify.
    await expect(
      resolvePreviewViewports([
        { label: "  ", width: 390 },
        { label: "Real", width: 768 },
      ])
    ).resolves.toEqual([{ label: "Real", width: 768 }]);
  });

  it("rounds a fractional width, because a viewport is whole pixels", async () => {
    await expect(
      resolvePreviewViewports([{ label: "Odd", width: 767.6 }])
    ).resolves.toEqual([{ label: "Odd", width: 768 }]);
  });

  it("drops a width that ROUNDS to zero, not merely one declared as zero", async () => {
    /*
     * The check has to run on the rounded value, because rounding is what makes
     * a row unusable here: `0.4` is a positive finite number and passes every
     * test asked of the declared value, then becomes `0`. Offered, it is a named
     * option reading "0px" that does not preview 0px — `previewFrameFit` reads
     * zero as no request at all and fills the pane — so the one preset an author
     * can prove is broken is the one that looks like it works.
     */
    await expect(
      resolvePreviewViewports([
        { label: "Sliver", width: 0.4 },
        { label: "Real", width: 768 },
      ])
    ).resolves.toEqual([{ label: "Real", width: 768 }]);
  });

  it("keeps a width that rounds UP to one pixel", async () => {
    // The control on the case above: rejecting the rounded value must not
    // reject everything below a pixel, only what rounds away to nothing.
    await expect(
      resolvePreviewViewports([{ label: "Hair", width: 0.6 }])
    ).resolves.toEqual([{ label: "Hair", width: 1 }]);
  });

  it("keeps the FIRST of two rows at the same width", async () => {
    /*
     * Two names for one width are indistinguishable once chosen — the frame is
     * the same size either way — so the second is noise in a control that has
     * to stay compact. First wins because the author wrote it first.
     */
    await expect(
      resolvePreviewViewports([
        { label: "Tablet", width: 768 },
        { label: "iPad", width: 768 },
        { label: "Phone", width: 390 },
      ])
    ).resolves.toEqual([
      { label: "Tablet", width: 768 },
      { label: "Phone", width: 390 },
    ]);
  });

  it("answers with nothing when a declaration THROWS, rather than failing the mint", async () => {
    /*
     * A viewport list is a convenience on a credential handout. A declaration
     * that throws must cost the author their presets, never their preview — the
     * mint is what the pane cannot work without.
     */
    await expect(
      resolvePreviewViewports(() => {
        throw new Error("author bug");
      })
    ).resolves.toEqual([]);
  });

  it("answers with nothing when the declaration is not a list at all", async () => {
    // Stored data reaches here unvalidated; a string or an object is a
    // configuration fault, and refusing it silently is the same trade as above.
    await expect(resolvePreviewViewports("1280" as never)).resolves.toEqual([]);
    await expect(
      resolvePreviewViewports(async () => "no" as never)
    ).resolves.toEqual([]);
  });
});
