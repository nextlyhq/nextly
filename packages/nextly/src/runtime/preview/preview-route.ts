import {
  previewTokenCovers,
  verifyPreviewToken,
  type PreviewTokenScope,
} from "../../auth/preview/preview-token";

import { PREVIEW_COOKIE_SAME_SITE } from "./preview-frame-policy";

/**
 * The route that turns a preview link into a draft-reading session, and the
 * reader that tells the rest of the request what that session may see.
 *
 * **Why a cookie carries the token rather than a decision.** Next's draft mode
 * is a single boolean: `draftMode().enable()` sets `__prerender_bypass` for the
 * whole host, and nothing about it names a document. A preview token names
 * exactly one. Enabling draft mode alone would therefore turn a link meant for
 * one unpublished page into a key to every unpublished page on the site — the
 * opposite of what the token was scoped for.
 *
 * So the scope travels beside it: the token itself is stored, httpOnly, and
 * re-verified on every read. Storing the token rather than a decision derived
 * from it means expiry and revocation keep applying for the life of the
 * session, not just at the moment the link was clicked.
 *
 * @module runtime/preview/preview-route
 */

/**
 * What the route can tell a redirect resolver about the request in hand.
 *
 * Only the origin, and only because a resolver otherwise has no way to judge an
 * ABSOLUTE preview URL on an installation that has configured no site URL: the
 * origin serving this request is the site's, and it is the one honest thing to
 * compare against.
 */
export interface PreviewRedirectContext {
  /** The origin this request was served from. */
  requestOrigin: string;
}

/** The cookie carrying the preview token for the rest of the session. */
export const PREVIEW_SCOPE_COOKIE = "__nextly_preview";

/**
 * Every member is optional.
 *
 * Each one has a default resolved from the booted instance, so the ordinary
 * mount is `createPreviewRoute()` with no argument at all. They remain
 * overridable because the resolution genuinely is the application's to change —
 * a site that routes its own content needs its own `redirectTo`, and a test
 * needs all four — but REQUIRING them meant every value had to be restated by
 * hand in a route file, and a mount that costs a paragraph of wiring is a mount
 * that does not get written.
 *
 * The defaults are imported inside the handler rather than at the top of this
 * module. A static import would make `import { createPreviewRoute } from
 * "nextly/runtime"` pull in the service container and `next/headers` with it.
 */
export interface PreviewRouteConfig {
  /** The signing secret; the same `NEXTLY_SECRET` sessions use. Defaults to it. */
  secret?: string;
  /**
   * The site's current revocation generation. Read per request so raising it
   * ends existing preview sessions rather than only refusing new links.
   *
   * Defaults to the value stored in general settings, read per request for the
   * same reason.
   */
  generation?: number | (() => number | Promise<number>);
  /**
   * Where to send the visitor once the link checks out.
   *
   * The returned value must be a site-relative path.
   *
   * Defaults to the collection's own preview declaration — the `url` function a
   * code-first collection carries, or the `urlTemplate` a UI-created one does —
   * resolved against the configured site URL. An application whose content is
   * routed some other way supplies its own.
   *
   * Returning `null` refuses the link the same way an invalid token is
   * refused. A preview link outlives what it points at — the entry can be
   * deleted, unpublished or moved between minting and clicking — and this is
   * how an app says so without having to throw.
   */
  redirectTo?: (
    scope: PreviewTokenScope,
    context: PreviewRedirectContext
  ) => string | null | Promise<string | null>;
  /**
   * Reads and enables Next's draft mode. Injected so the route is testable.
   *
   * Accepts a synchronous return as well: `draftMode()` is sync on Next 14 and
   * async from 15, and the peer range covers both, so requiring a promise would
   * make the natural import fail to typecheck on the older one.
   *
   * Defaults to `draftMode` from `next/headers`.
   */
  draftMode?: () => { enable: () => void } | Promise<{ enable: () => void }>;
}

/**
 * A redirect target reduced to its site-relative form, or `null` if it is not
 * one.
 *
 * The value comes from the app rather than the request, so this guards a
 * mistake rather than an attack — but an open redirect built out of a preview
 * link is worth making unreachable by construction. A protocol-relative
 * `//evil.example` is a URL to another host wearing a path's clothes, which is
 * why matching a leading slash is not enough on its own.
 *
 * Two decisions, both about closing the gap between what is checked and what is
 * used:
 *
 * 1. **Resolved against the REQUEST's origin**, not a fixed sentinel. Any
 *    constant used as the base is a host that passes the check, and a public
 *    one is a host anybody can name: `//nextly.invalid/x` would be approved and
 *    then sent, taking the visitor off the site. Resolving against the request
 *    leaves exactly one origin that passes, and it is the site's own.
 * 2. **Returns the parser's normalized form** rather than the string that was
 *    checked, so the value that reaches the `Location` header is the value that
 *    was validated. The parser strips CR and LF and percent-encodes NUL; the
 *    raw string keeps them, and a header carrying one makes the `Response`
 *    constructor throw — which would happen after draft mode had been enabled,
 *    turning a refusal into a 500 with a session already granted.
 *
 * Resolution is the URL parser's job rather than this function's, because the
 * spellings that escape an origin are its to know: `//host`, `/\host` and
 * `/\\host` all reach another origin, since a special scheme normalises a
 * backslash to a slash. Asking the same parser the browser will use is the only
 * check that cannot fall behind the list.
 */
