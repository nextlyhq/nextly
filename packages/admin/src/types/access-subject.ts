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
