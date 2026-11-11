/**
 * Who holds an address, as the record says: in the language a route read the
 * page in, or the site's default language where the route named none.
 */
import { createHash } from "node:crypto";

import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { addressHolders } from "../participant";

/** An address or range row as the record stores it. */
function row(
  locale: string,
  path: string,
  holderId: string,
  kind: "address" | "range" = "address"
) {
  return {
    id: `${locale}${path}`,
    claimKey: createHash("sha256")
      .update(`${kind}:${locale}|${path}`, "utf8")
      .digest("hex"),
    kind,
    locale,
    path,
    holderCollection: "pages",
    holderId,
  };
}

type Where = {
  claimKey?: { equals?: string; in?: string[] };
  and?: [{ kind: { equals: string } }, { path: { equals: string } }];
};

/**
 * A context on a site whose addresses read with no language named are held
 * in `defaultLanguage`, whose record holds `rows`.
 */
function context(rows: ReturnType<typeof row>[], defaultLanguage: string) {
  return {
    self: { collections: {} },
    config: {},
    publicAddresses: { defaultLanguage: async () => defaultLanguage },
    services: {
      ownCollections: {
        listEntries: async (_slug: string, query: { where: Where }) => {
          const { where } = query;
          const data = rows.filter(entry =>
            where.claimKey !== undefined
              ? entry.claimKey === where.claimKey.equals ||
                (where.claimKey.in ?? []).includes(entry.claimKey)
              : entry.kind === where.and?.[0].kind.equals &&
                entry.path === where.and?.[1].path.equals
          );
          return { data };
        },
      },
    },
  } as unknown as PluginContext;
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
