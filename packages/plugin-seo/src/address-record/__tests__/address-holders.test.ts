/**
 * Who holds an address, asked page by page while a list of pages is worked
 * through: read once for the whole list beforehand, and answered from that
 * read, the same as one read per address would answer.
 */
import { createHash } from "node:crypto";

import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { addressHolders, withAddressHolders } from "../participant";

/** A stored claim key, spelled as the record stores it. */
const key = (kind: string, locale: string, path: string) =>
  createHash("sha256")
    .update(`${kind}:${locale}|${path}`, "utf8")
    .digest("hex");

const ROWS = [
  {
    id: "r1",
    claimKey: key("address", "en", "/about"),
    kind: "address",
    locale: "en",
    path: "/about",
    holderCollection: "pages",
    holderId: "1",
  },
  {
    id: "r2",
    claimKey: key("range", "en", "/news"),
    kind: "range",
    locale: "en",
    path: "/news",
    holderCollection: "pages",
    holderId: "2",
  },
];

/** A context over the rows above, counting the record's reads. */
function context() {
  const reads: unknown[] = [];
  const ctx = {
    self: { collections: {} },
    publicAddresses: { defaultLanguage: async () => "en" },
    services: {
      ownCollections: {
        listEntries: async (
          _slug: string,
          query: { where: { claimKey: { in: string[] } } }
        ) => {
          reads.push(query);
          return {
            data: ROWS.filter(row =>
              query.where.claimKey.in.includes(row.claimKey)
            ),
          };
        },
      },
    },
  } as unknown as PluginContext;
  return { ctx, reads };
}

describe("who holds each of a list of addresses", () => {
  const paths = ["/about", "/news/page/2", "/contact"];

  it("is read once for the whole list", async () => {
    const { ctx, reads } = context();
    const answers = await withAddressHolders(ctx, "en", paths, () =>
      Promise.all(paths.map(path => addressHolders(ctx, path, "en")))
    );
    expect(reads).toHaveLength(1);
    expect(answers).toEqual([
      [{ collection: "pages", id: "1" }],
      [{ collection: "pages", id: "2" }],
      [],
    ]);
  });

  it("answers as one read per address does", async () => {
    const { ctx } = context();
    const each = await Promise.all(
      paths.map(path => addressHolders(ctx, path, "en"))
    );
    const together = await withAddressHolders(ctx, "en", paths, () =>
      Promise.all(paths.map(path => addressHolders(ctx, path, "en")))
    );
    expect(together).toEqual(each);
  });

  it("reads an address outside the list, or in another language, as before", async () => {
    const { ctx, reads } = context();
    await withAddressHolders(ctx, "en", ["/about"], async () => {
      await addressHolders(ctx, "/news/page/2", "en");
      await addressHolders(ctx, "/about", "fr");
    });
    expect(reads).toHaveLength(3);
  });
});
