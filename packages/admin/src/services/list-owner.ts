/**
 * Whose entities a list of collections, Singles or field groups asks for: the
 * site's own, or the plugins'. The server applies it as a condition on the
 * list query, so each list's page and count describe the same rows.
 */
export type ListOwner = "site" | "plugins";

/**
 * A list query with its owner added. Without an owner the query is unchanged,
 * which lists everything, as before the parameter existed.
 */
export function withListOwner(query: string, owner?: ListOwner): string {
  if (!owner) return query;
  const params = new URLSearchParams(query);
  params.set("owner", owner);
  return params.toString();
}
