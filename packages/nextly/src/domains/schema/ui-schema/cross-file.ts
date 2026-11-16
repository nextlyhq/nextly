/**
 * Cross-file validation for `ui-schema.json` vs `nextly.config.ts`
 * (spec §4.14.6). This check spans both schema sources, so it lives outside
 * the per-file Zod schema (D1).
 *
 *   - Relation target: every `relationTo` points at a real collection —
 *     code-first, UI-built, or one Nextly provides (`users`, `media`).
 *
 * A slug both files declare is not an issue here: the code-first entity of
 * that kind shadows the Builder's, which the merge reports per kind
 * (`mergeUiEntities`) and the migrate commands warn about.
 *
 * Pure: returns a list of issues; `readBuilderDefinitions` refuses them for
 * both migrate commands.
 *
 * @module domains/schema/ui-schema/cross-file
 * @since v0.0.3-alpha (Plan D2)
 */
import type { UiSchemaManifest } from "../../../schemas/_zod/ui-schema";

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

/** The issue code of a relationship whose target neither file declares. */
export const RELATION_TARGET_MISSING_ISSUE =
  "NEXTLY_SCHEMA_RELATION_TARGET_MISSING";

/**
 * The issue code of a Builder entity the newest snapshot records and neither
 * file declares now (`assertBuilderDefinitionsKept`). Kept here, beside the
 * other issue the Builder's definitions are refused with, so the CLI maps both
 * without loading the reader.
 */
export const BUILDER_DEFINITION_MISSING_ISSUE =
  "NEXTLY_SCHEMA_BUILDER_DEFINITION_MISSING";

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
    for (const f of e.fields) {
      if (f.type !== "relationship" && f.type !== "upload") continue;
      if (f.relationTo === undefined) continue;
      // relationTo may be a single target or an array (polymorphic) — check
      // every target so a polymorphic relation can't smuggle in an unknown one.
      const targets = Array.isArray(f.relationTo)
        ? f.relationTo
        : [f.relationTo];
      for (const target of targets) {
        if (!validTargets.has(target)) {
          issues.push({
            code: RELATION_TARGET_MISSING_ISSUE,
            message: `${e.slug}.${f.name} relates to unknown target '${target}'`,
          });
        }
      }
    }
  }

  return issues;
}
