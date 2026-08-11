/**
 * The tweakcn presets the theme lab ships, by id.
 *
 * The importer knows every published preset; the lab shows the ones under
 * comparison. That narrowing used to live only in the checked-in generated
 * file, applied by deleting entries from it by hand, so re-running the
 * importer restored all of them — failing the preset test and silently
 * widening the switcher, with no record anywhere of what the shortlist was
 * supposed to be.
 *
 * Keeping it here makes the generator the one place the shortlist is decided,
 * and lets the test that pins it read the same list instead of restating it.
 */
export const TWEAKCN_SHORTLIST = [
  "tweakcn-claude",
  "tweakcn-modern-minimal",
  "tweakcn-twitter",
  "tweakcn-vercel",
  "tweakcn-violet-bloom",
];
