/**
 * What a field rewrite's scope answers the validation core runs inside it, and
 * that nothing outside a rewrite reads from it.
 */
import { describe, expect, it, vi } from "vitest";

import type { SiteDefinitions } from "../fields/blocks-composition";

import {
  rewriteBaseline,
  siteDefinitionsInScope,
  withRewriteScope,
} from "./rewrite-scope";

const definitions = (id: string): SiteDefinitions => ({
  classIds: new Set([id]),
  breakpointIds: new Set(),
  tokenIds: new Set(),
});

describe("the rewrite scope", () => {
  it("answers the definitions read before the rewrite, without a read, inside one", async () => {
    const read = vi.fn(async () => definitions("read-now"));

    const inside = await withRewriteScope(
      { siteDefinitions: definitions("read-before"), current: null },
      () => siteDefinitionsInScope(read)
    );
    const outside = await siteDefinitionsInScope(read);

    expect([...inside.classIds]).toEqual(["read-before"]);
    expect([...outside.classIds]).toEqual(["read-now"]);
    // Read once: outside the scope, never inside it.
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("names the copy being decided for its own field only", async () => {
    const scope = {
      siteDefinitions: undefined,
      current: { field: "content", stored: { nodes: [] } },
    };

    const seen = await withRewriteScope(scope, async () => [
      rewriteBaseline("content"),
      rewriteBaseline("hero"),
    ]);

    expect(seen).toEqual([{ stored: { nodes: [] } }, undefined]);
    expect(rewriteBaseline("content")).toBeUndefined();
  });
});