function siteRelativeTarget(target: string, requestUrl: string): string | null {
  // Tested before parsing rather than after. `https://elsewhere` and
  // `javascript:` would be caught by the origin comparison below, but a bare
  // `pages/x` resolves against the CURRENT path and would pass as a
  // site-relative target the app never meant to write.
  if (!target.startsWith("/")) return null;
  try {
    const base = new URL(requestUrl);
    const resolved = new URL(target, base);
    if (resolved.origin !== base.origin) return null;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}

/**
 * A route handler that accepts a preview link and starts a draft session.
 *
 * Every failure answers exactly the same way: 404, no body, no cookie, no draft
 * mode. A token that is expired, revoked, forged or simply absent must not be
 * distinguishable from one naming a document that does not exist — otherwise
 * the endpoint becomes an oracle for which entries are in draft.
 */
/**
 * The two values every token verification needs, resolved from a config that
 * may name neither.
 *
 * Written once and shared by the route and the scope reader rather than spelled
 * out in both. They ask the identical question — which key signs this site's
 * preview tokens, and which generation is current — and two copies of that
 * answer agree only until one of them is edited: a route that kept reading a
 * cached generation while the reader re-read it would let revoked links keep
 * working through whichever path was not updated.
 *
 * The defaults module is imported here, inside the call, so neither caller
 * pulls the service container or `next/headers` at load time.
 */
async function verificationInputs(config: {
  secret?: string;
  generation?: number | (() => number | Promise<number>);
}): Promise<{
  secret: string;
  generation: number | (() => number | Promise<number>);
}> {
  const defaults = await import("./preview-route-defaults");

  // The generation is handed on UNRESOLVED. Reading it is a database query, and
  // the verifier needs it only after a token's signature has checked out — so
  // resolving it here would put a settings read in front of every request
  // carrying arbitrary bytes, including one that is about to be refused.
  return {
    secret: config.secret ?? defaults.defaultSecret(),
    generation: config.generation ?? defaults.defaultGeneration,
  };
}

export function createPreviewRoute(config: PreviewRouteConfig = {}): {
  GET: (request: Request) => Promise<Response>;
} {
  const refuse = () => new Response(null, { status: 404 });

  // Loaded per call rather than once at factory time. Hoisting it would start
  // the dynamic import at module scope, behind a promise nothing awaits, which
  // is exactly the eager coupling this indirection exists to avoid.
  const loadDefaults = () => import("./preview-route-defaults");

  return {
    async GET(request: Request): Promise<Response> {
      const token = new URL(request.url).searchParams.get("token");
      if (token === null || token.length === 0) return refuse();

      const { secret, generation } = await verificationInputs(config);

      const verified = await verifyPreviewToken(token, secret, {
        generation,
      });
      if (!verified.valid) return refuse();

      // Everything that can fail happens before draft mode is enabled, so the
      // request is never given a session it is then refused. A lookup here is
      // the likeliest thing to reject: a link outlives what it points at, and
      // the entry can be deleted between minting and clicking. Answering that
      // with a 500 while every other failure answers 404 is what would make the
      // endpoint an oracle again — a stranger could tell an entry that once
      // existed from one that never did.
      let target: string | null;
      try {
        const redirectTo =
          config.redirectTo ?? (await loadDefaults()).defaultRedirectTo;
        target = await redirectTo(verified.scope, {
          requestOrigin: new URL(request.url).origin,
        });
      } catch {
        return refuse();
      }
      if (target === null) return refuse();

      const location = siteRelativeTarget(target, request.url);
      if (location === null) return refuse();

      const response = new Response(null, {
        status: 307,
        headers: { location },
      });
      // `httpOnly` because nothing in the browser needs to read this. The
      // `SameSite` attribute is read from the shared policy rather than written
      // here: the mint tells the admin whether its pane can frame the site, and
      // that answer is only correct for the policy this cookie actually
      // carries. `Lax` keeps the cookie across following a shared link from an
      // email or a chat client while staying off cross-site sub-requests. The
      // cookie expires with the token rather than outliving it.
      response.headers.append(
        "set-cookie",
        [
          `${PREVIEW_SCOPE_COOKIE}=${encodeURIComponent(token)}`,
          "Path=/",
          "HttpOnly",
          `SameSite=${PREVIEW_COOKIE_SAME_SITE}`,
          "Secure",
          `Expires=${verified.expiresAt.toUTCString()}`,
        ].join("; ")
      );

      // Last, once the response it belongs to exists. Draft mode is a mutation
      // on the outgoing request, and enabling it before a step that can still
      // refuse would leave the visitor holding a draft session for a request
      // that answered 404.
      const draft = await (config.draftMode
        ? config.draftMode()
        : (await loadDefaults()).defaultDraftMode());
      draft.enable();

      return response;
    },
  };
}

/**
 * Optional throughout, for the same reason {@link PreviewRouteConfig} is: these
 * are facts about the booted instance and the request in hand rather than
 * decisions a site makes, and requiring them turned the one-line draft gate
 * built on this into a paragraph of wiring that no route ever wrote.
 */
export interface PreviewScopeReaderConfig {
  secret?: string;
  generation?: number | (() => number | Promise<number>);
  /**
   * Reads the request's cookies. Injected so the reader is testable, and
   * accepting a synchronous return for the same reason `draftMode` does.
   *
   * Defaults to `cookies` from `next/headers`.
   */
  cookies?: () =>
    | { get: (name: string) => { value: string } | undefined }
    | Promise<{ get: (name: string) => { value: string } | undefined }>;
}

/** What a verified preview cookie says about the request carrying it. */
export interface PreviewSession {
  /** The one document this request may preview. */
  scope: PreviewTokenScope;
  /**
   * Who shared the link, when the token records it.
   *
   * Not an authenticated principal — the bearer is still anonymous. It is the
   * identity the rendered document's FIELD rules are judged against, so a link
   * shows what its sender can see rather than everything. Absent on a token
   * minted before the claim existed.
   */
  minter?: string;
}

/**
 * What the current request is allowed to preview, if anything.
 *
 * Re-verifies the stored token rather than trusting that the route once said
 * yes. A session started an hour ago is refused the moment the token expires or
 * the generation moves, which is what makes "revoke all preview links" mean
 * something for sessions already in flight.
 */
export async function readPreviewSession(
  config: PreviewScopeReaderConfig = {}
): Promise<PreviewSession | null> {
  const loadDefaults = () => import("./preview-route-defaults");

  const store = await (config.cookies
    ? config.cookies()
    : (await loadDefaults()).defaultCookies());
  const raw = store.get(PREVIEW_SCOPE_COOKIE)?.value;
  // Read before anything else is resolved: a request with no preview cookie is
  // the overwhelmingly common case, and it must not cost a settings read.
  if (raw === undefined || raw.length === 0) return null;

  const { secret, generation } = await verificationInputs(config);

  // A cookie is request input whoever sent it, and `%` alone makes
  // `decodeURIComponent` throw — which would answer a page request with a 500
  // rather than simply no preview session.
  let token: string;
  try {
    token = decodeURIComponent(raw);
  } catch {
    return null;
  }

  const verified = await verifyPreviewToken(token, secret, {
    generation,
  });
  if (!verified.valid) return null;
  return {
    scope: verified.scope,
    ...(verified.minter === undefined ? {} : { minter: verified.minter }),
  };
}

/**
 * What the current request is allowed to preview, if anything.
 *
 * DERIVED from {@link readPreviewSession} rather than reading the cookie a
 * second time, so the two cannot come to disagree about what a token says.
 *
 * Kept at its original shape because it is exported from `nextly/runtime` and
 * applications call it: widening the return to carry the minter would break
 * every typed consumer at compile time, and — worse — leave an untyped one
 * reading `scope.collection` as `undefined`, so its gate silently refuses every
 * valid preview. A richer answer belongs in a new function, which is what the
 * session reader is.
 */
export async function readPreviewScope(
  config: PreviewScopeReaderConfig = {}
): Promise<PreviewTokenScope | null> {
  return (await readPreviewSession(config))?.scope ?? null;
}

/**
 * Whether this request may read the named document's draft.
 *
 * The question a read path asks. Kept as a function over the scope rather than
 * left to each caller to compare fields, so "a preview session exists" can
 * never be mistaken for "this preview session covers what is being read" —
 * which is the mistake that would turn one link into a key to every draft.
 */
export function previewGrantsDraft(
  scope: PreviewTokenScope | null,
  requested: PreviewTokenScope
): boolean {
  return scope !== null && previewTokenCovers(scope, requested);
}
