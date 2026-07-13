/**
 * DynamicCollectionService is a facade over the validation, schema, and
 * registry services for dynamic collections.
 */

import { createHash, randomBytes } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { MigrationStatus } from "../../../schemas/dynamic-collections/types";
import { BaseService } from "../../../shared/base-service";
import type { Logger } from "../../../shared/types";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import { ddlType, q } from "../../i18n/migration/ddl-types";
import { deriveCompanionSpec } from "../../i18n/migration/derive-companion-spec";
import { fieldToLocalizedColumnSpec } from "../../i18n/migration/field-to-column-spec";
import { buildCompanionCreateOnlySql } from "../../i18n/migration/generate-up";

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
  fields?: FieldDefinition[];
  hooks?: Record<string, unknown>[];
}

export class DynamicCollectionService extends BaseService {
  private validationService: DynamicCollectionValidationService;
  private schemaService: DynamicCollectionSchemaService;
  private registryService: DynamicCollectionRegistryService;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);

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
    return `${migrationSQL}\n\n${buildCompanionCreateOnlySql(spec)}`;
  }

  /**
   * i18n: SQL to evolve the companion `<table>_locales` when a localized collection's
   * translatable fields change on update. Creates the companion on the first localized
   * field (it isn't created for a fields-less localized collection), otherwise ADDs
   * newly-translatable columns and DROPs removed ones. Returns "" when there is nothing
   * to do (no localized fields yet and none added).
   */
  private async buildCompanionUpdateSQL(
    slug: string,
    tableName: string,
    oldLocalized: FieldDefinition[],
    newLocalized: FieldDefinition[],
    status: boolean
  ): Promise<string> {
    const companionTable = `${tableName}_locales`;
    const dialect = this.adapter.dialect;
    const exists = await this.adapter.tableExists(companionTable);

    if (!exists) {
      const spec = deriveCompanionSpec({
        slug,
        dbName: tableName,
        fields: newLocalized,
        dialect,
        defaultLocale: "en", // unused for create-only (no seed)
        collectionLocalized: true,
        status,
      });
      return spec ? buildCompanionCreateOnlySql(spec) : "";
    }

    // Companion already exists — diff the localized columns and ADD/DROP.
    const oldNames = new Set(oldLocalized.map(f => f.name));
    const newNames = new Set(newLocalized.map(f => f.name));
    const stmts: string[] = [];
    for (const f of newLocalized) {
      if (oldNames.has(f.name)) continue;
      const col = fieldToLocalizedColumnSpec(f, dialect);
      if (col) {
        stmts.push(
          `ALTER TABLE ${q(companionTable, dialect)} ADD COLUMN ${q(col.name, dialect)} ${ddlType(col, dialect)};`
        );
      }
    }
    for (const f of oldLocalized) {
      if (newNames.has(f.name)) continue;
      const col = fieldToLocalizedColumnSpec(f, dialect);
      if (col) {
        stmts.push(
          `ALTER TABLE ${q(companionTable, dialect)} DROP COLUMN ${q(col.name, dialect)};`
        );
      }
    }
    return stmts.join("\n");
  }

  private generateSchemaHash(fields: FieldDefinition[]): string {
    const fieldsJson = JSON.stringify(fields);
    return createHash("sha256").update(fieldsJson).digest("hex");
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

      const isLocalized =
        (collection as { localized?: boolean }).localized === true;
      if (isLocalized) {
        // i18n: a localized collection stores translatable fields in the companion
        // `_locales` table. The main ALTER must only see SHARED fields; the
        // translatable field changes are applied to the companion (created on first
        // use). Without this, fields added through the builder land on the main table
        // and every language shares one value.
        const oldLocalizedNames = new Set(
          resolveLocalizedFieldNames(oldUserFields, true)
        );
        const newLocalizedNames = new Set(
          resolveLocalizedFieldNames(userDefinedFields, true)
        );
        const oldShared = oldUserFields.filter(f => !oldLocalizedNames.has(f.name));
        const newShared = userDefinedFields.filter(
          f => !newLocalizedNames.has(f.name)
        );
        const oldLocalized = oldUserFields.filter(f => oldLocalizedNames.has(f.name));
        const newLocalized = userDefinedFields.filter(f =>
          newLocalizedNames.has(f.name)
        );

        const mainSQL = this.schemaService.generateAlterTableMigration(
          collection.tableName,
          oldShared,
          newShared,
          { wasStatus, hasStatus }
        );
        const companionSQL = await this.buildCompanionUpdateSQL(
          collectionName,
          collection.tableName,
          oldLocalized,
          newLocalized,
          hasStatus
        );
        migrationSQL = [mainSQL, companionSQL]
          .filter(sql => sql && sql.trim())
          .join("\n\n");
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
