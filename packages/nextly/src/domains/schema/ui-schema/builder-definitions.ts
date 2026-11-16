/**
 * The Schema Builder's definition file, read and judged by one set of rules for every reader that
 * plans or checks a migration: `migrate:create`, `migrate:check`, and a Builder save writing its
 * own migration. Two readers judged it apart before, and a definition one refused the other wrote
 * into a migration.
 *
 * Reading it means: load the file (or take the definition a save holds), materialise the plugin
 * extends that target a Builder entity, merge it with the configuration (a code-first entity of the
 * same kind and slug wins, with a warning naming its kind), check the plugin field declarations of
 * the entries that survive, and refuse a relationship whose target neither file declares. Every
 * refusal is thrown as a `NextlyError` with an issue code, which the CLI maps to its own code, so
 * each command that reads the file ends with the same message.
 *
 * The definition file is part of the code: a Builder entity the newest snapshot records and
 * neither the configuration nor the file declares was lost, not removed, since a Builder delete
 * writes the migration that drops it. `assertBuilderDefinitionsKept` refuses that before a drop is
 * planned.
 *
 * @module domains/schema/ui-schema/builder-definitions
 */
import type { SanitizedNextlyConfig } from "../../../collections/config/define-config";
import { NextlyError } from "../../../errors/nextly-error";
import type { DeferredExtend } from "../../../plugins/schema/apply-contributions";
import type {
  UiSchemaEntity,
  UiSchemaManifest,
} from "../../../schemas/_zod/ui-schema";
import { assertPluginFieldDeclarations } from "../../../shared/lib/assert-plugin-field-declarations";
import { resolveSingleTableName } from "../../singles/services/resolve-single-table-name";
import { toMinimalEntities } from "../migrate-create/config-entities";
import type { EntitySettingsRecord } from "../migrate-create/entity-settings";
import type { MinimalConfigEntity } from "../migrate-create/generate";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../utils/resolve-table-name";

import {
  BUILDER_DEFINITION_MISSING_ISSUE,
  validateCrossFile,
} from "./cross-file";
import { loadUiSchema } from "./loader";
import {
  applyDeferredExtendsToManifest,
  type BuilderEntityKind,
  mergeUiEntities,
} from "./merge";

/** Each kind as a sentence names it. */
const KIND_WORD: Record<BuilderEntityKind, string> = {
  collection: "collection",
  single: "Single",
  fieldGroup: "field group",
};

/** Each kind's key in the snapshot's settings record, and in the merged entities. */
const KINDS: ReadonlyArray<{
  kind: BuilderEntityKind;
  record: keyof EntitySettingsRecord;
  merged: keyof MergedEntities;
}> = [
  { kind: "collection", record: "collections", merged: "collections" },
  { kind: "single", record: "singles", merged: "singles" },
  { kind: "fieldGroup", record: "fieldGroups", merged: "components" },
];

/** The configuration's entities, merged with the Builder's that no code-first one shadows. */
export interface MergedEntities {
  collections: MinimalConfigEntity[];
  singles: MinimalConfigEntity[];
  components: MinimalConfigEntity[];
}

/** What `readBuilderDefinitions` reads. */
export interface ReadBuilderDefinitionsArgs {
  config: Pick<
    SanitizedNextlyConfig,
    "collections" | "singles" | "fieldGroups"
  > & {
    db: Pick<SanitizedNextlyConfig["db"], "uiSchemaFile">;
  };
  /** Plugin extends whose target is a Schema Builder entity, as the config loader left them. */
  deferredExtends?: readonly DeferredExtend[];
  /** The project root, which `db.uiSchemaFile` is read from. */
  projectRoot: string;
  /** The definition a Builder save holds already; absent, it is read from `db.uiSchemaFile`. */
  manifest?: UiSchemaManifest;
  /**
   * Whether every relationship's target is judged. A Builder save, which writes one entity's
   * migration, leaves it to the save's own validation of the entity it writes, so an unrelated
   * entry never refuses it.
   */
  judgeRelationTargets: boolean;
  logger: { warn(message: string): void };
}

/** The Builder's definitions, read and judged. */
export interface BuilderDefinitions {
  /** The definition, with the plugin extends that target its entities materialised. */
  manifest: UiSchemaManifest;
  /** The entities to generate or check a migration from. */
  merged: MergedEntities;
  /** The Builder's entries no code-first entity of their kind shadows. */
  surviving: {
    collections: UiSchemaEntity[];
    singles: UiSchemaEntity[];
    components: UiSchemaEntity[];
  };
}

