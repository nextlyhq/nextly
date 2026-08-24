import { describe, expect, it, vi } from "vitest";

import {
  isSingleScope,
  signPreviewToken,
} from "../../../auth/preview/preview-token";
import {
  PREVIEW_SCOPE_COOKIE,
  createPreviewRoute,
  previewGrantsDraft,
  readPreviewScope,
  type PreviewRouteConfig,
  type PreviewScopeReaderConfig,
} from "../preview-route";

const TEST_SECRET = "preview-route-test-secret-at-least-32-chars!!";
const GENERATION = 1;
const SCOPE = { collection: "pages", entryId: "entry-1" };

/** A draft-mode double that records whether the route enabled it. */
function draftModeDouble() {
  const enable = vi.fn();
  return { enable, draftMode: () => Promise.resolve({ enable }) };
}

function routeFor(
  overrides: Partial<Parameters<typeof createPreviewRoute>[0]> = {}
) {
  const draft = draftModeDouble();
  const route = createPreviewRoute({
    secret: TEST_SECRET,
    generation: GENERATION,
    // Narrowed rather than asserted: the scope is a union, and this suite's
    // tokens are all entry-scoped, so the single branch is genuinely
    // unreachable here and says so instead of being cast away.
    redirectTo: scope =>
      isSingleScope(scope)
        ? `/single/${scope.single}`
        : `/${scope.collection}/${scope.entryId}`,
    draftMode: draft.draftMode,
    ...overrides,
  });
  return { route, enable: draft.enable };
}

function request(token?: string): Request {
  const url = new URL("https://site.example/api/preview");
  if (token !== undefined) url.searchParams.set("token", token);
  return new Request(url);
}

function cookiesFrom(response: Response) {
  const header = response.headers.get("set-cookie") ?? "";
  const value = /__nextly_preview=([^;]*)/.exec(header)?.[1];
  return {
    header,
    get: (name: string) =>
      name === PREVIEW_SCOPE_COOKIE && value !== undefined
        ? { value }
        : undefined,
  };
}

