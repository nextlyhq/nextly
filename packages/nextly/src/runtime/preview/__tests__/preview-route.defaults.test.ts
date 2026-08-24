/**
 * `createPreviewRoute()` with nothing passed to it.
 *
 * The factory was previously unusable without four arguments, every one of
 * which is a fact about the booted instance rather than a decision the site
 * makes — so no application ever wrote them and the route was never mounted.
 * What matters here is that the no-argument form works AND that each default
 * is still an override, because a default nobody can replace is a different
 * defect from a default nobody can reach.
 */
import { describe, expect, it, vi } from "vitest";

import { signPreviewToken } from "../../../auth/preview/preview-token";
import { createPreviewRoute } from "../preview-route";

const TEST_SECRET = "preview-route-test-secret-at-least-32-chars!!";

const enable = vi.fn();
const generationReads = vi.fn();
const defaultRedirectTo = vi.fn().mockResolvedValue("/about");

vi.mock("../preview-route-defaults", () => ({
  defaultSecret: () => TEST_SECRET,
  defaultGeneration: () => {
    generationReads();
    return Promise.resolve(1);
  },
  defaultDraftMode: () => Promise.resolve({ enable }),
  defaultCookies: () => Promise.resolve({ get: () => undefined }),
  defaultRedirectTo: (...args: unknown[]) => defaultRedirectTo(...args),
}));

async function tokenFor(): Promise<string> {
  const { token } = await signPreviewToken(
    { collection: "pages", entryId: "entry-1" },
    TEST_SECRET,
    { generation: 1, minter: "minter-1" }
  );
  return token;
}

function request(token: string): Request {
  const url = new URL("https://site.example/api/preview");
  url.searchParams.set("token", token);
  return new Request(url);
}

describe("createPreviewRoute with no arguments", () => {
  it("is callable with no config at all and redirects using the defaults", async () => {
    const { GET } = createPreviewRoute();

    const response = await GET(request(await tokenFor()));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/about");
  });

  it("asks the default resolver for the scope the token names", async () => {
    const { GET } = createPreviewRoute();

    await GET(request(await tokenFor()));

    expect(defaultRedirectTo).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "pages", entryId: "entry-1" }),
      // The origin serving THIS request, so a resolver can judge an absolute
      // preview URL on an installation that has configured no site URL.
      { requestOrigin: "https://site.example" }
    );
  });

  it("still sets the preview scope cookie", async () => {
    const { GET } = createPreviewRoute();

    const response = await GET(request(await tokenFor()));

    expect(response.headers.get("set-cookie")).toContain("__nextly_preview=");
  });

  it("still enables draft mode", async () => {
    enable.mockClear();
    const { GET } = createPreviewRoute();

    await GET(request(await tokenFor()));

    expect(enable).toHaveBeenCalled();
  });

  it("lets an explicit redirectTo override the default", async () => {
    const redirectTo = vi.fn().mockReturnValue("/overridden");
    const { GET } = createPreviewRoute({ redirectTo });

    const response = await GET(request(await tokenFor()));

    expect(redirectTo).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "pages", entryId: "entry-1" }),
      { requestOrigin: "https://site.example" }
    );
    expect(response.headers.get("location")).toBe("/overridden");
  });

  // A token signed with the DEFAULT secret refused by a route configured with a
  // different one. Asserting the override is consulted rather than merely
  // accepted: a route that ignored it would answer 307 here.
  it("lets an explicit secret override the default", async () => {
    const { GET } = createPreviewRoute({
      secret: "a-completely-different-secret-32chars!!",
    });

    const response = await GET(request(await tokenFor()));

    expect(response.status).toBe(404);
  });

  // Reading the revocation counter is a database query. Anything that resolves
  // it before a signature has been checked lets unauthenticated traffic force a
  // settings read by sending arbitrary bytes — on this endpoint, and on every
  // content request that consults a preview cookie.
  it("does not read the revocation generation for a malformed token", async () => {
    generationReads.mockClear();
    const { GET } = createPreviewRoute();

    const response = await GET(request("not-a-token"));

    expect(response.status).toBe(404);
    expect(generationReads).not.toHaveBeenCalled();
  });

  it("still reads it for a token whose signature checks out", async () => {
    generationReads.mockClear();
    const { GET } = createPreviewRoute();

    await GET(request(await tokenFor()));

    expect(generationReads).toHaveBeenCalled();
  });

  // Same argument as the secret: a route reading the override rejects a token
  // minted under a generation that is no longer current.
  it("lets an explicit generation override the default", async () => {
    const { GET } = createPreviewRoute({ generation: 2 });

    const response = await GET(request(await tokenFor()));

    expect(response.status).toBe(404);
  });
});
