/**
 * The template directories the CLI build copies into the package
 * (tsdown.config.ts), so a scaffold can use them offline and in step with the
 * package versions it installs. Content templates (blog) are downloaded at run
 * time instead. `base` is the app skeleton the app templates build on, not a
 * template anyone selects.
 *
 * The one list of them: the build copies what is here, and the CLI chooses the
 * bundled copy only for what is here, so the two cannot disagree.
 */
export const BUNDLED_TEMPLATES = ["base", "blank", "plugin"] as const;
