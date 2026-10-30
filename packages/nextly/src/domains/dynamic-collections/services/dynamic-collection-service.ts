/**
 * DynamicCollectionService is a facade over the validation, schema, and
 * registry services for dynamic collections.
 */

import { randomBytes } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors";
import { resolveBuilderRevalidate } from "../../../revalidation/builder-revalidate";
import type { UiSchemaEntity } from "../../../schemas/_zod/ui-schema";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type {
  MigrationStatus,
  StoredHookConfig,
} from "../../../schemas/dynamic-collections/types";
import { getI18nArchiveDdl } from "../../../schemas/nextly-i18n-archive";
import { BaseService } from "../../../shared/base-service";
import type { Logger } from "../../../shared/types";
import { FieldGroupRegistryService } from "../../field-groups/services/field-group-registry-service";
import { fieldGroupSlugList } from "../../field-groups/storage/field-group-field-type";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import { assertLocalizationConfigured } from "../../i18n/config/require-app-config";
import type { LiveLocalization } from "../../i18n/localization-source";
import {
  archiveFieldsLeavingTranslation,
  fieldsLeavingTranslationUnder,
} from "../../i18n/migration/archive-preflight";
import { companionUniqueIndexStatements } from "../../i18n/migration/companion-unique-indexes";
import { deriveCompanionSpec } from "../../i18n/migration/derive-companion-spec";
import {
  buildFieldsJoiningTranslationStatements,
  fieldsJoiningTranslation,
} from "../../i18n/migration/field-joins-translation";
import { withoutLeavingConstraints } from "../../i18n/migration/field-leaves-translation-rules";
import { buildCompanionCreateOnlySql } from "../../i18n/migration/generate-up";
import {
  buildCompanionTransitionPlans,
  type FieldRename,
} from "../../i18n/migration/reconcile-companion";
import { refuseUnindexableTranslatedUnique } from "../../i18n/migration/translated-unique-preconditions";
import { companionHasStatusColumn } from "../../i18n/runtime/companion-io";
import { normalizeType } from "../../schema/pipeline/diff/normalize-type";
import { queryLiveColumnTypes } from "../../schema/pipeline/live-column-types";
import {
  readColumnNullState,
  readForeignKeyColumns,
  readIndexColumns,
  readIndexNames,
  readUniqueColumns,
  tableHasRows,
} from "../../schema/pipeline/live-table-facts";
import type {
  BrowserRenameResolution,
  LegacyFieldResolution,
  LegacyResolutionsBundle,
} from "../../schema/pipeline/prompt-dispatcher/browser";
import {
  columnsThatMayHoldNull,
  getColumnDescriptor,
  systemColumnsForFields,
  toSnakeCase,
} from "../../schema/services/field-column-descriptor";
import { calculateSchemaHash } from "../../schema/services/schema-hash";
import { buildCollectionMetadataUpsert } from "../../schema/ui-schema/metadata-sql";
import { resolveBuilderVersions } from "../../versions/builder-versions";
import { resolveBuilderWebhooks } from "../../webhooks/builder-webhooks";

import {
  DynamicCollectionRegistryService,
  type CollectionMetadata,
  type ListCollectionsOptions,
  type ListCollectionsResponse,
} from "./dynamic-collection-registry-service";
import { DynamicCollectionSchemaService } from "./dynamic-collection-schema-service";
import { DynamicCollectionValidationService } from "./dynamic-collection-validation-service";
import { namesKeptFromStored } from "./field-names";
import { refusalsForCollectionSave } from "./save-preconditions";

export interface CollectionArtifacts {
  /**
   * The migration to COMMIT. Carries the `dynamic_collections` upsert, because
   * the database this file is replayed against has no row for the collection.
   */
  migrationSQL: string;
  /**
   * What to run against THIS database, which differs from the artefact.
   *
   * The registry row here is written by `registerCollection`, and it refuses a
   * slug that already exists — so the upsert the artefact carries must not run
   * locally. Optional so a caller that has no reason to distinguish the two can
   * fall back to `migrationSQL`, which is how the update path already reads its
   * own local variant.
   */
  localMigrationSQL?: string;
  migrationFileName: string;
  tableName: string;
  metadata: {
    id: string;
    slug: string;
    tableName: string;
    description?: string;
    labels: { singular: string; plural: string };
    fields: FieldDefinition[];
    timestamps?: boolean;
    admin?: {
      group?: string;
      icon?: string;
      hidden?: boolean;
      useAsTitle?: string;
    };
    source: "code" | "ui" | "built-in";
    locked?: boolean;
    /** Draft/Published enabled. */
    status?: boolean;
    /** i18n: collection is localized (translatable fields + companion table). */
    localized?: boolean;
    schemaHash: string;
    schemaVersion?: number;
    migrationStatus?: MigrationStatus;
    createdBy?: string;
  };
}

/**
 * The fields every dynamic collection has without being asked: the system adds
 * them, so a save never defines them, and the UI may send them back with the
 * complete field list on an update.
 */
const RESERVED_FIELD_NAMES: readonly string[] = [
  "id",
  "title",
  "slug",
  "created_at",
  "updated_at",
];

export interface CreateCollectionInput {
  name: string;
  label?: string;
  labels?: { singular: string; plural: string };
  description?: string;
  icon?: string;
  group?: string;
  useAsTitle?: string;
  hidden?: boolean;
  order?: number;
  sidebarGroup?: string;
  /** Whether the collection has the Draft/Published status feature enabled. */
  status?: boolean;
  /**
   * i18n: whether the collection is localized. When true, translatable fields are
   * omitted from the main table and a companion `<table>_locales` table is created.
   */
  localized?: boolean;
  /** Whether every save is recorded as a restorable version. */
  versions?: boolean;
  /** Durable versions kept per document. `false` = unlimited, a number = keep
   *  that many, undefined = the default (50). Ignored when `versions` is off. */
  versionsMaxPerDoc?: number | false;
  /** Whether writes bust cache tags. Default on; false opts out entirely. */
  revalidate?: boolean;
  /**
   * Whether writes are recorded to the webhook outbox. Default on; false keeps
   * this collection's content out of the outbox and every delivery.
   */
  webhooks?: boolean;
  fields: FieldDefinition[];
  /**
   * The canonical stored-hook shape, not a looser record: the registry row
   * these feed is typed with it, and the executor reads `config` and `order`
   * off every entry.
   */
  hooks?: StoredHookConfig[];
  createdBy?: string;
}

export interface UpdateCollectionInput {
  label?: string;
  labels?: { singular: string; plural: string };
  description?: string;
  icon?: string;
  group?: string;
  useAsTitle?: string;
  hidden?: boolean;
  order?: number;
  sidebarGroup?: string;
  /** Toggle Draft/Published. Honoured when defined; undefined leaves it unchanged. */
  status?: boolean;
  /** i18n: toggle Internationalization. Honoured when defined; undefined leaves it unchanged. */
  localized?: boolean;
  /** Toggle version history. Honoured when defined; undefined leaves it unchanged. */
  versions?: boolean;
  /** Retention, honoured with the switch. `false` = unlimited, a number = keep
   *  that many, undefined = the default (50). */
  versionsMaxPerDoc?: number | false;
  /** Toggle cache revalidation. Honoured when defined; undefined leaves it unchanged. */
  revalidate?: boolean;
  /** Toggle webhook recording. Honoured when defined; undefined leaves it unchanged. */
  webhooks?: boolean;
  fields?: FieldDefinition[];
  /**
   * The canonical stored-hook shape, not a looser record: the registry row
   * these feed is typed with it, and the executor reads `config` and `order`
   * off every entry.
   */
  hooks?: StoredHookConfig[];
}

/**
 * The order of a translated collection's migration parts, one statement block after another.
 *
 * A disable re-adds the translatable columns to main (the companion part), so the companion
 * transition runs FIRST, after the archive table is ensured, then the shared ALTER. An enable or a
 * field change runs the shared ALTER first, then seeds and drops or ADD/DROPs the companion. One
 * that archives (a field leaving translation) ensures the archive table and writes the archive
 * rows before the shared ALTER: replayed on a database whose archive refuses them, the migration
 * stops before the main table has changed.
 *
 * `settings` comes last: the Required and Unique settings of fields leaving translation, whose
 * shared columns the shared ALTER creates without them so the companion part can copy the default
 * language's values in first.
 */
function orderLocalizedMigration(
  isLocalized: boolean,
  parts: {
    main: string;
    archive: string;
    beforeMain: string;
    companion: string;
    settings?: string;
  }
): string {
  return (
    isLocalized
      ? [
          parts.archive,
          parts.beforeMain,
          parts.main,
          parts.companion,
          parts.settings ?? "",
        ]
      : [parts.archive, parts.companion, parts.main]
  )
    .filter(sql => sql && sql.trim())
    .join("\n--> statement-breakpoint\n");
}

