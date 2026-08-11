/**
 * Preview-link minting and revocation.
 *
 * What matters here is which gate each endpoint asks for and what it does with
 * the answer, because a preview link is a bearer credential: anyone holding one
 * reads the draft it names, with no session of their own.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../errors/nextly-error";

vi.mock("./route-auth", () => ({
  requireRouteCollectionAccess: vi.fn(),
  requireRoutePermission: vi.fn(),
}));

const { findByID } = vi.hoisted(() => ({ findByID: vi.fn() }));

vi.mock("../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue({ findByID }),
}));

vi.mock("../services/lib/permissions", () => ({
  resolveRoleSlugs: vi.fn().mockResolvedValue(["editor"]),
}));

vi.mock("../di", () => ({
  container: { get: vi.fn(), has: vi.fn().mockReturnValue(false) },
}));

vi.mock("../lib/env", () => ({
  env: { NEXTLY_SECRET: "a-test-secret-value" },
}));

import { verifyPreviewToken } from "../auth/preview/preview-token";
import { container } from "../di";

import {
  requireRouteCollectionAccess,
  requireRoutePermission,
} from "./route-auth";

import { mintPreviewLink, revokePreviewLinks } from "./preview-links";

/** The value the mocked `env` supplies, named once so both sides agree. */
const SECRET = "a-test-secret-value";

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
  // The default: the caller can see the entry they named. Tests about the
  // entry gate override this.
  findByID.mockResolvedValue({ id: "7" });
  (requireRouteCollectionAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "u1",
    permissions: [],
    roles: [],
    authMethod: "session",
    // A stored `custom` read rule may decide on a claim this framework knows
    // nothing about, so the probe has to carry them or it answers a different
    // question than the caller's own read would.
    claims: { tenant: "acme", tier: "restricted" },
  });
  getGeneration.mockResolvedValue(0);
  revokeAll.mockResolvedValue(1);
  (container.get as ReturnType<typeof vi.fn>).mockReturnValue({
    getPreviewTokenGeneration: getGeneration,
    revokeAllPreviewTokens: revokeAll,
  });
});

describe("mintPreviewLink", () => {
  it("refuses an entry the caller cannot read when the read THROWS rather than returns null", async () => {
    // How the production read actually reports an unreadable row. `findByID`
    // returns null only under `disableErrors`; otherwise it throws NOT_FOUND,
    // and a row hidden by a row-level rule is reported the same way as an id
    // that matches nothing. A mock that resolves null exercises a path the
    // caller never takes, and would certify this gate while the throw sailed
    // past it into a 404.
    findByID.mockRejectedValue(
      NextlyError.notFound({ logContext: { collection: "pages" } })
    );

    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "someone-elses-draft" })
    );

    // 403, the same answer a visible-but-forbidden row gets. Answering 404 here
    // would tell an unauthorized caller which entry ids exist.
    expect(response.status).toBe(403);
  });

  it("lets a genuine failure keep its own status instead of reading as a denial", async () => {
    // The neighbouring case, and the reason only NOT_FOUND is translated.
    // Collapsing every failure into "not visible" would report a broken
    // database as an ordinary permission denial and hide the outage.
    findByID.mockRejectedValue(new Error("connection reset"));

    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "7" })
    );

    // 500, not the 403 an unreadable row gets. The route wraps a thrown error
    // rather than rejecting, so the only thing separating an outage from a
    // permission denial is the status it lands on.
    expect(response.status).toBe(500);
  });

  it("refuses an entry the caller cannot read, even inside a collection it may edit", async () => {
    // The collection gate answers a coarser question than the token asks. A
    // caller bounded by a row-level rule to their own documents passes it, so
    // without a check on the ENTRY they could mint a working credential for
    // someone else's draft — a read they cannot perform themselves.
    findByID.mockResolvedValue(null);

    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "someone-elses-draft" })
    );

    expect(response.status).toBe(403);
    // And the entry was judged as the CALLER, not as a trusted reader: an
    // `overrideAccess: true` probe here would answer the wrong question.
    expect(findByID).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "pages",
        id: "someone-elses-draft",
        overrideAccess: false,
        // The whole identity, not an id: `roles` drives role-based rules and
        // the claims drive `custom` ones. A probe missing either decides a
        // different question than the read it stands in for — an
        // absence-tolerant rule would admit a caller it was written to refuse.
        user: expect.objectContaining({
          id: "u1",
          roles: ["editor"],
          role: "editor",
          tenant: "acme",
          tier: "restricted",
        }),
      })
    );
    // No token is minted for a refused entry.
    const body = await json(response);
    expect(body.item).toBeUndefined();
  });

  it("judges an API key on the key's own grants, not its owner's", async () => {
    // The leak direction, which is the one a naive test gets backwards. Asserting
    // that a key is DENIED something it should not have passes against the broken
    // code too, because the OWNER's grants happen to allow it. What is wrong is
    // that the key is still GRANTED something only the owner had — so the probe
    // has to carry the key's own scope for the service to judge it on.
    (
      requireRouteCollectionAccess as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      userId: "owner-who-can-read",
      // Update but NOT read. The owner is a super-admin who can read everything;
      // without the scope below the probe resolves the OWNER's RBAC and mints.
      permissions: ["update-pages"],
      roles: [],
      authMethod: "api-key",
      apiKeyId: "key-1",
      claims: {},
    });

    await mintPreviewLink(post({ collection: "pages", entryId: "7" }));

    expect(findByID).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { actorType: "apiKey", permissions: ["update-pages"] },
      })
    );
  });

  it("sends no actor for a session caller, so it resolves grants the normal way", async () => {
    // Not merely absent: an empty scope would read as an API key holding nothing
    // and deny a legitimate session caller everything.
    await mintPreviewLink(post({ collection: "pages", entryId: "7" }));

    const [call] = findByID.mock.calls;
    expect(call[0].actor).toBeUndefined();
  });

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

  it("signs the site's current generation into the token", async () => {
    // Asserting that the getter RAN would pass for a handler that read 4 and
    // signed 0, which is the regression that matters: a link minted under a
    // stale generation is already revoked, and looks to the editor like preview
    // is simply broken. So the token is verified rather than inspected.
    getGeneration.mockResolvedValue(4);

    const body = await json(
      await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
    );
    const item = body.item as { token: string };

    const atCurrent = await verifyPreviewToken(item.token, SECRET, {
      generation: 4,
    });
    expect(atCurrent.valid).toBe(true);

    // And the same token is refused once the generation moves, which is what
    // makes revocation reach links already in circulation.
    const afterRevoke = await verifyPreviewToken(item.token, SECRET, {
      generation: 5,
    });
    expect(afterRevoke.valid).toBe(false);
  });

  it("scopes the token to the entry that was asked for", async () => {
    const body = await json(
      await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
    );
    const item = body.item as { token: string };

    const verified = await verifyPreviewToken(item.token, SECRET, {
      generation: 0,
    });
    expect(verified.valid && verified.scope).toEqual({
      collection: "pages",
      entryId: "7",
    });
  });

  it("returns a token rather than a url", async () => {
    // Where the preview route is mounted is the app's decision; a url guessed
    // here would 404 on any app that mounted it elsewhere.
    const body = await json(
      await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
    );
    // The canonical mutation envelope, so a direct-API caller reads `.item`.
    expect(Object.keys(body).sort()).toEqual(["item", "message"]);
    const item = body.item as Record<string, unknown>;
    expect(Object.keys(item).sort()).toEqual(["expiresAt", "token"]);
    expect(String(item.token)).not.toContain("http");
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

    expect((body.item as { generation?: unknown }).generation).toBe(9);
  });
});
