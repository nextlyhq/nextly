/**
 * The roles a session is issued with, and how long its access token may
 * carry them.
 *
 * An access token is a copy of the roles taken when it was signed: the
 * stateless session readers (`getSession`, `requireAuth`) answer from its
 * claims until it expires. A role that lapses while a token is still
 * alive would keep answering from it for the rest of its life, so a token
 * ends no later than the soonest expiry among the roles it carries, and the
 * client refreshes into claims that no longer hold the role. The signer
 * applies that bound (`notAfter` in `auth/jwt/sign.ts`), against the same
 * second the token is issued in.
 *
 * @module auth/session/session-roles
 */

/** A user's roles in force when a session is issued, and when that ends. */
export interface SessionRoles {
  roleIds: string[];
  /**
   * The soonest expiry among those roles (epoch ms), or `undefined` when none
   * of them expires.
   */
  validUntil: number | undefined;
}
