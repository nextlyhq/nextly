/**
 * Where a rejected save has to send the author.
 *
 * The Details sheet opens on demand, so a field can be invalid while the panel
 * that renders its message is unmounted. When that happens `handleSubmit`
 * refuses and nothing appears anywhere: Save reads as a dead button. The
 * refusal has to open the panel that owns the offending field.
 *
 * Declared as data rather than as a condition per field, so adding a field to a
 * panel is one edit here instead of a branch someone has to remember to add.
 */

/** Fields whose only message lives inside the Details panel. */
const DETAILS_FIELDS = new Set([
  "description",
  "variables",
  "slug",
  "providerId",
  "useLayout",
  "layoutId",
  "isActive",
  "attachments",
  "cc",
  "bcc",
]);

/** Fields whose message lives in the content column: the envelope and body. */
const CONTENT_FIELDS = new Set([
  "subject",
  "preheader",
  "htmlContent",
  "plainTextContent",
  "fromOverride",
  "replyTo",
]);

/**
 * Which panels a refusal must open, given the names react-hook-form rejected.
 *
 * Takes the error KEYS rather than the error object: nested field arrays report
 * as `variables` at the top level, which is the granularity a panel needs, and
 * a helper that walked the whole tree would be deciding something it is not
 * asked to decide.
 */
export function regionsForRefusal(errorKeys: readonly string[]): {
  details: boolean;
  content: boolean;
} {
  return {
    details: errorKeys.some(key => DETAILS_FIELDS.has(key)),
    content: errorKeys.some(key => CONTENT_FIELDS.has(key)),
  };
}
