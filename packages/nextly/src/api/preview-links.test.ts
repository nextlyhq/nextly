/**
 * Preview-link minting and revocation.
 *
 * What matters here is which gate each endpoint asks for and what it does with
 * the answer, because a preview link is a bearer credential: anyone holding one
 * reads the draft it names, with no session of their own.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./route-auth", () => ({
  requireRouteCollectionAccess: vi.fn(),
  requireRoutePermission: vi.fn(),
}));

vi.mock("../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../di", () => ({
  container: { get: vi.fn(), has: vi.fn().mockReturnValue(false) },
}));

vi.mock("../lib/env", () => ({
  env: { NEXTLY_SECRET: "a-test-secret-value" },
}));

import { container } from "../di";

import {
  requireRouteCollectionAccess,
  requireRoutePermission,
} from "./route-auth";

import { mintPreviewLink, revokePreviewLinks } from "./preview-links";

const getGeneration = vi.fn();
const revokeAll = vi.fn();

function post(
  body: unknown,
  path = "http://x/api/nextly/preview-links"
): Request {
  return new Request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  getGeneration.mockResolvedValue(0);
  revokeAll.mockResolvedValue(1);
  (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
    getPreviewTokenGeneration: getGeneration,
    revokeAllPreviewTokens: revokeAll,
  });
});

describe("mintPreviewLink", () => {
  it("gates on update for the collection that was named", async () => {
    // Per collection, not a blanket permission: otherwise a caller who may
    // edit posts could mint a link into a collection they cannot read.
    await mintPreviewLink(post({ collection: "pages", entryId: "7" }));

    expect(requireRouteCollectionAccess).toHaveBeenCalledWith(
      expect.anything(),
      "update",
      "pages"
    );
  });

  it("does not mint when the gate refuses", async () => {
    (
      requireRouteCollectionAccess as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("forbidden"));

    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "7" })
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    // The gate has to run BEFORE the token exists, not merely before it is
    // returned: a token that was signed and then discarded is still a token.
    expect(getGeneration).not.toHaveBeenCalled();
  });

  it("mints under the site's current generation", async () => {
    // Minting under a stale generation would issue a link that is already
    // revoked, which looks to the editor like preview is broken.
    getGeneration.mockResolvedValue(4);

    const body = await json(
      await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
    );

    expect(getGeneration).toHaveBeenCalled();
    expect(typeof body.token).toBe("string");
  });

  it("returns a token rather than a url", async () => {
    // Where the preview route is mounted is the app's decision; a url guessed
    // here would 404 on any app that mounted it elsewhere.
    const body = await json(
      await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
    );
    // `respondData` returns the object bare, so these ARE the response keys.
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "token"]);
    expect(String(body.token)).not.toContain("http");
  });

  it("refuses a ttl beyond the maximum rather than shortening it", async () => {
    // Silently clamping would leave an editor believing a link lasts longer
    // than it does, which is the failure they cannot see until it bites.
    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "7", ttlSeconds: 60 * 60 * 24 * 30 })
    );

    expect(response.status).toBe(400);
  });

  it("refuses a request naming no entry", async () => {
    const response = await mintPreviewLink(post({ collection: "pages" }));
    expect(response.status).toBe(400);
    expect(requireRouteCollectionAccess).not.toHaveBeenCalled();
  });

  it("refuses a body that is not json", async () => {
    const response = await mintPreviewLink(
      new Request("http://x/api/nextly/preview-links", {
        method: "POST",
        body: "not json",
      })
    );
    expect(response.status).toBe(400);
  });
});

describe("revokePreviewLinks", () => {
  it("gates on manage settings, not on a collection", async () => {
    // The generation is site-wide, so one editor revoking would otherwise end
    // every other editor's outstanding links.
    await revokePreviewLinks(
      post({}, "http://x/api/nextly/preview-links/revoke")
    );

    expect(requireRoutePermission).toHaveBeenCalledWith(
      expect.anything(),
      "manage",
      "settings"
    );
    expect(requireRouteCollectionAccess).not.toHaveBeenCalled();
  });

  it("does not revoke when the gate refuses", async () => {
    (requireRoutePermission as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("forbidden")
    );

    const response = await revokePreviewLinks(
      post({}, "http://x/api/nextly/preview-links/revoke")
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(revokeAll).not.toHaveBeenCalled();
  });

  it("returns the generation it moved to", async () => {
    revokeAll.mockResolvedValue(9);

    const body = await json(
      await revokePreviewLinks(
        post({}, "http://x/api/nextly/preview-links/revoke")
      )
    );

    expect(body.generation).toBe(9);
  });
});
