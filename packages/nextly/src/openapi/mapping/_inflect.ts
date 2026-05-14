/**
 * Schema-name inflection for collection / component slugs.
 *
 * Conservative implementation: handles common English plurals (`s`, `ies`,
 * `ses` / `xes` / `zes`) and converts snake / kebab / space-separated slugs
 * to PascalCase. Edge cases (`mice`, `geese`, `criteria`, etc.) are handled
 * by authors setting `collection.labels.singular` explicitly — which
 * `collectionSchemaName` honors as the source of truth.
 *
 * @module nextly/openapi/mapping/_inflect
 */

/**
 * Split a kebab / snake / space-separated string into PascalCase.
 *
 * Empty segments and lone separators are dropped silently.
 *
 *   pascalize("email-providers")  -> "EmailProviders"
 *   pascalize("user_profile")     -> "UserProfile"
 *   pascalize("blog posts")       -> "BlogPosts"
 *   pascalize("Hero")             -> "Hero"   (idempotent for already-cased)
 */
export function pascalize(input: string): string {
  return input
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

/**
 * Apply naive English singularization. A small set of common pluralization
 * suffixes is reversed; everything else passes through unchanged.
 *
 *   singularize("posts")         -> "post"
 *   singularize("categories")    -> "category"
 *   singularize("boxes")         -> "box"
 *   singularize("classes")       -> "class"
 *   singularize("media")         -> "media"     (no trailing `s`)
 *   singularize("status")        -> "status"    (`-us` is protected)
 *
 * Genuinely irregular words (`mice`, `quizzes`, `criteria`, …) are not
 * handled — the caller should set `labels.singular` to fix those. The rule
 * set is intentionally tiny to keep behavior predictable: less magic, fewer
 * mis-singularizations, with one well-known escape hatch.
 */
export function singularize(input: string): string {
  if (input.endsWith("ies")) return `${input.slice(0, -3)}y`;
  if (input.endsWith("ses") || input.endsWith("xes")) {
    return input.slice(0, -2);
  }
  if (input.endsWith("s") && !input.endsWith("ss") && !input.endsWith("us")) {
    return input.slice(0, -1);
  }
  return input;
}

/**
 * Convert a collection slug (and optional explicit singular label) into the
 * canonical PascalCase schema name used everywhere in the OpenAPI document.
 *
 *   collectionSchemaName("posts")                              -> "Post"
 *   collectionSchemaName("categories")                         -> "Category"
 *   collectionSchemaName("email-providers")                    -> "EmailProvider"
 *   collectionSchemaName("media")                              -> "Media"
 *   collectionSchemaName("people", "Person")                   -> "Person"
 *   collectionSchemaName("blog-posts", "Blog Post")            -> "BlogPost"
 *
 * When `singularLabel` is provided, it wins outright — singularization is
 * skipped and the label is just pascalized. This lets authors fix English
 * exceptions by configuring `collection.labels.singular`.
 */
export function collectionSchemaName(
  slug: string,
  singularLabel?: string
): string {
  if (singularLabel) return pascalize(singularLabel);
  return pascalize(singularize(slug));
}
