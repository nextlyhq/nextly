/**
 * What a component row holds as content: its values, without the timestamps its own row carries.
 *
 * A component instance read from its table carries the row's `created_at` and `updated_at` beside
 * its values, while the same instance as an editor saves it carries neither. Every comparison of
 * held content (a held save that changes nothing, a held share that did not change) leaves them
 * out from this one rule, so two readings of one instance compare equal however they were read.
 *
 * @module domains/field-groups/storage/component-row-content
 */
import { readFieldGroupType } from "./field-group-type-key";

/** The timestamps a component row's own columns carry, in both spellings. */
const COMPONENT_ROW_TIMESTAMPS = new Set([
  "created_at",
  "updated_at",
  "createdAt",
  "updatedAt",
]);

/** An object's entries, without a component row's own timestamps where it is one. */
export function componentRowContentEntries(
  inner: Record<string, unknown>
): [string, unknown][] {
  const entries = Object.entries(inner);
  return readFieldGroupType(inner) !== undefined
    ? entries.filter(([key]) => !COMPONENT_ROW_TIMESTAMPS.has(key))
    : entries;
}
