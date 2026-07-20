/**
 * Version history URLs nest under the document they belong to, and the two
 * scopes address that document differently — a Single carries no entry id,
 * because the server resolves it from the live row rather than trusting one
 * sent by the client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSpy } = vi.hoisted(() => ({ getSpy: vi.fn() }));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: getSpy },
}));

import { versionApi } from "../versionApi";

const collection = {
  kind: "collection" as const,
  slug: "posts",
  entryId: "e1",
};
const single = {
  kind: "single" as const,
  slug: "settings",
  documentId: "s1",
};

describe("versionApi.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSpy.mockResolvedValue({ items: [], meta: {} });
  });

  it("nests a collection entry's history under the entry", async () => {
    await versionApi.list(collection);

    expect(getSpy).toHaveBeenCalledWith(
      "/collections/posts/entries/e1/versions"
    );
  });

  it("addresses a Single's history without an entry id", async () => {
    // The document id is carried for cache identity only; sending it would let
    // a client name which document's history to read.
    await versionApi.list(single);

    expect(getSpy).toHaveBeenCalledWith("/singles/settings/versions");
  });

  it("sends the limit and cursor when paging", async () => {
    await versionApi.list(collection, { limit: 25, cursor: 12 });

    expect(getSpy).toHaveBeenCalledWith(
      "/collections/posts/entries/e1/versions?limit=25&cursor=12"
    );
  });

  it("omits an absent cursor rather than sending it empty", async () => {
    // The server rejects a cursor that is not a positive integer, so an unset
    // one must not reach it as the string "undefined".
    await versionApi.list(collection, { limit: 10 });

    expect(getSpy).toHaveBeenCalledWith(
      "/collections/posts/entries/e1/versions?limit=10"
    );
  });
});

describe("versionApi.get", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSpy.mockResolvedValue({ id: "v1" });
  });

  it("addresses one version of a collection entry", async () => {
    await versionApi.get(collection, 3);

    expect(getSpy).toHaveBeenCalledWith(
      "/collections/posts/entries/e1/versions/3"
    );
  });

  it("addresses one version of a Single", async () => {
    await versionApi.get(single, 2);

    expect(getSpy).toHaveBeenCalledWith("/singles/settings/versions/2");
  });
});
