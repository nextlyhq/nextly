/**
 * A registry page derived in memory: the filters before the total, the
 * search as `ICONTAINS` folds it, the order with `id` breaking ties, and the
 * one warning a registry too large for it earns.
 */
import { describe, expect, it, vi } from "vitest";

import {
  REGISTRY_LISTING_WARN_ROWS,
  registryPage,
  warnIfRegistryListingLarge,
  type RegistryRow,
} from "../registry-listing-page";

const ROWS: RegistryRow[] = [
  { id: "3", slug: "posts", description: "Blog Posts", createdAt: new Date(3) },
  { id: "1", slug: "pages", description: null, createdAt: new Date(1) },
  { id: "2", slug: "crème", description: "ΟΔΟΣ", createdAt: new Date(1) },
  { id: "4", slug: "news", description: "100%_done", createdAt: new Date(2) },
];

const slugs = (rows: readonly RegistryRow[]) => rows.map(row => row.slug);

describe("registryPage", () => {
  it("counts only the rows the reader may see, before paging", () => {
    const page = registryPage(ROWS, {
      include: row => row.slug !== "posts",
      orderBy: "slug",
      direction: "asc",
      offset: 1,
      limit: 1,
    });
    expect(page.total).toBe(3);
    expect(slugs(page.rows)).toEqual(["news"]);
  });

  it("orders by the column, with id breaking a tie", () => {
    const asc = registryPage(ROWS, {
      include: () => true,
      orderBy: "createdAt",
      direction: "asc",
    });
    expect(slugs(asc.rows)).toEqual(["pages", "crème", "news", "posts"]);
    const desc = registryPage(ROWS, {
      include: () => true,
      orderBy: "createdAt",
      direction: "desc",
    });
    // Newest first; the tie still broken by id ascending.
    expect(slugs(desc.rows)).toEqual(["posts", "news", "pages", "crème"]);
  });

  it("searches without regard to case, beyond ASCII, and literally", () => {
    const search = (text: string) =>
      slugs(
        registryPage(ROWS, {
          include: () => true,
          search: { text, columns: ["slug", "description"] },
          orderBy: "slug",
          direction: "asc",
        }).rows
      );
    expect(search("BLOG")).toEqual(["posts"]);
    expect(search("CRÈME")).toEqual(["crème"]);
    // A final sigma meets its capital, as `ICONTAINS` folds it.
    expect(search("οδος")).toEqual(["crème"]);
    expect(search("0%_d")).toEqual(["news"]);
    expect(search("p%s")).toEqual([]);
    expect(search("")).toEqual(["crème", "news", "pages", "posts"]);
  });

  it("changes nothing it was handed", () => {
    const before = JSON.stringify(ROWS);
    registryPage(ROWS, {
      include: () => true,
      orderBy: "slug",
      direction: "desc",
      limit: 2,
    });
    expect(JSON.stringify(ROWS)).toBe(before);
  });
});

describe("warnIfRegistryListingLarge", () => {
  it("warns once per table, and only above the limit", () => {
    const warn = vi.fn();
    warnIfRegistryListingLarge("t_at_limit", REGISTRY_LISTING_WARN_ROWS, warn);
    expect(warn).not.toHaveBeenCalled();

    warnIfRegistryListingLarge("t_large", REGISTRY_LISTING_WARN_ROWS + 1, warn);
    warnIfRegistryListingLarge(
      "t_large",
      REGISTRY_LISTING_WARN_ROWS + 50,
      warn
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("t_large");

    warnIfRegistryListingLarge("t_other", REGISTRY_LISTING_WARN_ROWS + 1, warn);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