export class DynamicCollectionService extends BaseService {
  private validationService: DynamicCollectionValidationService;
  private schemaService: DynamicCollectionSchemaService;
  private registryService: DynamicCollectionRegistryService;
  /**
   * i18n: the app's default locale — the language seeded onto/restored from the companion when
   * localization is enabled/disabled on an existing collection. Injected from the localization
   * config; defaults to "en" for setups without localization (where transitions never run).
   */
  private readonly defaultLocaleSource: string | LiveLocalization;
  /**
   * i18n: whether the constructing caller holds a localization config, when it
   * knows. `CollectionsHandler` takes one as a constructor argument and can be
   * built outside DI, so that instance must not be told localization is
   * unconfigured by a container it never used. Undefined defers to DI, which is
   * the registered-services path every dispatcher request takes.
   */
  private readonly localizationConfiguredGiven?: boolean;

  /** Lazily built field-group registry, owned by this instance's adapter. */
  private fieldGroupRegistry?: FieldGroupRegistryService;

  /**
   * Whether localization is configured, as the caller said or, handed the language registry, as
   * the registry says now. Undefined defers to DI.
   */
  private get localizationConfigured(): boolean | undefined {
    if (this.localizationConfiguredGiven !== undefined) {
      return this.localizationConfiguredGiven;
    }
    const source = this.defaultLocaleSource;
    return typeof source === "string" ? undefined : source.current() != null;
  }