describe("the preview route", () => {
  it("starts a draft session and sends the visitor to the document", async () => {
    const { token } = await signPreviewToken(SCOPE, TEST_SECRET, {
      generation: GENERATION,
    });
    const { route, enable } = routeFor();

    const response = await route.GET(request(token));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/pages/entry-1");
    expect(enable).toHaveBeenCalledOnce();
  });

  it("carries the scope in an httpOnly cookie that dies with the token", async () => {
    // Next's draft mode is one boolean for the whole host, so the cookie is
    // what keeps a link meant for ONE page from unlocking every draft.
    const { token, expiresAt } = await signPreviewToken(SCOPE, TEST_SECRET, {
      generation: GENERATION,
    });
    const { route } = routeFor();

    const header = cookiesFrom(await route.GET(request(token))).header;

    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Secure");
    expect(header).toContain(`Expires=${expiresAt.toUTCString()}`);
  });

  describe("refusals", () => {
    const cases: Array<[string, () => Promise<Request>]> = [
      ["no token at all", () => Promise.resolve(request())],
      ["an empty token", () => Promise.resolve(request(""))],
      ["a garbage token", () => Promise.resolve(request("not-a-jwt"))],
      [
        "a token signed with another secret",
        async () =>
          request(
            (
              await signPreviewToken(SCOPE, `${TEST_SECRET}-other`, {
                generation: GENERATION,
              })
            ).token
          ),
      ],
      [
        "a revoked token",
        async () =>
          request(
            (
              await signPreviewToken(SCOPE, TEST_SECRET, {
                generation: GENERATION - 1,
              })
            ).token
          ),
      ],
    ];

    for (const [label, build] of cases) {
      it(`answers 404 to ${label}, and identically`, async () => {
        const { route, enable } = routeFor();

        const response = await route.GET(await build());

        // Every failure looks the same: anything else makes the endpoint an
        // oracle for which entries have unpublished drafts.
        expect(response.status).toBe(404);
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(response.headers.get("location")).toBeNull();
        expect(enable).not.toHaveBeenCalled();
      });
    }

    it("refuses to redirect anywhere but this site", async () => {
      // The target comes from the app rather than the request, so this guards a
      // mistake — but an open redirect wearing a preview link is worth making
      // unreachable.
      const { token } = await signPreviewToken(SCOPE, TEST_SECRET, {
        generation: GENERATION,
      });

      for (const target of [
        "//evil.example/x",
        // A special scheme normalises a backslash to a slash, so these resolve
        // to another host while still starting with a single "/".
        "/\\evil.example/x",
        "/\\\\evil.example/x",
        "https://evil.example/x",
        "javascript:alert(1)",
        // Not off-site, but not a path either: a bare relative target resolves
        // against the ROUTE's own directory, so it would silently send the
        // visitor somewhere under /api rather than where the app meant.
        "pages/entry-1",
        // No fixed sentinel origin can be named to slip past the check, because
        // there is no fixed sentinel origin: the target is resolved against the
        // request's own.
        "//nextly.invalid/x",
        "///nextly.invalid/x",
      ]) {
        const { route, enable } = routeFor({ redirectTo: () => target });
        const response = await route.GET(request(token));

        expect(response.status).toBe(404);
        expect(response.headers.get("location")).toBeNull();
        expect(enable).not.toHaveBeenCalled();
      }
    });

    it("refuses a link whose target cannot be resolved", async () => {
      // A preview link outlives what it points at. When the entry has been
      // deleted since the link was minted, the app's lookup rejects — and a 500
      // here while every other failure answers 404 would make the endpoint an
      // oracle again, separating entries that once existed from those that
      // never did.
      const { token } = await signPreviewToken(SCOPE, TEST_SECRET, {
        generation: GENERATION,
      });

      for (const redirectTo of [
        () => {
          throw new Error("entry was deleted");
        },
        () => Promise.reject(new Error("entry was deleted")),
        // Saying so without throwing, which is the shape an app should reach
        // for first.
        () => null,
      ]) {
        const { route, enable } = routeFor({ redirectTo });
        const response = await route.GET(request(token));

        expect(response.status).toBe(404);
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(enable).not.toHaveBeenCalled();
      }
    });

    it("sends the normalised target rather than the string it checked", async () => {
      // CR, LF and NUL in a path — from a slug field, say — make the `Response`
      // constructor throw when they reach a header raw. Emitting what the URL
      // parser produced closes the gap between the value that was validated and
      // the value that is used: the parser strips CR and LF and percent-encodes
      // NUL, so the header cannot carry a second one.
      const { token } = await signPreviewToken(SCOPE, TEST_SECRET, {
        generation: GENERATION,
      });
      const CR = String.fromCharCode(13);
      const LF = String.fromCharCode(10);
      const NUL = String.fromCharCode(0);

      for (const target of [
        `/pages/a${CR}${LF}X-Injected: yes`,
        `/pages/a${LF}X-Injected: yes`,
        `/pages/a${NUL}b`,
      ]) {
        const { route, enable } = routeFor({ redirectTo: () => target });
        const response = await route.GET(request(token));

        expect(response.status).toBe(307);
        const location = response.headers.get("location") ?? "";
        expect(location).not.toContain(CR);
        expect(location).not.toContain(LF);
        expect(location).not.toContain(NUL);
        expect(response.headers.get("x-injected")).toBeNull();
        expect(enable).toHaveBeenCalledOnce();
      }
    });

    it("keeps the query and fragment of a target it accepts", async () => {
      // Normalising must not quietly drop the parts of a path a preview link
      // needs — a locale query or an anchor into the page being reviewed.
      const { token } = await signPreviewToken(SCOPE, TEST_SECRET, {
        generation: GENERATION,
      });
      const { route } = routeFor({
        redirectTo: () => "/pages/entry-1?locale=fr#section-2",
      });

      const response = await route.GET(request(token));

      expect(response.headers.get("location")).toBe(
        "/pages/entry-1?locale=fr#section-2"
      );
    });
  });
});

/**
 * The shape Next's own cookie store hands back: more than this reader needs,
 * which is the point — the exported type has to accept it.
 */
interface NextRequestCookie {
  name: string;
  value: string;
}
const storedCookie: NextRequestCookie = {
  name: PREVIEW_SCOPE_COOKIE,
  value: "",
};

