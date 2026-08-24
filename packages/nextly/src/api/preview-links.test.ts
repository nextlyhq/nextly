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

const {
  getEntry,
  canUpdateEntry,
  getSettings,
  previewDeclaration,
  singleDeclaration,
  findSingle,
} = vi.hoisted(() => ({
  getEntry: vi.fn(),
  canUpdateEntry: vi.fn(),
  getSettings: vi.fn(),
  previewDeclaration: vi.fn(),
  singleDeclaration: vi.fn(),
  findSingle: vi.fn(),
}));

/** The application's `preview` config for the test in hand. */
let previewConfig: { route?: string } | undefined;

vi.mock("../init", () => ({
  // Carries findSingle, because the Single mint path reads the document through
  // the Direct API rather than the collections handler.
  getCachedNextly: () => Promise.resolve({ findSingle }),
}));

vi.mock("../services/lib/permissions", () => ({
  resolveRoleSlugs: vi.fn().mockResolvedValue(["editor"]),
}));

vi.mock("./preview-url", () => ({
  previewDeclarationFor: (...args: unknown[]) => previewDeclaration(...args),
  singlePreviewDeclarationFor: (...args: unknown[]) =>
    singleDeclaration(...args),
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
    // A slug, because the default declaration below is `/{slug}` and minting
    // now resolves the ENTRY rather than trusting that a declaration exists. An
    // entry with no slug is genuinely not previewable, which is what the
    // refusal tests assert by removing it again.
    data: { id: "7", slug: "seven" },
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
  getSettings.mockResolvedValue({ siteUrl: "https://site.example" });
  previewDeclaration.mockResolvedValue({ urlTemplate: "/{slug}" });
  previewConfig = undefined;
  // Key-aware, because assembling the link needs BOTH the settings service and
  // the application config, and a mock answering the same object for every key
  // cannot tell them apart.
  (container.get as ReturnType<typeof vi.fn>).mockImplementation(
    (key: string) => {
      if (key === "config") return { preview: previewConfig };
      return {
        getPreviewTokenGeneration: getGeneration,
        revokeAllPreviewTokens: revokeAll,
        getSettings,
      };
    }
  );
});

/** The mutation envelope's payload, narrowed once rather than at every use. */
function item(body: { item?: unknown }): Record<string, unknown> {
  return body.item as Record<string, unknown>;
}

/** Mint once for the default entry and hand back the envelope's payload. */
async function mintedData(): Promise<Record<string, unknown>> {
  return item(
    await json(
      await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
    )
  );
}

describe("mintPreviewLink for a Single", () => {
  beforeEach(() => {
    singleDeclaration.mockResolvedValue({ url: () => "/" });
    findSingle.mockResolvedValue({ id: "homepage" });
  });

  it("mints a link scoped to the Single", async () => {
    const response = await mintPreviewLink(post({ single: "homepage" }));

    expect(response.status).toBe(200);
  });

  it("signs a token that names the Single rather than a collection entry", async () => {
    const body = await json(
      await mintPreviewLink(post({ single: "homepage" }))
    );
    const verified = await verifyPreviewToken(
      String(item(body).token),
      SECRET,
      { generation: 0 }
    );

    expect(verified.valid && verified.scope).toEqual({
      kind: "single",
      single: "homepage",
    });
  });

  // The same gate a Single's document update asks for, keyed on its slug — so a
  // caller who cannot edit the Single cannot mint a credential to read its
  // draft.
  it("authorizes update on the Single, not on some collection", async () => {
    await mintPreviewLink(post({ single: "homepage" }));

    expect(requireRouteCollectionAccess).toHaveBeenCalledWith(
      expect.anything(),
      "update",
      "homepage"
    );
  });

  it("refuses a Single that declares no preview url", async () => {
    singleDeclaration.mockResolvedValue(undefined);

    const response = await mintPreviewLink(post({ single: "homepage" }));

    expect(response.status).toBe(409);
  });

  it("refuses a Single whose declaration cannot address it yet", async () => {
    singleDeclaration.mockResolvedValue({ url: () => null });

    const response = await mintPreviewLink(post({ single: "homepage" }));

    expect(response.status).toBe(409);
  });

  // Naming both is not a narrower request, it is two different documents — and
  // silently honouring one would mint a credential for a document the caller
  // may not have meant.
  it("refuses a request that names both a Single and a collection entry", async () => {
    const response = await mintPreviewLink(
      post({ single: "homepage", collection: "pages", entryId: "7" })
    );

    expect(response.status).toBe(400);
  });

  it("refuses a request that names neither", async () => {
    const response = await mintPreviewLink(post({}));

    expect(response.status).toBe(400);
  });
});

describe("mintPreviewLink: a collection with nowhere to send a reviewer", () => {
  // The button that mints this is shown whether or not a collection declares a
  // preview URL, and that is deliberate — a draft is shareable either way. What
  // is NOT acceptable is answering success and handing over a link that cannot
  // land: the reviewer then sees a 404 they cannot tell from an expired link,
  // and the editor has no idea anything is wrong.
  it("refuses instead of minting a link that cannot land", async () => {
    previewDeclaration.mockResolvedValue(undefined);

    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "7" })
    );

    expect(response.status).toBe(409);
  });

  it("names the cause and who can fix it", async () => {
    previewDeclaration.mockResolvedValue(undefined);

    const body = await json(
      await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
    );

    // The editor reading this cannot fix it themselves, so the message has to
    // say what is missing AND that a developer is the one who adds it.
    const message = String(
      (body.error as { message?: string } | undefined)?.message ?? ""
    );
    expect(message).toMatch(/preview url/i);
    expect(message).toMatch(/developer/i);
  });

  it("mints no token at all when it refuses", async () => {
    previewDeclaration.mockResolvedValue(undefined);

    const body = await json(
      await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
    );

    // A bearer credential must not be issued for a refused request, even one
    // refused for a configuration reason rather than an authorization one.
    expect(body.item).toBeUndefined();
  });

  // A declaration is necessary and NOT sufficient. `preview.url` returning null
  // for a document it cannot address yet, or a `urlTemplate` placeholder naming
  // an empty field, both mean "not previewable yet" — and both used to mint
  // successfully and 404 at the redirect, which is the failure this refusal
  // exists to remove, reappearing one level down.
  it("refuses an entry the declaration cannot address yet", async () => {
    previewDeclaration.mockResolvedValue({ url: () => null });

    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "7" })
    );

    expect(response.status).toBe(409);
  });

  it("refuses when a template placeholder has no value on this entry", async () => {
    previewDeclaration.mockResolvedValue({ urlTemplate: "/{slug}" });
    getEntry.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { id: "7" },
    });

    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "7" })
    );

    expect(response.status).toBe(409);
  });

  // The two refusals must not read alike: one is a developer's job and the other
  // is the editor's own, and an editor told to "ask a developer" about their
  // empty slug field is being sent to the wrong person.
  it("distinguishes an unaddressable entry from an unconfigured collection", async () => {
    previewDeclaration.mockResolvedValue({ url: () => null });
    const entryBody = await json(
      await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
    );

    previewDeclaration.mockResolvedValue(undefined);
    const collectionBody = await json(
      await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
    );

    const message = (b: { error?: unknown }): string =>
      String((b.error as { message?: string } | undefined)?.message ?? "");

    expect(message(entryBody)).not.toBe(message(collectionBody));
    expect(message(entryBody)).toMatch(/this entry/i);
    expect(message(collectionBody)).toMatch(/developer/i);
  });

  it("mints normally once the collection declares one", async () => {
    previewDeclaration.mockResolvedValue({ url: () => "/somewhere" });

    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "7" })
    );

    expect(response.status).toBe(200);
  });
});

