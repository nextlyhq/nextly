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
   */
  redirectTo: (scope: PreviewTokenScope) => string | Promise<string>;
  /** Reads and enables Next's draft mode. Injected so the route is testable. */
  draftMode: () => Promise<{ enable: () => void }>;
}

/**
 * Whether a redirect target is somewhere this site can send a visitor.
 *
 * The value comes from the app rather than the request, so this guards a
 * mistake rather than an attack — but an open redirect built out of a
 * preview link is worth making unreachable by construction. A protocol-relative
 * `//evil.example` is a URL to another host wearing a path's clothes, which is
 * why matching a leading slash is not enough on its own.
 */
function isSiteRelative(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
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

      const target = await config.redirectTo(verified.scope);
      if (!isSiteRelative(target)) return refuse();

      const draft = await config.draftMode();
      draft.enable();

      const response = new Response(null, {
        status: 307,
        headers: { location: target },
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
      return response;
    },
  };
}

export interface PreviewScopeReaderConfig {
  secret: string;
  generation: number | (() => number | Promise<number>);
  /** Reads the request's cookies. Injected so the reader is testable. */
  cookies: () => Promise<{
    get: (name: string) => { value: string } | undefined;
  }>;
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

  const verified = await verifyPreviewToken(
    decodeURIComponent(raw),
    config.secret,
    { generation }
  );
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
