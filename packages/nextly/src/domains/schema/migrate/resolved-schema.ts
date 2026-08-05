/**
 * The schema as every migrate command must see it: code-first config and the
 * Schema Builder's manifest, merged the way generation merges them.
 *
 * Four commands compare a live database against a snapshot — `migrate`,
 * `migrate:resolve --applied`, `migrate:baseline`, and the boot paths — and
 * each needs the same two answers: which tables the schema declares, and which
 * exist only because a relationship created them. Assembling that per call
 * site is how it kept being assembled differently: one place read the config
 * and not the manifest, another read the manifest and not the plugin extends,
 * and each omission surfaced as drift no migration could resolve.
 *
 * So it is resolved once, here, and every caller reads the same answer.
 *
 * **Runtime restriction (F11):** CLI/boot only; never import from runtime code.
 *
 * @module domains/schema/migrate/resolved-schema
 */
import { resolveSingleTableName } from "../../singles/services/resolve-single-table-name";
import type { ColumnOrigin } from "../services/field-column-descriptor";
import { loadUiSchema } from "../ui-schema/loader";
import { applyDeferredExtendsToManifest } from "../ui-schema/merge";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../utils/resolve-table-name";

import { customJunctionNames } from "./junction-names";

/**
 * How each kind of entity's physical table name is spelled.
 *
 * Kept here rather than restated per command: three callers needing the same
 * three resolvers is exactly the duplication that produced divergent answers
 * elsewhere in this area.
 */
export const DEFAULT_TABLE_NAME_RESOLVERS: TableNameResolvers = {
  collection: e => resolveCollectionTableName(e.slug, e.dbName),
  single: e => resolveSingleTableName({ slug: e.slug, dbName: e.dbName }),
  component: e => resolveComponentTableName(e.slug),
};

export interface TableNameResolvers {
  collection: (e: { slug: string; dbName?: string }) => string;
  single: (e: { slug: string; dbName?: string }) => string;
  component: (e: { slug: string }) => string;
}

/**
 * An entity as the migrate commands need it: its table, and enough of its
 * fields to rebuild a companion the way its creator built it.
 *
 * The fields are the RAW ones. The column descriptor reads `options.variant`,
 * `validation.maxLength` and `options.format` to decide storage, and the diff
 * engine's reduced shape drops all three — a companion derived from that
 * recreates bounded text and formatted numbers as plain TEXT and integers.
 */
export interface ResolvedEntity {
  slug: string;
  tableName: string;
  fields: readonly unknown[];
  status: boolean;
  /**
   * The service that created the table, not who wrote the config.
   * `DynamicCollectionSchemaService` builds Builder collections AND singles;
   * `FieldGroupSchemaService` builds components; everything code-first is the
   * pipeline's own builder.
   */
  builtBy: ColumnOrigin;
}

export interface ResolvedSchema {
  /** Every declared entity, code-first winning on a slug collision. */
  entities: ResolvedEntity[];
  /** Table names the schema declares, for telling a real table from a junction. */
  declaredTables: Set<string>;
  /** Junction tables named outright via `options.junctionTable`. */
  knownJunctions: Set<string>;
}

interface RawEntity {
  slug: string;
  dbName?: string;
  fields?: readonly unknown[];
  status?: boolean;
}

function toResolved(
  entities: readonly unknown[],
  builtBy: ColumnOrigin,
  resolveTableName: (e: { slug: string; dbName?: string }) => string
): ResolvedEntity[] {
  return entities.map(raw => {
    const e = raw as RawEntity;
    return {
      slug: e.slug,
      tableName: resolveTableName({ slug: e.slug, dbName: e.dbName }),
      fields: e.fields ?? [],
      status: e.status === true,
      builtBy,
    };
  });
}

