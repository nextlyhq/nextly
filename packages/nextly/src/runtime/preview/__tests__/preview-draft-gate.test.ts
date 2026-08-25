/**
 * `previewDraftGate` grants exactly what the token covers, and nothing beside.
 *
 * The property under test is CONFINEMENT, not that a preview works. A gate that
 * returns a grant whenever a valid token exists passes every happy-path
 * assertion and is precisely the defect this exists to prevent — one link
 * becoming a key to every draft — so each case below names a document the token
 * did NOT cover and requires a refusal.
 */
import { hkdfSync } from "node:crypto";

import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signPreviewToken } from "../../../auth/preview/preview-token";
import type { ContentRouteConfig } from "../../routing/content-route";
import { PREVIEW_SCOPE_COOKIE } from "../preview-route";
import { previewDraftGate } from "../preview-draft-gate";

// The identity lookup reaches the container and the database. These cases are
// about CONFINEMENT — which document a token reaches — so the sharer is a
// fixture here; who the draft renders as is covered in `preview-identity.test.ts`,
// and the refusals when it cannot be established are at the end of this file.
const SHARER = { id: "minter-1", roles: ["editor"], role: "editor" };
const resolvePreviewIdentity = vi.hoisted(() => vi.fn());
vi.mock("../preview-identity", () => ({ resolvePreviewIdentity }));

// The per-render re-authorization. It reaches the container and the database;
// what it DECIDES is covered in the integration suite, where a permission can
// actually be revoked. Here it stands aside so these cases stay about
// confinement — which document a token reaches.
const assertEntryPreviewable = vi.hoisted(() => vi.fn());
vi.mock("../../../api/preview-access", () => ({ assertEntryPreviewable }));

const SECRET = "test-secret-value-long-enough-for-hmac";
const GENERATION = 1;

/** A cookie store carrying one signed token, as the request would. */
async function cookiesFor(
  scope: { collection: string; entryId: string; locale?: string },
  options: { generation?: number } = {}
) {
  const { token } = await signPreviewToken(scope, SECRET, {
    generation: options.generation ?? GENERATION,
    ttlSeconds: 600,
    minter: "minter-1",
  });
  return () => ({
    get: (name: string) =>
      name === PREVIEW_SCOPE_COOKIE ? { value: token } : undefined,
  });
}

/** A request with no preview cookie at all. */
const noCookies = () => ({ get: () => undefined });

// `NonNullable`, because the config parameter is optional: the ordinary mount
// passes nothing and lets every value default. These tests pin all three, which
// is what keeps them independent of the container.
function gate(
  cookies: NonNullable<Parameters<typeof previewDraftGate>[0]>["cookies"]
) {
  return previewDraftGate({ secret: SECRET, generation: GENERATION, cookies });
}

