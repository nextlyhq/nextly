/**
 * Where a preview token sends the visitor.
 *
 * The cases that matter here are the refusals. A resolver that answers a path
 * whenever it can produce one hands the preview route a redirect target for an
 * entry that was deleted, for a collection that declares no preview, and — the
 * one with teeth — for a host that is not the site's.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";

import * as resolverModule from "../preview-redirect-resolver";
import {
  explainPreviewRedirect,
  explainSinglePreviewRedirect,
  previewCallerAuthorized,
  readOrReport,
  resolvePreviewRedirect,
  resolveSinglePreviewRedirect,
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
const CALLER = previewCallerAuthorized({ userId: "u1" });

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
      "readOrReport",
      "resolvePreviewRedirect",
      "resolveSinglePreviewRedirect",
    ]);
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
        CALLER
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
        CALLER
      )
    ).toEqual({ kind: "refused", cause: "foreignOrigin" });
  });

  it("answers a path when there is one", async () => {
    expect(
      await explainSinglePreviewRedirect(
        { single: "homepage" },
        singleDeps(),
        CALLER
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
