/**
 * The review-state table's value types, shared by its three dialect declarations.
 *
 * @module schemas/review-states/types
 */

/** What a review state belongs to: a collection's document or a Single. */
export type ReviewScopeKind = "collection" | "single";

/** Who a part is assigned to: a person, or everyone holding a role. */
export type ReviewAssigneeKind = "user" | "role";
