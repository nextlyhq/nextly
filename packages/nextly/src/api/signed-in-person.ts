/**
 * The signed-in person behind a request, refusing an API key.
 *
 * For a route whose resource is a person's own (their notices, their dashboard
 * pins): a key has none, so it is refused before anything is read, for every
 * method, since reading such a thing is as personal as changing it.
 *
 * @module api/signed-in-person
 */
import type { AuthContext } from "../auth/middleware";
import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { NextlyError } from "../errors/nextly-error";

/**
 * The signed-in person, or a refusal: unauthenticated as such, an API key as
 * "Only a signed-in person can `doing`".
 */
export async function signedInPerson(
  req: Request,
  doing: string
): Promise<AuthContext> {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);
  if (auth.authMethod === "api-key") {
    throw NextlyError.personOnly({
      doing,
      logContext: { reason: `an api key cannot ${doing}` },
    });
  }
  return auth;
}
