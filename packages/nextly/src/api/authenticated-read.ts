/**
 * The opening move every authenticated read endpoint makes.
 *
 * Four lines — require a session, convert a refusal into the canonical error,
 * then read the query string — repeated verbatim by each read handler. Repeated
 * text is not itself a problem; this one is, because the order carries a rule:
 * the refusal must be thrown BEFORE anything reads the request, so a handler
 * cannot accidentally act on parameters it has not yet earned the right to see.
 * A copy that drifts by one line loses that and still looks right.
 *
 * `api/dashboard` predates this and holds two copies of its own. They are left
 * alone here rather than swept in a change about something else; new read
 * endpoints should use this.
 *
 * @module api/authenticated-read
 */

import type { AuthContext } from "../auth/middleware";
import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { buildUserContext } from "../auth/user-context";
import type { ReadCaller } from "../services/dashboard/readable-resources";
import { resolveRoleSlugs } from "../services/lib/permissions";

/**
 * Who is asking, and what they asked for.
 *
 * The auth context is carried WHOLE rather than reduced to an id. Everything a
 * later access decision needs lives on it — the method the caller
 * authenticated by, an API key's own stamped permissions, and the custom claims
 * a claim-based rule reads — and each of them is invisible once dropped: the
 * request still succeeds, it simply answers as somebody with fewer rights, or
 * with more.
 */
export interface AuthenticatedRead {
  auth: AuthContext;
  searchParams: URLSearchParams;
}

/**
 * Headers for a response shaped by WHO asked.
 *
 * `private, no-store` keeps a per-user answer out of any shared cache, and
 * `Vary: Cookie` keeps it out of a per-browser one too. Both, not either: the
 * first stops a proxy holding it, the second stops the reply to one session
 * being served to the next.
 */
export const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
} as const;

/**
 * Authenticate, then hand back the caller and their query string.
 *
 * Throws the canonical auth error rather than returning a response, so the
 * handler's `withErrorHandler` renders it the same way it renders every other
 * failure.
 */
export async function authenticatedRead(
  req: Request
): Promise<AuthenticatedRead> {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);
  return { auth, searchParams: new URL(req.url).searchParams };
}

/**
 * The caller, in the two shapes an access decision reads.
 *
 * `roles` must be RESOLVED rather than forwarded: session auth carries role
 * IDs and API-key auth carries slugs, and a role-based rule matches on slugs.
 * Handing it the ids matches nothing — so a collection guarded by a role rule
 * returns no rows, and a read that should have been full comes back empty
 * without an error anywhere to say why.
 *
 * `authenticatedScope` exists so an API KEY is judged on its own stamped grant
 * rather than on the roles of whoever minted it. Without it a narrowly scoped
 * key issued by a super-admin inherits the owner's reach.
 *
 * The return type is the NAMED `ReadCaller` rather than an inline literal, and
 * that annotation is what couples this function to its consumer. An inline
 * shape only had to be assignable at each call site, and the property that
 * matters is OPTIONAL: every caller passes the result as a variable rather than
 * an object literal, so excess-property checking never applies, and renaming
 * `authenticatedScope` here would compile everywhere. The dashboard service's
 * conditional spread would then simply stop firing, and every API-key
 * recent-entries read would be judged by the minter's roles -- the exact silent
 * drop the `satisfies Pick<FindArgs<string>, "actor">` beside it exists to
 * prevent. `ReadCaller` is declared in `readable-resources` because that is
 * where the dashboard service reads it from; one declaration, two importers.
 *
 * `versions-access` and `preview-links` each grew their own copy of this before
 * there was a shared one; they are left as they are, and new read endpoints
 * should call this.
 */
export async function readCaller(auth: AuthContext): Promise<ReadCaller> {
  const roles = await resolveRoleSlugs(auth);
  const user = buildUserContext({
    claims: auth.claims,
    id: auth.userId,
    name: auth.userName,
    email: auth.userEmail,
    roles,
  });
  return {
    user,
    // `satisfies` makes the field name a COMPILE-TIME boundary, and the
    // return annotation alone does NOT: TypeScript exempts properties
    // introduced by a SPREAD from excess-property checking, so
    // `...(cond ? { authenticatedScopeTypo: ... } : {})` is assignable to
    // `ReadCaller` and compiles clean. Every consumer then reads
    // `caller.authenticatedScope` as `undefined` -- an API key silently judged
    // by its minter's roles, with no error anywhere. `Required<Pick<...>>`
    // rather than a bare `Pick` so a rename fails twice: once as an excess
    // property, once as a missing one. `dashboard-service` applies the same
    // pattern to `find()`'s `actor` for the same reason.
    ...(auth.authMethod === "api-key"
      ? ({
          authenticatedScope: {
            actorType: "apiKey" as const,
            permissions: auth.permissions,
          },
        } satisfies Required<Pick<ReadCaller, "authenticatedScope">>)
      : {}),
  };
}
