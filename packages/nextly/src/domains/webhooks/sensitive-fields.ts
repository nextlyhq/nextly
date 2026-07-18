/**
 * Webhook domain — sensitive-field policy.
 *
 * Turns a collection's field configuration into the flat list of field names
 * `buildEnvelope` strips from webhook payloads. A field is sensitive when it is
 * a password field (secret by construction) or explicitly hidden. Nested
 * fields (groups, repeaters, blocks) are walked, and their names are collected
 * too, because `buildEnvelope` strips by name at any depth.
 *
 * @module domains/webhooks/sensitive-fields
 */

/** The minimal field-config shape this policy reads. */
export interface SensitiveFieldSource {
  name: string;
  type?: string;
  /** Top-level hidden flag. */
  hidden?: boolean;
  /** Admin-scoped options; real collection fields put `hidden` here. */
  admin?: { hidden?: boolean };
  /** Sub-fields of a group/repeater/blocks field, if any. */
  fields?: SensitiveFieldSource[];
}

/**
 * Names of every field that must be stripped from a webhook payload: password
 * fields and hidden fields, at any nesting depth. Deduplicated.
 */
export function sensitiveFieldNames(
  fields: readonly SensitiveFieldSource[]
): string[] {
  const names = new Set<string>();
  const walk = (list: readonly SensitiveFieldSource[]): void => {
    for (const field of list) {
      if (
        field.type === "password" ||
        field.hidden === true ||
        field.admin?.hidden === true
      ) {
        names.add(field.name);
      }
      if (Array.isArray(field.fields)) walk(field.fields);
    }
  };
  walk(fields);
  return [...names];
}
