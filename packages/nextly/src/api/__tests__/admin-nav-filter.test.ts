import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getFilterRegistry,
  resetFilterRegistry,
  FilterSeams,
} from "../../filters";
import { applyAdminNavFilter } from "../collections-schema";

beforeEach(() => {
  resetFilterRegistry();
});

afterEach(() => {
  resetFilterRegistry();
});

describe("applyAdminNavFilter (D63 admin.nav seam)", () => {
  it("returns items unchanged when no filter is registered", async () => {
    const items = [{ slug: "posts" }, { slug: "pages" }];
    const result = await applyAdminNavFilter(items, "user-1");
    expect(result).toEqual(items);
  });

  it("a registered admin.nav filter that drops slug==='secret' filters correctly", async () => {
    getFilterRegistry().addFilter(
      FilterSeams.AdminNav,
      (items: Array<{ slug: string }>) =>
        items.filter(item => item.slug !== "secret")
    );

    const items = [{ slug: "posts" }, { slug: "secret" }, { slug: "pages" }];
    const result = await applyAdminNavFilter(items, "user-1");
    expect(result).toEqual([{ slug: "posts" }, { slug: "pages" }]);
  });

  it("a registered filter that reorders returns items in the new order", async () => {
    getFilterRegistry().addFilter(
      FilterSeams.AdminNav,
      (items: Array<{ slug: string }>) => [...items].reverse()
    );

    const items = [{ slug: "aaa" }, { slug: "bbb" }, { slug: "ccc" }];
    const result = await applyAdminNavFilter(items, "user-1");
    expect(result).toEqual([{ slug: "ccc" }, { slug: "bbb" }, { slug: "aaa" }]);
  });
});
