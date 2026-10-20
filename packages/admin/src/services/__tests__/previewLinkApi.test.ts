/**
 * The requests the preview-link client sends, which the server's routes are
 * matched against: which path each one names and which document it carries.
 * The site-wide revoke-all sends `{}`, which the server keeps reading as the
 * site-wide revoke, so naming a document is the only way to reach one page's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@admin/lib/api/protectedApi", () => ({ protectedApi: api }));

import { previewLinkApi } from "../previewLinkApi";

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ items: [], meta: { total: 0 } });
  api.post.mockResolvedValue({ item: {} });
});

describe("previewLinkApi", () => {
  it("lists an entry's links by collection and id", async () => {
    await previewLinkApi.list({ collection: "posts", entryId: "e 1" });
    expect(api.get).toHaveBeenCalledWith(
      "/preview-links?collection=posts&entryId=e+1"
    );
  });

  it("lists a Single's links by slug, in the translation being edited", async () => {
    await previewLinkApi.list({ single: "home", locale: "fr" });
    expect(api.get).toHaveBeenCalledWith(
      "/preview-links?single=home&locale=fr"
    );
  });

  it("revokes one link by its id, naming the document it belongs to", async () => {
    await previewLinkApi.revoke("ab/cd", {
      collection: "posts",
      entryId: "e1",
    });
    expect(api.post).toHaveBeenCalledWith("/preview-links/ab%2Fcd/revoke", {
      collection: "posts",
      entryId: "e1",
    });
  });

  it("revokes one document's links by naming it, and the site's by naming none", async () => {
    await previewLinkApi.revokeDocument({ single: "home" });
    expect(api.post).toHaveBeenCalledWith("/preview-links/revoke", {
      single: "home",
    });

    await previewLinkApi.revokeAll();
    expect(api.post).toHaveBeenLastCalledWith("/preview-links/revoke", {});
  });
});
