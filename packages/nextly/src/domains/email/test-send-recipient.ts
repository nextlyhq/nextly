/**
 * Where a test send goes: the signed-in person's own address, read from
 * their user record — never an address a caller names.
 *
 * Both REST surfaces resolve a test's destination here, the dispatcher's
 * catch-all route and the standalone `nextly/api/email-providers-test`
 * export, because the restriction is the point of the route rather than a
 * convenience of one surface: whoever may add providers may test one, and a
 * recipient they chose would let them send through any saved provider's
 * credentials to anyone. An API key names no person, so a key holder is
 * refused rather than redirected to an address they did not choose.
 *
 * @module domains/email/test-send-recipient
 */

import type { RequestActor } from "../../auth/request-actor";
import { NextlyError } from "../../errors/nextly-error";
import type { UserService } from "../users/services/user-service";

/**
 * The address a test send's one recipient is: the caller's own. A caller
 * that is not a signed-in person, or a user record without an address, is
 * refused — a test send has no other destination to fall back to.
 */
export async function testSendRecipientOf(
  actor: RequestActor | undefined,
  users: UserService | undefined
): Promise<string> {
  if (actor?.type !== "user" || !actor.id || !users) {
    throw NextlyError.forbidden({
      logContext: { reason: "test-send-needs-a-signed-in-user" },
    });
  }
  const user = await users.findById(actor.id, {});
  if (!user.email) {
    throw NextlyError.forbidden({
      logContext: { reason: "test-send-user-has-no-address" },
    });
  }
  return user.email;
}
