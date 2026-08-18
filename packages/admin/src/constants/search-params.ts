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