/** Read the Builder's definition file and judge it, throwing the first refusal. */
export async function readBuilderDefinitions(
  args: ReadBuilderDefinitionsArgs
): Promise<BuilderDefinitions> {
  const { config, logger } = args;
  const definitionFile = config.db.uiSchemaFile;
  // Each code-first kind resolves its table name through the helper the
  // runtime uses, so the names match the live database (collections, singles
  // and components each normalise differently).
  const codeCollections = toMinimalEntities(config.collections, e =>
    resolveCollectionTableName(e.slug, e.dbName)
  );
  const codeSingles = toMinimalEntities(config.singles ?? [], e =>
    resolveSingleTableName({ slug: e.slug, dbName: e.dbName })
  );
  const codeComponents = toMinimalEntities(config.fieldGroups ?? [], e =>
    resolveComponentTableName(e.slug)
  );

  // Plugin extends that target a Builder entity land in the definition, so
  // they reach both the table diff and the registry row it writes.
  const manifest = applyDeferredExtendsToManifest(
    args.manifest ??
      (await loadUiSchema({
        projectRoot: args.projectRoot,
        uiSchemaFile: definitionFile,
      })),
    [...(args.deferredExtends ?? [])]
  );

  const { shadowed, ...merged } = mergeUiEntities({
    codeCollections,
    codeSingles,
    codeComponents,
    manifest,
  });
  for (const { kind, slug } of shadowed) {
    const word = KIND_WORD[kind];
    logger.warn(
      `${definitionFile} declares a ${word} '${slug}' that a code-first ${word} of the same slug shadows; the code definition wins.`
    );
  }

  // Shadowing is per KIND: the definition may use one slug for a collection,
  // a Single and a field group, and the merge resolves each kind apart. A
  // shadowed entry contributes nothing, so it is not judged.
  const survivingOf = <T extends { slug: string }>(
    list: readonly T[],
    codeFirst: ReadonlyArray<{ slug: string }>
  ): T[] => {
    const codeSlugs = new Set(codeFirst.map(e => e.slug));
    return list.filter(e => !codeSlugs.has(e.slug));
  };
  const surviving = {
    collections: survivingOf(manifest.collections, codeCollections),
    singles: survivingOf(manifest.singles, codeSingles),
    components: survivingOf(manifest.components, codeComponents),
  };

  // A Builder entity can carry a plugin's field too, and a plugin extending
  // one contributes its fields here rather than in the configuration.
  assertPluginFieldDeclarations({
    collections: surviving.collections,
    singles: surviving.singles,
    fieldGroups: surviving.components,
  });

  if (args.judgeRelationTargets) {
    assertRelationTargetsDeclared({
      codeCollectionSlugs: config.collections.map(c => c.slug),
      manifest,
      definitionFile,
    });
  }

  return { manifest, merged, surviving };
}

/**
 * Refuse a relationship or upload in the definition whose target neither the configuration nor
 * the definition declares, and that Nextly does not provide: a migration written with it would
 * hold a reference to a table that does not exist.
 */
export function assertRelationTargetsDeclared(args: {
  codeCollectionSlugs: string[];
  manifest: UiSchemaManifest;
  /** `db.uiSchemaFile`, as the configuration names it. */
  definitionFile: string;
}): void {
  const issues = validateCrossFile({
    codeCollectionSlugs: args.codeCollectionSlugs,
    manifest: args.manifest,
  });
  if (issues.length === 0) return;
  throw NextlyError.validation({
    errors: issues.map(issue => ({
      path: args.definitionFile,
      code: issue.code,
      message: issue.message,
    })),
    logContext: {
      reason: "builder-relation-target",
      definitionFile: args.definitionFile,
    },
  });
}

/**
 * Refuse when the newest snapshot records a Builder entity that neither the configuration nor the
 * definition file declares now: the file lost it, and a migration written from what is left would
 * drop its table and everything in it. An entity the configuration declares moved into code and
 * is kept. A snapshot written before snapshots recorded who declares each entity cannot tell a
 * Builder entity from a code-first one, so it refuses nothing.
 */
export function assertBuilderDefinitionsKept(args: {
  /** The newest snapshot's settings record; absent where it has none. */
  recorded: EntitySettingsRecord | undefined;
  /** What the configuration and the definition file declare now, merged. */
  merged: {
    readonly [K in keyof MergedEntities]: ReadonlyArray<{ slug: string }>;
  };
  /** `db.uiSchemaFile`, as the configuration names it. */
  definitionFile: string;
}): void {
  const { recorded, merged, definitionFile } = args;
  if (recorded === undefined) return;
  const lost: string[] = [];
  for (const { kind, record, merged: key } of KINDS) {
    const declared = new Set(merged[key].map(e => e.slug));
    for (const [slug, entry] of Object.entries(recorded[record])) {
      if (entry.source === "builder" && !declared.has(slug)) {
        lost.push(`${KIND_WORD[kind]} '${slug}'`);
      }
    }
  }
  if (lost.length === 0) return;
  throw NextlyError.validation({
    errors: lost.map(entity => ({
      path: definitionFile,
      code: BUILDER_DEFINITION_MISSING_ISSUE,
      message: entity,
    })),
    logContext: {
      reason: "builder-definition-missing",
      definitionFile,
      entities: lost,
    },
  });
}
