/**
 * Every direct read of the media table must carry the trust bound.
 *
 * There are three, in two services, and they do not share a path: the
 * collection batch expansion, the collection single-entry expansion, and the
 * Single read's upload expansion. Each one fetches by id straight from the
 * media table, so nothing applied to the relationship fetches reaches any of
 * them, and each carries the bound or does not, independently.
 *
 * Asserted on the source rather than by rendering, for the reason a behavioural
 * test cannot cover it: a fetch missing the bound returns exactly the same row
 * as one carrying it, unless the caller is bounded AND the row has ownership or
 * filing set. A test whose fixture lacks either passes on a read that leaks —
 * which is how all three came to be written without it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..", "..");

/** Modules that read the media table by id. */
const MEDIA_READERS = [
  join(SRC, "domains/collections/services/collection-relationship-service.ts"),
  join(SRC, "domains/singles/services/single-query-service.ts"),
];

/** Calls to the media fetch, and how many of them are bound. */
function mediaFetches(file: string): { called: number; bound: number } {
  const text = readFileSync(file, "utf8");
  return {
    // The CALL form. The `private async fetchMediaByIds(` definition is not a
    // call and must not be counted as one that needs wrapping.
    called: [...text.matchAll(/await this\.fetchMediaByIds\(/g)].length,
    bound: [
      ...text.matchAll(
        /applyMediaTrustBound\(\s*await this\.fetchMediaByIds\(/g
      ),
    ].length,
  };
}

describe("every media fetch carries the trust bound", () => {
  it("is exercised — the services do read media by id", () => {
    // Without this, the assertion below passes against zero matches: a rename
    // of the fetch would silently turn this file into a guard that checks
    // nothing and reports success.
    const total = MEDIA_READERS.reduce(
      (sum, file) => sum + mediaFetches(file).called,
      0
    );
    expect(total).toBeGreaterThanOrEqual(3);
  });

  it.each(MEDIA_READERS)("binds every media fetch in %s", file => {
    const { called, bound } = mediaFetches(file);
    expect(
      bound,
      `${called} media fetches, ${bound} bound. An unbound fetch returns the ` +
        "whole media row — uploader, folder, tags — to a caller whose bypass " +
        "was narrowed to exclude media, including a public route pre-rendering " +
        "it into a static page."
    ).toBe(called);
  });
});
