/**
 * `previewDraftGate` grants exactly what the token covers, and nothing beside.
 *
 * The property under test is CONFINEMENT, not that a preview works. A gate that
 * returns a grant whenever a valid token exists passes every happy-path
 * assertion and is precisely the defect this exists to prevent — one link
 * becoming a key to every draft — so each case below names a document the token
 * did NOT cover and requires a refusal.
 */
import { describe, expect, it } from "vitest";

import { signPreviewToken } from "../../../auth/preview/preview-token";
import type { ContentRouteConfig } from "../../routing/content-route";
import { PREVIEW_SCOPE_COOKIE } from "../preview-route";
import { previewDraftGate } from "../preview-draft-gate";

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
  });
  return () => ({
    get: (name: string) =>
      name === PREVIEW_SCOPE_COOKIE ? { value: token } : undefined,
  });
}

/** A request with no preview cookie at all. */
const noCookies = () => ({ get: () => undefined });

function gate(cookies: Parameters<typeof previewDraftGate>[0]["cookies"]) {
  return previewDraftGate({ secret: SECRET, generation: GENERATION, cookies });
}

describe("previewDraftGate", () => {
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
    expect(grant).toEqual({ entryId: "entry-1" });
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
    ).toEqual({ entryId: "entry-1" });
  });

  it("refuses a locale-scoped token on a route that states no locale", async () => {
    // The direction a config-supplied locale could not express. An unlocalized
    // request carries no locale to compare, so a token scoped to one covers
    // nothing here — rather than covering everything.
    const cookies = await cookiesFor({
      collection: "pages",
      entryId: "entry-1",
      locale: "en",
    });

    expect(await gate(cookies)({ collection: "pages", slug: "about" })).toBe(
      false
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
    ).toEqual({ entryId: "entry-1" });
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
    expect(await g({ collection: "pages", slug: "about" })).toEqual({
      entryId: "entry-1",
    });

    present = false;
    expect(await g({ collection: "pages", slug: "about" })).toBe(false);
  });
});
