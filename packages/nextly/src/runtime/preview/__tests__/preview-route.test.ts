import { describe, expect, it, vi } from "vitest";

import { signPreviewToken } from "../../../auth/preview/preview-token";
import {
  PREVIEW_SCOPE_COOKIE,
  createPreviewRoute,
  previewGrantsDraft,
  readPreviewScope,
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
    redirectTo: scope => `/${scope.collection}/${scope.entryId}`,
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
        "https://evil.example/x",
        "javascript:alert(1)",
      ]) {
        const { route, enable } = routeFor({ redirectTo: () => target });
        const response = await route.GET(request(token));

        expect(response.status).toBe(404);
        expect(enable).not.toHaveBeenCalled();
      }
    });
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
