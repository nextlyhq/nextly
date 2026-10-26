import {
  useCurrentUserPermissions,
  type CollectionAccess,
} from "./useCurrentUserPermissions";
import { useLocalization } from "./useLocalization";

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

/**
 * Whether a read of the collection `slug`'s documents asks every language's
 * translation state: on an app with several languages, and only of a user the
 * server lets read that state, since a read asking it is refused otherwise.
 * The editor's read and its save's cache key both take it from here, so a save
 * writes to the document on screen.
 */
export function useAsksTranslationStatus(slug: string): boolean {
  const { enabled } = useLocalization();
  const mayReadTranslations = useCanRequest(slug, "readTranslations");
  return enabled && mayReadTranslations;
}

/**
 * The language a read of the collection or Single `slug`'s version history is
 * narrowed to: none, so every language's versions, for a user the server lets
 * read them all; otherwise `language`, since the unfiltered history would be
 * refused outright.
 */
export function useHistoryLanguage(
  slug: string,
  language: string | null | undefined
): string | undefined {
  const mayReadAllHistory = useCanRequest(slug, "readHistory");
  return mayReadAllHistory ? undefined : language || undefined;
}
