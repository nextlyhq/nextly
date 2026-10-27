/**
 * The kind of thing a guarded route opens, so a refusal can say what the user
 * cannot reach. Absent for routes that open neither, which are refused as
 * "this page".
 *
 * Kept apart from `lib/routing`, which imports every page through the
 * registry: the guard and the refusal page read this type, and importing it
 * from the router would close a cycle through the pages they guard.
 */
export type AccessSubject = "collection" | "single";

/**
 * What a collection or Single route asks of the entity it opens, so the guard
 * can ask the server's answer about that entity rather than a permission
 * slug, which cannot see the entity's code rules.
 */
export interface EntityAccess {
  slug: string;
  /**
   * The action, or `readHistory` for a document's version history, which the
   * server judges in every language.
   */
  action: "read" | "create" | "update" | "readHistory";
}
