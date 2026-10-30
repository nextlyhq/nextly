/**
 * Where the admin keeps the chosen theme in local storage, which it reads
 * before its first paint. `admin.ts` opens a spec's screen in a known theme
 * with it, and the visual check opens each screen in both themes the same way.
 *
 * Plain JavaScript, so the visual check (`scripts/visual-check`) can load it
 * on every Node version `engines` allows, with no type stripping.
 *
 * @module e2e/tests/support/theme
 */
export const THEME_STORAGE_KEY = "nextly-theme";
