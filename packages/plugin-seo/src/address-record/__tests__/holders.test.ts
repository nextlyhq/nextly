/**
 * Who holds an address, as the record says: in the language a route read the
 * page in, or the site's default language where the route named none.
 */
import { createHash } from "node:crypto";

import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { addressHolders } from "../participant";

/** An address row as the record stores it. */
function row(locale: string, path: string, holderId: string) {
  return {
    id: `${locale}${path}`,
    claimKey: createHash("sha256")
      .update(`address:${locale}|${path}`, "utf8")
      .digest("hex"),
    kind: "address",
    locale,
    path,
    holderCollection: "pages",
    holderId,
  };
}

type Where = {
  claimKey?: { equals: string };
  and?: [{ kind: { equals: string } }, { path: { equals: string } }];
};

/** A context on a site in `localization`, whose record holds `rows`. */
function context(
  rows: ReturnType<typeof row>[],
  localization: Record<string, unknown> | undefined
) {
  return {
    self: { collections: {} },
    config: { localization },
    services: {
      ownCollections: {
        listEntries: async (_slug: string, query: { where: Where }) => {
          const { where } = query;
          const data = rows.filter(entry =>
            where.claimKey !== undefined
              ? entry.claimKey === where.claimKey.equals
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
    const ctx = context(rows, { defaultLocale: "en", locales: [] });
    expect(await addressHolders(ctx, "/news", "de")).toEqual([
      { collection: "pages", id: "a" },
    ]);
  });

  it("reads the site's default language where the route named none", async () => {
    const ctx = context(rows, {
      defaultLocale: "en",
      locales: [{ code: "en" }, { code: "de" }],
    });
    expect(await addressHolders(ctx, "/news", undefined)).toEqual([
      { collection: "pages", id: "b" },
    ]);
  });

  it("reads English on a site with no languages configured", async () => {
    const ctx = context([row("en", "/about", "c")], undefined);
    expect(await addressHolders(ctx, "/about", undefined)).toEqual([
      { collection: "pages", id: "c" },
    ]);
  });
});
