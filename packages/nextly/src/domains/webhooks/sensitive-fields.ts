/**
 * Webhook domain — sensitive-field policy.
 *
 * Turns a collection's field configuration into the flat list of field names
 * `buildEnvelope` strips from webhook payloads. A field is sensitive when it is
 * a password field (secret by construction) or explicitly hidden (top-level
 * `hidden` or `admin.hidden`). Structurally-inline nested fields are walked —
 * group/repeater `fields` and blocks' per-block `fields` — since `buildEnvelope`
 * strips by name at any depth.
 *
 * Reference-based fields (a `component` field points at a component definition
 * elsewhere) are NOT resolved here: that needs the component registry, which a
 * pure policy has no access to. The capture wiring must expand those references
 * into the field tree it passes in, so component secrets are covered too.
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
  /** Inline sub-fields of a group/repeater field, if any. */
  fields?: SensitiveFieldSource[];
  /** Block definitions of a blocks field; each carries its own `fields`. */
  blocks?: { fields?: SensitiveFieldSource[] }[];
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
      // group/repeater sub-fields are inline on `fields`; blocks carry their
      // own `fields` on each block definition.
      if (Array.isArray(field.fields)) walk(field.fields);
      if (Array.isArray(field.blocks)) {
        for (const block of field.blocks) {
          if (Array.isArray(block.fields)) walk(block.fields);
        }
      }
    }
  };
  walk(fields);
  return [...names];
}
