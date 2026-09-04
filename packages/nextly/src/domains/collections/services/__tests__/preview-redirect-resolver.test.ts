/**
 * Where a preview token sends the visitor.
 *
 * The cases that matter here are the refusals. A resolver that answers a path
 * whenever it can produce one hands the preview route a redirect target for an
 * entry that was deleted, for a collection that declares no preview, and — the
 * one with teeth — for a host that is not the site's.
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";

import * as resolverModule from "../preview-redirect-resolver";
import {
  explainPreviewRedirect,
  explainSinglePreviewRedirect,
  previewCallerAuthorized,
  readFromEnvelope,
  readOrReport,
  resolvePreviewRedirect,
  resolveSinglePreviewRedirect,
  type AuthorizedPreviewCaller,
  type PreviewRedirectDeps,
  type SinglePreviewRedirectDeps,
} from "../preview-redirect-resolver";

const SCOPE = { collection: "pages", entryId: "entry-1" };

/**
 * Loaders on the discriminated read shape.
 *
 * Named rather than spelled out at each site because the three cases are the
 * point: a loader that folds a FAILED read into "no such document" is what made
 * a database hiccup arrive as "this may have been deleted".
 */
const reads = (document: Record<string, unknown>) =>
  vi.fn().mockResolvedValue({ kind: "document", document });
const absent = () => vi.fn().mockResolvedValue({ kind: "absent" });
const unreadable = () => vi.fn().mockResolvedValue({ kind: "unreadable" });

/**
 * Proof of authorization, which the explaining façades demand.
 *
 * Obtainable only from `previewCallerAuthorized`, which is the control: the
 * symbol behind the type is not exported, so no anonymous handler can conjure
 * one and reach a refusal cause.
 */
const PRINCIPAL = { id: "u1" };

/** A grant for the entry `SCOPE` names, which is what most cases ask about. */
const CALLER = previewCallerAuthorized(PRINCIPAL, SCOPE);

/** A grant for the Single the Single cases ask about. */
const SINGLE_CALLER = previewCallerAuthorized(PRINCIPAL, {
  single: "homepage",
});

/**
 * Are these two types EXACTLY the same, in both directions?
 *
 * Assignability alone is one-directional: `CALLER` assigns happily to
 * `unknown` and to `AuthorizedPreviewCaller | undefined`, so an assignment test
 * stays green through precisely the widening it exists to catch. The
 * conditional-on-a-generic-signature trick is the standard way to ask for
 * identity rather than compatibility.
 */
type Exactly<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

