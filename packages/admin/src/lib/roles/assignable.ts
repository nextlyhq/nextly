/**
 * The roles a picker may offer: those a person or a key can be given, or
 * another role can build on. The server marks each role with `assignable`,
 * false for the one it refuses all three for (the Public role, which visitors
 * are judged by), so this never names a role itself. A role sent without the
 * mark, by a server from before it, counts as assignable.
 *
 * Only for pickers: the roles screen lists every role, Public included, since
 * that is where Public's permissions are set.
 */
export function assignableRoles<T extends { assignable?: boolean }>(
  roles: readonly T[]
): T[] {
  return roles.filter(role => role.assignable !== false);
}
