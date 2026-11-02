/**
 * Which of the dashboard summary's installation-wide counts a caller may be
 * given.
 *
 * How many users, roles, permissions, media items, field groups and active
 * API keys exist is not content: each describes a resource with its own list
 * endpoint and its own permission. A count is therefore given to exactly the
 * callers that endpoint admits, and LEFT OUT for anyone else -- a zero would
 * still be an answer, and one that changes when the rows behind it do.
 *
 * Each count is decided by its list's own gate (`auth/list-read-gates`),
 * checked the way the list checks it, for a session and for an API key alike,
 * so a key is judged on its own grant and never on its owner's.
 *
 * @module services/dashboard/admin-counts
 */

import {
  API_KEY_LIST_COVERS_EVERY_USER,
  authorizeListRead,
  LIST_READ_GATES,
  type GatedList,
} from "../../auth/list-read-gates";
import { isErrorResponse, type AuthContext } from "../../auth/middleware";

/** The counts, by the name the decision uses. */
export const ADMIN_COUNTS = [
  "apiKeys",
  "fieldGroups",
  "media",
  "permissions",
  "roles",
  "users",
] as const;

export type AdminCount = (typeof ADMIN_COUNTS)[number];

/** The list each count describes, whose gate gives it. */
const LIST_OF: Readonly<Record<AdminCount, GatedList>> = {
  apiKeys: "apiKeys",
  fieldGroups: "fieldGroups",
  media: "media",
  permissions: "permissions",
  roles: "roles",
  users: "users",
};

/**
 * Whose keys the API-key count covers for `auth`: those the caller's key list
 * shows, every user's or their own, as `API_KEY_LIST_COVERS_EVERY_USER` says
 * for both. The count must not describe keys the caller's list would never
 * show; `api-key-count-scope.test.ts` holds them to it.
 */
export function apiKeyCountScope(auth: AuthContext): Promise<ApiKeyCountScope> {
  return Promise.resolve(
    API_KEY_LIST_COVERS_EVERY_USER
      ? { kind: "all" }
      : { kind: "owner", userId: auth.userId }
  );
}

/**
 * Whose API keys a count covers. Tagged rather than a sentinel string, so no
 * user id can ever read as "everyone's".
 */
export type ApiKeyCountScope =
  | { readonly kind: "all" }
  | { readonly kind: "owner"; readonly userId: string };

/** The counts `auth` may be given. */
export async function readableAdminCounts(
  auth: AuthContext
): Promise<ReadonlySet<AdminCount>> {
  const verdicts = await Promise.all(
    ADMIN_COUNTS.map(async count => {
      const verdict = await authorizeListRead(
        auth,
        LIST_READ_GATES[LIST_OF[count]]
      );
      return [count, !isErrorResponse(verdict)] as const;
    })
  );
  return new Set(verdicts.filter(([, may]) => may).map(([count]) => count));
}
