/**
 * The diagnostic for the failure that looks like nothing.
 *
 * A route with no `draft` hook is the normal configuration for most pages. But
 * a request arriving at one WITH a valid preview credential is a mistake nobody
 * can see: the reviewer gets a 404 they cannot tell from an expired link, the
 * editor was told the link was copied, and the developer has no signal at all.
 *
 * Two properties matter here and they pull against each other — the warning has
 * to fire in development, and production has to stay silent, because a
 * production 404 that varied by cause would let a stranger discover which
 * entries exist in draft.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signPreviewToken } from "../../../auth/preview/preview-token";
import { PREVIEW_SCOPE_COOKIE } from "../../preview/preview-route";

const SECRET = "content-route-warning-secret-at-least-32ch!!";

let cookieValue: string | undefined;

vi.mock("../../preview/preview-route-defaults", () => ({
  defaultSecret: () => SECRET,
  defaultGeneration: () => Promise.resolve(1),
  defaultCookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === PREVIEW_SCOPE_COOKIE && cookieValue !== undefined
          ? { value: cookieValue }
          : undefined,
    }),
}));

const { createContentRoute } = await import("../content-route");

/** A route with NO draft hook — the configuration this warning is about. */
function routeWithoutGate() {
  return createContentRoute({
    collections: ["pages"],
    render: (entry: unknown) => entry,
    nextly: {
      find: () => Promise.resolve({ docs: [], totalDocs: 0 }),
      findByID: () => Promise.resolve(null),
    } as never,
  });
}

async function cookieFor(collection: string): Promise<void> {
  const { token } = await signPreviewToken(
    { collection, entryId: "entry-1" },
    SECRET,
    { generation: 1, minter: "minter-1" }
  );
  cookieValue = encodeURIComponent(token);
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  cookieValue = undefined;
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  vi.unstubAllEnvs();
});

describe("a preview credential meeting a route with no draft hook", () => {
  // The hook runs before a path is resolved, so it cannot know whether THIS
  // request wanted the draft. A visitor holding a preview cookie goes on
  // browsing, and every published page they open in the same collection reaches
  // the same branch — so the diagnostic is stated once and worded as a fact
  // about the route rather than a prediction about the request.
  it("warns once, however many pages the visitor then opens", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await cookieFor("pages");

    const route = routeWithoutGate();
    for (const slug of ["about", "contact", "pricing"]) {
      await route
        .ContentPage({ params: { slug: [slug] } })
        .catch(() => undefined);
    }

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns in development, naming the hook that is missing", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await cookieFor("pages");

    await routeWithoutGate()
      .ContentPage({ params: { slug: ["about"] } })
      .catch(() => undefined);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("previewDraftGate")
    );
  });

  // The security half. A production 404 that varied by cause would answer the
  // question "does this entry have a draft" for anyone who asked.
  it("stays silent in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await cookieFor("pages");

    await routeWithoutGate()
      .ContentPage({ params: { slug: ["about"] } })
      .catch(() => undefined);

    expect(warn).not.toHaveBeenCalled();
  });

  // The overwhelmingly common request: an ordinary visitor with no preview
  // cookie. Warning here would make every page view of every site noisy, and a
  // warning nobody can act on is one everybody learns to ignore.
  it("says nothing for a visitor carrying no preview credential", async () => {
    vi.stubEnv("NODE_ENV", "development");

    await routeWithoutGate()
      .ContentPage({ params: { slug: ["about"] } })
      .catch(() => undefined);

    expect(warn).not.toHaveBeenCalled();
  });

  // Scoped to the collection the token names. A site serving several
  // collections would otherwise warn on every route a previewing visitor
  // touched, including the ones correctly serving published content.
  it("says nothing when the token names a different collection", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await cookieFor("posts");

    await routeWithoutGate()
      .ContentPage({ params: { slug: ["about"] } })
      .catch(() => undefined);

    expect(warn).not.toHaveBeenCalled();
  });
});
