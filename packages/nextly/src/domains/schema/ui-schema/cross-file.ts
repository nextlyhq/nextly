/**
 * Cross-file validation for `ui-schema.json` vs `nextly.config.ts`
 * (spec §4.14.5/4.14.6). These checks span both schema sources, so they
 * live outside the per-file Zod schema (D1) and run at CI / dev-API time.
 *
 *   - Slug collision: no slug appears in both code config and the manifest.
 *   - Relation target: every `relationTo` points at a real collection —
 *     code-first, UI-built, or a known core table (`users`, `media`).
 *
 * Pure: returns a list of issues; callers decide how to surface them
 * (migrate:check prints + exits; the D3 dev API maps to NextlyError).
 *
 * @module domains/schema/ui-schema/cross-file
 * @since v0.0.3-alpha (Plan D2)
 */
import type { UiSchemaManifest } from "../../../schemas/_zod/ui-schema";

/** Core tables a UI field may relate to without being a user collection. */
const CORE_RELATION_TARGETS = new Set(["users", "media"]);

export interface CrossFileIssue {
  code:
    | "NEXTLY_SCHEMA_SLUG_COLLISION"
    | "NEXTLY_SCHEMA_RELATION_TARGET_MISSING";
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
  const codeSlugs = new Set(args.codeCollectionSlugs);

  // Every entity across the manifest, for slug-collision detection.
  const manifestEntities = [
    ...args.manifest.collections,
    ...args.manifest.singles,
    ...args.manifest.components,
  ];
  for (const e of manifestEntities) {
    if (codeSlugs.has(e.slug)) {
      issues.push({
        code: "NEXTLY_SCHEMA_SLUG_COLLISION",
        message: `slug '${e.slug}' is defined in both nextly.config.ts and ui-schema.json`,
      });
    }
  }

  // Valid relation targets: code collections + UI collections + core tables.
  const validTargets = new Set<string>([
    ...args.codeCollectionSlugs,
    ...args.manifest.collections.map(c => c.slug),
    ...CORE_RELATION_TARGETS,
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
            code: "NEXTLY_SCHEMA_RELATION_TARGET_MISSING",
            message: `${e.slug}.${f.name} relates to unknown target '${target}'`,
          });
        }
      }
    }
  }

  return issues;
}