  /**
   * The default language as it is now. Handed the language registry, a language list changed in
   * Settings after this service was built still decides it.
   */
  private get defaultLocale(): string {
    const source = this.defaultLocaleSource;
    return typeof source === "string"
      ? source
      : (source.current()?.defaultLocale ?? "en");
  }

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    defaultLocale: string | LiveLocalization = "en",
    localizationConfigured?: boolean
  ) {
    super(adapter, logger);
    this.defaultLocaleSource = defaultLocale;
    this.localizationConfiguredGiven = localizationConfigured;

    this.validationService = new DynamicCollectionValidationService();
    this.schemaService = new DynamicCollectionSchemaService(
      this.validationService
    );
    this.registryService = new DynamicCollectionRegistryService(
      this.adapter,
      this.logger
    );
  }

  /**
   * What the live table is, for the parts of an ALTER the field list cannot decide: whether a
   * required column can be added without a value for the rows already there, and which columns
   * are referenced by a foreign key that has to come off before they can be dropped.
   *
   * Both are read together and once per save, so the two cannot be observed at different
   * moments and a table is not queried twice for one edit.
   */
  private async readTableFacts(
    tableName: string,
    pendingFields: FieldDefinition[]
  ): Promise<{
    tableHasRows: boolean;
    foreignKeysByColumn: ReadonlyMap<string, readonly string[]>;
    indexNames: ReadonlySet<string>;
    indexColumns: ReadonlyMap<string, readonly string[]>;
    uniqueColumns: ReadonlyMap<string, string | null>;
    columnsContainingNull: ReadonlySet<string>;
    columnsAbsentFromTable: ReadonlySet<string>;
    liveColumnTypes: ReadonlyMap<string, string>;
  }> {
    // A collection whose creation migration has not been deployed yet has a registry record and
    // no table. Reading from it throws, which would block every follow-up edit to a collection
    // the author has only just created.
    //
    // The attachments still have to be modelled, and as the table WILL be rather than as it is:
    // the two artefacts replay in order, so the create runs first and installs the index and the
    // constraint that this update then has to remove. Reporting none emits a bare DROP COLUMN
    // that is correct against the absent table and refused by the one the deployment builds.
    // There are no rows either way, because nothing has ever been inserted.
    if (!(await this.adapter.tableExists(tableName))) {
      return {
        tableHasRows: false,
        // No table, no rows: nothing holds a null, and nothing can be
        // tightened against a table the deployment has not built yet either —
        // which the create artefact handles, not this diff.
        columnsContainingNull: new Set<string>(),
        columnsAbsentFromTable: new Set<string>(),
        // The types the create artefact WILL write, for the same reason the attachments below are
        // predicted rather than read: the two artefacts replay in order, so an edit made in this
        // window is generated against the table the create is about to build. Reporting none sends
        // MySQL's restate to the legacy renderer, which would `MODIFY` a float the create had just
        // made `double` down to `decimal(10,2)`.
        liveColumnTypes: this.schemaService.plannedColumnTypes(pendingFields),
        ...this.schemaService.plannedAttachments(tableName, pendingFields),
      };
    }

    const db = this.adapter.getDrizzle();
    // A deliberate over-estimate: `readColumnNullState` narrows this to
    // the columns the table ACTUALLY has, from the catalog, before it probes
    // anything — so this only has to drop the ones that could not hold a null
    // anyway. Which of them a save then TIGHTENS is the generator's question;
    // it holds both field lists and this reader holds only the live table.
    const nullableColumns = columnsThatMayHoldNull(pendingFields);
    const [
      hasRows,
      foreignKeys,
      indexes,
      indexColumns,
      unique,
      holdingNull,
      liveTypes,
    ] = await Promise.all([
      tableHasRows(db, this.adapter.dialect, tableName),
      readForeignKeyColumns(db, this.adapter.dialect, tableName),
      readIndexNames(db, this.adapter.dialect, tableName),
      // What each index covers, which its name does not say.
      readIndexColumns(db, this.adapter.dialect, tableName),
      // What each unique index covers, which its name does not say.
      readUniqueColumns(db, this.adapter.dialect, tableName),
      readColumnNullState(db, this.adapter.dialect, tableName, nullableColumns),
      // What each column IS, for the one statement that has to restate a column it is not
      // otherwise changing: MySQL's `MODIFY`. Rendering that type instead of reading it asks
      // which renderer built the column, which has no static answer once the create path moved
      // to the descriptor.
      queryLiveColumnTypes(db, this.adapter.dialect, [tableName]),
    ]);

    // What the table carries, and only that.
    //
    // A deployment can hold several unapplied edits, and each one is generated against the
    // table as it is now rather than as the edit before it will leave it. Correcting for that
    // means replaying the queued artefacts in order — adding what they add AND removing what
    // they remove — because a state that can only gain attachments answers the second edit
    // wrongly in the other direction: disabling an index and then dropping its field would
    // emit a second unguarded removal for an index the first artefact already took away.
    //
    // That is the deferred-artefact problem in general, not something about attachments, and
    // it is tracked with the rest of it rather than approximated here. Reading the live table
    // is exact whenever the edit is applied as it is saved, which is every development setup
    // and every deployment holding one edit.
    return {
      tableHasRows: hasRows,
      foreignKeysByColumn: foreignKeys,
      indexNames: indexes,
      indexColumns,
      uniqueColumns: unique,
      columnsContainingNull: holdingNull.holdingNull,
      columnsAbsentFromTable: holdingNull.absent,
      liveColumnTypes: liveTypes.get(tableName) ?? new Map<string, string>(),
    };
  }

  /**
   * Physical table name per field-group slug these fields reference, resolved
   * from the REGISTRY record each group was created with.
   *
   * The association migration a field-group rename emits has to name the
   * group's data table, and that table is whatever the registry says it is —
   * the storage migration renames comp_ tables to fg_, and a group may carry a
   * historical custom name — so deriving it from the slug again would target a
   * table that does not exist and fail the save.
   *
   * A precondition of the rename, not a best-effort lookup: when any referenced
   * slug cannot be resolved — the registry is unavailable, or a record is
   * missing — the save is refused. Letting it proceed would advance the
   * collection metadata to the new field name while every existing instance
   * row stays keyed by the old one, and the renamed field would read as empty.
   */
  private async resolveFieldGroupTableNames(
    fields: FieldDefinition[]
  ): Promise<ReadonlyMap<string, string>> {
    const slugs = new Set<string>();
    for (const field of fields) {
      for (const slug of fieldGroupSlugList(field)) slugs.add(slug);
    }
    if (slugs.size === 0) return new Map();

    const resolved = new Map<string, string>();
    // Instance-owned, like every other service this class news up: a caller
    // that constructed DynamicCollectionService directly has no global
    // container, and the rename path must not depend on one having been
    // registered.
    const registry = (this.fieldGroupRegistry ??= new FieldGroupRegistryService(
      this.adapter,
      this.logger
    ));
    await Promise.all(
      [...slugs].map(async slug => {
        // As stored, past the registry row cache: the DDL is planned against this table.
        const record = await registry.findComponentForWrite(slug);
        if (record) resolved.set(slug, record.tableName);
      })
    );

    const unresolved = [...slugs].filter(slug => !resolved.has(slug));
    if (unresolved.length > 0) {
      throw NextlyError.validation({
        errors: [
          {
            path: `fields.${unresolved.join(", ")}`,
            code: "FIELD_GROUP_TABLE_UNRESOLVED",
            message:
              `Cannot rename this field group: its data lives in tables whose ` +
              `names come from the field-group registry, and no record could ` +
              `be resolved for: ${unresolved.join(", ")}. Restore the missing ` +
              `field group (or remove the field) and save again.`,
          },
        ],
        logContext: { unresolvedFieldGroups: unresolved },
      });
    }
    return resolved;
  }

  /**
   * Generate collection artifacts (SQL migration + TypeScript schema).
   */
  async generateCollection(
    data: CreateCollectionInput
  ): Promise<CollectionArtifacts> {
    // The REST dispatcher forwards the request body unvalidated, so `data` is
    // caller-controlled and the fields below may be absent. Check them before
    // dereferencing: without this a body missing `name` throws a TypeError
    // from `.toLowerCase()`, which is indistinguishable from a defect in our
    // own code and cannot be reported as the client error it is.
    if (typeof data?.name !== "string" || data.name.trim() === "") {
      throw NextlyError.validation({
        errors: [
          { path: "name", code: "REQUIRED", message: "Name is required." },
        ],
      });
    }
    if (!Array.isArray(data.fields)) {
      throw NextlyError.validation({
        errors: [
          {
            path: "fields",
            code: "REQUIRED",
            message: "Fields must be an array.",
          },
        ],
      });
    }
    // Element shape matters too: the array is normalised with `f.name
    // .toLowerCase()` below, before field validation runs, so an element
    // without a string name throws the same untyped TypeError the checks
    // above exist to prevent.
    const malformed = data.fields.findIndex(
      f => typeof (f as { name?: unknown })?.name !== "string"
    );
    if (malformed !== -1) {
      throw NextlyError.validation({
        errors: [
          {
            path: `fields[${malformed}].name`,
            code: "REQUIRED",
            message: "Each field requires a name.",
          },
        ],
      });
    }

    // `group` is lower-cased later without a type check; `?.` guards null and
    // undefined but not a number or object, which would throw an untyped
    // TypeError from a caller-supplied value.
    if (data.group !== undefined && typeof data.group !== "string") {
      throw NextlyError.validation({
        errors: [
          {
            path: "group",
            code: "INVALID",
            message: "Group must be a string.",
          },
        ],
      });
    }

    const normalizedName = data.name.toLowerCase();
    // A hyphen in the address is written as an underscore in the table, as configuration names it.
    const tableName = `dc_${normalizedName.replace(/-/g, "_")}`;

    this.validationService.validateCollectionName(normalizedName);

    // i18n: a localized collection stores translatable values via the app's
    // `localization` config; creating one without that config would split
    // the tables into a shape the runtime cannot write to (every entry
    // create then 500s). Reject up front with an actionable message.
    if (data.localized === true) {
      assertLocalizationConfigured(
        "collection",
        normalizedName,
        this.localizationConfigured
      );
    }

    const exists = await this.registryService.collectionExists(normalizedName);
    if (exists) {
      throw new Error(`Collection "${normalizedName}" already exists`);
    }

    const userDefinedFields = this.userFieldsOf(data.fields, tableName);

    const id = this.generateId();

    // The schema service automatically adds reserved fields (id, slug,
    // created_at, updated_at). Pass `hasStatus` so the data table also
    // gets a `status` column when the user toggled Draft/Published on —
    // without it, the first INSERT including status fails with "no
    // column named status".
    const migrationSQL = this.schemaService.generateMigrationSQL(
      tableName,
      userDefinedFields,
      // i18n: omit translatable columns from the main table when localized — they
      // live in the companion `_locales` table created below.
      { hasStatus: data.status === true, localized: data.localized === true }
    );

    // i18n: for a localized collection, append the companion `<table>_locales`
    // CREATE to the migration so the UI-create path materializes it (create-only:
    // fresh collection, no data to seed, no main-table columns to drop). Without
    // this, a UI-created localized collection has nowhere to store per-language
    // values and every language shares the main columns.
    const withCompanion = data.localized
      ? this.appendCompanionCreateSQL(migrationSQL, normalizedName, tableName, {
          fields: userDefinedFields,
          status: data.status === true,
        })
      : migrationSQL;

    // 🔴 The committed migration has to carry the REGISTRY ROW as well as the
    // table. This file is replayed against a database that has never seen the
    // Schema Builder -- production -- where the `dynamic_collections` row this
    // service writes locally does not exist. Without the upsert the deploy gets
    // the table and no row at all, and the collection is absent from the admin
    // rather than merely stale.
    //
    // Built by the SAME builder `migrate:create` uses, not a second statement
    // that would have to agree with it. What makes this file have to be
    // self-sufficient is simply that it is the only thing replayed against the
    // target database: nothing else recreates the registry row there.
    // 🔴 The ARTEFACT and what runs HERE are not the same statement, and this
    // path had no reason to distinguish them until the artefact gained the
    // registry row. The committed file must recreate that row, because the
    // database it is replayed against has none. THIS database is about to get
    // one from `registerCollection`, which refuses a slug that already exists --
    // so running the upsert locally would insert the row, make that refusal
    // fire, and leave a created table beside a half-written registry with every
    // retry failing on the slug it just took.
    //
    // The update path already draws this distinction and names it the same way;
    // the create path simply never needed it before.
    const fullMigrationSQL = this.appendMetadataUpsertSQL(
      withCompanion,
      this.manifestEntityFor(normalizedName, data, userDefinedFields)
    );

    const schemaHash = this.generateSchemaHash(userDefinedFields);

    const metadata = {
      id,
      slug: normalizedName,
      tableName,
      description: data.description,
      labels: data.labels ?? {
        singular: data.label || normalizedName,
        plural: (data.label || normalizedName) + "s",
      },
      fields: userDefinedFields,
      timestamps: true,
      admin: {
        icon: data.icon,
        group: data.group?.toLowerCase(),
        useAsTitle: data.useAsTitle,
        hidden: data.hidden,
        order: data.order,
        sidebarGroup: data.sidebarGroup,
      },
      source: "ui" as const,
      locked: false,
      // Persist the Draft/Published flag so the entry edit form shows
      // Save Draft / Publish split for new collections that opt in.
      status: data.status === true,
      // i18n: persist the localized flag so the read/write path routes translatable
      // fields to the companion table and the admin shows per-language editing.
      localized: data.localized === true,
      // Persist version history from the create payload; without it a
      // collection created with the switch on is written unversioned and the
      // switch reads as off the moment the editor loads. Retention rides along.
      versions: resolveBuilderVersions(data.versions, data.versionsMaxPerDoc),
      // Persist the cache-revalidation opt-out from the create payload (null =
      // standard tags, { disable: true } = off) so the write path reads it back.
      revalidate: resolveBuilderRevalidate(data.revalidate),
      // Persist the webhook recording opt-out from the create payload (null =
      // record, { record: false } = off) so boot reads it back and the switch
      // survives a restart rather than lasting only for this process.
      webhooks: resolveBuilderWebhooks(data.webhooks),
      schemaHash,
      schemaVersion: 1,
      migrationStatus: "pending" as const,
      hooks: data.hooks,
      createdBy: data.createdBy,
    };

    return {
      migrationSQL: fullMigrationSQL,
      // What to run against THIS database: the DDL without the registry row,
      // which `registerCollection` writes a moment later.
      localMigrationSQL: withCompanion,
      migrationFileName: `${Date.now()}_create_${normalizedName}.sql`,
      tableName,
      metadata,
    };
  }

  /**
   * This collection as the manifest describes it, which is what the metadata
   * upsert is built from.
   *
   * 🔴 Every optional value is passed STRAIGHT THROUGH, `undefined` included,
   * rather than being conditionally spread in. The upsert builder hands each to
   * its own literal helper -- `versionsLiteral`, `revalidateLiteral`,
   * `webhooksLiteral` -- which decide what an absent flag means, and
   * `JSON.stringify` drops an undefined member, so an omitted key and a
   * present-but-undefined one produce the same row. Spreading conditionally
   * bought nothing and put six branches on this mapping.
   *
   * The BOOLEAN forms, not the resolved objects this service stores: the
   * builder runs the same `resolveBuilder*` helpers itself, so handing it the
   * resolved form would resolve twice and could write a row `migrate:create`
   * would not.
   */
  /**
   * Refuse a junction move whose destination name the database already holds.
   *
   * @throws NextlyError (validation, `JUNCTION_TABLE_IN_USE`) naming the table
   */
  private async refuseJunctionMovesOntoLiveTables(
    tableName: string,
    oldFields: FieldDefinition[],
    newFields: FieldDefinition[]
  ): Promise<void> {
    for (const move of this.schemaService.junctionMoves(
      tableName,
      oldFields,
      newFields
    )) {
      if (!(await this.adapter.tableExists(move.to.table))) continue;
      throw NextlyError.validation({
        errors: [
          {
            path: "fields",
            code: "JUNCTION_TABLE_IN_USE",
            message:
              `Junction table "${move.from.table}" cannot move to ` +
              `"${move.to.table}": a table of that name already exists in the ` +
              `database. Choose another name, or drop that table first.`,
          },
        ],
        logContext: { from: move.from.table, to: move.to.table },
      });
    }
  }

  /**
   * The fields a save defines itself, validated: the reserved fields dropped,
   * every name checked by the column it becomes, and no two many-to-many fields
   * sharing one junction table — asked through the schema service's own naming,
   * which is what the DDL is written with.
   *
   * Each field keeps the name it was sent with, so its column is
   * `toSnakeCase(name)`, the name the write path uses. On an update, a field
   * that differs from a stored one only in case keeps the stored name, so a
   * field saved lowercased before names kept their case keeps its column and
   * values (`namesKeptFromStored`).
   */
  private userFieldsOf(
    fields: FieldDefinition[],
    tableName: string,
    stored: readonly FieldDefinition[] = []
  ): FieldDefinition[] {
    const userDefinedFields = namesKeptFromStored(
      fields.filter(f => !RESERVED_FIELD_NAMES.includes(f.name.toLowerCase())),
      stored
    );
    this.validationService.validateFieldNames(userDefinedFields);
    this.validationService.validateJunctionOwnership(userDefinedFields, field =>
      this.schemaService.junctionTableNameFor(tableName, field)
    );
    return userDefinedFields;
  }

  private manifestEntityFor(
    slug: string,
    data: CreateCollectionInput,
    fields: FieldDefinition[]
  ): UiSchemaEntity {
    return {
      slug,
      description: data.description,
      hooks: data.hooks,
      labels: data.labels ?? {
        singular: data.label || slug,
        plural: (data.label || slug) + "s",
      },
      // 🔴 EVERY admin key the local row gets, not the two the manifest used to
      // declare. These are what a reader sees -- whether the collection appears
      // at all, where in the sidebar, under which icon -- so a narrower mapping
      // here rebuilt a visibly different collection wherever the file was
      // replayed, and looked correct in the one place it was authored.
      admin: {
        useAsTitle: data.useAsTitle,
        group: data.group?.toLowerCase(),
        icon: data.icon,
        hidden: data.hidden,
        order: data.order,
        sidebarGroup: data.sidebarGroup,
      },
      status: data.status === true,
      localized: data.localized === true,
      versions: data.versions,
      versionsMaxPerDoc: data.versionsMaxPerDoc,
      revalidate: data.revalidate,
      webhooks: data.webhooks,
      fields: fields as unknown as UiSchemaEntity["fields"],
    };
  }

  /**
   * Append the `dynamic_collections` upsert that recreates this collection's
   * registry row when the migration is replayed elsewhere.
   *
   * Separated with the breakpoint marker for the same reason the companion
   * CREATE is: the runner splits on it, and a driver with multi-statements
   * disabled rejects a combined chunk.
   *
   * The upsert conflicts on `slug` and leaves `id`, `table_name`, `source` and
   * `migration_status` to the INSERT, so replaying it against a database that
   * already holds the row -- this one, in development -- refreshes the fields
   * and labels without renaming the row or overwriting a status the runtime
   * owns.
   */
  private appendMetadataUpsertSQL(
    migrationSQL: string,
    entity: UiSchemaEntity
  ): string {
    const upsert = buildCollectionMetadataUpsert(entity, this.adapter.dialect);
    return `${migrationSQL}\n--> statement-breakpoint\n${upsert}`;
  }

  /**
   * i18n: append the create-only companion `<table>_locales` CREATE statement to a
   * fresh localized collection's migration. Returns the original SQL unchanged when
   * the collection has no translatable fields (nothing to store per-locale).
   */
  private appendCompanionCreateSQL(
    migrationSQL: string,
    slug: string,
    tableName: string,
    opts: { fields: FieldDefinition[]; status: boolean }
  ): string {
    const spec = deriveCompanionSpec({
      slug,
      kind: "collection",
      dbName: tableName,
      fields: opts.fields,
      dialect: this.adapter.dialect,
      // This service creates Schema Builder collections, and the companion mirrors that table.
      builtBy: "collection",
      // Unused for the create-only statement (no seed) — a placeholder is fine.
      defaultLocale: "en",
      collectionLocalized: true,
      status: opts.status,
    });
    if (!spec) return migrationSQL;
    // A translated field marked unique is unique within each language: its index is created with
    // the companion, which is new, so none exists yet. Refused first on a server that cannot key it.
    const unique = refuseUnindexableTranslatedUnique(this.adapter, {
      entity: slug,
      builtBy: "collection",
      oldFields: [],
      newFields: opts.fields,
      wasLocalized: false,
      isLocalized: true,
    });
    // Separate each statement with the breakpoint marker so the runner executes it as its own
    // statement (a multi-statement chunk is rejected by drivers with multi-statements disabled,
    // e.g. MySQL).
    return [
      migrationSQL,
      buildCompanionCreateOnlySql(spec),
      ...companionUniqueIndexStatements({
        dialect: this.adapter.dialect,
        companionTable: `${tableName}_locales`,
        wanted: unique,
        translatedColumns: [],
        liveIndexNames: new Set(),
      }),
    ].join("\n--> statement-breakpoint\n");
  }

  /**
   * The schema hash for this collection's stored row.
   *
   * 🔴 DELEGATES to the canonical function, and the delegation is the point.
   * This hashed the raw field JSON; `calculateSchemaHash` normalises the fields
   * and folds in `SYSTEM_SCHEMA_VERSION`, so the two produce different values
   * for the same collection. The migration this service writes carries the
   * canonical one -- the shared upsert computes it -- so the local row and the
   * replayed row disagreed about a collection neither had changed.
   *
   * What that costs is not cosmetic: `syncCodeFirstCollections` decides whether
   * a definition changed by comparing this hash, so the two databases reach
   * opposite answers -- one reopening `migration_status` and bumping
   * `schema_version` for a collection the other considers settled.
   */
  private generateSchemaHash(fields: FieldDefinition[]): string {
    return calculateSchemaHash(
      fields as unknown as Parameters<typeof calculateSchemaHash>[0]
    );
  }

  /**
   * Join SQL statements for a migration file the way the runner expects: each statement is
   * `;`-terminated and separated by `--> statement-breakpoint`, so the file splits into
   * single-statement chunks (drivers with multi-statements disabled, e.g. MySQL, otherwise
   * reject a multi-statement chunk).
   */
  /**
   * Refuse an added field whose column name an unrelated column of this table already holds, with
   * another type: a column a save refused part-way added has the field's own type and is taken as
   * the field's by the push, while one of another type is left from an earlier field, and taking
   * it would keep values the new field cannot hold. A precondition, read from the live table
   * before anything changes.
   */
  private refuseAddedColumnsTaken(
    tableName: string,
    oldFields: readonly FieldDefinition[],
    newFields: readonly FieldDefinition[],
    liveColumnTypes: ReadonlyMap<string, string>
  ): void {
    const known = new Set(oldFields.map(f => f.name));
    for (const field of newFields) {
      if (known.has(field.name)) continue;
      const column = getColumnDescriptor(
        field,
        this.adapter.dialect,
        "collection"
      )?.name;
      if (column === undefined) continue;
      const live = liveColumnTypes.get(column);
      if (live === undefined) continue;
      const planned = [
        ...this.schemaService.plannedColumnTypes([field]).values(),
      ][0];
      if (normalizeType(live) !== normalizeType(planned)) {
        throw this.columnTakenRefusal(tableName, field, column, live, planned);
      }
    }
  }

  /** The refusal for an added field whose column name an unrelated column already holds. */
  private columnTakenRefusal(
    tableName: string,
    field: FieldDefinition,
    column: string,
    liveType: string,
    plannedType: string | undefined
  ): NextlyError {
    return NextlyError.validation({
      errors: [
        {
          path: `fields.${field.name}`,
          code: "COLUMN_ALREADY_EXISTS",
          message:
            `The table already has a column "${column}" of another type, left from an earlier ` +
            `field. Give ${field.name} another name, or remove that column first.`,
        },
      ],
      logContext: { tableName, column, liveType, plannedType },
    });
  }

  /**
   * The answers a Builder save gives the schema pipeline's push, which asks them of a dialog's
   * admin, made as the save has always decided them:
   *
   * - the field it renames is a rename, and no other pair of a removed and an added column is
   *   taken for one;
   * - each column leaving the main table is confirmed for its drop, as the save drops it: a removed
   *   field's, a field joining translation's (its values are moved first), and the lifecycle column
   *   when Draft/Published is turned off;
   * - an added Required column fills the rows already there with the field's default, or its
   *   type's empty, as the save's ADD did.
   */
  private pushAnswers(
    tableName: string,
    change: {
      oldFields: FieldDefinition[];
      newFields: FieldDefinition[];
      wasLocalized: boolean;
      isLocalized: boolean;
      wasStatus: boolean;
      hasStatus: boolean;
      renamed: FieldRename | null;
    }
  ): {
    renameResolutions: BrowserRenameResolution[];
    legacyResolutions: LegacyResolutionsBundle;
  } {
    const onMain = (fields: FieldDefinition[], localized: boolean) => {
      const translated = new Set(resolveLocalizedFieldNames(fields, localized));
      return fields.filter(f => !translated.has(f.name));
    };
    const before = onMain(change.oldFields, change.wasLocalized);
    const after = onMain(change.newFields, change.isLocalized);
    const beforeNames = new Set(before.map(f => f.name));
    const afterNames = new Set(after.map(f => f.name));
    const removed = before.filter(
      f => !afterNames.has(f.name) && f.name !== change.renamed?.from
    );
    const added = after.filter(
      f => !beforeNames.has(f.name) && f.name !== change.renamed?.to
    );
    const column = (f: FieldDefinition) => toSnakeCase(f.name);
    const renameResolutions: BrowserRenameResolution[] = [
      ...(change.renamed
        ? [
            {
              tableName,
              fromColumn: toSnakeCase(change.renamed.from),
              toColumn: toSnakeCase(change.renamed.to),
              choice: "rename" as const,
            },
          ]
        : []),
      // Every other removed column against every column the save adds, the renamed field's new
      // one included: the pipeline offers each such pair, and a pair left unanswered stops it.
      ...removed.flatMap(from =>
        [
          ...added.map(column),
          ...(change.renamed ? [toSnakeCase(change.renamed.to)] : []),
        ].map(toColumn => ({
          tableName,
          fromColumn: column(from),
          toColumn,
          choice: "drop_and_add" as const,
        }))
      ),
    ];
    const now = new Date();
    const byFieldName: Record<string, LegacyFieldResolution> = {};
    for (const field of removed)
      byFieldName[field.name] = { action: "confirm_drop" };
    // Every column the lifecycle brings, when Draft/Published is turned off: the system columns
    // the table has with it and not without it, as the schema derives them.
    if (change.wasStatus && !change.hasStatus) {
      const systemColumns = (hasStatus: boolean) =>
        systemColumnsForFields(change.newFields, this.adapter.dialect, {
          builtBy: "collection",
          hasStatus,
          isSingle: false,
        }).map(column => column.name);
      const without = new Set(systemColumns(false));
      for (const name of systemColumns(true)) {
        if (!without.has(name)) byFieldName[name] = { action: "confirm_drop" };
      }
    }
    for (const field of added) {
      if (field.required !== true) continue;
      const value = this.schemaService.addedColumnFillValue(field, now);
      if (value !== undefined) {
        byFieldName[field.name] = { action: "provide_default", value };
      }
    }
    return {
      renameResolutions,
      legacyResolutions: { tableName, byFieldName },
    };
  }

  /**
   * Statements the ALTER generator wrote, each already `;`-terminated, joined as its migration
   * joins them, or null when there are none.
   */
  private joinedStatements(statements: string[]): string | null {
    return statements.length === 0
      ? null
      : statements.join("\n--> statement-breakpoint\n");
  }

  private toBreakpointSql(statements: string[]): string {
    return statements.map(s => `${s};`).join("\n--> statement-breakpoint\n");
  }

  /**
   * i18n: build the data-preserving companion SQL for a localization enable/disable/field-change
   * on an existing collection (empty when there's nothing to do). Enabling seeds the companion
   * default locale from the existing main columns then drops them; disabling restores the default
   * onto main, archives the other languages into `nextly_i18n_archive`, then drops the companion;
   * a field change ADDs/DROPs localized columns. Returns `needsArchive` so the caller prepends the
   * archive table's `CREATE IF NOT EXISTS` DDL before a disable's archive INSERT.
   */
  /**
   * A translated collection's whole migration: the main-table SQL, the archive table when the
   * transition archives, and the companion transition, in the order `orderLocalizedMigration`
   * sets. `localSql` is the same migration for this process's own database when the companion
   * transition differs there.
   */
  private async buildLocalizedMigrationSQL(
    main: { artefact: string; settings?: string },
    args: Parameters<DynamicCollectionService["buildCompanionTransitionSQL"]>[0]
  ): Promise<{ sql: string; needsArchive: boolean }> {
    const { sql, beforeMainSql, needsArchive } =
      await this.buildCompanionTransitionSQL(args);
    const archive = needsArchive
      ? this.toBreakpointSql(getI18nArchiveDdl(this.adapter.dialect))
      : "";
    const assemble = (mainSQL: string, beforeMain: string, companion: string) =>
      orderLocalizedMigration(args.isLocalized, {
        main: mainSQL,
        archive,
        beforeMain,
        companion,
        settings: main.settings,
      });
    return {
      sql: assemble(main.artefact, beforeMainSql, sql),
      needsArchive,
    };
  }

  private async buildCompanionTransitionSQL(args: {
    slug: string;
    tableName: string;
    oldFields: FieldDefinition[];
    newFields: FieldDefinition[];
    wasLocalized: boolean;
    isLocalized: boolean;
    status: boolean;
    /** Whether the entity HAD Draft/Published before this save — see `wasStatus` on the args. */
    wasStatus: boolean;
    /** A field this save renames, by field name, as the main table's rename is decided. */
    renamed?: FieldRename;
  }): Promise<{
    sql: string;
    beforeMainSql: string;
    needsArchive: boolean;
  }> {
    const companionTable = `${args.tableName}_locales`;
    const companionExists = await this.adapter.tableExists(companionTable);
    // Only introspect `_status` for a field change on a still-localized collection (a later
    // Draft/Published toggle must ADD/DROP the companion `_status`).
    const companionHasStatus =
      companionExists && args.wasLocalized && args.isLocalized
        ? await companionHasStatusColumn(this.adapter, companionTable)
        : undefined;
    // Fields becoming translated: their values move into the default language's companion rows
    // before the main table loses their columns, and the file adds each companion column.
    const joinArgs = {
      slug: args.slug,
      tableName: args.tableName,
      dialect: this.adapter.dialect,
      builtBy: "collection" as const,
      defaultLocale: this.defaultLocale,
      oldFields: args.oldFields,
      newFields: args.newFields,
      status: args.wasStatus && companionHasStatus !== false,
      companionStatus: args.status,
      companionExists,
    };
    const joining =
      args.wasLocalized && args.isLocalized
        ? buildFieldsJoiningTranslationStatements(joinArgs)
        : {
            fields: [],
            columns: [],
            createsCompanion: false,
            statements: [],
          };
    const common = {
      // This service owns Schema Builder collections, so the companion mirrors that builder.
      builtBy: "collection" as const,
      slug: args.slug,
      kind: "collection" as const,
      tableName: args.tableName,
      dialect: this.adapter.dialect,
      defaultLocale: this.defaultLocale,
      status: args.status,
      wasLocalized: args.wasLocalized,
      isLocalized: args.isLocalized,
      oldFields: args.oldFields,
      newFields: args.newFields,
      // A companion the joining fields' statements create exists by the time the transition runs.
      companionExists: companionExists || joining.createsCompanion,
      companionHasStatus,
      wasStatus: args.wasStatus,
      // This service writes the whole migration, main-table change included, so the archive
      // writes come back separately to go ahead of it.
      archiveBeforeMain: true,
      joinedBefore: joining.fields,
      renamed: args.renamed,
    };

    // The file, planned from history alone: this database's companion is brought in step by the
    // apply, from what it holds now (`liveCompanionShape`).
    const { artefact } = buildCompanionTransitionPlans(common);

    // Separate statements with the migration-file breakpoint marker (not blank lines): the file
    // is split on `--> statement-breakpoint` and each chunk is run as ONE statement, so a
    // multi-statement chunk is rejected by drivers with multi-statements disabled (e.g. MySQL).
    return {
      sql: this.toBreakpointSql(artefact.statements),
      beforeMainSql: this.toBreakpointSql([
        ...(artefact.beforeMain ?? []),
        ...joining.statements,
      ]),
      needsArchive: artefact.needsArchive,
    };
  }

  /**
   * Generate update artifacts when collection schema is modified.
   */
  async generateCollectionUpdate(
    collectionName: string,
    updates: UpdateCollectionInput
  ): Promise<{
    migrationSQL: string | null;
    /**
     * The statements this database runs beside the schema pipeline's push, which leaves these
     * tables out of its diff: a renamed field-group field's association and the junction tables
     * of many-to-many fields, as the file carries them. Null when the save has none.
     */
    besideStatements: string | null;
    /** The field the save renames, which the push is answered with; null when none. */
    renamedField: FieldRename | null;
    /** The answers this save gives the schema pipeline's push (`pushAnswers`). */
    pushAnswers: {
      renameResolutions: BrowserRenameResolution[];
      legacyResolutions: LegacyResolutionsBundle;
    };
    migrationFileName: string | null;
    /**
     * What the registry row is updated with. `fields`, when the save changes them, is the list as
     * stored (names lowercased, reserved fields dropped), the one every table is built from.
     */
    metadataUpdates: Record<string, unknown> & { fields?: FieldDefinition[] };
    /**
     * Whether the migration writes `nextly_i18n_archive`. Its `CREATE TABLE IF NOT EXISTS` cannot
     * bring an older archive up to date, so a caller running it here prepares the archive first.
     */
    needsArchive: boolean;
  }> {
    if (updates.group !== undefined && typeof updates.group !== "string") {
      throw NextlyError.validation({
        errors: [
          {
            path: "group",
            code: "INVALID",
            message: "Group must be a string.",
          },
        ],
      });
    }

    // Validate caller input before any I/O: the shape checks below cannot
    // depend on the registry, and rejecting a malformed body after a fetch
    // does pointless work for a request that was never going to apply.
    //
    // Presence, not truthiness: `fields: null` or `fields: ""` is a supplied
    // value that cannot be applied, and treating it as absent would report
    // success for an update that silently did nothing to the fields.
    if (updates.fields !== undefined) {
      if (!Array.isArray(updates.fields)) {
        throw NextlyError.validation({
          errors: [
            {
              path: "fields",
              code: "REQUIRED",
              message: "Fields must be an array.",
            },
          ],
        });
      }
      // The array is normalised through `f.name.toLowerCase()` before field
      // validation runs, so an element without a string name throws an
      // untyped TypeError rather than reporting the client error it is.
      const malformedUpdate = updates.fields.findIndex(
        f => typeof (f as { name?: unknown })?.name !== "string"
      );
      if (malformedUpdate !== -1) {
        throw NextlyError.validation({
          errors: [
            {
              path: `fields[${malformedUpdate}].name`,
              code: "REQUIRED",
              message: "Each field requires a name.",
            },
          ],
        });
      }
    }

    const collection = (await this.registryService.getCollection(
      collectionName
    )) as CollectionMetadata;

    const metadataUpdates: Record<string, unknown> & {
      fields?: FieldDefinition[];
    } = {
      updatedAt: new Date(),
    };

    if (updates.labels) {
      metadataUpdates.labels = updates.labels;
      metadataUpdates.label = updates.labels.singular;
    } else if (updates.label) {
      metadataUpdates.label = updates.label;
    }
    if (updates.description !== undefined)
      metadataUpdates.description = updates.description;

    // Admin options are stored inside the admin object in the database.
    if (
      updates.icon !== undefined ||
      updates.group !== undefined ||
      updates.useAsTitle !== undefined ||
      updates.hidden !== undefined ||
      updates.order !== undefined ||
      updates.sidebarGroup !== undefined
    ) {
      const nextAdmin: Record<string, unknown> = {
        ...(collection.admin || {}),
      };

      if (updates.icon !== undefined) nextAdmin.icon = updates.icon;
      if (updates.group !== undefined)
        nextAdmin.group = updates.group?.toLowerCase();
      if (updates.useAsTitle !== undefined)
        nextAdmin.useAsTitle = updates.useAsTitle;
      if (updates.hidden !== undefined) nextAdmin.hidden = updates.hidden;
      if (updates.order !== undefined) nextAdmin.order = updates.order;
      if (updates.sidebarGroup !== undefined)
        nextAdmin.sidebarGroup = updates.sidebarGroup;

      metadataUpdates.admin = nextAdmin;
    }
    if (updates.icon !== undefined) metadataUpdates.icon = updates.icon;
    if (updates.hooks !== undefined) metadataUpdates.hooks = updates.hooks;
    // Status toggle: only persist when the caller explicitly sent it,
    // so admin updates that don't touch the flag don't reset it.
    if (updates.status !== undefined) metadataUpdates.status = updates.status;
    // i18n: persist the Internationalization toggle. Previously omitted here, so toggling i18n on
    // an EXISTING collection was sent by the UI but never saved (only the create path persisted
    // it). Mirrors `status` — only written when the caller explicitly sent it.
    if (updates.localized !== undefined)
      metadataUpdates.localized = updates.localized;
    // Version history toggle. The column holds the resolved config every
    // runtime reader tests, so the boolean is normalized before it is stored;
    // off writes null. `status` is deliberately not passed to the resolver —
    // it aliases to a versioned config for back-compat, which would stop the
    // toggle from ever turning versioning off on a Draft/Published entity.
    // Retention without the on/off switch is ambiguous — the resolver needs the
    // enabled state — so a retention-only update is rejected rather than
    // silently dropped. This is the chokepoint every collection-update caller
    // reaches (the dispatcher forwards its raw body here).
    if (
      updates.versionsMaxPerDoc !== undefined &&
      updates.versions === undefined
    ) {
      throw NextlyError.validation({
        errors: [
          {
            path: "versionsMaxPerDoc",
            code: "MISSING_DEPENDENCY",
            message: "versionsMaxPerDoc requires versions to be set.",
          },
        ],
      });
    }
    if (updates.versions !== undefined) {
      metadataUpdates.versions = resolveBuilderVersions(
        updates.versions,
        updates.versionsMaxPerDoc
      );
    }
    // Cache-revalidation toggle. The column holds the resolved config the write
    // path reads, so the boolean is normalized before storing; off writes the
    // disable config, on writes null.
    if (updates.revalidate !== undefined) {
      metadataUpdates.revalidate = resolveBuilderRevalidate(updates.revalidate);
    }
    // Webhook recording toggle. The column holds the resolved policy boot reads
    // back, so the boolean is normalized before storing; off writes the opt-out,
    // on writes null.
    if (updates.webhooks !== undefined) {
      metadataUpdates.webhooks = resolveBuilderWebhooks(updates.webhooks);
    }

    let migrationSQL: string | null = null;
    let besideStatements: string | null = null;
    let renamedField: FieldRename | null = null;
    let needsArchive = false;
    let migrationFileName: string | null = null;

    // Read by the branches that diff two different field lists, and shared between them. The
    // status-only branches below diff a list against itself, so no column is added or dropped
    // and there is nothing for these facts to decide.
    let tableFacts: ReturnType<typeof this.readTableFacts> | null = null;
    const liveTable = () =>
      (tableFacts ??= this.readTableFacts(
        collection.tableName,
        // What the pending create artefact builds from, for the not-yet-deployed case.
        collection.fields ?? []
      ));
    // The facts the migration file is planned from. What the table IS comes from the fields the
    // registry records, as every database built from the migrations has it, never from this
    // database's table, which a save refused part-way can have changed. Whether it holds rows, and
    // which columns hold a null, are this database's entries, which the change is judged against.
    const historyFacts = async () => {
      const live = await liveTable();
      const recorded = collection.fields ?? [];
      return {
        tableHasRows: live.tableHasRows,
        columnsContainingNull: live.columnsContainingNull,
        columnsAbsentFromTable: new Set<string>(),
        liveColumnTypes: this.schemaService.plannedColumnTypes(recorded),
        ...this.schemaService.plannedAttachments(
          collection.tableName,
          recorded
        ),
      };
    };

    // Why: the alter-table block runs when fields change, but a status-only
    // flip also needs a migration (ADD/DROP status column) so the data
    // table matches the new lifecycle setting. When only `status` toggled,
    // we synthesise an empty fields-diff with the status flags set so the
    // generator emits just the column ADD/DROP and nothing else.
    const wasStatusForUpdate =
      (collection as { status?: boolean }).status === true;
    const statusFlipped =
      updates.status !== undefined &&
      (updates.status === true) !== wasStatusForUpdate;

    // i18n: detect a localization enable/disable transition against the persisted flag. A
    // transition must run the data-preserving companion migration (seed on enable, restore +
    // archive on disable) even on a flag-only save with no field changes, so content never
    // strands in the wrong table.
    const collectionWasLocalized =
      (collection as { localized?: boolean }).localized === true;
    const collectionIsLocalized =
      updates.localized !== undefined
        ? updates.localized === true
        : collectionWasLocalized;
    const localizedTransition =
      collectionWasLocalized !== collectionIsLocalized;
    // i18n: turning Internationalization ON requires the app-level
    // `localization` config — without it the enable transition would move
    // translatable columns into a companion the runtime cannot address.
    // Only the false→true transition is gated: an already-localized
    // collection keeps saving, and disabling is always allowed.
    if (!collectionWasLocalized && collectionIsLocalized) {
      assertLocalizationConfigured(
        "collection",
        collectionName,
        this.localizationConfigured
      );
    }
    const existingUserFieldsForTransition = (collection.fields || []).filter(
      (f: FieldDefinition) => !RESERVED_FIELD_NAMES.includes(f.name)
    );
    // A save that changes no field still answers for what its flags drop: the lifecycle column,
    // or the translatable columns an enable moves to the companion.
    let pushAnswers = this.pushAnswers(collection.tableName, {
      oldFields: existingUserFieldsForTransition,
      newFields: existingUserFieldsForTransition,
      wasLocalized: collectionWasLocalized,
      isLocalized: collectionIsLocalized,
      wasStatus: wasStatusForUpdate,
      hasStatus:
        updates.status !== undefined
          ? updates.status === true
          : wasStatusForUpdate,
      renamed: null,
    });

    if (updates.fields !== undefined) {
      const userDefinedFields = this.userFieldsOf(
        updates.fields,
        collection.tableName,
        collection.fields || []
      );

      const oldUserFields = (collection.fields || []).filter(
        (f: FieldDefinition) => !RESERVED_FIELD_NAMES.includes(f.name)
      );

      // Asked here rather than in the generator, because only this side can
      // ask the database. The generator refuses a move onto a table this
      // collection's own fields name; a junction left behind by an older
      // migration is invisible to it, and the rename would meet that table at
      // apply time — in production, where a migration can no longer be
      // refused and the registry has already recorded the new name.
      await this.refuseJunctionMovesOntoLiveTables(
        collection.tableName,
        oldUserFields,
        userDefinedFields
      );
      // A field leaving or joining translation has preconditions of its own, asked before anything
      // here is written or altered.
      await archiveFieldsLeavingTranslation({
        // This service builds Schema Builder collections.
        builtBy: "collection",
        tableName: collection.tableName,
        defaultLocale: this.defaultLocale,
        adapter: this.adapter,
        entity: collectionName,
        kind: "collection",
        oldFields: oldUserFields,
        newFields: userDefinedFields,
        wasLocalized: collectionWasLocalized,
        isLocalized: collectionIsLocalized,
      });
      // What the existing entries must satisfy for the change to apply, asked before any statement
      // runs: a refusal part-way would leave MySQL, which commits each schema statement, holding
      // half the change. Main-table fields only; a translated field's column is the companion's.
      const onMain = (fields: FieldDefinition[], localized: boolean) => {
        const translated = new Set(
          resolveLocalizedFieldNames(fields, localized)
        );
        return fields.filter(f => !translated.has(f.name));
      };
      // A field that stops being translated while the collection stays translated: main gains its
      // column in this save, so the companion transition has a shared column to copy the default
      // language's value into before it drops its own.
      // Named after the change: a field renamed and made shared leaves under its new name, so its
      // Required or Unique setting waits for the copy as any other leaving field's does. One
      // rename rule for every column: the main table's decides a translated field's too.
      const changeRename = fieldRenameOf(
        this.schemaService.detectFieldRename(oldUserFields, userDefinedFields)
      );
      const leavingTranslation = new Set(
        collectionWasLocalized && collectionIsLocalized
          ? fieldsLeavingTranslationUnder(
              oldUserFields,
              userDefinedFields,
              changeRename
            )
          : []
      );
      const mainBefore = onMain(oldUserFields, collectionWasLocalized);
      // Judged in the shape the main diff adds it with: a leaving field's column comes without its
      // Required or Unique setting and takes it once the default language's values are copied in,
      // and whether those values can take it is asked by the preflight above
      // (`archiveFieldsLeavingTranslation`). Judged with the setting, an added Required column
      // would be checked holding one placeholder in every entry.
      const mainAfter = withoutLeavingConstraints(
        onMain(userDefinedFields, collectionIsLocalized),
        leavingTranslation
      );
      // A table still to be deployed holds no entries, so there is nothing to check yet.
      const tableDeployed = await this.adapter.tableExists(
        collection.tableName
      );
      const refusals = !tableDeployed
        ? []
        : await refusalsForCollectionSave({
            presentColumns: new Set((await liveTable()).liveColumnTypes.keys()),
            adapter: this.adapter,
            dialect: this.adapter.dialect,
            tableName: collection.tableName,
            oldFields: mainBefore,
            newFields: mainAfter,
            rename: this.schemaService.detectFieldRename(mainBefore, mainAfter),
            addedColumnBackfill: field =>
              this.schemaService.addedColumnBackfill(field),
          });
      if (tableDeployed) {
        this.refuseAddedColumnsTaken(
          collection.tableName,
          mainBefore,
          mainAfter,
          (await liveTable()).liveColumnTypes
        );
      }
      if (refusals.length > 0) {
        throw NextlyError.validation({
          errors: refusals.map(r => r.error),
          logContext: {
            collection: collectionName,
            fields: refusals.map(r => r.error.path),
            // What the entries in the way hold, for the log only.
            details: refusals.flatMap(r =>
              r.logContext ? [r.logContext] : []
            ),
          },
        });
      }

      // Pass status flags so the alter migration can ADD/DROP the
      // `status` column when the user toggles Draft/Published on or off.
      // `wasStatus` reflects what the table already has; `hasStatus`
      // reflects the value the user is saving. When undefined on
      // updates, leave the column untouched.
      const wasStatus = (collection as { status?: boolean }).status === true;
      const hasStatus =
        updates.status !== undefined ? updates.status === true : wasStatus;

      // i18n: prefer the update's localized flag over the persisted one, so toggling i18n ON an
      // existing collection immediately routes translatable fields to the companion in the same
      // save (the flag is persisted above). Falls back to the stored value when not sent.
      const isLocalized =
        updates.localized !== undefined
          ? updates.localized === true
          : (collection as { localized?: boolean }).localized === true;
      if (isLocalized || localizedTransition) {
        // i18n: a localized collection stores translatable fields on the companion `_locales`
        // table, so the main ALTER must exclude every column that is localized in EITHER the old
        // or new state — those are seeded (enable), restored (disable), or ADDed/DROPped by the
        // companion transition below, never by the plain main diff. Using the correct per-state
        // localized flag is what prevents an enable from treating existing main columns as
        // already companion-owned (which would drop them without seeding).
        const excludedLocalized = new Set([
          ...resolveLocalizedFieldNames(oldUserFields, collectionWasLocalized),
          ...resolveLocalizedFieldNames(
            userDefinedFields,
            collectionIsLocalized
          ),
        ]);
        // A field that becomes translated while the collection stays translated: its main column
        // goes, so the main diff has to see it as there before and gone after. Its value moves to
        // the default language's companion row first, ahead of this diff (see the companion
        // transition below).
        const joiningTranslation = new Set(
          collectionWasLocalized && collectionIsLocalized
            ? fieldsJoiningTranslation(oldUserFields, userDefinedFields)
            : []
        );
        const oldShared = oldUserFields.filter(
          f => !excludedLocalized.has(f.name) || joiningTranslation.has(f.name)
        );
        const newShared = userDefinedFields.filter(
          f => !excludedLocalized.has(f.name) || leavingTranslation.has(f.name)
        );

        // Detected from the FULL lists: a renamed LOCALIZED field-group field
        // sits in neither shared list, and its association migration must not
        // be excluded along with its column handling.
        const groupAssociationRename =
          this.schemaService.detectFieldGroupAssociationRename(
            oldUserFields,
            userDefinedFields
          );
        const mainOptions = {
          wasStatus,
          hasStatus,
          // The junction tables are decided on the full lists: a localized
          // many-to-many sits in neither shared list and still has one.
          junctionFields: { old: oldUserFields, new: userDefinedFields },
          ...(await historyFacts()),
          // Strict only when an association rename will occur: the table
          // names are a precondition of THAT migration, and requiring them
          // for every edit would refuse saves unrelated to renames.
          associationRename: groupAssociationRename ?? undefined,
          fieldGroupTableNames: groupAssociationRename
            ? await this.resolveFieldGroupTableNames([
                ...oldUserFields,
                ...userDefinedFields,
              ])
            : new Map(),
        };
        // A Required or Unique field leaving translation gets its shared column without the
        // setting: created with it, every entry would hold NULL or the same placeholder before the
        // default language's values arrive. The setting follows the copy (`settings`).
        const sharedUnconstrained = withoutLeavingConstraints(
          newShared,
          leavingTranslation
        );
        const mainSQL = this.schemaService.generateAlterTableMigration(
          collection.tableName,
          oldShared,
          sharedUnconstrained,
          mainOptions
        );
        // The settings as their own diff, so each dialect applies them its own way. The live
        // table's facts describe the columns BEFORE the main diff above creates them, so they are
        // not passed; what this diff needs instead is the type that diff will have written.
        // MySQL restates a whole column definition on every MODIFY, and with no type to restate it
        // falls back to the legacy renderer — which would narrow a float the main diff had just
        // created `double` down to `decimal(10,2)`, from two diffs that are each correct alone.
        // Whether the values can take the settings was asked before anything ran.
        const settingsSQL = sharedUnconstrained.some(
          (f, i) => f !== newShared[i]
        )
          ? this.schemaService.generateAlterTableMigration(
              collection.tableName,
              sharedUnconstrained,
              newShared,
              {
                wasStatus: hasStatus,
                hasStatus,
                liveColumnTypes:
                  this.schemaService.plannedColumnTypes(sharedUnconstrained),
              }
            )
          : undefined;
        // What this database needs beside the push, from the lists the main diff is planned on.
        besideStatements = this.joinedStatements(
          this.schemaService.statementsBesideThePush(
            collection.tableName,
            oldShared,
            sharedUnconstrained,
            mainOptions
          )
        );
        const localizedMigration = await this.buildLocalizedMigrationSQL(
          { artefact: mainSQL, settings: settingsSQL },
          {
            slug: collectionName,
            tableName: collection.tableName,
            oldFields: oldUserFields,
            newFields: userDefinedFields,
            wasLocalized: collectionWasLocalized,
            isLocalized: collectionIsLocalized,
            status: hasStatus,
            wasStatus,
            renamed: changeRename,
          }
        );
        migrationSQL = localizedMigration.sql;
        needsArchive = localizedMigration.needsArchive;
      } else {
        const groupAssociationRename =
          this.schemaService.detectFieldGroupAssociationRename(
            oldUserFields,
            userDefinedFields
          );
        const alterOptions = {
          wasStatus,
          hasStatus,
          ...(await historyFacts()),
          associationRename: groupAssociationRename ?? undefined,
          fieldGroupTableNames: groupAssociationRename
            ? await this.resolveFieldGroupTableNames([
                ...oldUserFields,
                ...userDefinedFields,
              ])
            : new Map(),
        };
        migrationSQL = this.schemaService.generateAlterTableMigration(
          collection.tableName,
          oldUserFields,
          userDefinedFields,
          alterOptions
        );
        besideStatements = this.joinedStatements(
          this.schemaService.statementsBesideThePush(
            collection.tableName,
            oldUserFields,
            userDefinedFields,
            alterOptions
          )
        );
      }
      renamedField = changeRename ?? null;
      pushAnswers = this.pushAnswers(collection.tableName, {
        oldFields: oldUserFields,
        newFields: userDefinedFields,
        wasLocalized: collectionWasLocalized,
        isLocalized: collectionIsLocalized,
        wasStatus,
        hasStatus,
        renamed: renamedField,
      });
      migrationFileName = `${Date.now()}_update_${collectionName}.sql`;

      metadataUpdates.fields = userDefinedFields;
      metadataUpdates.schemaHash = this.generateSchemaHash(userDefinedFields);
    } else if (localizedTransition) {
      // Flag-only save (no field changes) that toggles Internationalization: run the
      // data-preserving companion transition on the existing field set so an enable seeds + drops
      // the main columns and a disable restores + archives them, even without a field edit. A
      // simultaneous status flip still emits its main ADD/DROP `status` column.
      const oldUserFields = existingUserFieldsForTransition;
      // The same preconditions a field-changing save is asked, because this save builds the same
      // companion DDL: an enable creates, seeds, drops main's columns and then creates each
      // per-language unique index. Skipped here, a field already marked unique reached the index
      // on a server that cannot key it, or over values a language already holds twice, with the
      // statements before it committed on MySQL.
      await archiveFieldsLeavingTranslation({
        builtBy: "collection",
        tableName: collection.tableName,
        defaultLocale: this.defaultLocale,
        adapter: this.adapter,
        entity: collectionName,
        kind: "collection",
        oldFields: oldUserFields,
        newFields: oldUserFields,
        wasLocalized: collectionWasLocalized,
        isLocalized: collectionIsLocalized,
      });
      const hasStatus =
        updates.status !== undefined
          ? updates.status === true
          : wasStatusForUpdate;
      const excludedLocalized = new Set([
        ...resolveLocalizedFieldNames(oldUserFields, collectionWasLocalized),
        ...resolveLocalizedFieldNames(oldUserFields, collectionIsLocalized),
      ]);
      const shared = oldUserFields.filter(f => !excludedLocalized.has(f.name));
      const mainSQL = statusFlipped
        ? this.schemaService.generateAlterTableMigration(
            collection.tableName,
            shared,
            shared,
            { wasStatus: wasStatusForUpdate, hasStatus }
          )
        : "";
      const localizedMigration = await this.buildLocalizedMigrationSQL(
        { artefact: mainSQL },
        {
          slug: collectionName,
          tableName: collection.tableName,
          oldFields: oldUserFields,
          newFields: oldUserFields,
          wasLocalized: collectionWasLocalized,
          isLocalized: collectionIsLocalized,
          status: hasStatus,
          wasStatus: wasStatusForUpdate,
        }
      );
      migrationSQL = localizedMigration.sql;
      needsArchive = localizedMigration.needsArchive;
      migrationFileName = `${Date.now()}_i18n_${collectionName}.sql`;
    } else if (statusFlipped) {
      // No field changes, but status toggled — emit an alter that just
      // adds or drops the `status` column. Pass the existing field list
      // as both old + new so the field-diff produces no statements; only
      // the system-flag delta lands in the SQL.
      const reservedFieldNames = [
        "id",
        "title",
        "slug",
        "created_at",
        "updated_at",
      ];
      const existingUserFields = (collection.fields || []).filter(
        (f: FieldDefinition) => !reservedFieldNames.includes(f.name)
      );
      const statusOptions = {
        wasStatus: wasStatusForUpdate,
        hasStatus: updates.status === true,
      };
      migrationSQL = this.schemaService.generateAlterTableMigration(
        collection.tableName,
        existingUserFields,
        existingUserFields,
        statusOptions
      );
      migrationFileName = `${Date.now()}_status_${collectionName}.sql`;
    }

    return {
      migrationSQL,
      besideStatements,
      renamedField,
      pushAnswers,
      migrationFileName,
      metadataUpdates,
      needsArchive,
    };
  }

  generateDropTableMigration(
    collectionName: string,
    tableName: string,
    fields: FieldDefinition[] = []
  ): {
    migrationSQL: string;
    migrationFileName: string;
  } {
    return this.schemaService.generateDropTableMigration(
      collectionName,
      tableName,
      fields
    );
  }

  async registerCollection(
    metadata: CollectionArtifacts["metadata"]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- caller's MetadataServiceResult.data field is loosely typed
  ): Promise<any> {
    return this.registryService.registerCollection(metadata);
  }

  async updateCollectionMetadata(
    collectionName: string,
    updates: Partial<CollectionMetadata>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- caller's MetadataServiceResult.data field is loosely typed
  ): Promise<any> {
    return this.registryService.updateCollectionMetadata(
      collectionName,
      updates
    );
  }

  async listCollections<TIncludeSchema extends boolean = true>(
    options?: ListCollectionsOptions & { includeSchema?: TIncludeSchema }
  ): Promise<ListCollectionsResponse<TIncludeSchema>> {
    return this.registryService.listCollections(options);
  }

  async getCollection(
    name: string,
    // Optional transaction-bound executor so the registry read runs on the
    // caller's transaction connection instead of the pool; see the base
    // registry service's `getRecordBySlug`.
    executor?: unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- callers index dialect-specific row shapes
  ): Promise<any> {
    return this.registryService.getCollection(name, executor);
  }

  async unregisterCollection(name: string): Promise<unknown> {
    return this.registryService.unregisterCollection(name);
  }

  /**
   * Generate a unique ID in UUID v4 format.
   */
  public generateId(): string {
    const bytes = randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10xx

    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  getValidationService(): DynamicCollectionValidationService {
    return this.validationService;
  }

  getSchemaService(): DynamicCollectionSchemaService {
    return this.schemaService;
  }

  getRegistryService(): DynamicCollectionRegistryService {
    return this.registryService;
  }
}

/** A detected rename as the companion reconcile takes it: the field's name before and after. */
function fieldRenameOf(
  rename: { from: FieldDefinition; to: FieldDefinition } | null
): FieldRename | undefined {
  return rename ? { from: rename.from.name, to: rename.to.name } : undefined;
}
