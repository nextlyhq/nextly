/**
 * The headings a dashboard row is titled by: one read per collection and
 * language, as the reader, each document filed under its own language, so a
 * document saved in French is titled in French and its English heading is a
 * different one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const readableDocumentColumns = vi.fn();
const readableSingleColumns = vi.fn();

vi.mock("../../lib/readable-documents", () => ({
  readableDocumentColumns: (...args: unknown[]) =>
    readableDocumentColumns(...args) as unknown,
  readableSingleColumns: (...args: unknown[]) =>
    readableSingleColumns(...args) as unknown,
}));
// Every collection and Single is in reach: what this file asks is which
// language each document is read in, not whether it may be read.
vi.mock("../../../auth/entity-read-access", () => ({
  readAccessCaller: (caller: unknown) => caller,
  readableEntities: async (slugs: readonly string[]) => new Set(slugs),
}));

import {
  headingKey,
  type HeadingRegistries,
  readableHeadings,
} from "../readable-headings";

const caller = { user: { id: "user-1" } } as never;

const registries: HeadingRegistries = {
  getCollectionBySlug: async () => ({ admin: { useAsTitle: "title" } }),
  getSingleBySlug: async () => ({ label: "Home" }),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Each row's title says which language it was read in.
  readableDocumentColumns.mockImplementation(
    async (
      _slug: string,
      ids: string[],
      _caller: unknown,
      _columns: string[],
      locale?: string | null
    ) =>
      new Map(
        ids.map(id => [id, { id, title: `${id} in ${locale ?? "default"}` }])
      )
  );
  readableSingleColumns.mockImplementation(
    async (
      _slug: string,
      _caller: unknown,
      _columns: string[],
      locale?: string | null
    ) => ({ status: locale === "fr" ? "draft" : "published" })
  );
});

describe("a document's heading in the language it was saved in", () => {
  it("reads one document in each of its languages, and files each heading apart", async () => {
    const english = {
      kind: "collection" as const,
      slug: "posts",
      entryId: "p1",
    };
    const french = { ...english, locale: "fr" };

    const headings = await readableHeadings(
      [english, french],
      caller,
      registries
    );

    expect(headings.get(headingKey(english))?.title).toBe("p1 in default");
    expect(headings.get(headingKey(french))?.title).toBe("p1 in fr");
    // One read per language, each naming its language.
    expect(
      readableDocumentColumns.mock.calls.map(call => [call[1], call[4]])
    ).toEqual([
      [["p1"], null],
      [["p1"], "fr"],
    ]);
  });

  it("reads the entries of one collection in one language together, once", async () => {
    await readableHeadings(
      [
        { kind: "collection", slug: "posts", entryId: "p1", locale: "fr" },
        { kind: "collection", slug: "posts", entryId: "p2", locale: "fr" },
        { kind: "collection", slug: "posts", entryId: "p1", locale: "fr" },
      ],
      caller,
      registries
    );
    expect(readableDocumentColumns).toHaveBeenCalledTimes(1);
    expect(readableDocumentColumns.mock.calls[0]![1]).toEqual(["p1", "p2"]);
    expect(readableDocumentColumns.mock.calls[0]![4]).toBe("fr");
  });

  it("reads a Single in the language it was saved in", async () => {
    const french = {
      kind: "single" as const,
      slug: "home",
      entryId: "",
      locale: "fr",
    };
    const headings = await readableHeadings([french], caller, registries);
    expect(headings.get(headingKey(french))).toMatchObject({
      title: "Home",
      status: "draft",
    });
    expect(readableSingleColumns).toHaveBeenCalledWith(
      "home",
      caller,
      ["status"],
      "fr"
    );
  });
});
