/**
 * What the plugin-owned `pages` collection offers as preview viewports.
 *
 * The gap this closes is the one a feature can have while reading as shipped:
 * `previewViewportsFromSiteStyle` existed and was exported, and the mint path
 * resolved whatever a collection declared — but `pageBuilder()` built its pages
 * collection with a preview containing only `url`, and its options had no way to
 * supply anything else. Every preset therefore reached exactly the collections a
 * host had composed by hand, and none of the ones this plugin owns, which is the
 * primary page-builder workflow.
 */
import { describe, expect, it } from "vitest";

import { pageBuilder } from "./plugin";

/** The pages collection as the plugin contributes it. */
function pagesPreview(options?: Parameters<typeof pageBuilder>[0]) {
  const collections = pageBuilder(options).contributes?.collections ?? [];
  const pages = (
    collections as { slug?: string; admin?: { preview?: unknown } }[]
  ).find(c => c.slug === "pages");
  return pages?.admin?.preview as
    | { url?: unknown; breakpoints?: unknown }
    | undefined;
}

describe("pageBuilder — the pages collection's preview viewports", () => {
  it("offers the site's own breakpoints by default", () => {
    /*
     * A function, not a list, and that is the point: an author edits these in
     * the page builder, so a list captured when the plugin was constructed
     * would size the frame to a tier the site no longer has. It is evaluated
     * per mint, on the server, where the current value is readable.
     */
    const preview = pagesPreview({ pagePreviewPath: "/{slug}" });

    expect(typeof preview?.url).toBe("function");
    expect(typeof preview?.breakpoints).toBe("function");
  });

  it("takes a declaration of the host's own instead", () => {
    const declared = [{ label: "Kiosk", width: 1920 }];
    const preview = pagesPreview({
      pagePreviewPath: "/{slug}",
      pagePreviewBreakpoints: declared,
    });

    expect(preview?.breakpoints).toBe(declared);
  });

  it("offers none when the host says false", () => {
    /*
     * The escape hatch has to actually remove the key rather than set it to
     * something empty: `resolvePreviewViewports` reads an absent declaration as
     * "offer nothing", and the pane then falls back to Responsive and a custom
     * width — everything it can offer without inventing numbers.
     */
    const preview = pagesPreview({
      pagePreviewPath: "/{slug}",
      pagePreviewBreakpoints: false,
    });

    expect(preview).not.toBeUndefined();
    expect("breakpoints" in (preview as object)).toBe(false);
  });

  it("declares no preview at all without a path, viewports included", () => {
    // The default must not conjure a preview onto a host that mounted no
    // preview route — that installation is strictly worse off with one, because
    // the mint then succeeds and the reviewer gets a 404.
    expect(pagesPreview()).toBeUndefined();
  });
});
