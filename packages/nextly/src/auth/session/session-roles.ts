/**
 * The roles a session is issued with, and how long its access token may
 * carry them.
 *
 * An access token is a copy of the roles taken when it was signed: the
 * stateless session readers (`getSession`, `hasRole`, `requireRole`) answer
 * from its claims until it expires. A role that lapses while a token is still
 * alive would keep answering from it for the rest of its life, so a token
 * ends no later than the soonest expiry among the roles it carries, and the
 * client refreshes into claims that no longer hold the role.
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

/**
 * The lifetime, in seconds, an access token carrying `roles` is signed with:
 * the configured TTL, or the time left until the soonest of its roles lapses
 * when that is shorter. Never less than a second, so the token is still
 * well-formed; a client given one that short refreshes at once.
 */
export function accessTokenLifetime(
  ttlSeconds: number,
  roles: Pick<SessionRoles, "validUntil">,
  now: number = Date.now()
): number {
  if (roles.validUntil === undefined) return ttlSeconds;
  const untilLapse = Math.floor((roles.validUntil - now) / 1000);
  return Math.max(1, Math.min(ttlSeconds, untilLapse));
}
