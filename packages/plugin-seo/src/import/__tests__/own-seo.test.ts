/**
 * The site's own types holding a field named `seo`, as Import's first step
 * names them: only those the person asking may read, so a type they can't
 * see is not revealed by its name.
 */
import { describe, expect, it } from "vitest";

import type { ImportEngine } from "../plan";
import { typesWithOwnSeo } from "../plan";

/** A collection as the listing answers it, holding a field named `seo`. */
function withOwnSeo(slug: string, plural: string) {
  return {
    slug,
    source: "code",
    labels: { plural },
    fields: [{ name: "title" }, { name: "seo" }],
  };
}

/** An engine whose site lists `rows`, asked by someone who may read `readable`. */
function engineOf(
  rows: readonly unknown[],
  readable: readonly string[]
): ImportEngine {
  return {
    ctx: {
      services: {
        collections: {
          listCollections: async () => ({
            data: rows,
            pagination: { hasMore: false },
          }),
        },
      },
    },
    actor: { mayRead: async (key: string) => readable.includes(key) },
    setup: { targets: ["pages"] },
  } as unknown as ImportEngine;
}

describe("types with a field of their own called seo", () => {
  it("names only those the person asking may read", async () => {
    const engine = engineOf(
      [withOwnSeo("legacy", "Legacy pages"), withOwnSeo("payroll", "Payroll")],
      ["legacy"]
    );
    expect(await typesWithOwnSeo(engine)).toEqual([
      { slug: "legacy", label: "Legacy pages", definedIn: "code" },
    ]);
  });
});
