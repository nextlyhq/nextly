/**
 * An entry preview's sharer is judged in the language the link is to.
 *
 * A link names one document and, on a site with languages, one of them. Its
 * sharer must still read and edit that document in that language when the
 * link is made and at every open, and the grant that proves it names the
 * language, so it answers for no other.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEntry = vi.hoisted(() => vi.fn());
const canUpdateEntry = vi.hoisted(() => vi.fn());

vi.mock("../../di", async importOriginal => ({
  ...(await importOriginal<typeof import("../../di")>()),
  getService: vi.fn(() => ({ getEntry, canUpdateEntry })),
}));

// The grant itself is opaque; what it is asked to name is watched instead.
vi.mock(
  "../../domains/collections/services/preview-redirect-resolver",
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import("../../domains/collections/services/preview-redirect-resolver")
      >();
    return {
      ...actual,
      previewCallerAuthorized: vi.fn(actual.previewCallerAuthorized),
    };
  }
);

import { previewCallerAuthorized } from "../../domains/collections/services/preview-redirect-resolver";
import { EVERY_TRANSLATION } from "../../domains/i18n/locale-selector";
import { assertEntryPreviewable } from "../preview-access";

const SHARER = { id: "sharer-1", roles: ["editor"], role: "editor" };

beforeEach(() => {
  vi.clearAllMocks();
  getEntry.mockResolvedValue({
    success: true,
    statusCode: 200,
    data: { id: "e1" },
  });
  canUpdateEntry.mockResolvedValue(true);
});

describe("assertEntryPreviewable, by language", () => {
  it("reads the entry in the link's language, and its grant names it", async () => {
    await assertEntryPreviewable("pages", "e1", SHARER, {
      routeAuthorized: false,
      locale: "fr",
    });

    expect(getEntry).toHaveBeenCalledTimes(1);
    expect(getEntry).toHaveBeenCalledWith(
      expect.objectContaining({ entryId: "e1", locale: "fr" })
    );
    expect(previewCallerAuthorized).toHaveBeenCalledWith(SHARER, {
      collection: "pages",
      entryId: "e1",
      locale: "fr",
    });
  });

  it("reads a link naming no language in every language, and its grant names none", async () => {
    // A link naming no language is to the entry in every language, so it is
    // read in every language, and the grant names none, so it answers only
    // for a link that names none.
    await assertEntryPreviewable("pages", "e1", SHARER, {
      routeAuthorized: false,
    });
    expect(getEntry).toHaveBeenCalledTimes(1);
    expect(getEntry.mock.calls[0][0]).toMatchObject({
      locale: EVERY_TRANSLATION,
    });
    expect(previewCallerAuthorized).toHaveBeenCalledWith(SHARER, {
      collection: "pages",
      entryId: "e1",
    });
  });
});
