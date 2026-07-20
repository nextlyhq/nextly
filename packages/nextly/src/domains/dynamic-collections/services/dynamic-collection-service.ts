/**
 * DynamicCollectionService is a facade over the validation, schema, and
 * registry services for dynamic collections.
 */

import { createHash, randomBytes } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { MigrationStatus } from "../../../schemas/dynamic-collections/types";
import { getI18nArchiveDdl } from "../../../schemas/nextly-i18n-archive";
import { BaseService } from "../../../shared/base-service";
import type { Logger } from "../../../shared/types";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import { deriveCompanionSpec } from "../../i18n/migration/derive-companion-spec";
import { buildCompanionCreateOnlySql } from "../../i18n/migration/generate-up";
import { buildCompanionTransitionStatements } from "../../i18n/migration/reconcile-companion";
import { companionHasStatusColumn } from "../../i18n/runtime/companion-io";

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

  constructor(adapter: DrizzleAdapter, logger: Logger, defaultLocale = "en") {
    super(adapter, logger);
    this.defaultLocale = defaultLocale;

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
   * Generate collection artifacts (SQL migration + TypeScript schema).
   */
  async generateCollection(
    data: CreateCollectionInput
  ): Promise<CollectionArtifacts> {
    const normalizedName = data.name.toLowerCase();
    const tableName = `dc_${normalizedName}`;

    this.validationService.validateCollectionName(normalizedName);

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
  }): Promise<{ sql: string; needsArchive: boolean }> {
    const companionTable = `${args.tableName}_locales`;
    const companionExists = await this.adapter.tableExists(companionTable);
    // Only introspect `_status` for a field change on a still-localized collection (a later
    // Draft/Published toggle must ADD/DROP the companion `_status`).
    const companionHasStatus =
      companionExists && args.wasLocalized && args.isLocalized
        ? await companionHasStatusColumn(this.adapter, companionTable)
        : undefined;
    const plan = buildCompanionTransitionStatements({
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
    });
    // Separate statements with the migration-file breakpoint marker (not blank lines): the file
    // is split on `--> statement-breakpoint` and each chunk is run as ONE statement, so a
    // multi-statement chunk is rejected by drivers with multi-statements disabled (e.g. MySQL).
    return {
      sql: this.toBreakpointSql(plan.statements),
      needsArchive: plan.needsArchive,
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
    migrationFileName: string | null;
    metadataUpdates: Record<string, unknown>;
  }> {
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

    let migrationSQL: string | null = null;
    let migrationFileName: string | null = null;

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

    if (updates.fields) {
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
          { wasStatus, hasStatus }
        );
        const { sql: companionSQL, needsArchive } =
          await this.buildCompanionTransitionSQL({
            slug: collectionName,
            tableName: collection.tableName,
            oldFields: oldUserFields,
            newFields: userDefinedFields,
            wasLocalized: collectionWasLocalized,
            isLocalized: collectionIsLocalized,
            status: hasStatus,
          });
        const archiveSQL = needsArchive
          ? this.toBreakpointSql(getI18nArchiveDdl(this.adapter.dialect))
          : "";
        // A disable re-adds the translatable columns to main (companionSQL), so run the companion
        // transition FIRST (after ensuring the archive table), then the shared ALTER. An enable /
        // field change runs the shared ALTER first, then seeds + drops / ADD-DROPs the companion.
        const parts = collectionIsLocalized
          ? [mainSQL, companionSQL]
          : [archiveSQL, companionSQL, mainSQL];
        migrationSQL = parts
          .filter(sql => sql && sql.trim())
          .join("\n--> statement-breakpoint\n");
      } else {
        migrationSQL = this.schemaService.generateAlterTableMigration(
          collection.tableName,
          oldUserFields,
          userDefinedFields,
          { wasStatus, hasStatus }
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
      const { sql: companionSQL, needsArchive } =
        await this.buildCompanionTransitionSQL({
          slug: collectionName,
          tableName: collection.tableName,
          oldFields: oldUserFields,
          newFields: oldUserFields,
          wasLocalized: collectionWasLocalized,
          isLocalized: collectionIsLocalized,
          status: hasStatus,
        });
      const archiveSQL = needsArchive
        ? this.toBreakpointSql(getI18nArchiveDdl(this.adapter.dialect))
        : "";
      const parts = collectionIsLocalized
        ? [mainSQL, companionSQL]
        : [archiveSQL, companionSQL, mainSQL];
      migrationSQL = parts
        .filter(sql => sql && sql.trim())
        .join("\n--> statement-breakpoint\n");
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
    name: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- callers index dialect-specific row shapes
  ): Promise<any> {
    return this.registryService.getCollection(name);
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
