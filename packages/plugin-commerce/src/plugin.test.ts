import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { commerce } from "./plugin";
import { createInMemoryCatalogueSource } from "./testing/in-memory-catalogue-source";

function codeOf(body: () => unknown): string | undefined {
  try {
    body();
  } catch (error) {
    return NextlyError.is(error) ? String(error.code) : "not a NextlyError";
  }
  return undefined;
}

const outside = createInMemoryCatalogueSource({
  currency: "USD",
  items: [],
}).source;

describe("commerce()", () => {
  it("takes a cart lifetime of up to a year, inside the 400 days browsers keep a cookie", () => {
    expect(
      codeOf(() => commerce({ currency: "USD", cartLifetimeDays: 365 }))
    ).toBe(undefined);
    expect(
      codeOf(() => commerce({ currency: "USD", cartLifetimeDays: 366 }))
    ).toBe("VALIDATION_ERROR");
    expect(
      codeOf(() => commerce({ currency: "USD", cartLifetimeDays: 0 }))
    ).toBe("VALIDATION_ERROR");
    expect(
      codeOf(() => commerce({ currency: "USD", cartLifetimeDays: 1.5 }))
    ).toBe("VALIDATION_ERROR");
  });

  it("refuses a currency a store cannot sell in, and a malformed catalogue source", () => {
    expect(codeOf(() => commerce({ currency: "XAU" }))).toBe(
      "COMMERCE_UNKNOWN_CURRENCY"
    );
    expect(
      codeOf(() =>
        commerce({
          currency: "USD",
          catalogue: {
            ...outside,
            find: undefined,
          } as unknown as typeof outside,
        })
      )
    ).toBe("COMMERCE_PROVIDER_CONTRACT");
  });

  it("refuses a products slug that is not a lower-case slug", () => {
    expect(
      codeOf(() => commerce({ currency: "USD", productsSlug: "Products" }))
    ).toBe("VALIDATION_ERROR");
    const renamed = commerce({ currency: "USD", productsSlug: "machines" });
    expect(renamed.contributes?.collections?.map(c => c.slug)).toEqual([
      "machines",
    ]);
  });

  it("offers the catalogue listing only when the source can list", () => {
    const paths = (plugin: ReturnType<typeof commerce>) =>
      (plugin.contributes?.routes ?? []).map(r => `${r.method} ${r.path}`);
    const { list: _list, ...unlisted } = outside;
    expect(paths(commerce({ currency: "USD", catalogue: outside }))).toContain(
      "GET /catalogue"
    );
    expect(
      paths(commerce({ currency: "USD", catalogue: unlisted }))
    ).not.toContain("GET /catalogue");
  });

  it("applies the site's cart write limit to every cart write, and 60 a minute otherwise", () => {
    const writes = (plugin: ReturnType<typeof commerce>) =>
      (plugin.contributes?.routes ?? [])
        .filter(r => r.method !== "GET")
        .map(r => r.rateLimit);
    expect(writes(commerce({ currency: "USD" }))).toEqual(
      Array(4).fill({ max: 60, windowMs: 60_000 })
    );
    expect(
      writes(
        commerce({
          currency: "USD",
          cartWriteLimit: { max: 300, windowMs: 60_000 },
        })
      )
    ).toEqual(Array(4).fill({ max: 300, windowMs: 60_000 }));
    expect(
      codeOf(() =>
        commerce({ currency: "USD", cartWriteLimit: { max: 0, windowMs: 1 } })
      )
    ).toBe("VALIDATION_ERROR");
  });

  it("makes every storefront route public, uncached and rate-limited", () => {
    const routes = commerce({ currency: "USD" }).contributes?.routes ?? [];
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route).toMatchObject({ public: true, noStore: true });
      expect(route.rateLimit).toBeDefined();
    }
  });
});
