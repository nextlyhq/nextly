/**
 * A collection document's readability, asked of its read in one language: as
 * the caller, nothing attested, drafts included, and with ids only. The verdict
 * is the read's report of the row it loaded, which no related row changes, so
 * a probe asked once per configured language must not read every related
 * entry and file each time.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEntry = vi.fn();

vi.mock("../../../di", () => ({
  getService: (name: string) => {
    if (name !== "collectionsHandler") throw new Error(`unexpected ${name}`);
    return { getEntry };
  },
}));

import { documentReadableIn } from "../document-readable-in";

const post = { kind: "collection" as const, slug: "posts", entryId: "e1" };
const caller = { user: { id: "u1" } } as Parameters<
  typeof documentReadableIn
>[1];

describe("documentReadableIn for a collection", () => {
  beforeEach(() => getEntry.mockReset());

  it("reads the document as the caller, in the language, with ids only", async () => {
    getEntry.mockResolvedValue({ success: true, resolvedEntryId: "e1" });

    expect(await documentReadableIn(post, caller, "fr")).toBe(true);
    expect(getEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionName: "posts",
        entryId: "e1",
        overrideAccess: false,
        routeAuthorized: false,
        status: "all",
        locale: "fr",
        depth: 0,
      })
    );
  });

  it("answers false for a refusal or a missing document", async () => {
    getEntry.mockResolvedValue({ success: false, statusCode: 404 });
    expect(await documentReadableIn(post, caller, "fr")).toBe(false);
    getEntry.mockResolvedValue({ success: false, statusCode: 403 });
    expect(await documentReadableIn(post, caller, "fr")).toBe(false);
  });

  it("answers false where the read loaded another row", async () => {
    getEntry.mockResolvedValue({ success: true, resolvedEntryId: "e2" });
    expect(await documentReadableIn(post, caller)).toBe(false);
  });
});
