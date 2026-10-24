/**
 * The `nextly/auth` exports that are deprecated, and the warning each gives.
 *
 * Each still works for one release. It warns the first time it is called in
 * a process, naming what to use instead, so an app learns before the release
 * that removes it, without a warning on every request.
 *
 * @module auth/deprecated-exports
 */
import { consoleLogger } from "../shared/types";

/**
 * Why a role check goes: it compares role ids with role names, so it never
 * matches a role by its name.
 */
export const INSTEAD_OF_A_ROLE_CHECK =
  "it compares the user's role ids with role names, so it never matches a role by name. " +
  "Check a permission instead, with `nextly.access.check({ userId, resource, operation })`, " +
  "or `isSuperAdmin(userId)` for super-admin authority";

/**
 * What asks whether a caller may act. A signed-in user is asked through the
 * one access decision. An API key is judged on its own permissions, never its
 * maker's: `nextly.access.check` judges the user named by `userId`, so asking
 * it about a key's maker would give a read-only key its maker's full reach.
 */
export const INSTEAD_OF_AN_ACCESS_CHECK =
  "for a signed-in user, use `nextly.access.check({ userId, resource, operation })`, which asks the one access decision. " +
  "For an API key, check the key's own permissions, which `nextly.access.checkApiKey({ rawKey })` returns: " +
  "`nextly.access.check` judges the user who made the key, not the key's narrower scope. " +
  "If you passed `checkCollectionAccess` an `evaluateCodeAccess`, keep running that collection rule too: " +
  "like `checkCollectionAccess`, `checkApiKey` runs no rule of its own";

/**
 * What authenticates an API key and returns what it may do. It applies no
 * rate limit, and neither did the deprecated function: that only passed on
 * the refusal the caller's own `validateApiKey` reported.
 */
export const INSTEAD_OF_A_KEY_CHECK =
  "use `nextly.access.checkApiKey({ rawKey })`, which authenticates the key and returns its own permissions and roles. " +
  "Like `authenticateApiKey`, it applies no rate limit of its own: a route that limits keys keeps doing so itself";

const warned = new Set<string>();

/** Warns, once per process, that `name` is deprecated, naming what replaces it. */
export function warnDeprecatedExport(name: string, instead: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  consoleLogger.warn(
    `\`${name}\` from "nextly/auth" is deprecated and is removed in the next release: ${instead}.`
  );
}

/** Forgets which exports have warned, so a test can watch the first warning again. */
export function resetDeprecatedExportWarningsForTests(): void {
  warned.clear();
}