describe("the reader shapes both supported Next majors supply", () => {
  // These are COMPILE-time assertions. Vitest does not typecheck, so a runtime
  // test of a sync reader passes whatever the exported signature says; what
  // makes these load-bearing is `tsc --noEmit -p tsconfig.tests.json`, which
  // CI runs. An app on Next 14 gets synchronous helpers and one on Next 15 gets
  // promises, and the peer range covers both, so a signature that required
  // either alone would fail to typecheck in half the supported apps.
  const next14Cookies: PreviewScopeReaderConfig["cookies"] = () => ({
    get: (_name: string): NextRequestCookie | undefined => storedCookie,
  });
  const next15Cookies: PreviewScopeReaderConfig["cookies"] = () =>
    Promise.resolve({
      get: (_name: string): NextRequestCookie | undefined => storedCookie,
    });
  const next14Draft: PreviewRouteConfig["draftMode"] = () => ({
    enable: () => undefined,
  });
  const next15Draft: PreviewRouteConfig["draftMode"] = () =>
    Promise.resolve({ enable: () => undefined });

  it("reads a cookie store from either major", async () => {
    for (const cookies of [next14Cookies, next15Cookies]) {
      // The stored value is empty, so this exercises the call rather than a
      // grant; the assertion that matters is that both assignments above
      // compile.
      expect(
        await readPreviewScope({
          secret: TEST_SECRET,
          generation: GENERATION,
          cookies,
        })
      ).toBeNull();
    }
  });

  it("enables draft mode from either major", async () => {
    const { token } = await signPreviewToken(SCOPE, TEST_SECRET, {
      generation: GENERATION,
    });

    for (const draftMode of [next14Draft, next15Draft]) {
      const response = await createPreviewRoute({
        secret: TEST_SECRET,
        generation: GENERATION,
        redirectTo: () => "/pages/entry-1",
        draftMode,
      }).GET(request(token));

      expect(response.status).toBe(307);
    }
  });
});

describe("request input the reader must survive", () => {
  it("treats a cookie that cannot be decoded as no session", async () => {
    // A cookie is request input whoever wrote it, and "%" alone makes
    // decodeURIComponent throw — which would answer a page request with a 500
    // rather than simply no preview.
    const scope = await readPreviewScope({
      secret: TEST_SECRET,
      generation: GENERATION,
      cookies: () => Promise.resolve({ get: () => ({ value: "%" }) }),
    });

    expect(scope).toBeNull();
  });

  it("accepts synchronous cookies(), as Next 14 supplies", async () => {
    // The peer range covers Next 14, where these helpers are synchronous.
    const scope = await readPreviewScope({
      secret: TEST_SECRET,
      generation: GENERATION,
      cookies: () => ({ get: () => undefined }),
    });

    expect(scope).toBeNull();
  });

  it("accepts a synchronous draftMode(), as Next 14 supplies", async () => {
    const { token } = await signPreviewToken(SCOPE, TEST_SECRET, {
      generation: GENERATION,
    });
    const enable = vi.fn();
    const route = createPreviewRoute({
      secret: TEST_SECRET,
      generation: GENERATION,
      redirectTo: () => "/pages/entry-1",
      draftMode: () => ({ enable }),
    });

    const response = await route.GET(request(token));

    expect(response.status).toBe(307);
    expect(enable).toHaveBeenCalledOnce();
  });
});

describe("what a preview session may read", () => {
  async function sessionFor(scope = SCOPE, generation = GENERATION) {
    const { token } = await signPreviewToken(scope, TEST_SECRET, {
      generation,
    });
    const { route } = routeFor();
    return cookiesFrom(await route.GET(request(token)));
  }

  it("reports the document the link named", async () => {
    const store = await sessionFor();

    const scope = await readPreviewScope({
      secret: TEST_SECRET,
      generation: GENERATION,
      cookies: () => Promise.resolve(store),
    });

    expect(scope).toEqual(SCOPE);
  });

  it("grants that document and refuses every other", async () => {
    const store = await sessionFor();
    const scope = await readPreviewScope({
      secret: TEST_SECRET,
      generation: GENERATION,
      cookies: () => Promise.resolve(store),
    });

    expect(previewGrantsDraft(scope, SCOPE)).toBe(true);
    expect(
      previewGrantsDraft(scope, { collection: "pages", entryId: "entry-2" })
    ).toBe(false);
    expect(
      previewGrantsDraft(scope, { collection: "posts", entryId: "entry-1" })
    ).toBe(false);
    // No session at all grants nothing, which is the default for every visitor.
    expect(previewGrantsDraft(null, SCOPE)).toBe(false);
  });

  it("stops granting the moment the generation moves", async () => {
    // The session is re-verified on every read rather than trusted because the
    // route once said yes, so revoking reaches sessions already in flight.
    const store = await sessionFor();

    const scope = await readPreviewScope({
      secret: TEST_SECRET,
      generation: GENERATION + 1,
      cookies: () => Promise.resolve(store),
    });

    expect(scope).toBeNull();
    expect(previewGrantsDraft(scope, SCOPE)).toBe(false);
  });

  it("reports nothing when there is no cookie", async () => {
    const scope = await readPreviewScope({
      secret: TEST_SECRET,
      generation: GENERATION,
      cookies: () => Promise.resolve({ get: () => undefined }),
    });

    expect(scope).toBeNull();
  });
});
