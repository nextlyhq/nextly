/**
 * What makes `core/gallery` worth being a block rather than a styled box.
 *
 * It delegates to `renderContainer`, so asserting that it draws a `div` passes
 * equally on a `core/box` and would keep passing if the block were deleted and
 * aliased. What separates it is the slot restriction, the ASYMMETRY of that
 * restriction, and a track list that survives compilation — the last one
 * because a property the catalog does not know is dropped in silence, which is
 * how `core/columns` once shipped a layout that did nothing.
 */
import { describe, expect, it } from "vitest";

import { gallery, GALLERY_BASE_STYLES, GALLERY_ITEM_BLOCK } from "./gallery";
import { image } from "./image";
import { coreBlocks } from "./index";

describe("core/gallery", () => {
  it("lays out pictures and refuses anything else", () => {
    // A paragraph in a gallery is laid out as though it were a photograph,
    // which reads as a broken gallery rather than a misplaced block.
    expect(gallery.slots?.children?.allow).toEqual([GALLERY_ITEM_BLOCK]);
    expect(GALLERY_ITEM_BLOCK).toBe(image.name);
  });

  it("does NOT confine core/image to itself", () => {
    // The asymmetry that separates this from the columns pair. A column has no
    // meaning outside its row, so it declares `parent`. An image belongs
    // anywhere, so a gallery naming it must not confine it — `block.ts` is
    // explicit that the two halves are independent, and this is the case that
    // relies on it.
    expect(image.parent).toBeUndefined();
  });

  it("is registered after the block its slot allows", () => {
    const names = coreBlocks.map(block => block.name);
    expect(names).toContain(gallery.name);
    expect(names.indexOf(image.name)).toBeLessThan(names.indexOf(gallery.name));
  });

  it("declares a track list the catalog can actually compile", () => {
    // The property this block would most naturally have reached for is `flex`,
    // and the catalog has NO flex item properties at all — an absent property
    // is dropped by the compiler without a word, so the layout would be silence
    // rather than an error. Grid is what survives.
    const declared = JSON.stringify(GALLERY_BASE_STYLES);

    expect(declared).toContain("gridTemplateColumns");
    expect(declared).not.toContain("flexBasis");
    expect(declared).not.toContain('"flex"');
  });

  it("reflows on the container rather than on a breakpoint", () => {
    // A gallery holds however many pictures were uploaded, and it can sit
    // inside a column or a card where a viewport breakpoint measures the wrong
    // box. `auto-fit` is what makes the count the container's business.
    const tracks = JSON.stringify(GALLERY_BASE_STYLES);

    expect(tracks).toContain("auto-fit");
    // Capped by the available width: at a container narrower than the floor a
    // bare `minmax(180px, 1fr)` makes one track wider than its parent.
    expect(tracks).toContain("min(180px, 100%)");
  });

  it("imposes no aspect ratio, so the library is not cropped to one shape", () => {
    // A default here is invisible in the editor's own preview, because the same
    // rule applies there. Uniform tiles stay available on the image itself.
    expect(JSON.stringify(GALLERY_BASE_STYLES)).not.toContain("aspectRatio");
  });

  it("uses only guaranteed tokens, so it resolves under every theme", () => {
    // `defaultSiteTokens()` guarantees space.4 but no surface or border colour,
    // and the older page-builder's grids reached for `--nx-*` — the ADMIN
    // namespace, which this renderer never emits.
    const declared = JSON.stringify(GALLERY_BASE_STYLES);

    expect(declared).toContain("space.4");
    expect(declared).not.toContain("--nx-");
  });
});
