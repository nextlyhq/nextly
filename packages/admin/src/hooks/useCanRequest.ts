import {
  useCurrentUserPermissions,
  type CollectionAccess,
} from "./useCurrentUserPermissions";

/**
 * Whether the user may send `request` about the collection or Single `slug`,
 * as the server judges that request: an action, or a request judged in other
 * languages than the one on screen (a read with every language's translation
 * state, the unfiltered history, publishing every language, an update sent
 * with no language, a copy). False until the server's answer is in hand.
 */
export function useCanRequest(
  slug: string,
  request: CollectionAccess
): boolean {
  const { canAccessCollection } = useCurrentUserPermissions();
  return canAccessCollection(slug, request);
}
