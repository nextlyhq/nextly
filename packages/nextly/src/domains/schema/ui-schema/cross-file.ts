/**
 * Cross-file validation for `ui-schema.json` vs `nextly.config.ts`
 * (spec §4.14.6). This check spans both schema sources, so it lives outside
 * the per-file Zod schema (D1).
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
 * @since v0.0.3-alpha (Plan D2)
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
  manifest: UiSchemaManifest;
}

export function validateCrossFile(
  args: ValidateCrossFileArgs
): CrossFileIssue[] {
  const issues: CrossFileIssue[] = [];
  // Every entity across the manifest, each of whose fields may name a target.
  const manifestEntities = [
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
    // Every field that points at a collection, read as the delete checks and
    // the generator read it: `relationTo` (one target or a polymorphic list)
    // or the earlier Builder's `options.target`, inside repeaters and groups
    // too. A narrower reader let a target the generator keys a column to go
    // unjudged, and the migration then failed where it was applied.
    for (const { path, targets } of referencingFields(e.fields)) {
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
