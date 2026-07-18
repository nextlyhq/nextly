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
  /** Optional: presentational groups can be nameless and store children inline. */
  name?: string;
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
  // `inheritedHidden` carries a container's hidden state down: a hidden group
  // (including a nameless presentational one that stores its children inline)
  // makes everything under it sensitive, so no child value can leak just
  // because it was not individually marked hidden.
  const walk = (
    list: readonly SensitiveFieldSource[],
    inheritedHidden: boolean
  ): void => {
    for (const field of list) {
      const hidden =
        inheritedHidden ||
        field.hidden === true ||
        field.admin?.hidden === true;
      if ((field.type === "password" || hidden) && field.name) {
        names.add(field.name);
      }
      // group/repeater sub-fields are inline on `fields`; blocks carry their
      // own `fields` on each block definition. Hidden state flows into both.
      if (Array.isArray(field.fields)) walk(field.fields, hidden);
      if (Array.isArray(field.blocks)) {
        for (const block of field.blocks) {
          if (Array.isArray(block.fields)) walk(block.fields, hidden);
        }
      }
    }
  };
  walk(fields, false);
  return [...names];
}
