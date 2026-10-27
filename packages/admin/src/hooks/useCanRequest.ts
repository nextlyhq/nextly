import { LOCALE_PARAM } from "@admin/constants/search-params";

import {
  useCurrentUserPermissions,
  type CollectionAccess,
} from "./useCurrentUserPermissions";
import { useLocaleParam } from "./useLocaleParam";
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
 * {@link useAsksTranslationStatus} for a read sent in the default language,
 * as quick edit sends one. The answer in hand is for the content language on
 * screen, and a rule may answer by language, so it speaks for a default
 * language read only while that is the language on screen; elsewhere the read
 * asks no state rather than risk the server refusing it.
 */
export function useDefaultLanguageAsksTranslationStatus(slug: string): boolean {
  const asksTranslationStatus = useAsksTranslationStatus(slug);
  const onScreen = useLocaleParam(LOCALE_PARAM);
  const { defaultLocale } = useLocalization();
  return (
    asksTranslationStatus &&
    (onScreen === undefined || onScreen === defaultLocale)
  );
}
