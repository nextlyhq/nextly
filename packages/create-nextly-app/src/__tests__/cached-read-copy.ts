/**
 * How copies of the app's cached-read file are compared: its code after the
 * leading doc comment, which each copy words for its app, with the one config
 * import set aside, since each app imports its config its own way
 * (`@nextly-config`, or a relative path to `nextly.config.ts`).
 */

/** `source` after its leading doc comment, its config import spelled alike. */
export function cachedReadCode(source: string): string {
  return source
    .slice(source.indexOf("*/") + 2)
    .trim()
    .replace(
      /^import config from "[^"]+";$/m,
      'import config from "<the app config>";'
    );
}

/** The path a copy imports the app's config from, if it imports one. */
export function configSpecifier(source: string): string | undefined {
  return /^import config from "([^"]+)";$/m.exec(source)?.[1];
}
