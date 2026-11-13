/**
 * Who holds an address, as the record says: in the language a route read the
 * page in, or the site's default language where the route named none.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { addressHolders } from "../participant";

import { keepRecord, type DoubleRow } from "./record-double";

vi.mock("../store", async importOriginal => ({
  ...(await importOriginal()),
  ...(await import("./record-double")).recordDouble,
}));

/** An address or range row as the record holds it. */
function row(
  locale: string,
  path: string,
  holderId: string,
  kind: "address" | "range" = "address"
): DoubleRow {
  return { kind, locale, path, holderCollection: "pages", holderId };
}

/**
 * A context on a site whose addresses read with no language named are held
 * in `defaultLanguage`, whose record holds `rows`.
 */
function context(rows: DoubleRow[], defaultLanguage: string) {
  const ctx = {
    self: { collections: {} },
    config: {},
    publicAddresses: { defaultLanguage: async () => defaultLanguage },
  } as unknown as PluginContext;
  keepRecord(ctx, rows);
  return ctx;
}

describe("addressHolders", () => {
  // Page b took /news in English; page a still holds it in German.
  const rows = [row("en", "/news", "b"), row("de", "/news", "a")];

  it("reads the language the route named", async () => {
    const ctx = context(rows, "en");
    expect(await addressHolders(ctx, "/news", "de")).toEqual([
      { collection: "pages", id: "a" },
    ]);
  });

  it("reads the site's default language where the route named none", async () => {
    const ctx = context(rows, "en");
    expect(await addressHolders(ctx, "/news", undefined)).toEqual([
      { collection: "pages", id: "b" },
    ]);
  });

  it("reads a default language chosen in Settings, not only in code", async () => {
    // German is the default, set in Settings: the site's config names no
    // languages, and the route named none.
    const ctx = context(rows, "de");
    expect(await addressHolders(ctx, "/news", undefined)).toEqual([
      { collection: "pages", id: "a" },
    ]);
  });

  it("names the page holding a range the address falls in", async () => {
    // Page r holds everything under /go, so /go/a is its, not page a's.
    const ctx = context(
      [row("en", "/go", "r", "range"), row("en", "/other", "a")],
      "en"
    );
    expect(await addressHolders(ctx, "/go/a", undefined)).toEqual([
      { collection: "pages", id: "r" },
    ]);
    expect(await addressHolders(ctx, "/go", undefined)).toEqual([
      { collection: "pages", id: "r" },
    ]);
    expect(await addressHolders(ctx, "/gone", undefined)).toEqual([]);
  });
});