describe("mintPreviewLink: the link it hands back", () => {
  it("returns an absolute url built from the site url and the default mount", async () => {
    const body = await json(
      await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
    );

    expect(item(body).url).toMatch(
      /^https:\/\/site\.example\/api\/preview\?token=/
    );
  });

  it("honours a configured preview.route", async () => {
    previewConfig = { route: "/next/preview" };

    const body = await json(
      await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
    );

    expect(item(body).url).toMatch(
      /^https:\/\/site\.example\/next\/preview\?token=/
    );
  });

  // A site URL may legitimately carry a path, a query or a fragment — the
  // settings schema accepts all three — and concatenating the route onto the end
  // puts it inside whichever component came last, producing a link that never
  // reaches the route and carries no token.
  it("keeps a site url's own query instead of appending the route inside it", async () => {
    getSettings.mockResolvedValue({
      siteUrl: "https://site.example/base?tenant=a",
    });

    const url = new URL(String((await mintedData()).url));

    expect(url.pathname).toBe("/base/api/preview");
    expect(url.searchParams.get("tenant")).toBe("a");
    expect(url.searchParams.get("token")).toBeTruthy();
  });

  it("mounts the route under a site url served from a sub-path", async () => {
    getSettings.mockResolvedValue({ siteUrl: "https://site.example/site" });

    expect(new URL(String((await mintedData()).url)).pathname).toBe(
      "/site/api/preview"
    );
  });

  it("returns a null url for a site url that cannot be parsed", async () => {
    getSettings.mockResolvedValue({ siteUrl: "not a url" });

    expect(await mintedData()).toMatchObject({ url: null });
  });

  it("does not double the separator when the site url carries a trailing slash", async () => {
    getSettings.mockResolvedValue({ siteUrl: "https://site.example/" });

    const body = await json(
      await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
    );

    expect(item(body).url).not.toContain("//api/preview");
  });

  it("carries the token in the url it returns", async () => {
    const body = await json(
      await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
    );

    expect(item(body).url).toContain(
      `token=${encodeURIComponent(item(body).token as string)}`
    );
  });

  it("still returns the token and expiry", async () => {
    const body = await json(
      await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
    );

    expect(typeof item(body).token).toBe("string");
    expect(typeof item(body).expiresAt).toBe("string");
  });

  // The admin cannot recover from this: the `editor` and `author` presets
  // cannot read settings at all, so a RELATIVE url would be resolved against
  // the admin's own origin — confidently wrong, and the exact guess the
  // four-state preview resolver exists elsewhere to prevent.
  it("returns a null url when no site url is configured", async () => {
    getSettings.mockResolvedValue({ siteUrl: null });

    const body = await json(
      await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
    );

    expect(item(body).url).toBeNull();
    // The token is still minted: the link is usable by anyone who can build the
    // URL, and refusing here would break preview on a site that never set one.
    expect(typeof item(body).token).toBe("string");
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

  it("asks the edit question about the id the token will sign", async () => {
    // Two earlier tests here pinned a derived subject — the id read back from
    // the returned document, and a refusal when that id was absent. Both were
    // removed deliberately, not lost: `read.data` is presentation data and
    // `afterRead` may remove `id` OR rewrite it to another row's, so no value in
    // it identifies what was fetched. Deriving the subject from it authorized a
    // row the bearer would not receive.
    //
    // The token signs the requested id, so that is what is asserted editable.
    // The remaining gap — a `beforeOperation` hook resolving that id differently
    // in the bearer's context, where `user` is undefined — is not closeable at
    // this boundary and is tracked as a known limitation.
    getEntry.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { id: "reshaped-by-afterRead" },
    });

    await mintPreviewLink(post({ collection: "pages", entryId: "7" }));

    expect(canUpdateEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionName: "pages",
        // The requested id, NOT the one the returned document carries.
        entryId: "7",
        // The route already ran the coarse `update` gate for this collection and
        // this flag skips only that; stored owner-only/role/custom rules still
        // evaluate against the loaded document.
        routeAuthorized: true,
      })
    );
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

  it("answers with the canonical envelope and nothing else", async () => {
    const body = await json(
      await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
    );

    // The canonical mutation envelope, so a direct-API caller reads `.item`.
    expect(Object.keys(body).sort()).toEqual(["item", "message"]);
    const item = body.item as Record<string, unknown>;
    expect(Object.keys(item).sort()).toEqual(["expiresAt", "token", "url"]);
    // The token is a credential, not an address: it carries no host of its own,
    // and the `url` beside it is what puts one in front.
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
