/**
 * Webhook domain — the curated-payload projection.
 *
 * A default-deny field picker for metadata-only webhook events. Only the
 * allowlisted keys of a document are copied into the payload; anything not
 * listed never appears, so a collection's PII (a form submission's free-form
 * answers, ipAddress, userAgent) cannot leak into an event that is meant to
 * carry identity/metadata only. Absent allowlisted keys are skipped rather than
 * emitted as `undefined`, and no allowlist yields an empty object.
 *
 * @module domains/webhooks/project-fields
 */

/**
 * Copy only the allowlisted keys from `source` into a new object.
 *
 * @param source - The assembled document to project from.
 * @param allowlist - Keys to include; anything else is dropped (default-deny).
 * @returns A new object with only the present, allowlisted keys.
 */
export function projectFields(
  source: Record<string, unknown>,
  allowlist: readonly string[] | undefined
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  if (!allowlist) return projected;
  for (const key of allowlist) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      projected[key] = source[key];
    }
  }
  return projected;
}
