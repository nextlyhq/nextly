/**
 * `GET /content-events?subject=…`: a subject's events, read by subject.
 *
 * For what has no entry route to nest under: a release, and a document that
 * has been deleted. A live document reads here too, through the same gate as
 * its own `…/events` route. The read decides access; this handler only
 * authenticates and resolves who is asking.
 *
 * @module api/content-events
 * @experimental
 */

import { apiKeyScopeFrom } from "../auth/authenticated-scope";
import { buildUserContext } from "../auth/user-context";
import { getCachedNextly } from "../init";
import { resolveRoleSlugs } from "../services/lib/permissions";

import { privateToSession, respondList } from "./response-shapes";
import { requireRouteAuthentication } from "./route-auth";
import {
  parseSubjectEventsQuery,
  parseSubjectParam,
  readSubjectEvents,
} from "./subject-events";
import { withErrorHandler } from "./with-error-handler";

// Private to the session, refusals included: whether a subject is readable
// depends on who asks, so a shared cache must not replay one caller's answer,
// or one caller's "not found", to another.
export const handleContentEventsRequest = privateToSession(
  withErrorHandler(async (request: Request): Promise<Response> => {
    // Authenticated first: the route handler registers services on a cold
    // worker only for a request that carries credentials, so booting first
    // would answer an anonymous request with a server error.
    const auth = await requireRouteAuthentication(request);
    await getCachedNextly();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const subject = parseSubjectParam(params);
    const query = parseSubjectEventsQuery(params);
    // Role slugs, so a code-defined rule judges the caller it would on any
    // other read; an API key is judged by its own scope.
    const roles = await resolveRoleSlugs(auth);
    const result = await readSubjectEvents(subject, query, {
      // The shared constructor, so the caller's verified claims (a tenant,
      // say) reach the document's hooks as on every other read.
      user: buildUserContext({
        claims: auth.claims,
        id: auth.userId,
        name: auth.userName,
        email: auth.userEmail,
        roles,
      }),
      ...(auth.authMethod === "api-key"
        ? { authenticatedScope: apiKeyScopeFrom(auth) }
        : {}),
    });
    return respondList(result.items, result.meta);
  })
);
