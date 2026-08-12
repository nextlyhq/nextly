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

/**
 * The fields `applyMediaTrustBound` reads before it narrows a media row.
 *
 * Checking `trusted` alone is not enough, and the gap is not symmetric.
 * `boundRefuses` requires `overrideAccess === true` AND a refusing predicate,
 * so a call dropping EITHER stops narrowing altogether and returns the whole
 * row — the defect this file exists to catch, slipping past a check that
 * happened to look at the other field. `user` and `authenticatedScope` decide
 * whether an authorized caller keeps the row, so losing one of those narrows
 * too much instead, which is wrong in the quieter direction.
 */
const BOUND_FIELDS = [
  "overrideAccess",
  "trusted",
  "user",
  "authenticatedScope",
] as const;

/** Modules that call the Single upload expansion. */
const UPLOAD_EXPANSION_CALLERS = [
  join(SRC, "domains/singles/services/single-query-service.ts"),
  join(SRC, "domains/singles/services/single-mutation-service.ts"),
];

/**
 * The source of each `expandUploadFields(...)` CALL, arguments included.
 *
 * Read by balancing parentheses rather than by a regex, so a call spanning
 * several lines or holding a nested call is captured whole. The definition is
 * excluded by its `async` keyword: it takes the access context as a parameter
 * and would otherwise look exactly like a call that passes one.
 */
function uploadExpansionCalls(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const calls: string[] = [];

  for (const match of text.matchAll(/(async\s+)?expandUploadFields\(/g)) {
    if (match[1] !== undefined) continue;
    let depth = 0;
    const open = match.index + match[0].length - 1;
    for (let i = open; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") {
        depth--;
        if (depth === 0) {
          calls.push(text.slice(open, i + 1));
          break;
        }
      }
    }
  }

  return calls;
}

describe("every upload expansion carries the caller", () => {
  it("is exercised — the Single services do expand uploads", () => {
    const total = UPLOAD_EXPANSION_CALLERS.reduce(
      (sum, file) => sum + uploadExpansionCalls(file).length,
      0
    );
    expect(total).toBeGreaterThanOrEqual(2);
  });

  it.each(UPLOAD_EXPANSION_CALLERS)("passes the bound in %s", file => {
    // The access context is OPTIONAL on the expansion, so omitting it is not a
    // type error — it silently selects the unbounded default. The read and the
    // write path each reach it separately, and the relationship expansion
    // beside it returns early when a Single holds no relationship field, so a
    // bound threaded only there reaches nothing for an uploads-only Single.
    for (const call of uploadExpansionCalls(file)) {
      for (const field of BOUND_FIELDS) {
        expect(
          call.includes(`${field}:`),
          `An expandUploadFields call in ${file} omits \`${field}\`. Each of ` +
            "these is read before a media row is narrowed, so a call missing " +
            "any of them expands media as a different caller than the one " +
            "that asked:\n" +
            call
        ).toBe(true);
      }
    }
  });
});
