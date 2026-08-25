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
  singleReadable,
  singleEditable,
} = vi.hoisted(() => ({
  getEntry: vi.fn(),
  canUpdateEntry: vi.fn(),
  getSettings: vi.fn(),
  previewDeclaration: vi.fn(),
  singleDeclaration: vi.fn(),
  findSingle: vi.fn(),
  singleReadable: vi.fn(),
  singleEditable: vi.fn(),
}));

/** The application's `preview` config for the test in hand. */
let previewConfig: { route?: string } | undefined;

/**
 * Which singles the config reports as localized, for the test in hand.
 *
 * A set rather than a flag because the endpoint asks per slug, and a single
 * boolean would answer for a single it was never asked about.
 */
const localizedSingles = new Set<string>();

/**
 * Which singles carry a Draft / Published lifecycle, for the test in hand.
 *
 * A single without one has no pending version to preview, so minting is refused
 * — which every other Single test would otherwise trip over.
 */
const statusSingles = new Set<string>();

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
  // Delegates to the same `findSingle` double the mint used to reach directly,
  // so what these tests drive is unchanged: the read moved behind a shared
  // loader, and the loader is the one the preview ROUTE reads through too.
  loadSingleForPreview: async (slug: string, locale: string | undefined) =>
    (await findSingle({
      slug,
      ...(locale === undefined ? {} : { locale }),
    })) ?? null,
}));

// The gate itself is exercised where it lives; what these cover is that the
// mint ASKS it, and that a refusal stops short of signing anything.
vi.mock("../domains/singles/services/single-document-access", () => ({
  singleDocumentReadable: (...args: unknown[]) => singleReadable(...args),
  singleDocumentEditable: (...args: unknown[]) => singleEditable(...args),
}));

vi.mock("../di", () => ({
  container: { get: vi.fn(), has: vi.fn().mockReturnValue(false) },
  getService: vi.fn(() => ({
    getEntry,
    canUpdateEntry,
    // The registry fallback the localized probe reaches when the authored
    // config has nothing to say about this slug.
    getSingleBySlug: (slug: string) =>
      Promise.resolve({
        localized: localizedSingles.has(slug),
        status: statusSingles.has(slug),
      }),
  })),
}));

/*
 * The audit writer is mocked so the RECORD is observable. Left real it would
 * reach the adapter double, fail inside its own never-throws contract, and log
 * — so every assertion below would pass against a route that recorded nothing.
 */