function deps(
  overrides: Partial<PreviewRedirectDeps> = {}
): PreviewRedirectDeps {
  return {
    loadEntry: reads({ id: "entry-1", slug: "about" }),
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
    const loadEntry = reads({ id: "entry-1", slug: "a-propos" });
    const d = deps({ loadEntry });

    await resolvePreviewRedirect({ ...SCOPE, locale: "fr" }, d);

    expect(loadEntry).toHaveBeenCalledWith("pages", "entry-1", "fr");
  });

  it("passes no locale when the token names none", async () => {
    const loadEntry = reads({ id: "entry-1", slug: "about" });
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
    const d = deps({ loadEntry: absent() });

    expect(await resolvePreviewRedirect(SCOPE, d)).toBeNull();
  });

  it("returns null when the collection declares no preview", async () => {
    const d = deps({ loadDeclaration: vi.fn().mockResolvedValue(undefined) });

    expect(await resolvePreviewRedirect(SCOPE, d)).toBeNull();
  });

  it("returns null when a template placeholder has no value yet", async () => {
    const d = deps({ loadEntry: reads({ id: "entry-1" }) });

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

describe("resolveSinglePreviewRedirect", () => {
  function singleDeps(
    overrides: Partial<SinglePreviewRedirectDeps> = {}
  ): SinglePreviewRedirectDeps {
    return {
      loadSingle: reads({ path: "welcome" }),
      loadDeclaration: vi.fn().mockResolvedValue({ url: () => "/" }),
      loadSiteUrl: vi.fn().mockResolvedValue("https://site.example"),
      ...overrides,
    };
  }

  it("answers the path the declaration names", async () => {
    expect(
      await resolveSinglePreviewRedirect({ single: "homepage" }, singleDeps())
    ).toBe("/");
  });

  it("reads the Single in the locale the token names", async () => {
    const loadSingle = reads({ path: "accueil" });

    await resolveSinglePreviewRedirect(
      { single: "homepage", locale: "fr" },
      singleDeps({ loadSingle })
    );

    expect(loadSingle).toHaveBeenCalledWith("homepage", "fr");
  });

  it("can derive the path from the Single's own document", async () => {
    const d = singleDeps({
      loadDeclaration: vi.fn().mockResolvedValue({
        url: (doc: Record<string, unknown>) => `/${String(doc.path)}`,
      }),
    });

    expect(await resolveSinglePreviewRedirect({ single: "landing" }, d)).toBe(
      "/welcome"
    );
  });

  it("returns null when the Single declares no preview", async () => {
    const d = singleDeps({
      loadDeclaration: vi.fn().mockResolvedValue(undefined),
    });

    expect(
      await resolveSinglePreviewRedirect({ single: "homepage" }, d)
    ).toBeNull();
  });

  // A Single is not deleted the way an entry is, but it can be dropped from the
  // configuration — and a link minted before that points at nothing.
  it("returns null when the Single can no longer be read", async () => {
    const d = singleDeps({ loadSingle: absent() });

    expect(
      await resolveSinglePreviewRedirect({ single: "homepage" }, d)
    ).toBeNull();
  });

  // The same refusal the entry path makes, reached through the SAME reduction
  // rather than a second origin comparison written beside it.
  it("refuses an absolute url on another origin", async () => {
    const d = singleDeps({
      loadDeclaration: vi
        .fn()
        .mockResolvedValue({ url: () => "https://elsewhere.example/x" }),
    });

    expect(
      await resolveSinglePreviewRedirect({ single: "homepage" }, d)
    ).toBeNull();
  });

  it("works with no site url configured, as a fresh install has none", async () => {
    const d = singleDeps({
      loadSiteUrl: vi.fn().mockResolvedValue(null),
      loadDeclaration: vi.fn().mockResolvedValue({ url: () => "/about" }),
    });

    expect(await resolveSinglePreviewRedirect({ single: "homepage" }, d)).toBe(
      "/about"
    );
  });
});

/**
 * Every refusal, as the deps that produce it.
 *
 * A table because the pair of assertions below has to run over the SAME set:
 * one says each cause is named, the other says none of them is visible from
 * the route. Two hand-written lists would agree on the day they were written,
 * and the one that fell behind would be the one facing the public.
 */
const CAUSES: ReadonlyArray<{
  cause: string;
  why: string;
  deps: () => PreviewRedirectDeps;
}> = [
  {
    cause: "documentGone",
    why: "the entry was deleted between minting and clicking",
    deps: () => deps({ loadEntry: absent() }),
  },
  {
    cause: "documentUnreadable",
    why: "the read itself failed, so absence was never established",
    deps: () => deps({ loadEntry: unreadable() }),
  },
  {
    cause: "notConfigured",
    why: "the collection declares no preview at all",
    deps: () => deps({ loadDeclaration: vi.fn().mockResolvedValue(undefined) }),
  },
  {
    cause: "unavailable",
    why: "declared, but this document has no slug yet",
    deps: () => deps({ loadEntry: reads({ id: "entry-1" }) }),
  },
  {
    cause: "foreignOrigin",
    why: "the declaration named another site",
    deps: () =>
      deps({
        loadDeclaration: vi
          .fn()
          .mockResolvedValue({ url: () => "https://elsewhere.test/about" }),
      }),
  },
  {
    cause: "unresolvable",
    why: "a protocol-relative path escapes this origin",
    deps: () =>
      deps({
        loadSiteUrl: vi.fn().mockResolvedValue(null),
        loadDeclaration: vi
          .fn()
          .mockResolvedValue({ url: () => "//evil.test" }),
      }),
  },
  {
    cause: "unresolvable",
    why: "the configured site URL does not parse",
    /*
     * The `catch` branch, which the other two `unresolvable` cases do not
     * reach: one is rejected by `siteRelativePath` and the other returns before
     * any parsing happens. An absolute declaration URL skips the `noSiteUrl`
     * path entirely, so the first thing to throw is `new URL(comparisonOrigin)`
     * on the unparseable setting.
     */
    deps: () =>
      deps({
        loadSiteUrl: vi.fn().mockResolvedValue("not a url"),
        loadDeclaration: vi
          .fn()
          .mockResolvedValue({ url: () => "https://site.example/about" }),
      }),
  },
  {
    cause: "unresolvable",
    why: "an absolute url arrives with no origin to compare it against",
    /*
     * The branch reached only when BOTH origins are missing: no site URL is
     * configured AND the caller passed no request origin, while the declaration
     * returned something absolute. There is then nothing to judge the target
     * against, which is not the same as judging it and finding it foreign —
     * conflating the two would tell a developer their preview URL points at
     * another site when in fact nothing was configured to compare it to.
     */
    deps: () =>
      deps({
        loadSiteUrl: vi.fn().mockResolvedValue(null),
        loadDeclaration: vi
          .fn()
          .mockResolvedValue({ url: () => "https://anywhere.test/about" }),
      }),
  },
];

describe("explainPreviewRedirect", () => {
  it.each(CAUSES)("names $cause when $why", async ({ cause, deps: build }) => {
    expect(await explainPreviewRedirect(SCOPE, build(), CALLER)).toEqual({
      kind: "refused",
      cause,
    });
  });

  it("answers a path when there is one", async () => {
    // The control for the table above: these are refusals rather than a
    // function that refuses everything put to it.
    expect(await explainPreviewRedirect(SCOPE, deps(), CALLER)).toEqual({
      kind: "path",
      path: "/about",
    });
  });

  it("does not report a failed read as a deletion", async () => {
    /*
     * The two are a pair, so they are asserted as a pair: each alone would pass
     * against an implementation that returned the same cause for both. A read
     * that failed establishes nothing about whether the document exists, and
     * telling an editor their entry may have been deleted because the database
     * hiccuped is the wrong-diagnosis failure this type exists to end.
     */
    const gone = await explainPreviewRedirect(
      SCOPE,
      deps({ loadEntry: absent() }),
      CALLER
    );
    const failed = await explainPreviewRedirect(
      SCOPE,
      deps({ loadEntry: unreadable() }),
      CALLER
    );

    expect(gone).toEqual({ kind: "refused", cause: "documentGone" });
    expect(failed).toEqual({ kind: "refused", cause: "documentUnreadable" });
    expect(gone).not.toEqual(failed);
  });
});

describe("what this module lets anyone reach", () => {
  it("exports exactly these, and nothing else that hands out a cause", () => {
    /*
     * A MANIFEST rather than a check that one function is private, because the
     * property is about every path to a refusal cause and not about the one
     * that was found. `reduceToSitePath` became a bypass the moment its return
     * type changed from `string | null` to the detailed outcome — it was still
     * exported, and nothing noticed. This fails when the surface changes at
     * all, so a new export has to be considered rather than merely added.
     *
     * The two `explain*` façades are on the list because they demand a witness;
     * `readOrReport` and `previewCallerAuthorized` carry no cause at all.
     */
    expect(Object.keys(resolverModule).sort()).toEqual([
      "explainPreviewRedirect",
      "explainSinglePreviewRedirect",
      "previewCallerAuthorized",
      "readFromEnvelope",
      "readOrReport",
      "resolvePreviewRedirect",
      "resolveSinglePreviewRedirect",
    ]);
  });
});

describe("what the ANONYMOUS preview path is wired to", () => {
  it("never reaches an explaining façade", () => {
    /*
     * The witness makes the wrong call awkward; this makes it visible. Within
     * one package no value is unforgeable against code that means to forge one,
     * so the boundary needs a second control that reads the anonymous side
     * directly rather than trusting it to ask nicely.
     *
     * These modules serve requests carrying no session — the preview route and
     * the loaders it is built from — and a refusal cause reaching any of them
     * is the draft-existence oracle the flattening wrapper exists to prevent.
     */
    const anonymous = [
      "../../../../runtime/preview/preview-route-defaults.ts",
      "../../../../runtime/preview/preview-route.ts",
      "../../../../runtime/preview/preview-draft-gate.ts",
      "../../../../runtime/preview/preview-single-draft-gate.ts",
    ];

    for (const relative of anonymous) {
      const source = readFileSync(
        fileURLToPath(new URL(relative, import.meta.url)),
        "utf8"
      );
      // A control first: reading the wrong path returns "" and would let every
      // assertion below pass by having examined nothing.
      expect(source.length).toBeGreaterThan(0);
      expect(source).not.toMatch(/\bexplainPreviewRedirect\b/);
      expect(source).not.toMatch(/\bexplainSinglePreviewRedirect\b/);
      expect(source).not.toMatch(/\bpreviewCallerAuthorized\b/);
    }
  });
});

describe("who decides which envelope means absent", () => {
  it("is decided here, and not re-decided by either loader", () => {
    /*
     * The mint and the anonymous route both read entries through a service
     * envelope, and each used to map it itself. Two copies of one decision
     * agree until one is edited — and these two would then disagree about the
     * SAME entry, minting a link the route refuses. A source-level assertion
     * rather than a behavioural one because the defect IS the second copy: both
     * behaved identically the day it was written.
     */
    const loaders = [
      "../../../../api/preview-links.ts",
      "../../../../runtime/preview/preview-route-defaults.ts",
    ];

    for (const relative of loaders) {
      const source = readFileSync(
        fileURLToPath(new URL(relative, import.meta.url)),
        "utf8"
      );
      // Control: a mistyped path reads as "" and would let this pass having
      // examined nothing.
      expect(source.length).toBeGreaterThan(0);
      expect(source).toMatch(/\breadFromEnvelope\b/);
      expect(source).not.toMatch(/statusCode === 404/);
    }
  });
});

describe("a grant covers ONE document, not the holder", () => {
  /*
   * `requireRouteAuthentication` returns a full `AuthContext` without consulting
   * any permission — it exists for handlers doing their own per-resource
   * filtering — so a witness that demanded only that shape would be obtainable
   * by any signed-in account, including one with no access to the document it
   * then asked about. The grant names its document, and the façade compares.
   */
  it("refuses a question about a DIFFERENT entry", async () => {
    const forAnotherEntry = previewCallerAuthorized(PRINCIPAL, {
      collection: "pages",
      entryId: "entry-2",
    });

    await expect(
      explainPreviewRedirect(SCOPE, deps(), forAnotherEntry)
    ).rejects.toThrow();
  });

  it("refuses a question about a different COLLECTION", async () => {
    // Same entry id, different collection: ids are not unique across them, so
    // comparing only the id would let a grant travel between collections.
    const forAnotherCollection = previewCallerAuthorized(PRINCIPAL, {
      collection: "posts",
      entryId: "entry-1",
    });

    await expect(
      explainPreviewRedirect(SCOPE, deps(), forAnotherCollection)
    ).rejects.toThrow();
  });

  it("refuses a Single's grant on a collection question, and the reverse", async () => {
    await expect(
      explainPreviewRedirect(SCOPE, deps(), SINGLE_CALLER)
    ).rejects.toThrow();

    await expect(
      explainSinglePreviewRedirect(
        { single: "homepage" },
        {
          loadSingle: reads({ path: "welcome" }),
          loadDeclaration: vi.fn().mockResolvedValue({ url: () => "/" }),
          loadSiteUrl: vi.fn().mockResolvedValue("https://site.example"),
        },
        CALLER
      )
    ).rejects.toThrow();
  });

  it("refuses a grant for a DIFFERENT translation of the same Single", async () => {
    /*
     * `assertSinglePreviewable` runs a locale-specific readable check, so a
     * grant naming only the Single would claim more than was verified — an `en`
     * grant answering for `fr`, whose custom read rule may deny it. The locale
     * travels in the grant and the comparison asks for it.
     */
    const forEnglish = previewCallerAuthorized(PRINCIPAL, {
      single: "homepage",
      locale: "en",
    });

    await expect(
      explainSinglePreviewRedirect(
        { single: "homepage", locale: "fr" },
        {
          loadSingle: reads({ path: "accueil" }),
          loadDeclaration: vi.fn().mockResolvedValue({ url: () => "/" }),
          loadSiteUrl: vi.fn().mockResolvedValue("https://site.example"),
        },
        forEnglish
      )
    ).rejects.toThrow();
  });

  it("ALLOWS the translation the grant names", async () => {
    // The control: the refusal above is about the locale rather than the
    // comparison having stopped accepting anything.
    const forFrench = previewCallerAuthorized(PRINCIPAL, {
      single: "homepage",
      locale: "fr",
    });

    expect(
      await explainSinglePreviewRedirect(
        { single: "homepage", locale: "fr" },
        {
          loadSingle: reads({ path: "accueil" }),
          loadDeclaration: vi.fn().mockResolvedValue({ url: () => "/" }),
          loadSiteUrl: vi.fn().mockResolvedValue("https://site.example"),
        },
        forFrench
      )
    ).toEqual({ kind: "path", path: "/" });
  });

  it("still covers an UNLOCALIZED Single, where neither side names a locale", () => {
    // Both undefined must match, or every unlocalized Single would be refused
    // for a precondition nothing establishes.
    expect(() =>
      previewCallerAuthorized(PRINCIPAL, { single: "homepage" })
    ).not.toThrow();
  });

  it("ALLOWS the document the grant names", async () => {
    // The control for all four refusals above: a matching grant works, so the
    // comparison discriminates rather than rejecting everything.
    expect(await explainPreviewRedirect(SCOPE, deps(), CALLER)).toEqual({
      kind: "path",
      path: "/about",
    });
  });
});

describe("readFromEnvelope, the one place a service result becomes an outcome", () => {
  /*
   * One translator because this is a single decision. Two copies would agree
   * until one was edited, and the mint and the anonymous route would then
   * disagree about the SAME entry — minting a link the route refuses.
   */
  it("reads a 404 envelope as absence", () => {
    expect(readFromEnvelope({ success: false, statusCode: 404 })).toEqual({
      kind: "absent",
    });
  });

  it("reads a 404 carrying a CODE as unreadable, not as absence", () => {
    /*
     * The pair the `code` check exists for. A thrown `NextlyError` reaches this
     * envelope through `errorEnvelopeFields`, which always sets `code` — so an
     * `afterRead` hook raising not-found for a DEPENDENT lookup arrives as a
     * 404 while the previewed row loaded perfectly well. Calling that absence
     * tells an author their entry may have been deleted because something it
     * references was.
     */
    expect(
      readFromEnvelope({
        success: false,
        statusCode: 404,
        code: "NOT_FOUND",
      })
    ).toEqual({ kind: "unreadable" });

    // The control, asserted beside it: a BARE 404 is the service's own
    // not-found branch and still establishes absence, so the split is on
    // provenance rather than the endpoint having stopped reporting deletions.
    expect(readFromEnvelope({ success: false, statusCode: 404 })).toEqual({
      kind: "absent",
    });
  });

  it("reads any other failure as unreadable", () => {
    expect(readFromEnvelope({ success: false, statusCode: 500 })).toEqual({
      kind: "unreadable",
    });
  });

  it("reads a failure with NO status as unreadable rather than absent", () => {
    // Absence has to be established. An envelope that reports failure without
    // saying how is not evidence the document is gone.
    expect(readFromEnvelope({ success: false })).toEqual({
      kind: "unreadable",
    });
  });

  it("reads a success carrying no document as absence", () => {
    expect(readFromEnvelope({ success: true, data: null })).toEqual({
      kind: "absent",
    });
    expect(readFromEnvelope({ success: true })).toEqual({ kind: "absent" });
  });

  it("hands back the document when there is one", () => {
    expect(
      readFromEnvelope({ success: true, data: { id: "7", slug: "seven" } })
    ).toEqual({ kind: "document", document: { id: "7", slug: "seven" } });
  });
});

describe("readOrReport, for loaders that throw instead of returning", () => {
  /*
   * The Direct API has no failure envelope: `findSingle` throws for every
   * unsuccessful result. A loader that only checked for `null` produced neither
   * `absent` nor `unreadable` — the throw travelled straight past it, and the
   * endpoint answered with a raw internal error instead of the refusal it had
   * prepared. These cases exist because a mock returning `null` cannot
   * reproduce that contract, so the suite agreed with an implementation
   * production never runs.
   */
  it("reads a 404 as absence, because that status DOES establish it", async () => {
    const notFound = new NextlyError({
      code: "NOT_FOUND",
      statusCode: 404,
      publicMessage: "No such single",
    });

    expect(await readOrReport(() => Promise.reject(notFound))).toEqual({
      kind: "absent",
    });
  });

  it("reads any other failure as unreadable, never as absence", async () => {
    const boom = new NextlyError({
      code: "INTERNAL_ERROR",
      statusCode: 500,
      publicMessage: "Database unavailable",
    });

    expect(await readOrReport(() => Promise.reject(boom))).toEqual({
      kind: "unreadable",
    });
  });

  it("reads a non-Nextly throw as unreadable rather than assuming anything", async () => {
    // A driver error or a bug in a read hook arrives as a plain Error with no
    // status at all. Guessing absence from it would be the same wrong
    // diagnosis reached by a different route.
    expect(
      await readOrReport(() => Promise.reject(new Error("socket hang up")))
    ).toEqual({ kind: "unreadable" });
  });

  it("recognises a not-found thrown by ANOTHER copy of this package", async () => {
    /*
     * Next.js and Turbopack duplicate ESM modules — `getCachedNextly` keeps the
     * instance on `globalThis` for exactly that reason — so an error raised by
     * one copy is not `instanceof` the class as this copy sees it. Under
     * `instanceof` a removed Single would be reported as a transient read
     * failure, telling an author to retry something that can never succeed.
     *
     * This object carries the registry-shared brand and the code, which is what
     * the structural guard reads, and is deliberately NOT a NextlyError.
     */
    const fromAnotherCopy = Object.assign(new Error("No such single"), {
      [Symbol.for("nextly/NextlyError")]: true,
      code: "NOT_FOUND",
    });
    expect(fromAnotherCopy).not.toBeInstanceOf(NextlyError);

    expect(await readOrReport(() => Promise.reject(fromAnotherCopy))).toEqual({
      kind: "absent",
    });
  });

  it("still reads a returned null as absence", async () => {
    expect(await readOrReport(() => Promise.resolve(null))).toEqual({
      kind: "absent",
    });
  });

  it("hands back the document when there is one", async () => {
    // The control: it is a translator, not a function that reports failure
    // whatever it is given.
    expect(
      await readOrReport(() => Promise.resolve({ path: "welcome" }))
    ).toEqual({ kind: "document", document: { path: "welcome" } });
  });
});

describe("the authenticated boundary on the explaining form", () => {
  /*
   * The parameter SHAPE, asserted two ways, and neither is a suppressed error.
   *
   * A blanket directive would accept ANY diagnostic on the line beneath it, so
   * an unrelated signature or fixture mistake keeps the purported contract
   * green while proving nothing about the witness. Both assertions below name
   * exactly what is expected instead.
   */
  it("takes the witness as a positional parameter of its own", () => {
    /*
     * Four: scope, deps, caller, requestOrigin. A TypeScript `?` compiles to an
     * ordinary parameter with no default, so `Function.length` counts it —
     * which means this is 4 while the witness is present and 3 the moment it is
     * removed. Evaluated at run time, and unlike a blanket directive it cannot
     * be satisfied by an unrelated error somewhere else in the file.
     */
    expect(explainPreviewRedirect).toHaveLength(4);
    expect(explainSinglePreviewRedirect).toHaveLength(4);
  });

  it("types that parameter as the proof only previewCallerAuthorized mints", () => {
    /*
     * A compile-time assertion that names its type. If the third parameter
     * stopped being `AuthorizedPreviewCaller` — widened to `unknown`, reordered,
     * or dropped — these assignments stop typechecking, and `check-types` fails
     * on THIS line rather than somewhere a directive happened to be pointing.
     */
    const witness: Parameters<typeof explainPreviewRedirect>[2] = CALLER;
    const singleWitness: Parameters<typeof explainSinglePreviewRedirect>[2] =
      CALLER;

    expect(witness).toBe(CALLER);
    expect(singleWitness).toBe(CALLER);
  });

  it("types that parameter as EXACTLY the branded proof, not merely something it fits", () => {
    /*
     * Bidirectional, because assignability is not the property. Widen that
     * parameter to `unknown` or to `AuthorizedPreviewCaller | undefined` and
     * `CALLER` still assigns, the runtime identity still holds and the arity is
     * unchanged — so the one-way assignment above returns green from both the
     * correct implementation and the widening it was written to catch. It stays
     * as a readable statement of intent; THIS is the assertion with teeth.
     *
     * Both constants are typed `true`, so any widening resolves `Exactly<…>` to
     * `false` and `check-types` fails on this line.
     */
    const entryWitnessIsExact: Exactly<
      Parameters<typeof explainPreviewRedirect>[2],
      AuthorizedPreviewCaller
    > = true;
    const singleWitnessIsExact: Exactly<
      Parameters<typeof explainSinglePreviewRedirect>[2],
      AuthorizedPreviewCaller
    > = true;

    expect(entryWitnessIsExact).toBe(true);
    expect(singleWitnessIsExact).toBe(true);
  });

  it("is minted from exactly ONE module, the authorization gate", () => {
    /*
     * THE control, and the reason the parameter shape no longer is one.
     *
     * An earlier version demanded the whole route-auth shape on the theory that
     * an anonymous handler could not produce it — a proxy for "you
     * authenticated", and a weak one, because any handler can assemble an
     * object literal and the anonymous preview route holds a real user id to
     * put in it. What establishes the claim is provenance: the grant is
     * returned by `assertEntryPreviewable` / `assertSinglePreviewable` after
     * their refusals have all been passed FOR THIS DOCUMENT, so one cannot
     * exist unless the gate ran and allowed it.
     *
     * A second importer would quietly restore the self-asserted grant, so this
     * asserts the whole importer set rather than that some particular module is
     * absent — a test naming one module passes for every module it does not
     * name.
     */
    const root = new URL("../../../../", import.meta.url);
    const importers = execFileSync(
      "grep",
      ["-rl", "--include=*.ts", "previewCallerAuthorized", fileURLToPath(root)],
      { encoding: "utf8" }
    )
      .split("\n")
      .filter(Boolean)
      .map(p => p.slice(fileURLToPath(root).length).replace(/^[\/]+/, ""))
      .filter(p => !p.includes("__tests__") && !p.endsWith(".test.ts"))
      .sort();

    // Control: the search found something, so an empty list cannot pass by
    // having looked in the wrong place.
    expect(importers.length).toBeGreaterThan(0);
    expect(importers).toEqual([
      "api/preview-access.ts",
      "domains/collections/services/preview-redirect-resolver.ts",
    ]);
  });

  /**
   * Every module reachable from `entries` by `export *` that EXPORTS the
   * constructor, relative to `root`.
   *
   * Only `export *` recurses, because only it propagates names the author did
   * not write down: a named re-export exposes exactly the identifiers in its
   * clause, which the export test below reads in place. A module that merely
   * IMPORTS the constructor to call it exposes nothing, so it is not followed —
   * otherwise every consumer would be reported and the boundary assertion would
   * fail on correct code.
   *
   * A module the map names and the tree does not have is reported rather than
   * skipped: an entry whose source cannot be found is not evidence of safety.
   */
  function modulesExportingTheConstructor(
    root: URL,
    entries: string[]
  ): string[] {
    const declaresIt =
      /export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface)\s+previewCallerAuthorized\b/;
    const listsIt = /export\s*\{[^}]*\bpreviewCallerAuthorized\b[^}]*\}/;

    /*
     * Returns WHERE the module was found as well as its text. A bundled entry
     * may be a directory index rather than a file, and a relative specifier
     * inside it resolves against that directory — so resolving children against
     * the name that was asked for sends the walk one level too high and every
     * module it names comes back missing.
     */
    const readModule = (rel: string): { at: string; source: string } | null => {
      for (const at of [rel, rel.replace(/\.ts$/, "/index.ts")]) {
        try {
          return { at, source: readFileSync(fileURLToPath(new URL(at, root)), "utf8") };
        } catch {
          continue;
        }
      }
      return null;
    };

    const seen = new Set<string>();
    const found: string[] = [];

    const walk = (rel: string): void => {
      if (seen.has(rel)) return;
      seen.add(rel);

      const module = readModule(rel);
      if (module === null) {
        found.push(rel);
        return;
      }

      /*
       * Comments are removed before anything is matched. This package's own
       * `src/index.ts` documents its barrel chain by quoting the statements
       * verbatim, so a scan over raw text follows a specifier that no module
       * actually re-exports — and reports the file it fails to find as a
       * reachable one.
       */
      const source = module.source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      const { at } = module;
      if (declaresIt.test(source) || listsIt.test(source)) {
        found.push(at);
        return;
      }

      const stars = source.matchAll(
        /export\s+\*(?:\s+as\s+\w+)?\s+from\s*["']([^"']+)["']/g
      );
      for (const [, spec] of stars) {
        if (spec === undefined || !spec.startsWith(".")) continue;
        const href = new URL(spec, new URL(at, root)).href.slice(
          root.href.length
        );
        walk(
          /\.[cm]?[jt]s$/.test(href)
            ? href.replace(/\.[cm]?js$/, ".ts")
            : `${href}.ts`
        );
      }
    };

    for (const entry of entries) walk(entry);
    return found.sort();
  }

  it("is not reachable from any of the package's PUBLIC entry points", () => {
    /*
     * The importer scan above is a syntax search over this package's own
     * sources, and on its own it would miss the escape that matters: a barrel
     * adding `export * from "…/preview-redirect-resolver"` puts the constructor
     * on the public API, after which an application outside the scanned tree
     * can self-mint a grant for any scope — and every assertion above stays
     * green, because nothing inside `src` gained a reference.
     *
     * So the entry points are checked directly, DERIVED from `package.json`
     * rather than listed here: a new export map entry is covered the day it is
     * added, which a hand-written list would not be.
     *
     * The walk is TRANSITIVE, so an intermediate barrel is followed rather than
     * ending the search: an entry re-exporting a barrel that re-exports the
     * module reaches the same verdict a direct re-export does.
     */
    const pkgRoot = new URL("../../../../../", import.meta.url);
    const pkg = JSON.parse(
      readFileSync(new URL("package.json", pkgRoot), "utf8")
    ) as { exports?: Record<string, { import?: string }> };

    /*
     * From `import`, not `types`. They do not always name the same module —
     * `./field-catalog` declares `dist/field-catalog.d.ts` beside
     * `dist/collections/fields/catalog.mjs` — and the runtime entry is the one
     * that decides what an application can actually import.
     */
    const entrySources = Object.values(pkg.exports ?? {})
      .map(e => e.import)
      .filter((i): i is string => typeof i === "string")
      .map(i => i.replace(/^\.\/dist\//, "src/").replace(/\.mjs$/, ".ts"));

    // Control: the export map was read and produced entries, so an empty list
    // cannot certify a package whose manifest this failed to parse.
    expect(entrySources.length).toBeGreaterThan(0);

    expect(modulesExportingTheConstructor(pkgRoot, entrySources)).toEqual([]);
  });

  it("follows a chain of barrels rather than stopping at the first", () => {
    /*
     * The instrument's own control. The assertion above passes when the walk
     * reports nothing, and a walk that reports nothing under any circumstances
     * satisfies it perfectly — so the walker is run against a tree whose answer
     * is known and required to NAME the module it should find.
     *
     * The fixture carries both halves of the discrimination:
     *   entry -> barrel -> leaf     re-exported, must be reported
     *   entry -> uses               imports and calls it, must NOT be reported
     *   entry's COMMENTS            quote both forms, must NOT be followed
     *
     * The second separates re-export from ordinary use. Every module consuming
     * the constructor mentions its name, so a walker matching on the name alone
     * would report the whole call graph and the real assertion above would fail
     * on correct code.
     *
     * The third names a module that does not exist, so following it produces a
     * report of an unreadable file — the shape a missing entry takes, arriving
     * from a module nobody re-exports.
     */
    const dir = mkdtempSync(join(tmpdir(), "preview-export-walk-"));
    try {
      const root = pathToFileURL(`${dir}/`);
      mkdirSync(join(dir, "barrel"));
      writeFileSync(
        join(dir, "entry.ts"),
        'export * from "./barrel/index.js";\n' +
          'export * from "./uses.js";\n' +
          '// export * from "./ghost.js";\n' +
          '/* export { previewCallerAuthorized } from "./ghost.js"; */\n'
      );
      writeFileSync(
        join(dir, "barrel", "index.ts"),
        'export * from "../leaf.js";\n'
      );
      writeFileSync(
        join(dir, "leaf.ts"),
        "export function previewCallerAuthorized() {}\n"
      );
      writeFileSync(
        join(dir, "uses.ts"),
        'import { previewCallerAuthorized } from "./leaf.js";\n' +
          "export const call = () => previewCallerAuthorized();\n"
      );

      expect(modulesExportingTheConstructor(root, ["entry.ts"])).toEqual([
        "leaf.ts",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to mint proof without an authenticated identity", () => {
    // The witness CARRIES the id rather than discarding it, so a handler with
    // no principal cannot satisfy it with a placeholder.
    let thrown: unknown;
    try {
      previewCallerAuthorized({ id: "" }, SCOPE);
    } catch (error) {
      thrown = error;
    }

    // Asserted on the LOG message and the code rather than on what a caller
    // would see: the public text is deliberately generic, because tripping this
    // is a handler's mistake and not something the requester can act on.
    expect(NextlyError.isCode(thrown, "INTERNAL_ERROR")).toBe(true);
    expect((thrown as NextlyError).logMessage).toMatch(/authenticated caller/i);
  });

  it("answers normally once the witness is supplied", async () => {
    // The control: the boundary refuses the missing proof rather than the
    // function being unusable.
    expect(await explainPreviewRedirect(SCOPE, deps(), CALLER)).toEqual({
      kind: "path",
      path: "/about",
    });
  });
});

describe("the route sees ONE refusal, whatever the cause", () => {
  /*
   * The security property, and the reason `resolvePreviewRedirect` was kept
   * rather than replaced. The preview route answers `null` with the same 404 an
   * invalid token gets, so a stranger must not be able to tell a deleted entry
   * from an unconfigured collection from one whose slug is merely empty. The
   * moment any cause reaches that caller, the endpoint is an oracle for which
   * documents exist in draft.
   */
  it.each(CAUSES)(
    "collapses $cause to a bare null",
    async ({ deps: build }) => {
      expect(await resolvePreviewRedirect(SCOPE, build())).toBeNull();
    }
  );

  it("returns the path when there is one, so null MEANS refused", async () => {
    // Without this the assertions above are satisfied by a function that
    // returns null unconditionally — which would pass while telling a visitor
    // nothing and a valid preview nothing either.
    expect(await resolvePreviewRedirect(SCOPE, deps())).toBe("/about");
  });

  it("gives every cause a byte-identical answer", async () => {
    // Stronger than each being null on its own: it is the INDISTINGUISHABILITY
    // that matters, so the set of distinct answers must have exactly one member.
    const answers = await Promise.all(
      CAUSES.map(c => resolvePreviewRedirect(SCOPE, c.deps()))
    );
    expect(new Set(answers).size).toBe(1);
    expect(answers).toHaveLength(CAUSES.length);
  });
});

describe("explainSinglePreviewRedirect", () => {
  function singleDeps(
    overrides: Partial<SinglePreviewRedirectDeps> = {}
  ): SinglePreviewRedirectDeps {
    return {
      loadSingle: reads({ path: "welcome" }),
      loadDeclaration: vi.fn().mockResolvedValue({ url: () => "/" }),
      loadSiteUrl: vi.fn().mockResolvedValue("https://site.example"),
      ...overrides,
    };
  }

  it("names documentGone when the Single was removed from the config", async () => {
    expect(
      await explainSinglePreviewRedirect(
        { single: "homepage" },
        singleDeps({ loadSingle: absent() }),
        SINGLE_CALLER
      )
    ).toEqual({ kind: "refused", cause: "documentGone" });
  });

  it("names foreignOrigin rather than blaming the document", async () => {
    // The case the editor can do nothing about, and the one they were
    // previously told to fix by filling in a slug.
    expect(
      await explainSinglePreviewRedirect(
        { single: "homepage" },
        singleDeps({
          loadDeclaration: vi
            .fn()
            .mockResolvedValue({ url: () => "https://elsewhere.test/" }),
        }),
        SINGLE_CALLER
      )
    ).toEqual({ kind: "refused", cause: "foreignOrigin" });
  });

  it("answers a path when there is one", async () => {
    expect(
      await explainSinglePreviewRedirect(
        { single: "homepage" },
        singleDeps(),
        SINGLE_CALLER
      )
    ).toEqual({ kind: "path", path: "/" });
  });

  it("still collapses to null for the route", async () => {
    expect(
      await resolveSinglePreviewRedirect(
        { single: "homepage" },
        singleDeps({ loadSingle: absent() })
      )
    ).toBeNull();
  });
});