/**
 * Builder entities of one kind that no code-first entity of the SAME kind
 * shadows.
 *
 * Per kind, deliberately: the manifest allows one slug on a collection, a
 * single and a field group at once, and the merge resolves each kind
 * separately. One combined set of shadowed slugs would drop an unshadowed
 * Builder single named `home` because a collection of that name was shadowed,
 * and its live `_locales` companion would then be skipped — leaving a baseline
 * that cannot rebuild the schema it adopted.
 */
function survivingOf<T extends { slug: string }>(
  builder: readonly T[],
  codeFirst: readonly unknown[]
): T[] {
  const shadowed = new Set(codeFirst.map(e => (e as { slug: string }).slug));
  return builder.filter(e => !shadowed.has(e.slug));
}

export interface ResolveSchemaArgs {
  projectRoot: string;
  config: {
    collections: readonly unknown[];
    singles?: readonly unknown[];
    fieldGroups?: readonly unknown[];
    db: { uiSchemaFile: string };
  };
  /** Plugin additions to Builder entities, from `loadConfig`. */
  deferredExtends?: readonly unknown[];
  /** Defaults to `DEFAULT_TABLE_NAME_RESOLVERS`. */
  resolvers?: TableNameResolvers;
}

/**
 * Merge code-first config with the Builder manifest.
 *
 * Code-first wins on a slug collision, matching generation. Order matters
 * beyond correctness of the merge: the losing Builder entity must not reach
 * companion derivation at all, or its stale shape is emitted first and a fresh
 * database keeps it — `CREATE TABLE IF NOT EXISTS` makes the real one a no-op.
 *
 * A manifest that is absent is the ordinary code-first case. One that exists
 * and cannot be read is the operator's to fix: swallowing it would silently
 * drop every Builder declaration.
 */
export async function resolveDeclaredSchema(
  args: ResolveSchemaArgs
): Promise<ResolvedSchema> {
  const resolvers = args.resolvers ?? DEFAULT_TABLE_NAME_RESOLVERS;
  const codeFirst = [
    ...toResolved(args.config.collections, "codeFirst", resolvers.collection),
    ...toResolved(args.config.singles ?? [], "codeFirst", resolvers.single),
    ...toResolved(args.config.fieldGroups ?? [], "codeFirst", e =>
      resolvers.component(e)
    ),
  ];

  let manifest: Awaited<ReturnType<typeof loadUiSchema>> | null = null;
  try {
    manifest = await loadUiSchema({
      projectRoot: args.projectRoot,
      uiSchemaFile: args.config.db.uiSchemaFile,
    });
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }

  let builder: ResolvedEntity[] = [];
  let builderJunctions: string[] = [];
  if (manifest) {
    const merged = applyDeferredExtendsToManifest(
      manifest,
      (args.deferredExtends ?? []) as Parameters<
        typeof applyDeferredExtendsToManifest
      >[1]
    );
    // Code-first wins, so a shadowed Builder entity is dropped rather than
    // ordered after: reaching companion derivation at all is what emits its
    // stale shape first.
    const survivingCollections = survivingOf(
      merged.collections ?? [],
      args.config.collections
    );
    builder = [
      ...toResolved(survivingCollections, "collection", e =>
        resolveCollectionTableName(e.slug)
      ),
      ...toResolved(
        survivingOf(merged.singles ?? [], args.config.singles ?? []),
        "collection",
        resolvers.single
      ),
      ...toResolved(
        survivingOf(merged.components ?? [], args.config.fieldGroups ?? []),
        "fieldGroup",
        e => resolveComponentTableName(e.slug)
      ),
    ];
    // From the SURVIVING collections only. A shadowed collection's custom
    // junction name belongs to a relationship the winning schema no longer
    // declares, so treating it as derived would exclude the table from the
    // snapshot and preserve it forever instead of letting the first migration
    // after adoption drop it.
    builderJunctions = customJunctionNames(survivingCollections);
  }

  const entities = [...codeFirst, ...builder];

  return {
    entities,
    declaredTables: new Set(entities.map(e => e.tableName)),
    knownJunctions: new Set([
      ...customJunctionNames(args.config.collections),
      ...builderJunctions,
    ]),
  };
}
