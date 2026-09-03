/**
 * DynamicCollectionService is a facade over the validation, schema, and
 * registry services for dynamic collections.
 */

import { createHash, randomBytes } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { getService } from "../../../di";
import { NextlyError } from "../../../errors";
import { resolveBuilderRevalidate } from "../../../revalidation/builder-revalidate";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { MigrationStatus } from "../../../schemas/dynamic-collections/types";
import { getI18nArchiveDdl } from "../../../schemas/nextly-i18n-archive";
import { BaseService } from "../../../shared/base-service";
import type { Logger } from "../../../shared/types";
import { fieldGroupSlugList } from "../../field-groups/storage/field-group-field-type";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import { assertLocalizationConfigured } from "../../i18n/config/require-app-config";
import { deriveCompanionSpec } from "../../i18n/migration/derive-companion-spec";
import { buildCompanionCreateOnlySql } from "../../i18n/migration/generate-up";
import { buildCompanionTransitionPlans } from "../../i18n/migration/reconcile-companion";
import {
  companionHasStatusColumn,
  localizedColumnsOnMain,
} from "../../i18n/runtime/companion-io";
import {
  readForeignKeyColumns,
  readIndexNames,
  tableHasRows,
} from "../../schema/pipeline/live-table-facts";
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

export interface CollectionArtifacts {
  migrationSQL: string;
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
  hooks?: Record<string, unknown>[];
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
  hooks?: Record<string, unknown>[];
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
  private readonly defaultLocale: string;
  /**
   * i18n: whether the constructing caller holds a localization config, when it
   * knows. `CollectionsHandler` takes one as a constructor argument and can be
   * built outside DI, so that instance must not be told localization is
   * unconfigured by a container it never used. Undefined defers to DI, which is
   * the registered-services path every dispatcher request takes.
   */
  private readonly localizationConfigured?: boolean;

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    defaultLocale = "en",
    localizationConfigured?: boolean
  ) {
    super(adapter, logger);
    this.defaultLocale = defaultLocale;
    this.localizationConfigured = localizationConfigured;

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
        ...this.schemaService.plannedAttachments(tableName, pendingFields),
      };
    }

    const db = this.adapter.getDrizzle();
    const [hasRows, foreignKeys, indexes] = await Promise.all([
      tableHasRows(db, this.adapter.dialect, tableName),
      readForeignKeyColumns(db, this.adapter.dialect, tableName),
      readIndexNames(db, this.adapter.dialect, tableName),
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
    const registry = getService("fieldGroupRegistryService");
    await Promise.all(
      [...slugs].map(async slug => {
        const record = await registry.getComponentBySlug(slug);
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
    const tableName = `dc_${normalizedName}`;

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

    const normalizedFields = data.fields.map(f => ({
      ...f,
      name: f.name.toLowerCase(),
    }));

    // Reserved fields are auto-added by the system and should not be user-defined.
    const reservedFieldNames = [
      "id",
      "title",
      "slug",
      "created_at",
      "updated_at",
    ];
    const userDefinedFields = normalizedFields.filter(
      f => !reservedFieldNames.includes(f.name)
    );

    this.validationService.validateFieldNames(userDefinedFields);

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
    const fullMigrationSQL = data.localized
      ? this.appendCompanionCreateSQL(migrationSQL, normalizedName, tableName, {
          fields: userDefinedFields,
          status: data.status === true,
        })
      : migrationSQL;

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
      migrationFileName: `${Date.now()}_create_${normalizedName}.sql`,
      tableName,
      metadata,
    };
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
    // Separate the companion CREATE from the main migration with the breakpoint marker so the
    // runner executes it as its own statement (a multi-statement chunk is rejected by drivers
    // with multi-statements disabled, e.g. MySQL).
    return `${migrationSQL}\n--> statement-breakpoint\n${buildCompanionCreateOnlySql(spec)}`;
  }

  private generateSchemaHash(fields: FieldDefinition[]): string {
    const fieldsJson = JSON.stringify(fields);
    return createHash("sha256").update(fieldsJson).digest("hex");
  }

  /**
   * Join SQL statements for a migration file the way the runner expects: each statement is
   * `;`-terminated and separated by `--> statement-breakpoint`, so the file splits into
   * single-statement chunks (drivers with multi-statements disabled, e.g. MySQL, otherwise
   * reject a multi-statement chunk).
   */
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
  }): Promise<{ sql: string; localSql?: string; needsArchive: boolean }> {
    const companionTable = `${args.tableName}_locales`;
    const companionExists = await this.adapter.tableExists(companionTable);
    // Only introspect `_status` for a field change on a still-localized collection (a later
    // Draft/Published toggle must ADD/DROP the companion `_status`).
    const companionHasStatus =
      companionExists && args.wasLocalized && args.isLocalized
        ? await companionHasStatusColumn(this.adapter, companionTable)
        : undefined;
    const localizedOldNames = new Set(
      resolveLocalizedFieldNames(args.oldFields, args.wasLocalized)
    );
    const common = {
      // This service owns Schema Builder collections, so the companion mirrors that builder.
      builtBy: "collection" as const,
      slug: args.slug,
      tableName: args.tableName,
      dialect: this.adapter.dialect,
      defaultLocale: this.defaultLocale,
      status: args.status,
      wasLocalized: args.wasLocalized,
      isLocalized: args.isLocalized,
      oldFields: args.oldFields,
      newFields: args.newFields,
      companionExists,
      companionHasStatus,
      wasStatus: args.wasStatus,
    };

    // Which translatable columns the main table still carries. A disable must not re-add one that
    // is already there, and must still restore it: presence says the column exists, never that its
    // value is current, because every localized write went to the companion alone.
    const { artefact, local } = buildCompanionTransitionPlans({
      ...common,
      // Only the fields that were TRANSLATABLE before this save. The helper reports whichever of
      // the names it is given exist on the main table, so handing it every old field would put
      // ordinary shared columns into the list and let the local plan diverge from the artefact
      // over columns no transition ever touched.
      existingMainColumns: await localizedColumnsOnMain(
        this.adapter,
        args.tableName,
        args.oldFields.filter(f => localizedOldNames.has(f.name))
      ).then(cols => cols.map(c => c.name)),
    });

    // Separate statements with the migration-file breakpoint marker (not blank lines): the file
    // is split on `--> statement-breakpoint` and each chunk is run as ONE statement, so a
    // multi-statement chunk is rejected by drivers with multi-statements disabled (e.g. MySQL).
    return {
      sql: this.toBreakpointSql(artefact.statements),
      ...(local ? { localSql: this.toBreakpointSql(local.statements) } : {}),
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
     * What to run against THIS database, when it differs from the artefact.
     *
     * Present only where the local schema is in a shape migration history cannot produce:
     * unattended provisioning retains the columns it copied into a companion, so a later disable
     * meets a main table that already has them while the file — which must be replayable on a
     * database that only ever ran migrations — re-adds them. Null means the artefact is correct
     * here too, which is every case but that one.
     */
    localMigrationSQL: string | null;
    migrationFileName: string | null;
    metadataUpdates: Record<string, unknown>;
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

    const metadataUpdates: Record<string, unknown> = {
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
    // Set only where this database is in a shape migration history cannot produce — see the
    // return type. Null everywhere else, so the caller runs the artefact itself.
    let localMigrationSQL: string | null = null;
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
    const reservedForFields = [
      "id",
      "title",
      "slug",
      "created_at",
      "updated_at",
    ];
    const existingUserFieldsForTransition = (collection.fields || []).filter(
      (f: FieldDefinition) => !reservedForFields.includes(f.name)
    );

    if (updates.fields !== undefined) {
      const normalizedFields = updates.fields.map(f => ({
        ...f,
        name: f.name.toLowerCase(),
      }));

      // Reserved fields are auto-added by the system; the UI may include them
      // when sending back the complete field list during an update operation.
      const reservedFieldNames = [
        "id",
        "title",
        "slug",
        "created_at",
        "updated_at",
      ];
      const userDefinedFields = normalizedFields.filter(
        f => !reservedFieldNames.includes(f.name)
      );

      this.validationService.validateFieldNames(userDefinedFields);

      const oldUserFields = (collection.fields || []).filter(
        (f: FieldDefinition) => !reservedFieldNames.includes(f.name)
      );

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
        const oldShared = oldUserFields.filter(
          f => !excludedLocalized.has(f.name)
        );
        const newShared = userDefinedFields.filter(
          f => !excludedLocalized.has(f.name)
        );

        const mainSQL = this.schemaService.generateAlterTableMigration(
          collection.tableName,
          oldShared,
          newShared,
          {
            wasStatus,
            hasStatus,
            ...(await liveTable()),
            // Strict only when an association rename will occur: the table
            // names are a precondition of THAT migration, and requiring them
            // for every edit would refuse saves unrelated to renames.
            fieldGroupTableNames: this.schemaService.detectFieldGroupAssociationRename(
              oldShared,
              newShared
            )
              ? await this.resolveFieldGroupTableNames([
                  ...oldShared,
                  ...newShared,
                ])
              : new Map(),
          }
        );
        const {
          sql: companionSQL,
          localSql: localCompanionSQL,
          needsArchive,
        } = await this.buildCompanionTransitionSQL({
          slug: collectionName,
          tableName: collection.tableName,
          oldFields: oldUserFields,
          newFields: userDefinedFields,
          wasLocalized: collectionWasLocalized,
          isLocalized: collectionIsLocalized,
          status: hasStatus,
          wasStatus,
        });
        const archiveSQL = needsArchive
          ? this.toBreakpointSql(getI18nArchiveDdl(this.adapter.dialect))
          : "";
        // A disable re-adds the translatable columns to main (companionSQL), so run the companion
        // transition FIRST (after ensuring the archive table), then the shared ALTER. An enable /
        // field change runs the shared ALTER first, then seeds + drops / ADD-DROPs the companion.
        const assemble = (companion: string) =>
          (collectionIsLocalized
            ? [mainSQL, companion]
            : [archiveSQL, companion, mainSQL]
          )
            .filter(sql => sql && sql.trim())
            .join("\n--> statement-breakpoint\n");
        migrationSQL = assemble(companionSQL);
        if (localCompanionSQL !== undefined) {
          localMigrationSQL = assemble(localCompanionSQL);
        }
      } else {
        migrationSQL = this.schemaService.generateAlterTableMigration(
          collection.tableName,
          oldUserFields,
          userDefinedFields,
          {
            wasStatus,
            hasStatus,
            ...(await liveTable()),
            fieldGroupTableNames: this.schemaService.detectFieldGroupAssociationRename(
              oldUserFields,
              userDefinedFields
            )
              ? await this.resolveFieldGroupTableNames([
                  ...oldUserFields,
                  ...userDefinedFields,
                ])
              : new Map(),
          }
        );
      }
      migrationFileName = `${Date.now()}_update_${collectionName}.sql`;

      metadataUpdates.fields = userDefinedFields;
      metadataUpdates.schemaHash = this.generateSchemaHash(userDefinedFields);
    } else if (localizedTransition) {
      // Flag-only save (no field changes) that toggles Internationalization: run the
      // data-preserving companion transition on the existing field set so an enable seeds + drops
      // the main columns and a disable restores + archives them, even without a field edit. A
      // simultaneous status flip still emits its main ADD/DROP `status` column.
      const oldUserFields = existingUserFieldsForTransition;
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
      const {
        sql: companionSQL,
        localSql: localCompanionSQL,
        needsArchive,
      } = await this.buildCompanionTransitionSQL({
        slug: collectionName,
        tableName: collection.tableName,
        oldFields: oldUserFields,
        newFields: oldUserFields,
        wasLocalized: collectionWasLocalized,
        isLocalized: collectionIsLocalized,
        status: hasStatus,
        wasStatus: wasStatusForUpdate,
      });
      const archiveSQL = needsArchive
        ? this.toBreakpointSql(getI18nArchiveDdl(this.adapter.dialect))
        : "";
      const assemble = (companion: string) =>
        (collectionIsLocalized
          ? [mainSQL, companion]
          : [archiveSQL, companion, mainSQL]
        )
          .filter(sql => sql && sql.trim())
          .join("\n--> statement-breakpoint\n");
      migrationSQL = assemble(companionSQL);
      if (localCompanionSQL !== undefined) {
        localMigrationSQL = assemble(localCompanionSQL);
      }
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
      migrationSQL = this.schemaService.generateAlterTableMigration(
        collection.tableName,
        existingUserFields,
        existingUserFields,
        {
          wasStatus: wasStatusForUpdate,
          hasStatus: updates.status === true,
        }
      );
      migrationFileName = `${Date.now()}_status_${collectionName}.sql`;
    }

    return {
      migrationSQL,
      localMigrationSQL,
      migrationFileName,
      metadataUpdates,
    };
  }

  generateDropTableMigration(
    collectionName: string,
    tableName: string
  ): {
    migrationSQL: string;
    migrationFileName: string;
  } {
    return this.schemaService.generateDropTableMigration(
      collectionName,
      tableName
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
