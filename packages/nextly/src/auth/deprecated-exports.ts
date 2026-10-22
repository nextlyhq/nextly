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

/** What asks whether a user may act, through the one access decision. */
export const INSTEAD_OF_AN_ACCESS_CHECK =
  "use `nextly.access.check({ userId, resource, operation })`, which asks the one access decision";

/** What authenticates an API key and returns what it may do. */
export const INSTEAD_OF_A_KEY_CHECK =
  "use `nextly.access.checkApiKey({ rawKey })`";

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
