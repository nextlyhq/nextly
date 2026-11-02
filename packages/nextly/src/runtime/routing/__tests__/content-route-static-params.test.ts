/**
 * Which failures `generateStaticParams` skips a collection for, against a
 * stubbed reader (no DB).
 *
 * The scan reads every configured collection at build time. A collection the
 * reader refuses has no public paths to pre-render, so it is skipped and its
 * entries render on demand; anything else fails the build rather than silently
 * shipping a site with pages missing. Two collections are configured so each
 * case also shows the scan carries on past the skipped one.
 */
import { describe, expect, it } from "vitest";

import type { ListResult } from "../../../direct-api/types/shared";
import { NextlyError } from "../../../errors/nextly-error";
import { createPublicContentRoute } from "../content-route";
import type { ContentEntry, NextlyContentReader } from "../resolve-content";

/** A reader that throws `failure` for `refused` and lists one row elsewhere. */
function readerRefusing(failure: unknown): NextlyContentReader {
  return {
    find: async (args): Promise<ListResult<Record<string, unknown>>> => {
      if (args.collection === "refused") throw failure;
      return {
        items: [{ id: "1", slug: "about" }],
        meta: {
          total: 1,
          page: 1,
          limit: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    },
    findByID: async () => null,
  };
}

function scan(failure: unknown) {
  return createPublicContentRoute({
    collections: ["refused", "pages"],
    nextly: readerRefusing(failure),
    render: (entry: ContentEntry) => entry,
  }).generateStaticParams();
}

describe("generateStaticParams over a collection the reader refuses", () => {
  it("skips a collection refused as forbidden", async () => {
    await expect(scan(NextlyError.forbidden())).resolves.toEqual([
      { slug: ["about"] },
    ]);
  });

  it("skips a collection refused because the visitor must sign in", async () => {
    await expect(scan(NextlyError.authRequired())).resolves.toEqual([
      { slug: ["about"] },
    ]);
  });

  it("fails the build on any other 401, which is no refusal of the content", async () => {
    for (const failure of [
      NextlyError.invalidCredentials(),
      NextlyError.tokenExpired(),
    ]) {
      await expect(scan(failure)).rejects.toBe(failure);
    }
  });

  it("fails the build on a read that broke", async () => {
    const failure = NextlyError.internal({
      logContext: { reason: "connection reset" },
    });
    await expect(scan(failure)).rejects.toBe(failure);
  });
});
