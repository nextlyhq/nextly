/**
 * Query keys the admin addresses its own state by.
 *
 * They live here, in a module that imports nothing, because the readers and the
 * writers of a key sit on opposite sides of the app — the entry list writes the
 * editor's language, the editor reads it — and a key defined next to either one
 * drags that side's imports into the other. `lib/routing` in particular pulls in
 * the page registry, and therefore every page, so a hook that reached for a
 * constant there closed a cycle back onto itself.
 *
 * @module constants/search-params
 */

/** The editor's active content language. Absent means the app default. */
export const LOCALE_PARAM = "locale";

/**
 * The language translation mode reads its SOURCE from. Absent means the mode is
 * off.
 *
 * A language rather than a boolean, so the pairing is in the URL: a translator
 * working German from Spanish is a different screen from German from English,
 * and a `?translate=1` that implied the default language could not express it.
 * It also makes the mode linkable the way `LOCALE_PARAM` made the target
 * linkable — a reviewer can be sent the exact pair.
 */
export const TRANSLATE_PARAM = "translate";
