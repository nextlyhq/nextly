/**
 * Where a preview token sends the visitor.
 *
 * The cases that matter here are the refusals. A resolver that answers a path
 * whenever it can produce one hands the preview route a redirect target for an
 * entry that was deleted, for a collection that declares no preview, and — the
 * one with teeth — for a host that is not the site's.
 */
import { describe, expect, it, vi } from "vitest";

import {
  resolvePreviewRedirect,
  type PreviewRedirectDeps,
} from "../preview-redirect-resolver";

const SCOPE = { collection: "pages", entryId: "entry-1" };

function deps(
  overrides: Partial<PreviewRedirectDeps> = {}
): PreviewRedirectDeps {
  return {
    loadEntry: vi.fn().mockResolvedValue({ id: "entry-1", slug: "about" }),
    loadDeclaration: vi.fn().mockResolvedValue({ urlTemplate: "/{slug}" }),
    loadSiteUrl: vi.fn().mockResolvedValue("https://site.example"),
    ...overrides,
  };
}

describe("resolvePreviewRedirect", () => {
  it("reduces a resolved URL on the site's own origin to a site-relative path", async () => {
    expect(await resolvePreviewRedirect(SCOPE, deps())).toBe("/about");
  });

  it("keeps the query and hash of a resolved URL", async () => {
    const d = deps({
      loadDeclaration: vi
        .fn()
        .mockResolvedValue({ urlTemplate: "/{slug}?a=1#top" }),
    });

    expect(await resolvePreviewRedirect(SCOPE, d)).toBe("/about?a=1#top");
  });

  // The security case. A collection's `preview.url` is application code that may
  // return any host at all, so removing the origin rather than comparing it
  // turns another site's URL into a path the route's own site-relative guard
  // then approves — the guard runs, passes, and was handed a value that had
  // already lost the evidence it exists to judge.
  it("refuses a resolved URL whose origin is not the configured site's", async () => {
    const d = deps({
      loadDeclaration: vi
        .fn()
        .mockResolvedValue({ url: () => "https://elsewhere.example/x" }),
    });

    expect(await resolvePreviewRedirect(SCOPE, d)).toBeNull();
  });

  // A link outlives what it points at: the entry can be deleted between minting
  // and clicking, which is a refusal rather than a fault.
  it("returns null when the entry no longer exists", async () => {
    const d = deps({ loadEntry: vi.fn().mockResolvedValue(null) });

    expect(await resolvePreviewRedirect(SCOPE, d)).toBeNull();
  });

  it("returns null when the collection declares no preview", async () => {
    const d = deps({ loadDeclaration: vi.fn().mockResolvedValue(undefined) });

    expect(await resolvePreviewRedirect(SCOPE, d)).toBeNull();
  });

  it("returns null when a template placeholder has no value yet", async () => {
    const d = deps({ loadEntry: vi.fn().mockResolvedValue({ id: "entry-1" }) });

    expect(await resolvePreviewRedirect(SCOPE, d)).toBeNull();
  });

  // Distinct from every case above, because a guess IS available here and is
  // wrong: without a site URL the only origin in reach is the admin's own.
  it("returns null when no site URL is configured", async () => {
    const d = deps({ loadSiteUrl: vi.fn().mockResolvedValue(null) });

    expect(await resolvePreviewRedirect(SCOPE, d)).toBeNull();
  });
});
