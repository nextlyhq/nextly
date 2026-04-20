/**
 * DynamicCollectionService is a facade over the validation, schema, and
 * registry services for dynamic collections.
 */

import { createHash, randomBytes } from "crypto";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { MigrationStatus } from "../../../schemas/dynamic-collections/types";
import { BaseService } from "../../../shared/base-service";
import type { Logger } from "../../../shared/types";

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
  schemaCode: string;
  schemaFileName: string;
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
      defaultColumns?: string[];
      useAsTitle?: string;
    };
    source: "code" | "ui" | "built-in";
    locked?: boolean;
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
  defaultColumns?: string[];
  hidden?: boolean;
  order?: number;
  sidebarGroup?: string;
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
  defaultColumns?: string[];
  hidden?: boolean;
  order?: number;
  sidebarGroup?: string;
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

    // The schema service automatically adds reserved fields (id, slug, created_at, updated_at).
    const migrationSQL = this.schemaService.generateMigrationSQL(
      tableName,
      userDefinedFields
    );
    const schemaCode = this.schemaService.generateSchemaCode(
      tableName,
      normalizedName,
      userDefinedFields
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
        defaultColumns: data.defaultColumns,
        hidden: data.hidden,
        order: data.order,
        sidebarGroup: data.sidebarGroup,
      },
      source: "ui" as const,
      locked: false,
      schemaHash,
      schemaVersion: 1,
      migrationStatus: "pending" as const,
      hooks: data.hooks,
      createdBy: data.createdBy,
    };

    return {
      migrationSQL,
      migrationFileName: `${Date.now()}_create_${normalizedName}.sql`,
      schemaCode,
      schemaFileName: `${normalizedName}.ts`,
      tableName,
      metadata,
    };
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
    schemaCode: string | null;
    schemaFileName: string | null;
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
      updates.defaultColumns !== undefined ||
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
      if (updates.defaultColumns !== undefined)
        nextAdmin.defaultColumns = updates.defaultColumns;
      if (updates.hidden !== undefined) nextAdmin.hidden = updates.hidden;
      if (updates.order !== undefined) nextAdmin.order = updates.order;
      if (updates.sidebarGroup !== undefined)
        nextAdmin.sidebarGroup = updates.sidebarGroup;

      metadataUpdates.admin = nextAdmin;
    }
    if (updates.icon !== undefined) metadataUpdates.icon = updates.icon;
    if (updates.hooks !== undefined) metadataUpdates.hooks = updates.hooks;

    let migrationSQL: string | null = null;
    let migrationFileName: string | null = null;
    let schemaCode: string | null = null;
    let schemaFileName: string | null = null;

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

      migrationSQL = this.schemaService.generateAlterTableMigration(
        collection.tableName,
        oldUserFields,
        userDefinedFields
      );
      migrationFileName = `${Date.now()}_update_${collectionName}.sql`;

      schemaCode = this.schemaService.generateSchemaCode(
        collection.tableName,
        collectionName,
        userDefinedFields
      );
      schemaFileName = `${collectionName}.ts`;

      metadataUpdates.fields = userDefinedFields;
      metadataUpdates.schemaHash = this.generateSchemaHash(userDefinedFields);
    }

    return {
      migrationSQL,
      migrationFileName,
      schemaCode,
      schemaFileName,
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
  ):  
  Promise<any> {
    return this.registryService.registerCollection(metadata);
  }

  async updateCollectionMetadata(
    collectionName: string,
    updates: Partial<CollectionMetadata>
  ):  
  Promise<any> {
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

   
  async getCollection(name: string): Promise<any> {
    return this.registryService.getCollection(name);
  }

   
  async unregisterCollection(name: string): Promise<any> {
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
