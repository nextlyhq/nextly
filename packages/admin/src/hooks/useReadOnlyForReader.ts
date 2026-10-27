import { useCurrentUserPermissions } from "./useCurrentUserPermissions";

/**
 * Whether the signed-in user may read the collection or Single `slug` but not
 * change it, as the server's capabilities answer says, so its editor opens
 * read-only.
 *
 * False until that answer is in hand: an editor is not turned read-only, and
 * its document claim released, on a guess while the answer is on its way. The
 * server refuses any change the answer would have refused either way.
 */
export function useReadOnlyForReader(slug: string): boolean {
  const { content, canAccessCollection } = useCurrentUserPermissions();
  return content.hasAnswer && !canAccessCollection(slug, "update");
}
