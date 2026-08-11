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

const { getEntry, canUpdateEntry } = vi.hoisted(() => ({
  getEntry: vi.fn(),
  canUpdateEntry: vi.fn(),
}));

vi.mock("../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue({}),
}));

vi.mock("../services/lib/permissions", () => ({
  resolveRoleSlugs: vi.fn().mockResolvedValue(["editor"]),
}));

vi.mock("../di", () => ({
  container: { get: vi.fn(), has: vi.fn().mockReturnValue(false) },
  getService: vi.fn(() => ({ getEntry, canUpdateEntry })),
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
  // The default: the caller can see the entry they named AND may edit it, so
  // the draft the token hands out is one they could already open. Tests about
  // the entry gate override whichever half they are about.
  getEntry.mockResolvedValue({
    success: true,
    statusCode: 200,
    data: { id: "7" },
  });
  canUpdateEntry.mockResolvedValue(true);
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
  it("refuses an entry the caller cannot read, even inside a collection it may edit", async () => {
    // The collection gate answers a coarser question than the token asks. A
    // caller bounded by a row-level rule to their own documents passes it, so
    // without a check on the ENTRY they could mint a working credential for
    // someone else's draft — a read they cannot perform themselves.
    getEntry.mockResolvedValue({ success: false, statusCode: 403 });

    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "someone-elses-draft" })
    );

    expect(response.status).toBe(403);
    // No token is minted for a refused entry.
    const body = await json(response);
    expect(body.item).toBeUndefined();
  });

  it("answers a missing entry the same way as a hidden one", async () => {
    // 403 for both, deliberately. Answering 404 for an id that matches nothing
    // would let an unauthorized caller enumerate which entry ids exist by
    // reading the status code.
    getEntry.mockResolvedValue({ success: false, statusCode: 404 });

    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "no-such-entry" })
    );

    expect(response.status).toBe(403);
  });

  it("lets a genuine failure keep its own status instead of reading as a denial", async () => {
    // 429, deliberately NOT 500. A test using 500 as both the input and the
    // expected output cannot tell "the status was preserved" from "every
    // failure is flattened to 500" — it passes under both, which is how the
    // flattening survived the first version of this test.
    getEntry.mockResolvedValue({
      success: false,
      statusCode: 429,
      code: "RATE_LIMITED",
      message: "Too many requests",
    });

    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "7" })
    );

    // Not 403 (an unreadable row) and not 500 (a flattened one): the caller
    // needs the retry semantics the service actually reported.
    expect(response.status).toBe(429);
  });

  it("judges the entry as the CALLER and keeps a never-published one visible", async () => {
    await mintPreviewLink(post({ collection: "pages", entryId: "7" }));

    expect(getEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionName: "pages",
        entryId: "7",
        // Enforced, not a trusted read: an `overrideAccess: true` probe would
        // answer a different question than the bearer's read will face.
        overrideAccess: false,
        // Without this a status-enabled collection filters to published only,
        // so an entry that has never been published reports as missing — which
        // is exactly the entry an editor wants to share for review.
        status: "all",
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
  });

  it("refuses a readable entry the caller may NOT edit", async () => {
    // The defect this gate exists for. Where a collection allows broad reads but
    // restricts updates per row, the caller passes both the collection gate and
    // the read — and the token they would receive is consumed with `draft: true`
    // and `overrideAccess: true`, exposing another author's unpublished edits.
    //
    // 🔴 Enabling `draft` on the read instead would NOT catch this: the overlay
    // falls back to the published row for a caller who cannot edit rather than
    // denying, so the read succeeds either way and the mint proceeds.
    canUpdateEntry.mockResolvedValue(false);

    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "someone-elses-draft" })
    );

    expect(response.status).toBe(403);
    const body = await json(response);
    expect(body.item).toBeUndefined();
  });

  it("asks the edit question about the row the READ settled on", async () => {
    // A `beforeOperation` hook may rewrite the id, and the read resolves it
    // before fetching. The bearer's own read runs that same hook and lands on
    // the same row, so authorizing the id the request NAMED would judge a
    // different row than the token delivers: editable row A mapped to
    // readable-but-uneditable row B passes read(B) plus update(A), while the
    // token hands out B.
    getEntry.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { id: "rewritten-by-hook" },
    });

    await mintPreviewLink(post({ collection: "pages", entryId: "7" }));

    expect(canUpdateEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionName: "pages",
        entryId: "rewritten-by-hook",
        // The route already ran the coarse `update` gate for this collection,
        // and this flag skips ONLY that. The stored owner-only/role/custom rules
        // still evaluate against the loaded document, which is what decides the
        // row-level question.
        routeAuthorized: true,
      })
    );
  });

  it("refuses when the row that was read cannot be identified", async () => {
    // `read.data` is presentation data — it has been through `afterRead`, which
    // the service allows to reshape the row, `id` included. A missing `id` does
    // NOT mean the request id was used; it means the row that was read is
    // unknown here.
    //
    // Falling back to the requested id would authorize a row that was never
    // read: a `beforeOperation` hook mapping A to B plus an `afterRead` hook
    // dropping `id` yields read(B) with update(A), while the token delivers B.
    getEntry.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { title: "afterRead stripped the id" },
    });

    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "7" })
    );

    expect(response.status).toBe(403);
    // And crucially the edit gate was never asked about the WRONG row.
    expect(canUpdateEntry).not.toHaveBeenCalled();
  });

  it("judges an API key on the key's own grants, not its owner's", async () => {
    // The leak direction, which is the one a naive test gets backwards. Asserting
    // that a key is DENIED something it should not have passes against the broken
    // code too, because the OWNER's grants happen to allow it. What is wrong is
    // that the key is still GRANTED something only the owner had — so both gates
    // have to carry the key's own scope for the services to judge it on.
    (
      requireRouteCollectionAccess as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      userId: "owner-who-can-read",
      // Update but NOT read. The owner is a super-admin who can read everything;
      // without the scope below the gates resolve the OWNER's RBAC and mint.
      permissions: ["update-pages"],
      roles: [],
      authMethod: "api-key",
      apiKeyId: "key-1",
      claims: {},
    });

    await mintPreviewLink(post({ collection: "pages", entryId: "7" }));

    const scope = { actorType: "apiKey", permissions: ["update-pages"] };
    expect(getEntry).toHaveBeenCalledWith(
      expect.objectContaining({ authenticatedScope: scope })
    );
    // Both gates, not just the read. A scope carried into one and dropped from
    // the other judges a single request as two different callers.
    expect(canUpdateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ authenticatedScope: scope })
    );
  });

  it("sends no scope for a session caller, so it resolves grants the normal way", async () => {
    // Not merely absent: an empty scope would read as an API key holding nothing
    // and deny a legitimate session caller everything.
    await mintPreviewLink(post({ collection: "pages", entryId: "7" }));

    expect(getEntry.mock.calls[0][0].authenticatedScope).toBeUndefined();
    expect(canUpdateEntry.mock.calls[0][0].authenticatedScope).toBeUndefined();
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
    // The error the real gate throws, not a stand-in. `throwAuthError` raises
    // `NextlyError.forbidden`, which the handler renders as 403; a bare `Error`
    // is an unrecognised failure and renders as 500. Both are >= 400, so a
    // range assertion over a stand-in passes whether the refusal is reported
    // as a refusal or as a crash.
    (
      requireRouteCollectionAccess as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(NextlyError.forbidden());

    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "7" })
    );

    expect(response.status).toBe(403);
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
      NextlyError.forbidden()
    );

    const response = await revokePreviewLinks(
      post({}, "http://x/api/nextly/preview-links/revoke")
    );

    expect(response.status).toBe(403);
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
