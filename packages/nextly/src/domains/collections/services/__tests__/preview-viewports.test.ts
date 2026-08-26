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

  it("offers a fractional width EXACTLY as declared", async () => {
    /*
     * The width has to match the rule the preset is named after. A site's
     * breakpoints reach here verbatim and the compiler emits
     * `@media (max-width: 767.6px)`, so rounding to 768 would sit the frame one
     * tier outside the very rule the option claims to preview — and would
     * collapse two breakpoints a fraction of a pixel apart into one option.
     */
    await expect(
      resolvePreviewViewports([{ label: "Odd", width: 767.6 }])
    ).resolves.toEqual([{ label: "Odd", width: 767.6 }]);
  });

  it("keeps two breakpoints that differ by a fraction of a pixel", async () => {
    // The consequence of the case above, stated separately: rounded, these are
    // one width, and the deduplication below would drop the second.
    await expect(
      resolvePreviewViewports([
        { label: "Narrow tablet", width: 767.6 },
        { label: "Wide tablet", width: 767.9 },
      ])
    ).resolves.toEqual([
      { label: "Narrow tablet", width: 767.6 },
      { label: "Wide tablet", width: 767.9 },
    ]);
  });

  it("keeps a sub-pixel width, because the site may really break there", async () => {
    /*
     * This replaces a rule that dropped anything rounding to zero. That rule
     * existed only because rounding could turn a positive width into `0` — an
     * option reading "0px" that previewed the full pane instead. Nothing rounds
     * now, so a declared `0.4` is offered as `0.4` and previews `0.4`: useless
     * to look at, and exactly what the site declared. The engine's own bound
     * accepts it too, so refusing it here would disagree with the sheet.
     */
    await expect(
      resolvePreviewViewports([
        { label: "Sliver", width: 0.4 },
        { label: "Real", width: 768 },
      ])
    ).resolves.toEqual([
      { label: "Sliver", width: 0.4 },
      { label: "Real", width: 768 },
    ]);
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