const auditWrite = vi.hoisted(() => vi.fn());
vi.mock("../domains/audit/audit-log-writer", () => ({
  buildAuditLogWriter: () => ({ write: auditWrite }),
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
  // Nothing is localized unless a test says so, which keeps the unscoped grant
  // correct for the singles that genuinely have one document.
  localizedSingles.clear();
  statusSingles.clear();
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
  (requireRoutePermission as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "admin-1",
    permissions: [],
    roles: [],
    authMethod: "session",
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
    singleReadable.mockResolvedValue(true);
    singleEditable.mockResolvedValue(true);
    statusSingles.add("homepage");
  });

  /**
   * The route gate answers a COARSE question — may this caller update this slug
   * — while a Single's stored rules are evaluated against the loaded document
   * and can deny a caller who holds that permission. A link minted on the
   * permission alone is a bearer credential for a draft the real update path
   * refuses to show them.
   */
  describe("the Single's own stored rules", () => {
    it("refuses when the caller cannot see the document", async () => {
      singleReadable.mockResolvedValue(false);

      const response = await mintPreviewLink(post({ single: "homepage" }));

      expect(response.status).toBe(403);
    });

    // Reading proves nothing about this. Where a Single allows broad reads and
    // restricts updates, a caller reads the published document and would
    // otherwise be handed the author's unpublished edits.
    it("refuses when the caller cannot edit the document", async () => {
      singleEditable.mockResolvedValue(false);

      const response = await mintPreviewLink(post({ single: "homepage" }));

      expect(response.status).toBe(403);
    });

    // The property that matters: a refusal must stop short of SIGNING. A token
    // that exists is a working credential whatever the response says.
    it("signs nothing when it refuses", async () => {
      singleEditable.mockResolvedValue(false);

      const body = await json(
        await mintPreviewLink(post({ single: "homepage" }))
      );

      expect(JSON.stringify(body)).not.toContain("eyJ");
    });

    // Asked BEFORE the trusted read that builds the redirect, so a refused
    // caller never reaches a document they may not see.
    it("asks before loading the document", async () => {
      singleReadable.mockResolvedValue(false);

      await mintPreviewLink(post({ single: "homepage" }));

      expect(findSingle).not.toHaveBeenCalled();
    });

    /**
     * `routeAuthorized` tells the checker that the coarse RBAC gate for THIS
     * operation already ran, so it is skipped as redundant. The mint route gated
     * `update` and nothing else — so claiming it for the READ probe would skip a
     * permission check that never happened, and a caller holding `update` with
     * no read grant would be handed a bearer token for the draft.
     */
    it("does not claim a read gate the mint route never ran", async () => {
      await mintPreviewLink(post({ single: "homepage" }));

      expect(singleReadable).toHaveBeenCalledWith(
        "homepage",
        expect.objectContaining({ routeAuthorized: false })
      );
    });

    // The other half, and the reason this is a per-call-site decision rather
    // than one polarity for both: the update gate DID run, so re-running it
    // would reject a scoped API key by resolving its creator's roles instead.
    it("does claim the update gate it did run", async () => {
      await mintPreviewLink(post({ single: "homepage" }));

      expect(singleEditable).toHaveBeenCalledWith(
        "homepage",
        expect.objectContaining({ routeAuthorized: true })
      );
    });

    // The token names one translation; the probe must judge that one. A custom
    // read rule can allow the default document and deny the requested locale,
    // and authorizing the default while signing the other authorizes nothing
    // about what the bearer receives.
    it("authorizes the translation the token will name", async () => {
      await mintPreviewLink(post({ single: "homepage", locale: "fr" }));

      expect(singleReadable).toHaveBeenCalledWith(
        "homepage",
        expect.objectContaining({ locale: "fr" })
      );
      expect(singleEditable).toHaveBeenCalledWith(
        "homepage",
        expect.objectContaining({ locale: "fr" })
      );
    });
  });

  /**
   * A Single with no Draft / Published lifecycle has no pending version, so a
   * link would hand its recipient the CURRENT private document through a route
   * that reads it trusted. The admin already withholds the control; this is the
   * same rule for a caller reaching the endpoint directly.
   */
  describe("a single with no draft lifecycle", () => {
    it("refuses to mint at all", async () => {
      statusSingles.delete("homepage");

      const response = await mintPreviewLink(post({ single: "homepage" }));

      expect(response.status).toBe(409);
    });

    it("signs nothing when it refuses", async () => {
      statusSingles.delete("homepage");

      const body = await json(
        await mintPreviewLink(post({ single: "homepage" }))
      );

      expect(JSON.stringify(body)).not.toContain("eyJ");
    });

    // Refused before the trusted read that builds the redirect, so nothing
    // loads a document the caller is not going to be given.
    it("refuses before loading the document", async () => {
      statusSingles.delete("homepage");

      await mintPreviewLink(post({ single: "homepage" }));

      expect(findSingle).not.toHaveBeenCalled();
    });
  });

  // The registry and the authored config can disagree — a metadata sync that
  // fails deliberately keeps the previous registry row — and the read path
  // consumes the registry. Believing the config alone reports a localized
  // Single as unlocalized and signs an all-locales token.
  describe("when the authored config and the registry disagree", () => {
    it("treats a Single the registry calls localized as localized", async () => {
      localizedSingles.add("homepage");
      previewConfig = undefined;

      const response = await mintPreviewLink(post({ single: "homepage" }));

      expect(response.status).toBe(400);
    });
  });

  /**
   * An absent locale claim covers EVERY translation. On a localized Single that
   * is a grant over drafts nobody authorized, so the endpoint refuses rather
   * than widening the probe to match — honouring the request would hand out the
   * very grant the refusal exists to withhold.
   */
  describe("a localized single with no locale named", () => {
    it("refuses rather than minting a token covering every translation", async () => {
      localizedSingles.add("homepage");

      const response = await mintPreviewLink(post({ single: "homepage" }));

      expect(response.status).toBe(400);
    });

    it("signs nothing when it refuses", async () => {
      localizedSingles.add("homepage");

      const body = await json(
        await mintPreviewLink(post({ single: "homepage" }))
      );

      expect(JSON.stringify(body)).not.toContain("eyJ");
    });

    it("mints once a translation is named", async () => {
      localizedSingles.add("homepage");

      const response = await mintPreviewLink(
        post({ single: "homepage", locale: "fr" })
      );

      expect(response.status).toBe(200);
    });

    // The negative control. An unlocalized Single has exactly one document, so
    // an absent claim is the CORRECT grant there — a rule that always demanded
    // a locale would refuse every link for every non-localized Single.
    it("still mints unscoped for a single that is not localized", async () => {
      const response = await mintPreviewLink(post({ single: "homepage" }));

      expect(response.status).toBe(200);
    });
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

  /*
   * A Single's read reports failure by THROWING, not by returning null.
   * `findSingle` raises a typed error for every unsuccessful service result, so
   * a loader that only checked for null let the throw travel past it and the
   * endpoint answered with the raw error instead of a refusal. A fixture that
   * resolves null cannot reproduce that, which is why these reject instead.
   */
  it("refuses, rather than erroring, when the Single's read throws not-found", async () => {
    findSingle.mockRejectedValue(
      new NextlyError({
        code: "NOT_FOUND",
        statusCode: 404,
        publicMessage: "No such single",
      })
    );

    const response = await mintPreviewLink(post({ single: "homepage" }));
    const message = String(
      ((await json(response)).error as { message?: string } | undefined)
        ?.message ?? ""
    );

    expect(response.status).toBe(409);
    expect(message).toMatch(/deleted|removed/i);
  });

  it("says a FAILED Single read could not be read, not that it was deleted", async () => {
    findSingle.mockRejectedValue(
      new NextlyError({
        code: "INTERNAL_ERROR",
        statusCode: 500,
        publicMessage: "Database unavailable",
      })
    );

    const response = await mintPreviewLink(post({ single: "homepage" }));
    const message = String(
      ((await json(response)).error as { message?: string } | undefined)
        ?.message ?? ""
    );

    expect(response.status).toBe(409);
    expect(message).toMatch(/could not be read just now|try again/i);
    expect(message).not.toMatch(/deleted/i);
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

  /*
   * The three refusals an editor cannot act on, asserted THROUGH the endpoint.
   *
   * The resolver's own suite stops at the cause value, which says nothing about
   * what anyone reads: the mapping from cause to message could be swapped back
   * to the slug advice and every resolver test would stay green, while the
   * user-facing behaviour this change exists for would be gone. So each case
   * asserts the remedy it names AND that it does not name the slug.
   */
  const slugAdvice = /slug/i;

  /** The message an endpoint refusal put in front of the editor. */
  const messageOf = (b: { error?: unknown }): string =>
    String((b.error as { message?: string } | undefined)?.message ?? "");

  async function refusalMessage(): Promise<string> {
    return messageOf(
      await json(
        await mintPreviewLink(post({ collection: "pages", entryId: "7" }))
      )
    );
  }

  it("says the document could not be read, rather than blaming the slug", async () => {
    // The entry vanished between the authorization read and the resolver's own.
    getEntry.mockResolvedValue({ success: true, statusCode: 200, data: null });

    const message = await refusalMessage();

    expect(message).toMatch(/could not be read|deleted/i);
    expect(message).not.toMatch(slugAdvice);
  });

  /**
   * A read that succeeds for AUTHORIZATION and then fails for the resolver.
   *
   * Both of the cases below are only reachable through this window, and
   * discovering that was worth the fixture: the mint authorizes by reading the
   * entry, so a read failing on the FIRST call is refused as a permission
   * problem and never reaches the resolver at all. What the resolver can see is
   * the race — the entry readable when the caller was authorized and not
   * readable a moment later — which is exactly the situation being diagnosed.
   */
  function readableThenFailing(second: Record<string, unknown>): void {
    getEntry.mockReset();
    getEntry.mockResolvedValueOnce({
      success: true,
      statusCode: 200,
      data: { id: "7", slug: "seven" },
    });
    getEntry.mockResolvedValue(second);
  }

  it("does not call a FAILED read a deletion", async () => {
    /*
     * A transient database error, a rate limit or a throwing read hook all
     * arrive as `success: false` with a non-404 status. None of them shows the
     * entry is absent, so "it may have been deleted" is a claim the read never
     * established — and it is the most alarming possible wrong answer to give
     * an editor about their own work.
     */
    readableThenFailing({ success: false, statusCode: 500 });

    const message = await refusalMessage();

    expect(message).toMatch(/could not be read just now|try again/i);
    expect(message).not.toMatch(/deleted/i);
    expect(message).not.toMatch(slugAdvice);
    // The ENTRY, not the collection. What failed is the trusted read of one
    // document; the collection and its declaration were both read fine a
    // moment earlier, so naming the collection points at the wrong scope.
    expect(message).toMatch(/this entry/i);
    expect(message).not.toMatch(/this collection/i);
  });

  it("still calls a 404 a deletion, so the pair discriminates", async () => {
    // The control for the case above: a read that DID establish absence keeps
    // the permanent diagnosis, so the split is on the failure KIND rather than
    // this endpoint having stopped saying "deleted" at all.
    readableThenFailing({ success: false, statusCode: 404 });

    const message = await refusalMessage();

    expect(message).toMatch(/deleted/i);
    expect(message).not.toMatch(/try again/i);
  });

  it("says the preview URL names another site, rather than blaming the slug", async () => {
    // No field on this entry can move the declaration to another origin, so
    // sending the editor to fill one in is advice they cannot act on.
    previewDeclaration.mockResolvedValue({
      url: () => "https://elsewhere.test/about",
    });

    const message = await refusalMessage();

    expect(message).toMatch(/different site/i);
    expect(message).not.toMatch(slugAdvice);
  });

  it("says the preview URL does not resolve, rather than blaming the slug", async () => {
    getSettings.mockResolvedValue({ siteUrl: "not a url" });
    previewDeclaration.mockResolvedValue({
      url: () => "https://site.example/about",
    });

    const message = await refusalMessage();

    expect(message).toMatch(/could not be turned into an address/i);
    expect(message).not.toMatch(slugAdvice);
  });

  it("gives all six refusals six different messages", async () => {
    /*
     * Stronger than each matching its own pattern: two causes could both match
     * their phrases while sharing a message, and the whole point is that an
     * editor can tell which of the six happened. The set having six members is
     * the property; six individual assertions do not state it.
     */
    previewDeclaration.mockResolvedValue(undefined);
    const notConfigured = await refusalMessage();

    previewDeclaration.mockResolvedValue({ url: () => null });
    const unavailable = await refusalMessage();

    previewDeclaration.mockResolvedValue({ urlTemplate: "/{slug}" });
    getEntry.mockResolvedValue({ success: true, statusCode: 200, data: null });
    const documentGone = await refusalMessage();

    readableThenFailing({ success: false, statusCode: 500 });
    const documentUnreadable = await refusalMessage();

    getEntry.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { id: "7", slug: "seven" },
    });
    previewDeclaration.mockResolvedValue({
      url: () => "https://elsewhere.test/about",
    });
    const foreignOrigin = await refusalMessage();

    getSettings.mockResolvedValue({ siteUrl: "not a url" });
    previewDeclaration.mockResolvedValue({
      url: () => "https://site.example/about",
    });
    const unresolvable = await refusalMessage();

    const all = [
      notConfigured,
      unavailable,
      documentGone,
      documentUnreadable,
      foreignOrigin,
      unresolvable,
    ];
    // Non-empty first, so six identical empty strings cannot satisfy the size
    // check by collapsing to one — and so a refusal that stopped carrying a
    // message at all fails here rather than passing quietly.
    expect(all.every(m => m.length > 0)).toBe(true);
    expect(new Set(all).size).toBe(6);
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

  it("refuses to mint from an API key at all", async () => {
    // A preview link records WHOSE permissions the draft is rendered through,
    // and a key names no person. It is authorized on the grants stamped on the
    // key — deliberately, so a narrow key cannot mint on the strength of its
    // owner's account — but the only identity it could record is that owner,
    // whose access is exactly what the key was scoped away from. The link would
    // render under permissions the request never had.
    //
    // This REPLACES a case asserting that both gates carried the key's own
    // scope. That property is now unreachable rather than untested: the request
    // is refused before either gate runs, which is strictly stronger than
    // judging it correctly.
    (
      requireRouteCollectionAccess as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      userId: "owner-who-can-read",
      permissions: ["update-pages"],
      roles: [],
      authMethod: "api-key",
      apiKeyId: "key-1",
      claims: {},
    });

    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "7" })
    );

    // 403 exactly, not merely >= 400: an unrecognised failure renders as 500,
    // and a range assertion cannot tell a refusal from a crash.
    expect(response.status).toBe(403);
    // Refused BEFORE the authorization probe, so a rejected request performs no
    // reads on the caller's behalf — and before any token exists, since a token
    // that was signed and then discarded is still a token.
    expect(getEntry).not.toHaveBeenCalled();
    expect(canUpdateEntry).not.toHaveBeenCalled();
    expect(getGeneration).not.toHaveBeenCalled();
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

/*
 * Minting hands out a bearer credential that reads a draft as the minter, and
 * until now it left no record at all. These cover WHAT is recorded rather than
 * that something is: a row naming the wrong document, or carrying the token
 * itself, is worse than no row — the first misdirects an investigation and the
 * second hands its reader the access the trail exists to describe.
 */
describe("the audit trail a preview link leaves", () => {
  // The Single path needs its own document doubles, exactly as the Single mint
  // suite above sets them up. The entry path's defaults come from the top-level
  // `beforeEach` and need nothing here.
  beforeEach(() => {
    singleDeclaration.mockResolvedValue({ url: () => "/" });
    findSingle.mockResolvedValue({ id: "homepage" });
    singleReadable.mockResolvedValue(true);
    singleEditable.mockResolvedValue(true);
    statusSingles.add("homepage");
  });

  /** The single event the run recorded, narrowed once. */
  function recorded(): Record<string, unknown> {
    expect(auditWrite, "nothing was recorded").toHaveBeenCalledTimes(1);
    return auditWrite.mock.calls[0]?.[0] as Record<string, unknown>;
  }

  function meta(): Record<string, unknown> {
    return recorded().metadata as Record<string, unknown>;
  }

  it("records the entry mint against the person who minted it", async () => {
    await mintPreviewLink(post({ collection: "pages", entryId: "7" }));

    expect(recorded()).toMatchObject({
      kind: "preview-link-minted",
      // The minter, not merely "someone": the token renders the draft through
      // THEIR field-level permissions, so the actor is what makes the row
      // answer "whose access was handed out".
      actorUserId: "u1",
    });
    expect(meta()).toMatchObject({
      scope: "collection",
      collection: "pages",
      entryId: "7",
    });
  });

  // The same recording, reached by the OTHER mint path. Both funnel through one
  // helper, and this is what would go red if a later change gave either path its
  // own response and left the record behind.
  it("records a Single mint through the same choke point", async () => {
    await mintPreviewLink(post({ single: "homepage" }));

    expect(recorded()).toMatchObject({ kind: "preview-link-minted" });
    expect(meta()).toMatchObject({ scope: "single", single: "homepage" });
  });

  it("records the language a scoped link was minted for", async () => {
    localizedSingles.add("homepage");

    await mintPreviewLink(post({ single: "homepage", locale: "fr" }));

    expect(meta()).toMatchObject({ locale: "fr" });
  });

  /*
   * The security property, asserted as an ABSENCE with a control beside it.
   * `toMatchObject` above would pass on a row that also carried the token, so
   * this is the assertion that separates them — and the metadata is checked to
   * be non-empty first, because an empty object contains no token either and
   * would satisfy the absence perfectly.
   */
  it("never writes the credential itself into the trail", async () => {
    await mintPreviewLink(post({ collection: "pages", entryId: "7" }));

    const serialised = JSON.stringify(recorded());
    // The control: the row genuinely describes this mint, so the absence below
    // is a true absence rather than an empty row.
    expect(serialised).toContain("pages");
    expect(serialised).not.toContain("eyJ");
    expect(Object.keys(meta())).not.toContain("token");
  });

  it("records who revoked, and the generation the revocation moved to", async () => {
    await revokePreviewLinks(
      post({}, "http://x/api/nextly/preview-links/revoke")
    );

    expect(recorded()).toMatchObject({
      kind: "preview-links-revoked",
      actorUserId: "admin-1",
    });
    // What relates the two kinds of row: every mint below this generation is
    // one this revocation killed.
    expect(meta()).toMatchObject({ generation: 1 });
  });

  /*
   * A refused mint produces no credential, so it must produce no row. Recorded
   * before the refusal, the trail would claim access was handed out that never
   * was — and an investigator reading it would be chasing a link nobody holds.
   */
  /*
   * `userId` on an api-key request is the key's OWNER. A row carrying only that
   * would state that a person personally revoked every link on the site when a
   * delegated key did — backwards in exactly the case this trail exists for,
   * where the key is what is under suspicion.
   */
  it("names the KEY when an api key revokes, not just its owner", async () => {
    (requireRoutePermission as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "owner-1",
      permissions: [],
      roles: [],
      authMethod: "api-key",
      apiKeyId: "key-9",
    });

    await revokePreviewLinks(
      post({}, "http://x/api/nextly/preview-links/revoke")
    );

    expect(meta()).toMatchObject({ authMethod: "api-key", apiKeyId: "key-9" });
  });

  // The control for the case above: a session revocation must NOT invent a key
  // id, so a reader can tell "no key was involved" from "a key id was lost".
  it("carries no key id when a session revokes", async () => {
    await revokePreviewLinks(
      post({}, "http://x/api/nextly/preview-links/revoke")
    );

    expect(meta()).toMatchObject({ authMethod: "session" });
    expect(Object.keys(meta())).not.toContain("apiKeyId");
  });

  /*
   * Signing is not the moment a credential exists for anyone: the settings read
   * and the link assembly come after it, and a failure in either returns an
   * error while the token never leaves the process. A row written before them
   * would durably assert that access was handed out on a request that handed
   * out nothing.
   */
  it("records nothing when the response cannot be assembled after signing", async () => {
    /*
     * The application config is the ONLY read that happens strictly after the
     * token is signed — the settings read cannot serve here, because the
     * redirect resolver reads settings too, so failing it aborts the request
     * before anything is signed and the assertion passes without ever reaching
     * the ordering it claims to test.
     */
    (container.get as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => {
        if (key === "config") throw new Error("config unavailable");
        return {
          getPreviewTokenGeneration: getGeneration,
          revokeAllPreviewTokens: revokeAll,
          getSettings,
        };
      }
    );

    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "7" })
    );

    expect(response.status).not.toBe(200);
    expect(auditWrite).not.toHaveBeenCalled();
  });

  it("records nothing when the mint is refused", async () => {
    previewDeclaration.mockResolvedValue(undefined);

    const response = await mintPreviewLink(
      post({ collection: "pages", entryId: "7" })
    );

    expect(response.status).not.toBe(200);
    expect(auditWrite).not.toHaveBeenCalled();
  });
});