describe("previewDraftGate", () => {
  beforeEach(() => {
    resolvePreviewIdentity.mockClear();
    resolvePreviewIdentity.mockResolvedValue(SHARER);
    assertEntryPreviewable.mockClear();
    assertEntryPreviewable.mockResolvedValue(undefined);
  });

  it("is accepted as a content route's draft hook", () => {
    // The usage the docblock shows, asserted rather than described. `satisfies`
    // is what does the work: if either shape moves, this stops compiling here
    // instead of in the first site that wires the two together.
    const hook = gate(noCookies) satisfies NonNullable<
      ContentRouteConfig<unknown>["draft"]
    >;

    expect(typeof hook).toBe("function");
  });

  it("grants the entry the token names, BY ID", async () => {
    // The positive control. Every refusal below is also satisfied by a gate
    // that refuses everything, and at each individual assertion the two are the
    // same output.
    const cookies = await cookiesFor({
      collection: "pages",
      entryId: "entry-1",
    });

    const grant = await gate(cookies)({ collection: "pages", slug: "about" });

    // `{ entryId }`, never `true`. A slug is not unique, so a bare `true`
    // grants whichever row the route resolves — which need not be the entry the
    // token was minted for.
    expect(grant).toEqual(expect.objectContaining({ entryId: "entry-1" }));
  });

  it("refuses a collection the token does not name", async () => {
    const cookies = await cookiesFor({
      collection: "pages",
      entryId: "entry-1",
    });

    expect(await gate(cookies)({ collection: "posts", slug: "about" })).toBe(
      false
    );
  });

  it("refuses when there is no preview session", async () => {
    expect(await gate(noCookies)({ collection: "pages", slug: "about" })).toBe(
      false
    );
  });

  it("refuses a token minted under a superseded generation", async () => {
    // What makes "revoke every preview link" mean something for sessions
    // already in flight, rather than only for links not yet opened.
    const cookies = await cookiesFor(
      { collection: "pages", entryId: "entry-1" },
      { generation: GENERATION - 1 }
    );

    expect(await gate(cookies)({ collection: "pages", slug: "about" })).toBe(
      false
    );
  });

  it("refuses a locale the token does not cover", async () => {
    // The third field `previewTokenCovers` compares, taken from the request so
    // it is the locale the route is about to read in.
    const cookies = await cookiesFor({
      collection: "pages",
      entryId: "entry-1",
      locale: "en",
    });
    const g = gate(cookies);

    expect(await g({ collection: "pages", slug: "about", locale: "fr" })).toBe(
      false
    );
    expect(
      await g({ collection: "pages", slug: "about", locale: "en" })
    ).toEqual(expect.objectContaining({ entryId: "entry-1" }));
  });

  it("grants the default language, whose request names the resolved locale", async () => {
    // The commonest preview there is, and the one a locale-less request breaks.
    // The editor spells the default language as "no locale" and the mint route
    // resolves it, so the token names `en` — a request that named nothing would
    // compare `en` against undefined and refuse every default-language preview.
    const cookies = await cookiesFor({
      collection: "pages",
      entryId: "entry-1",
      locale: "en",
    });

    expect(
      await gate(cookies)({ collection: "pages", slug: "about", locale: "en" })
    ).toEqual(expect.objectContaining({ entryId: "entry-1" }));
  });

  it("grants an unscoped token where the site has no locale at all", async () => {
    // Kept separate from the case above, because only a site configuring no
    // localization reaches the gate with no locale. A non-localized collection
    // mints an unscoped token, which covers the entry rather than a
    // translation, so nothing is compared and nothing is refused.
    const cookies = await cookiesFor({
      collection: "pages",
      entryId: "entry-1",
    });

    expect(await gate(cookies)({ collection: "pages", slug: "about" })).toEqual(
      expect.objectContaining({ entryId: "entry-1" })
    );
  });

  it("covers every locale when the token names none", async () => {
    // A token with no locale is scoped to the entry rather than to one
    // translation, so it must not be refused on a localized route.
    const cookies = await cookiesFor({
      collection: "pages",
      entryId: "entry-1",
    });

    expect(
      await gate(cookies)({ collection: "pages", slug: "about", locale: "fr" })
    ).toEqual(expect.objectContaining({ entryId: "entry-1" }));
  });

  it("re-reads the token per request rather than capturing a verdict", async () => {
    // Config is captured once at module scope; whether this visitor is
    // previewing is a per-request fact. A gate that resolved the scope when it
    // was built would keep granting after the cookie was gone.
    let present = true;
    const cookies = await cookiesFor({
      collection: "pages",
      entryId: "entry-1",
    });
    const switching = () => (present ? cookies() : noCookies());

    const g = gate(switching);
    expect(await g({ collection: "pages", slug: "about" })).toEqual(
      expect.objectContaining({ entryId: "entry-1" })
    );

    present = false;
    expect(await g({ collection: "pages", slug: "about" })).toBe(false);
  });
  // A grant with no identity is a grant with no field rules, which is the leak
  // the identity exists to close — so the draft is refused outright and the
  // request resolves published-only, indistinguishable from an expired link.
  it("refuses the draft when the sharer cannot be identified", async () => {
    resolvePreviewIdentity.mockResolvedValue(null);
    const cookies = await cookiesFor({
      collection: "pages",
      entryId: "entry-1",
    });

    expect(await gate(cookies)({ collection: "pages", slug: "about" })).toBe(
      false
    );
  });

  // A token minted BEFORE the claim existed, built the way one would actually
  // arrive: signed with the same derived key, carrying no `mnt`. The signer
  // refuses to produce one now, so it is hand-built rather than asserted
  // against a shape this module can no longer make. Such a link renders with no
  // field rules at all if it is honoured, so it must be refused.
  it("refuses a token minted before it recorded who shared it", async () => {
    const legacy = await new SignJWT({
      col: "pages",
      eid: "entry-1",
      gen: GENERATION,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("nextly:preview")
      .setSubject("pages:entry-1")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(
        new Uint8Array(
          hkdfSync("sha256", SECRET, "", "nextly:preview-token:v1", 32)
        )
      );
    const cookies = () => ({
      get: (name: string) =>
        name === PREVIEW_SCOPE_COOKIE ? { value: legacy } : undefined,
    });

    expect(await gate(cookies)({ collection: "pages", slug: "about" })).toBe(
      false
    );
    // And it never reached the identity lookup: there was no id to look up.
    expect(resolvePreviewIdentity).not.toHaveBeenCalled();
  });
  // A sharer who is still ACTIVE but no longer authorized — an update role
  // withdrawn, an owner-only rule they stopped satisfying. Rebuilding their
  // identity re-evaluates FIELD rules and nothing else, because the read runs
  // with the row checks bypassed, so without this the link kept serving the
  // draft until it expired.
  it("refuses once the sharer may no longer preview the entry", async () => {
    assertEntryPreviewable.mockRejectedValue(new Error("forbidden"));
    const cookies = await cookiesFor({
      collection: "pages",
      entryId: "entry-1",
    });

    expect(await gate(cookies)({ collection: "pages", slug: "about" })).toBe(
      false
    );
    // Asked about the entry the TOKEN names, as the SHARER — not about whatever
    // the path resolves to, and not as the anonymous visitor holding the link.
    //
    // `routeAuthorized: false` is asserted rather than left to the call: a
    // render has no route gate, and claiming one ran skips the coarse access
    // check — which is the only part of this probe that notices a withdrawn
    // role. Passing `true` here would leave every assertion in this file green
    // while the re-authorization caught nothing but a deleted account.
    expect(assertEntryPreviewable).toHaveBeenCalledWith(
      "pages",
      "entry-1",
      SHARER,
      { routeAuthorized: false }
    );
  });
});
