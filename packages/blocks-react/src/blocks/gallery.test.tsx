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

  it("declares no starting children, which follows from that asymmetry", () => {
    // A row and an accordion declare a default because their allowed child
    // names them back as its only parent, so the container is unusable until it
    // holds one. `core/image` declares no parent — the test above is that same
    // fact — so nothing about a gallery makes an image hard to reach, and a
    // seeded image with no source would be a placeholder to replace rather
    // than a container to fill.
    expect(gallery.slots?.children?.defaultBlock).toBeUndefined();
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

  it("spaces its tiles with a value that actually resolves", () => {
    // This test used to require `space.4` and was named "uses only guaranteed
    // tokens, so it resolves under every theme". The `--nx-` half was right and
    // is kept; the token half asserted a premise that does not hold.
    //
    // `defaultSiteTokens()` guarantees NOTHING today: `compileSiteSheet` — the
    // only thing that turns a token set into CSS — has zero consumers outside
    // `blocks-engine`, and `--site-` appears in no source file outside the
    // engine (positive control: `--nx-` appears in four). So a `{ $token }`
    // compiled to `var(--site-space-4)`, nothing defined it, the declaration
    // was invalid at computed-value time, and `gap` fell back to `normal` —
    // zero for a grid. The tiles touched.
    //
    // The ratchet that catches this class for every block lives in
    // `base-styles.test.tsx`; this asserts the value this block settled on.
    const declared = JSON.stringify(GALLERY_BASE_STYLES);

    expect(declared).toContain("1rem");
    expect(declared).not.toContain("$token");
    // The ADMIN namespace, which this renderer never emits — so a rule using it
    // resolves to nothing on a published page while looking right in an admin
    // preview. Three separate blocks reached for it independently.
    expect(declared).not.toContain("--nx-");
  });
});
