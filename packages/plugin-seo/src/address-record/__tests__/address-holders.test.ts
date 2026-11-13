/**
 * Who holds an address, asked page by page while a list of pages is worked
 * through: read once for the whole list beforehand, and answered from that
 * read, the same as one read per address would answer.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { addressHolders, withAddressHolders } from "../participant";

import { keepRecord, type DoubleRow } from "./record-double";

vi.mock("../store", async importOriginal => ({
  ...(await importOriginal()),
  ...(await import("./record-double")).recordDouble,
}));

const ROWS: DoubleRow[] = [
  {
    kind: "address",
    locale: "en",
    path: "/about",
    holderCollection: "pages",
    holderId: "1",
  },
  {
    kind: "range",
    locale: "en",
    path: "/news",
    holderCollection: "pages",
    holderId: "2",
  },
];

/** A context over the rows above, counting the record's reads. */
function context() {
  const ctx = {
    self: { collections: {} },
    publicAddresses: { defaultLanguage: async () => "en" },
  } as unknown as PluginContext;
  const { reads } = keepRecord(ctx, ROWS);
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
