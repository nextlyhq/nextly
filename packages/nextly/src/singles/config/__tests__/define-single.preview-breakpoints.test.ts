/**
 * A Single may declare the viewports its preview offers.
 *
 * This reads as a type test because the defect was one. The mint path resolves
 * `declaration?.breakpoints` without knowing whether the declaration came from
 * a collection or a Single — `singlePreviewDeclarationFor` hands back the
 * authored block verbatim — so the feature was plumbed end to end and reachable
 * from neither `defineSingle` nor a stored Single, because this config type
 * listed only `url`, `openInNewTab` and `label`. An excess-property error is
 * what an author met, and no runtime test could have seen it.
 */
import { describe, expect, it } from "vitest";

import { resolvePreviewViewports } from "../../../domains/collections/services/preview-viewports";
import { defineSingle } from "../define-single";

describe("defineSingle — preview breakpoints", () => {
  it("accepts a static list, and the mint path resolves what it declared", async () => {
    const single = defineSingle({
      slug: "landing-page",
      label: { singular: "Landing Page" },
      fields: [{ name: "title", type: "text" }],
      admin: {
        preview: {
          url: () => "/landing",
          breakpoints: [
            { label: "Phone", width: 390 },
            { label: "Desktop", width: 1280 },
          ],
        },
      },
    });

    // Resolved through the SAME function the mint calls, so this asserts the
    // declaration is usable rather than merely storable.
    await expect(
      resolvePreviewViewports(single.admin?.preview?.breakpoints)
    ).resolves.toEqual([
      { label: "Phone", width: 390 },
      { label: "Desktop", width: 1280 },
    ]);
  });

  it("accepts the FUNCTION form, which is why the declaration exists", async () => {
    /*
     * The form that matters for a Single: a site's breakpoints are stored data
     * an author edits, so a list captured when the config was written goes
     * stale. Rejecting only the static form would have left the useful half
     * unreachable while looking fixed.
     */
    const single = defineSingle({
      slug: "landing-page",
      label: { singular: "Landing Page" },
      fields: [{ name: "title", type: "text" }],
      admin: {
        preview: {
          url: () => "/landing",
          breakpoints: async () => [{ label: "Wide", width: 1440 }],
        },
      },
    });

    await expect(
      resolvePreviewViewports(single.admin?.preview?.breakpoints)
    ).resolves.toEqual([{ label: "Wide", width: 1440 }]);
  });
});
