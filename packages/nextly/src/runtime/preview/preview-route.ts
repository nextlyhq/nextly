import {
  previewTokenCovers,
  verifyPreviewToken,
  type PreviewTokenScope,
} from "../../auth/preview/preview-token";

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

/** The cookie carrying the preview token for the rest of the session. */
export const PREVIEW_SCOPE_COOKIE = "__nextly_preview";

export interface PreviewRouteConfig {
  /** The signing secret; the same `NEXTLY_SECRET` sessions use. */
  secret: string;
  /**
   * The site's current revocation generation. Read per request so raising it
   * ends existing preview sessions rather than only refusing new links.
   */
  generation: number | (() => number | Promise<number>);
  /**
   * Where to send the visitor once the link checks out.
   *
   * Supplied by the app because only it knows how its content is routed. The
   * returned value must be a site-relative path.
   *
   * Returning `null` refuses the link the same way an invalid token is
   * refused. A preview link outlives what it points at — the entry can be
   * deleted, unpublished or moved between minting and clicking — and this is
   * how an app says so without having to throw.
   */
  redirectTo: (
    scope: PreviewTokenScope
  ) => string | null | Promise<string | null>;
  /**
   * Reads and enables Next's draft mode. Injected so the route is testable.
   *
   * Accepts a synchronous return as well: `draftMode()` is sync on Next 14 and
   * async from 15, and the peer range covers both, so requiring a promise would
   * make the natural import fail to typecheck on the older one.
   */
  draftMode: () => { enable: () => void } | Promise<{ enable: () => void }>;
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
export function createPreviewRoute(config: PreviewRouteConfig): {
  GET: (request: Request) => Promise<Response>;
} {
  const refuse = () => new Response(null, { status: 404 });

  return {
    async GET(request: Request): Promise<Response> {
      const token = new URL(request.url).searchParams.get("token");
      if (token === null || token.length === 0) return refuse();

      const generation =
        typeof config.generation === "function"
          ? await config.generation()
          : config.generation;

      const verified = await verifyPreviewToken(token, config.secret, {
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
        target = await config.redirectTo(verified.scope);
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
      // `httpOnly` because nothing in the browser needs to read this, and
      // `sameSite=lax` so the cookie survives following the link from an email
      // or a chat client while staying off cross-site sub-requests. The cookie
      // expires with the token rather than outliving it.
      response.headers.append(
        "set-cookie",
        [
          `${PREVIEW_SCOPE_COOKIE}=${encodeURIComponent(token)}`,
          "Path=/",
          "HttpOnly",
          "SameSite=Lax",
          "Secure",
          `Expires=${verified.expiresAt.toUTCString()}`,
        ].join("; ")
      );

      // Last, once the response it belongs to exists. Draft mode is a mutation
      // on the outgoing request, and enabling it before a step that can still
      // refuse would leave the visitor holding a draft session for a request
      // that answered 404.
      const draft = await config.draftMode();
      draft.enable();

      return response;
    },
  };
}

export interface PreviewScopeReaderConfig {
  secret: string;
  generation: number | (() => number | Promise<number>);
  /**
   * Reads the request's cookies. Injected so the reader is testable, and
   * accepting a synchronous return for the same reason `draftMode` does.
   */
  cookies: () =>
    | { get: (name: string) => { value: string } | undefined }
    | Promise<{ get: (name: string) => { value: string } | undefined }>;
}

/**
 * What the current request is allowed to preview, if anything.
 *
 * Re-verifies the stored token rather than trusting that the route once said
 * yes. A session started an hour ago is refused the moment the token expires or
 * the generation moves, which is what makes "revoke all preview links" mean
 * something for sessions already in flight.
 */
export async function readPreviewScope(
  config: PreviewScopeReaderConfig
): Promise<PreviewTokenScope | null> {
  const store = await config.cookies();
  const raw = store.get(PREVIEW_SCOPE_COOKIE)?.value;
  if (raw === undefined || raw.length === 0) return null;

  const generation =
    typeof config.generation === "function"
      ? await config.generation()
      : config.generation;

  // A cookie is request input whoever sent it, and `%` alone makes
  // `decodeURIComponent` throw — which would answer a page request with a 500
  // rather than simply no preview session.
  let token: string;
  try {
    token = decodeURIComponent(raw);
  } catch {
    return null;
  }

  const verified = await verifyPreviewToken(token, config.secret, {
    generation,
  });
  return verified.valid ? verified.scope : null;
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
