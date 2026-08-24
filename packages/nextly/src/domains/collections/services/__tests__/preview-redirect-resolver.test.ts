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
  // A localized entry keeps its slug in a companion row per language. Reading
  // without the token's locale resolves the DEFAULT language's slug, so the
  // link redirects to a different translation — and the draft gate, which does
  // carry the locale, then refuses the very draft the link was minted for.
  it("reads the entry in the locale the token names", async () => {
    const loadEntry = vi
      .fn()
      .mockResolvedValue({ id: "entry-1", slug: "a-propos" });
    const d = deps({ loadEntry });

    await resolvePreviewRedirect({ ...SCOPE, locale: "fr" }, d);

    expect(loadEntry).toHaveBeenCalledWith("pages", "entry-1", "fr");
  });

  it("passes no locale when the token names none", async () => {
    const loadEntry = vi
      .fn()
      .mockResolvedValue({ id: "entry-1", slug: "about" });
    const d = deps({ loadEntry });

    await resolvePreviewRedirect(SCOPE, d);

    expect(loadEntry).toHaveBeenCalledWith("pages", "entry-1", undefined);
  });

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

  // No site URL is the DEFAULT state of a fresh install, and it must not break
  // preview. The admin needs an absolute URL because it may be served from
  // another origin entirely; this route is already ON the site, so a relative
  // path is all it ever needed. Refusing here would mean preview never works
  // until someone happens to fill in a settings field it does not depend on.
  it("still resolves a path when no site URL is configured", async () => {
    const d = deps({ loadSiteUrl: vi.fn().mockResolvedValue(null) });

    expect(await resolvePreviewRedirect(SCOPE, d)).toBe("/about");
  });

  // A collection may return an ABSOLUTE url, which `resolvePreviewUrl` passes
  // through as `resolved` whether or not a site URL is set. On a fresh install
  // there is then nothing configured to compare it against — but the request
  // being served came from the site's own origin, which is the honest
  // comparison and the one the route supplies.
  it("accepts an absolute url on the requesting origin when no site url is set", async () => {
    const d = deps({
      loadSiteUrl: vi.fn().mockResolvedValue(null),
      loadDeclaration: vi
        .fn()
        .mockResolvedValue({ url: () => "https://site.example/about" }),
    });

    expect(await resolvePreviewRedirect(SCOPE, d, "https://site.example")).toBe(
      "/about"
    );
  });

  it("still refuses an absolute url on another origin", async () => {
    const d = deps({
      loadSiteUrl: vi.fn().mockResolvedValue(null),
      loadDeclaration: vi
        .fn()
        .mockResolvedValue({ url: () => "https://elsewhere.example/x" }),
    });

    expect(
      await resolvePreviewRedirect(SCOPE, d, "https://site.example")
    ).toBeNull();
  });

  // The configured site URL wins where both exist: an admin may be proxied, and
  // the site's declared address is the deliberate answer.
  it("prefers the configured site url over the requesting origin", async () => {
    const d = deps({
      loadDeclaration: vi
        .fn()
        .mockResolvedValue({ url: () => "https://site.example/about" }),
    });

    expect(
      await resolvePreviewRedirect(SCOPE, d, "https://proxy.example")
    ).toBe("/about");
  });

  // With no site URL there is no origin to compare against, so the site-relative
  // shape has to be checked directly. A protocol-relative `//host` is a URL to
  // another origin wearing a path's clothes, and it reaches this branch because
  // it does not parse as absolute either.
  it("refuses a protocol-relative path when no site URL is configured", async () => {
    const d = deps({
      loadSiteUrl: vi.fn().mockResolvedValue(null),
      loadDeclaration: vi
        .fn()
        .mockResolvedValue({ url: () => "//elsewhere.example/x" }),
    });

    expect(await resolvePreviewRedirect(SCOPE, d)).toBeNull();
  });

  it("refuses a backslash-prefixed path when no site URL is configured", async () => {
    const d = deps({
      loadSiteUrl: vi.fn().mockResolvedValue(null),
      loadDeclaration: vi
        .fn()
        .mockResolvedValue({ url: () => String.raw`/\elsewhere.example` }),
    });

    expect(await resolvePreviewRedirect(SCOPE, d)).toBeNull();
  });
});
