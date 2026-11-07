/**
 * The content route's provider: the addresses it pre-renders are those under
 * the route's mount, counted toward the limit only once filtered, so paths
 * elsewhere in the store never crowd out the ones the route serves.
 */
import { describe, expect, it } from "vitest";

import { CONTENT_ADDRESS_SERVICE } from "./address-claims/content-addresses";
import { PAGE_BUILDER_PLUGIN_NAME } from "./library-contract";
import { pageBuilderContent } from "./page-content";

/** A store of 500 addresses elsewhere, then two under `/site`. */
function instance() {
  const elsewhere = Array.from({ length: 500 }, (_, at) => ["blog", `p${at}`]);
  const all = [...elsewhere, ["site", "about"], ["site", "news"]];
  return {
    plugins: {
      [PAGE_BUILDER_PLUGIN_NAME]: {
        [CONTENT_ADDRESS_SERVICE]: {
          holderAt: async () => null,
          addresses: async (
            _locale: string | undefined,
            { limit, page = 1 }: { limit: number; page?: number }
          ) => ({
            paths: all.slice((page - 1) * limit, page * limit),
            total: all.length,
          }),
        },
      },
    },
    find: async () => ({ items: [] }),
  };
}

describe("the addresses a mounted route pre-renders", () => {
  it("are the ones under its mount, however many lie elsewhere", async () => {
    const content = pageBuilderContent({ nextly: instance() });
    expect(await content.addresses(undefined, 2, ["site"])).toEqual([
      ["site", "about"],
      ["site", "news"],
    ]);
  });

  it("stop at the limit", async () => {
    const content = pageBuilderContent({ nextly: instance() });
    expect(await content.addresses(undefined, 1, ["site"])).toEqual([
      ["site", "about"],
    ]);
    expect(await content.addresses(undefined, 3, [])).toHaveLength(3);
  });
});
