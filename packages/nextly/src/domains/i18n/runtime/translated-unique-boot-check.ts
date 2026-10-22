/**
 * Names, at boot, each translated field marked unique whose companion has no per-language index
 * yet, with what creates it: a configured entity's fields, and a Schema Builder entity's as stored.
 *
 * The boot never changes the schema, so it does not create the index; `db:sync` does in
 * development and a migration does everywhere else. Until one runs, the rule is not enforced,
 * and saying so at every start is what keeps that from passing unnoticed.
 *
 * @module domains/i18n/runtime/translated-unique-boot-check
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  readIndexUniqueness,
  uniqueIndexNames,
} from "../../schema/pipeline/live-table-facts";
import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";
import {
  companionUniqueIndexName,
  uniqueTranslatedColumns,
  type UniqueFieldLike,
} from "../migration/companion-unique-indexes";

import { companionTableExists } from "./companion-io";
import {
  localizableConfigEntities,
  type LocalizableEntity,
} from "./localizable-config-entities";

type BootCheckAdapter = Pick<
  DrizzleAdapter,
  "dialect" | "getDrizzle" | "executeQuery"
>;

/** A collection, Single or field group the Schema Builder stored, as the boot check reads it. */
export interface StoredLocalizableEntity {
  kind: "collection" | "single" | "fieldGroup";
  slug: string;
  companionTable: string;
  fields: readonly UniqueFieldLike[];
  builtBy: ColumnOrigin;
}

/** A stored registry row, by the fields the check reads. */
interface StoredRow {
  slug: string;
  tableName: string;
  localized?: boolean | null;
  /** Stored as the field definitions the Builder saved; read here for name, type and flags. */
  fields?: readonly unknown[] | null;
}

/** The three registries the Schema Builder stores its entities in. */
export interface StoredRegistries {
  collections: { getAllCollections(): Promise<readonly StoredRow[]> };
  singles: { getAllSingles(): Promise<readonly StoredRow[]> };
  fieldGroups: { getAllComponents(): Promise<readonly StoredRow[]> };
}

/** The translated entities the registries hold, configured or made in the Schema Builder. */
export async function storedLocalizableEntities(
  registries: StoredRegistries
): Promise<StoredLocalizableEntity[]> {
  const of = (
    kind: StoredLocalizableEntity["kind"],
    builtBy: ColumnOrigin,
    rows: readonly StoredRow[]
  ): StoredLocalizableEntity[] =>
    rows
      .filter(row => row.localized === true)
      .map(row => ({
        kind,
        slug: row.slug,
        companionTable: `${row.tableName}_locales`,
        fields: (row.fields ?? []) as readonly UniqueFieldLike[],
        builtBy,
      }));
  return [
    ...of(
      "collection",
      "collection",
      await registries.collections.getAllCollections()
    ),
    ...of("single", "collection", await registries.singles.getAllSingles()),
    ...of(
      "fieldGroup",
      "fieldGroup",
      await registries.fieldGroups.getAllComponents()
    ),
  ];
}

/**
 * Warns once per entity whose translated unique fields lack their index: each configured one,
 * then each stored one the configuration does not define (`storedLocalizableEntities`), since an
 * entity made in the Schema Builder before the rule held has no index until it is saved again.
 * Asks the database nothing about an entity with no such field, which is nearly every entity.
 */
export async function warnAboutUnindexedTranslatedUnique(
  adapter: BootCheckAdapter,
  config: Parameters<typeof localizableConfigEntities>[0],
  warn: (message: string) => void,
  stored: readonly StoredLocalizableEntity[] = []
): Promise<void> {
  const configured = new Set<string>();
  for (const [kind, entities, tableNameOf] of localizableConfigEntities(
    config
  )) {
    for (const entity of entities) {
      if (!entity.slug) continue;
      configured.add(`${kind}:${entity.slug}`);
      if (entity.localized !== true) continue;
      const missing = await unindexedFields(
        adapter,
        entity.fields ?? [],
        `${tableNameOf(entity)}_locales`,
        "codeFirst"
      );
      warnFor(
        warn,
        entity.slug,
        missing,
        `Run \`nextly migrate:create\` and then \`nextly migrate\` (or \`nextly db:sync\` in development) to add the index.`
      );
    }
  }
  for (const entity of stored) {
    if (configured.has(`${entity.kind}:${entity.slug}`)) continue;
    const missing = await unindexedFields(
      adapter,
      entity.fields,
      entity.companionTable,
      entity.builtBy
    );
    warnFor(
      warn,
      entity.slug,
      missing,
      `Save it in the Schema Builder to add the index.`
    );
  }
}

function warnFor(
  warn: (message: string) => void,
  slug: string,
  missing: readonly string[],
  remedy: string
): void {
  if (missing.length === 0) return;
  const named = missing.map(field => `"${field}"`).join(", ");
  warn(
    `[nextly] "${slug}": ${named} ${missing.length === 1 ? "is" : "are"} ` +
      `translated and unique, but each language's values are not held unique yet. ${remedy}`
  );
}

/** The translated unique fields whose index the companion lacks; none when it is absent. */
async function unindexedFields(
  adapter: BootCheckAdapter,
  fields: NonNullable<LocalizableEntity["fields"]> | readonly UniqueFieldLike[],
  companionTable: string,
  builtBy: ColumnOrigin
): Promise<string[]> {
  const { dialect } = adapter;
  const wanted = uniqueTranslatedColumns({
    fields,
    entityLocalized: true,
    dialect,
    builtBy,
  });
  if (wanted.length === 0) return [];
  // An absent companion is reported by the boot's own companion provisioning.
  if (!(await companionTableExists(adapter, companionTable))) return [];
  // An index under the name that is not unique enforces nothing, so it counts as missing.
  const live = uniqueIndexNames(
    await readIndexUniqueness(adapter.getDrizzle(), dialect, companionTable)
  );
  return wanted
    .filter(c => !live.has(companionUniqueIndexName(companionTable, c.column)))
    .map(c => c.field);
}
