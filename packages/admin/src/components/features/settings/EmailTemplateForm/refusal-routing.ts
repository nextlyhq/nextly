/**
 * Where a rejected save has to send the author.
 *
 * The editor's regions are summoned, so a field can be invalid while the region
 * that renders its message is unmounted. When that happens `handleSubmit`
 * refuses and nothing appears anywhere: Save reads as a dead button. The
 * refusal has to reopen whichever region owns the offending field.
 *
 * Declared as data rather than as a condition per field, so adding a field to a
 * region is one edit here instead of a branch someone has to remember to add.
 */

/** Fields whose only message lives inside the summoned inspector. */
const INSPECTOR_FIELDS = new Set([
  "variables",
  "slug",
  "providerId",
  "useLayout",
  "layoutId",
  "isActive",
  "attachments",
]);

/**
 * Which regions a refusal must open, given the names react-hook-form rejected.
 *
 * Takes the error KEYS rather than the error object: nested field arrays report
 * as `variables` at the top level, which is the granularity a region needs, and
 * a helper that walked the whole tree would be deciding something it is not
 * asked to decide.
 */
export function regionsForRefusal(errorKeys: readonly string[]): {
  inspector: boolean;
} {
  return {
    inspector: errorKeys.some(key => INSPECTOR_FIELDS.has(key)),
  };
}
