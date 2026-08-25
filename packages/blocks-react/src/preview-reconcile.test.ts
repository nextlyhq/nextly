/**
 * That a preview surface's container is reconciled from BOTH tiers.
 *
 * The site sheet keeps this field through its own input spread, so a caller
 * stating it on the stored tier and not on the route would have the shared
 * sheet compiled for a preview while the page context compiled published rules
 * — one render carrying two answers to one breakpoint, which is the divergence
 * every other shared field is reconciled here to prevent.
 *
 * @module preview-reconcile.test
 */
import { describe, expect, it } from "vitest";

import { PREVIEW_VIEWPORT_CONTAINER } from "@nextlyhq/blocks-engine";

import { sharedStyleInputs } from "./page-renderer";

const breakpoints = { viewport: [], container: [] } as never;

describe("the preview container a render resolves", () => {
  it("is taken from the STORED tier when the route states none", () => {
    // The case that was dropped: read from the route alone, this answered
    // `undefined` while the site sheet kept the value and compiled a preview.
    const shared = sharedStyleInputs(
      { breakpoints } as never,
      {
        breakpoints,
        previewContainer: PREVIEW_VIEWPORT_CONTAINER,
      } as never
    );

    expect(shared.previewContainer).toBe(PREVIEW_VIEWPORT_CONTAINER);
  });

  it("is taken from the ROUTE when it states one", () => {
    const shared = sharedStyleInputs(
      { breakpoints, previewContainer: PREVIEW_VIEWPORT_CONTAINER } as never,
      { breakpoints } as never
    );

    expect(shared.previewContainer).toBe(PREVIEW_VIEWPORT_CONTAINER);
  });

  it("prefers the ROUTE where both state one", () => {
    // Which surface is previewing is a fact about THIS render; the stored tier
    // describes the site. A separating fixture, so a resolver picking either
    // side cannot pass both this and the case above.
    const shared = sharedStyleInputs(
      { breakpoints, previewContainer: "nx-route-box" } as never,
      { breakpoints, previewContainer: "nx-stored-box" } as never
    );

    expect(shared.previewContainer).toBe("nx-route-box");
  });

  it("omits the key entirely when neither states one", () => {
    /*
     * Omitted rather than present-and-undefined, which is the property the
     * whole resolver is built around: a context carrying the key would tell a
     * reader the question was asked and answered as "no preview", and the
     * artifact identity would then differ from one where it was never asked.
     */
    const shared = sharedStyleInputs(
      { breakpoints } as never,
      {
        breakpoints,
      } as never
    );

    expect("previewContainer" in shared).toBe(false);
  });
});
