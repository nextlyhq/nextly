/**
 * Pluralization Utilities
 *
 * Helper functions for converting between singular and plural forms
 * using basic English grammar rules.
 *
 * @module shared/lib/pluralization
 * @since 1.0.0
 */

/**
 * Detect if a word appears to already be in plural form.
 * Helps prevent double-pluralization (e.g., "posts" → "postses").
 *
 * Known limitations:
 * - A single "s" at the end is ambiguous (e.g., "status" vs "statuses")
 *   We use a conservative approach: only flag as plural if there's strong evidence
 */
function isAlreadyPlural(word: string): boolean {
  const lower = word.toLowerCase();

  // Known irregular plurals that users might enter as singular
  const knownPlurals = [
    "people",
    "children",
    "men",
    "women",
    "teeth",
    "feet",
    "mice",
    "geese",
    "oxen",
    "sheep",
    "deer",
    "fish",
    "species",
    "series",
    "crises",
    "analyses",
    "theses",
    "phenomena",
    "criteria",
    "data",
    "alumni",
    "cacti",
    "fungi",
    "nuclei",
    "radii",
  ];
  if (knownPlurals.includes(lower)) return true;

  // Ending in -ies (e.g., "categories", "industries")
  if (lower.endsWith("ies")) return true;

  // Ending in -ves (e.g., "knives", "shelves", "wives")
  if (lower.endsWith("ves")) return true;

  // Ending in -en (e.g., "oxen", "children")
  // But be careful not to flag singular words like "eaten", "spoken", "listen"
  if (lower.endsWith("en")) {
    // Only if preceded by a consonant and is a known plural pattern
    const beforeEN = lower.slice(-3, -2);
    if (beforeEN && !/[aeiou]/.test(beforeEN)) {
      // Known patterns: oxen, children
      if (lower === "oxen" || lower === "children") return true;
    }
  }

  // Ending in -i (likely Latin plural, e.g., "cacti", "fungi", "radii")
  if (lower.endsWith("i") && lower.length > 2) {
    const beforeI = lower.slice(-2, -1);
    // If preceded by 'c' (cacti), 'g' (fungi), or other Latin patterns
    if (["c", "g", "l", "r"].includes(beforeI)) {
      return true;
    }
  }

  // Ending in -a (likely Greek or Latin plural, e.g., "phenomena", "criteria")
  if (lower.endsWith("a") && lower.length > 2) {
    const beforeA = lower.slice(-2, -1);
    // If preceded by 'n', 'r', or other patterns common in Latin plurals
    if (["n", "r"].includes(beforeA)) {
      return true;
    }
  }

  // Ending in -o but is a known plural (e.g., "potatoes", "heroes", "tomatoes", "echoes")
  if (lower.endsWith("oes")) {
    // -oes pattern is typically plural form (heroes, potatoes, tomatoes, echoes)
    return true;
  }

  // Most trailing -s words are plural unless they match common singular patterns
  if (lower.endsWith("s") && lower.length > 1 && !isLikelySingular(lower)) {
    return true;
  }

  return false;
}

/**
 * Detect if a word is likely already singular (not plural).
 * Used for slug-to-label conversion to prevent incorrect transformations
 * like "glass" → "glas" or "status" → "statu".
 */
function isLikelySingular(word: string): boolean {
  const lower = word.toLowerCase();

  // Words that should not have 's' stripped
  const singularEndings = [
    "ss",
    "us",
    "is",
    "os",
    "sis",
    "asis",
    "isis",
    "ysis",
    "tis",
    "itis",
    "esis",
  ];

  for (const ending of singularEndings) {
    if (lower.endsWith(ending)) return true;
  }

  // Known singular nouns ending in 's'
  const knowSingulars = [
    "glass",
    "class",
    "mass",
    "pass",
    "grass",
    "status",
    "atlas",
    "bus",
    "gas",
    "lens",
    "canvas",
    "process",
    "address",
    "access",
    "success",
    "princess",
    "actress",
    "hostess",
    "witness",
    "fortress",
    "express",
  ];
  if (knowSingulars.includes(lower)) return true;

  return false;
}

/**
 * Generates a simple plural form of a word.
 * This is a basic implementation using common English pluralization rules.
 *
 * Handles:
 * - Words ending in -y (changing to -ies when preceded by consonant)
 * - Words ending in -s, -x, -z (adding -es)
 * - Basic regulars (adding -s)
 * - Already plural words (returns as-is)
 *
 * @param singular - The singular form
 * @returns Plural form
 *
 * @example
 * ```typescript
 * simplePluralize('post') // 'posts'
 * simplePluralize('posts') // 'posts' (already plural, not 'postses')
 * simplePluralize('category') // 'categories'
 * simplePluralize('box') // 'boxes'
 * ```
 */
export function simplePluralize(singular: string): string {
  // If already plural, return as-is
  if (isAlreadyPlural(singular)) {
    return singular;
  }

  if (
    singular.endsWith("s") ||
    singular.endsWith("x") ||
    singular.endsWith("z")
  ) {
    return singular + "es";
  }
  if (singular.endsWith("y") && !/[aeiou]y$/i.test(singular)) {
    return singular.slice(0, -1) + "ies";
  }
  return singular + "s";
}

/**
 * Convert a slug to singular label form.
 *
 * Converts kebab-case/snake_case slugs into Title Case singular form.
 * Intelligently avoids removing 's' from words that are likely singular.
 *
 * @param slug - The slug to convert (e.g., "blog-posts", "user_profiles")
 * @returns Singular label (e.g., "Blog Post", "User Profile")
 *
 * @example
 * ```typescript
 * toSingularLabel('blog-posts') // 'Blog Post'
 * toSingularLabel('user_profiles') // 'User Profile'
 * toSingularLabel('glass_classes') // 'Glass Classes' (preserves "glass")
 * ```
 */
export function toSingularLabel(slug: string): string {
  const words = slug
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

  const lastWord = words[words.length - 1];
  if (lastWord.endsWith("s") && lastWord.length > 1) {
    // Only strip 's' if the word looks like it's plural
    if (!isLikelySingular(lastWord)) {
      words[words.length - 1] = lastWord.slice(0, -1);
    }
  }

  return words.join(" ");
}

/**
 * Convert a slug to plural label form.
 *
 * Converts kebab-case/snake_case slugs into Title Case plural form.
 *
 * @param slug - The slug to convert (e.g., "blog-post", "user_profile")
 * @returns Plural label (e.g., "Blog Posts", "User Profiles")
 *
 * @example
 * ```typescript
 * toPluralLabel('blog-post') // 'Blog Posts'
 * toPluralLabel('user_profile') // 'User Profiles'
 * ```
 */
export function toPluralLabel(slug: string): string {
  const words = slug
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

  // Pluralize the last word
  const lastWord = words[words.length - 1];
  if (lastWord && !isAlreadyPlural(lastWord)) {
    words[words.length - 1] = simplePluralize(lastWord);
  }

  return words.join(" ");
}
