/**
 * Cross-file validation for `ui-schema.json` vs `nextly.config.ts`. This
 * check spans both schema sources, so it lives outside the per-file Zod
 * schema.
 *
 *   - Relation target: every relationship and upload, at any depth, points at
 *     a real collection — code-first, UI-built, or one Nextly provides
 *     (`users`, `media`).
 *
 * A slug both files declare is not an issue here: the code-first entity of
 * that kind shadows the Builder's, which the merge reports per kind
 * (`mergeUiEntities`) and the migrate commands warn about.
 *
 * Pure: returns a list of issues; `judgeBuilderDefinitions` refuses them for
 * both migrate commands.
 *
 * @module domains/schema/ui-schema/cross-file
 * @since v0.0.3-alpha
 */
import type { UiSchemaManifest } from "../../../schemas/_zod/ui-schema";
import { referencingFields } from "../../collections/services/collection-dependents";

import { RELATION_TARGET_MISSING_ISSUE } from "./definition-issues";

/**
 * The collections Nextly provides itself, which a relationship or upload may
 * name without the configuration declaring them. Only these: another core
 * table's name, such as `audit_log`, is no relationship's target, and a
 * collection of that slug is one like any other. The one list every reader of
 * a relationship's target uses.
 */
export const BUILT_IN_RELATION_TARGETS: ReadonlySet<string> = new Set([
  "users",
  "media",
]);

export interface CrossFileIssue {
  code: typeof RELATION_TARGET_MISSING_ISSUE;
  message: string;
}

export interface ValidateCrossFileArgs {
  /** Slugs of code-first collections (from `nextly.config.ts`). */
  codeCollectionSlugs: string[];
  /** The definition; its collections are the Builder's valid targets. */
  manifest: UiSchemaManifest;
  /**
   * The entries whose relationships are judged. Absent, every entry of the
   * definition is; a Builder save judges only the entity it saves.
   */
  judged?: ReadonlyArray<{ slug: string; fields: unknown }>;
}

/**
 * A field list with each relationship's target as reads take it
 * (`relationshipTargetSlug`): `relationTo` when the field names one or a list,
 * else `options.target`. A field retargeted in the Builder is saved with its
 * new `relationTo` and the options it was read with, the earlier target among
 * them; that stale one points at nothing the field uses, so it is not judged.
 */
function withTargetsAsRead(fields: unknown): unknown {
  if (!Array.isArray(fields)) return fields;
  return fields.map((field: unknown) => {
    if (field === null || typeof field !== "object") return field;
    const record = field as Record<string, unknown>;
    const { relationTo, options } = record;
    const named =
      (typeof relationTo === "string" && relationTo !== "") ||
      Array.isArray(relationTo);
    let read = record;
    if (named && typeof options === "object" && options !== null) {
      read = {
        ...record,
        options: Object.fromEntries(
          Object.entries(options).filter(([key]) => key !== "target")
        ),
      };
    }
    return Array.isArray(read.fields)
      ? { ...read, fields: withTargetsAsRead(read.fields) }
      : read;
  });
}

export function validateCrossFile(
  args: ValidateCrossFileArgs
): CrossFileIssue[] {
  const issues: CrossFileIssue[] = [];
  // Every entry judged, each of whose fields may name a target.
  const manifestEntities = args.judged ?? [
    ...args.manifest.collections,
    ...args.manifest.singles,
    ...args.manifest.components,
  ];

  // Valid relation targets: code collections + UI collections + Nextly's own.
  const validTargets = new Set<string>([
    ...args.codeCollectionSlugs,
    ...args.manifest.collections.map(c => c.slug),
    ...BUILT_IN_RELATION_TARGETS,
  ]);
  for (const e of manifestEntities) {
    // Every field that points at a collection, walked as the delete checks
    // walk it (`referencingFields`), inside repeaters and groups too, with its
    // target as reads take it: `relationTo` (one target or a polymorphic
    // list), else the earlier Builder's `options.target`. A narrower reader
    // let a target the generator keys a column to go unjudged, and the
    // migration then failed where it was applied.
    for (const { path, targets } of referencingFields(
      withTargetsAsRead(e.fields)
    )) {
      for (const target of new Set(targets)) {
        if (!validTargets.has(target)) {
          issues.push({
            code: RELATION_TARGET_MISSING_ISSUE,
            message: `${e.slug}.${path} relates to unknown target '${target}'`,
          });
        }
      }
    }
  }

  return issues;
}
