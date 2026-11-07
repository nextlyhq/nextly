/**
 * The page backfill says whether it settled every page, so what relies on
 * every existing page holding its address (an entry's claim, a list's later
 * pages) waits for a pass that completed rather than one that warned.
 */
import { describe, expect, it, vi } from "vitest";

import { backfillPageClaims, type BackfillDeps } from "./backfill";

function deps(find: BackfillDeps["nextly"]["find"]): BackfillDeps {
  return {
    pages: "pages",
    claims: {} as BackfillDeps["claims"],
    locales: ["en"],
    nextly: { find },
    withTransaction: async () => {
      throw new Error("no transaction is opened for no page");
    },
    warn: vi.fn(),
  };
}

describe("the page backfill", () => {
  it("completes when it has settled every page", async () => {
    expect(await backfillPageClaims(deps(async () => ({ items: [] })))).toBe(
      true
    );
  });

  it("does not complete when the pages could not be read", async () => {
    const pass = deps(async () => {
      throw new Error("connection lost");
    });
    expect(await backfillPageClaims(pass)).toBe(false);
    expect(pass.warn).toHaveBeenCalledTimes(1);
  });

  it("does not complete when a page's claim failed", async () => {
    const pass = deps(async () => ({
      items: [{ id: "p1", slug: "about", status: "published" }],
    }));
    expect(await backfillPageClaims(pass)).toBe(false);
    expect(pass.warn).toHaveBeenCalled();
  });
});
