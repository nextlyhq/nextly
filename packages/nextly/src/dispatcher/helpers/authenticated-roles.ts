import type { Params } from "../types";

/**
 * Decode the authenticated role set forwarded by the route handler.
 *
 * Route params are strings, so roles arrive JSON-encoded. Parse defensively:
 * require a non-empty array of only strings, so a malformed, mixed-type, or
 * empty value degrades to "no roles" rather than throwing or forwarding a
 * partial set. Shared by the collection and single dispatchers.
 */
export function readAuthenticatedRoles(p: Params): string[] | undefined {
  const raw = p._authenticatedUserRoles;
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      !parsed.every((role): role is string => typeof role === "string")
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}
