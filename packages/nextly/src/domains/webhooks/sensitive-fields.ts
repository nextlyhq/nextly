/**
 * Webhook domain — sensitive-field policy.
 *
 * Turns a collection's field configuration into the list of dotted field PATHS
 * `buildEnvelope` strips from webhook payloads. A field is sensitive when it is
 * a password field (secret by construction) or explicitly hidden (top-level
 * `hidden` or `admin.hidden`). Structurally-inline nested fields are walked —
 * group/repeater `fields` and blocks' per-block `fields`.
 *
 * Paths, not bare names: a bare name is denied everywhere it appears, so a
 * hidden `title` nested anywhere would silently strip an unrelated top-level
 * `title` from every payload. Array indices are not part of a path — a repeater
 * `rows` holding a hidden `token` denies `rows.token`, which covers every
 * element.
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
  /**
   * Admin-scoped options; real collection fields put `hidden` here. Typed as
   * `unknown` and narrowed at runtime so every field-config shape satisfies this
   * contract — the per-type admin options are closed interfaces, which no
   * structural annotation here could accept without a cast at the call site.
   */
  admin?: unknown;
  /** Inline sub-fields of a group/repeater field, if any. */
  fields?: SensitiveFieldSource[];
  /** Block definitions of a blocks field; each carries its own `fields`. */
  blocks?: { fields?: SensitiveFieldSource[] }[];
}

/**
 * Dotted paths of every field that must be stripped from a webhook payload:
 * password fields and hidden fields, at any nesting depth. Deduplicated.
 */
export function sensitiveFieldPaths(
  fields: readonly SensitiveFieldSource[]
): string[] {
  const paths = new Set<string>();
  // `inheritedHidden` carries a container's hidden state down: a hidden group
  // (including a nameless presentational one that stores its children inline)
  // makes everything under it sensitive, so no child value can leak just
  // because it was not individually marked hidden.
  const walk = (
    list: readonly SensitiveFieldSource[],
    prefix: string,
    inheritedHidden: boolean
  ): void => {
    for (const field of list) {
      const hidden =
        inheritedHidden ||
        field.hidden === true ||
        (typeof field.admin === "object" &&
          field.admin !== null &&
          (field.admin as { hidden?: unknown }).hidden === true);
      // A nameless container is presentational: its children sit inline at the
      // parent's level, so it contributes no path segment of its own.
      const path = field.name
        ? prefix
          ? `${prefix}.${field.name}`
          : field.name
        : prefix;
      if ((field.type === "password" || hidden) && field.name) {
        paths.add(path);
      }
      // A named hidden container is already denied at its own path, which drops
      // its whole subtree; only a nameless one needs its hidden state carried to
      // the children that actually hold the values. group/repeater sub-fields
      // are inline on `fields`; blocks carry their own `fields` per definition.
      const childHidden = hidden && !field.name;
      if (Array.isArray(field.fields)) walk(field.fields, path, childHidden);
      if (Array.isArray(field.blocks)) {
        for (const block of field.blocks) {
          if (Array.isArray(block.fields))
            walk(block.fields, path, childHidden);
        }
      }
    }
  };
  walk(fields, "", false);
  return [...paths];
}
