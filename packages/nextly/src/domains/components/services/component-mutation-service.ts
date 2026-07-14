import crypto from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";

import type { FieldConfig } from "../../../collections/fields/types";
import type { ComponentFieldConfig } from "../../../collections/fields/types/component";
import { toDbError } from "../../../database/errors";
// PR 4 migration: ServiceError throws replaced with NextlyError. The legacy
// `ServiceError.fromDatabaseError` boundary maps to `NextlyError.fromDatabaseError`,
// and the `instanceof ServiceError` rethrow guards become `NextlyError.is(...)`
// so any error type travelling through the shim is preserved.
import { NextlyError } from "../../../errors";
import type { DynamicComponentRecord } from "../../../schemas/dynamic-components/types";
import type { ComponentRegistryService } from "../../../services/components/component-registry-service";
import { BaseService } from "../../../shared/base-service";
import { coerceDateFieldsToDate } from "../../../shared/lib/field-transform";
import type { Logger } from "../../../shared/types";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import { resolveRequestedLocale } from "../../i18n/resolve-locale";
import {
  buildCompanionSchema,
  splitLocalizedWrite,
  upsertCompanionRow,
} from "../../i18n/runtime/companion-io";

import {
  COMPONENT_META_KEYS,
  toSnakeCase,
  shouldTreatAsJson,
  type ComponentRow,
  type ComponentInstanceData,
} from "./component-utils";

/**
 * Parameters for saving component data as part of a parent entry operation.
 */
export interface SaveComponentDataParams {
  /** UUID of the parent entry */
  parentId: string;

  /** Database table name of the parent entity (e.g., 'dc_pages', 'single_homepage') */
  parentTable: string;

  /** Field definitions of the parent entity (to detect component fields) */
  fields: FieldConfig[];

  /** The full data object from the parent entry (contains component field values) */
  data: Record<string, unknown>;

  /**
   * i18n: write locale. When set and an embedded component is localized, its translatable
   * field values are written to the component's companion `_locales` row for this locale
   * (shared fields still go to the main comp_ row). Threaded from the parent entity's write.
   */
  locale?: string;
}

/**
 * Parameters for deleting all component data when a parent entry is removed.
 */
export interface DeleteComponentDataParams {
  parentId: string;
  parentTable: string;
  fields: FieldConfig[];
}

function isComponentField(field: FieldConfig): field is ComponentFieldConfig {
  return field.type === "component";
}

export class ComponentMutationService extends BaseService {
  private readonly registryService: ComponentRegistryService;

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    registryService: ComponentRegistryService,
    // i18n: when set and an embedded component is localized, translatable field values are
    // routed to the component's companion `comp_<slug>_locales` row for the write locale.
    private readonly localization?: SanitizedLocalizationConfig
  ) {
    super(adapter, logger);
    this.registryService = registryService;
  }

  /**
   * i18n: split a component instance's write into the values that stay on the main comp_
   * table (shared) and the translatable values that belong on the companion row. Returns the
   * companion schema (or null when the component isn't localized) plus the split payloads.
   * The caller writes `main` to the instance row and, after it has the instance id, upserts
   * the companion via {@link upsertLocalizedComponent}.
   */
  private splitLocalizedComponent(
    meta: DynamicComponentRecord,
    data: Record<string, unknown>
  ): {
    schema: ReturnType<typeof buildCompanionSchema>;
    main: Record<string, unknown>;
    companion: Record<string, unknown>;
  } {
    if (!this.localization || meta.localized !== true) {
      return { schema: null, main: data, companion: {} };
    }
    const schema = buildCompanionSchema({
      slug: meta.slug,
      tableName: meta.tableName,
      fields: meta.fields as { name: string; type: string }[],
      dialect: this.adapter.dialect,
      status: false,
    });
    if (!schema) return { schema: null, main: data, companion: {} };
    const { main, companion } = splitLocalizedWrite(data, schema.localizedFields);
    return { schema, main, companion };
  }

  /**
   * i18n: upsert a component instance's translatable values into its companion for `locale`.
   * The write goes through `writeAdapter` so both the direct adapter and a transaction
   * context (which exposes the same `dialect` + raw `execute`) are supported.
   */
  private async upsertLocalizedComponent(
    schema: NonNullable<ReturnType<typeof buildCompanionSchema>>,
    instanceId: string,
    companionData: Record<string, unknown>,
    locale: string | undefined,
    writeAdapter: {
      dialect: SupportedDialect;
      executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
    } = this.adapter
  ): Promise<void> {
    if (Object.keys(companionData).length === 0) return;
    const writeLocale = resolveRequestedLocale(this.localization!, locale);
    await upsertCompanionRow(
      writeAdapter,
      schema.companionTableName,
      instanceId,
      writeLocale,
      companionData
    );
  }

  /** Wrap a transaction context as a companion write adapter (raw execute within the tx). */
  private txWriteAdapter(tx: TransactionContext): {
    dialect: SupportedDialect;
    executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  } {
    return {
      dialect: this.adapter.dialect,
      executeQuery: <T = unknown>(sql: string, params?: unknown[]) =>
        tx.execute<T>(sql, params as never),
    };
  }

  /**
   * Save component data for all component fields of a parent entry.
   */
  async saveComponentData(params: SaveComponentDataParams): Promise<void> {
    const { parentId, parentTable, fields, data, locale } = params;

    for (const field of fields) {
      if (!isComponentField(field)) continue;

      const fieldName = field.name;
      const fieldData = data[fieldName];

      if (fieldData === undefined || fieldData === null) {
        // On update, null means "clear this field" — delete existing instances
        if (fieldData === null) {
          await this.deleteFieldComponentData(
            parentId,
            parentTable,
            fieldName,
            field
          );
        }
        continue;
      }

      if (field.components && field.components.length > 0) {
        await this.saveMultiComponents({
          parentId,
          parentTable,
          fieldName,
          field,
          data: fieldData,
          locale,
        });
      } else if (field.component) {
        if (field.repeatable) {
          await this.saveRepeatableComponents({
            parentId,
            parentTable,
            fieldName,
            componentSlug: field.component,
            data: fieldData,
            locale,
          });
        } else {
          await this.saveSingleComponent({
            parentId,
            parentTable,
            fieldName,
            componentSlug: field.component,
            data: fieldData as ComponentInstanceData,
            locale,
          });
        }
      }
    }
  }

  async saveComponentDataInTransaction(
    tx: TransactionContext,
    params: SaveComponentDataParams
  ): Promise<void> {
    const { parentId, parentTable, fields, data, locale } = params;

    for (const field of fields) {
      if (!isComponentField(field)) continue;

      const fieldName = field.name;
      const fieldData = data[fieldName];

      if (fieldData === undefined || fieldData === null) {
        if (fieldData === null) {
          await this.deleteFieldComponentDataInTx(
            tx,
            parentId,
            parentTable,
            fieldName,
            field
          );
        }
        continue;
      }

      if (field.components && field.components.length > 0) {
        await this.saveMultiComponentsInTx(tx, {
          parentId,
          parentTable,
          fieldName,
          field,
          data: fieldData,
          locale,
        });
      } else if (field.component) {
        if (field.repeatable) {
          await this.saveRepeatableComponentsInTx(tx, {
            parentId,
            parentTable,
            fieldName,
            componentSlug: field.component,
            data: fieldData,
            locale,
          });
        } else {
          await this.saveSingleComponentInTx(tx, {
            parentId,
            parentTable,
            fieldName,
            componentSlug: field.component,
            data: fieldData as ComponentInstanceData,
            locale,
          });
        }
      }
    }
  }

  /**
   * Delete all component data for a parent entry.
   */
  async deleteComponentData(params: DeleteComponentDataParams): Promise<void> {
    const { parentId, parentTable, fields } = params;

    for (const field of fields) {
      if (!isComponentField(field)) continue;

      await this.deleteFieldComponentData(
        parentId,
        parentTable,
        field.name,
        field
      );
    }
  }

  async deleteComponentDataInTransaction(
    tx: TransactionContext,
    params: DeleteComponentDataParams
  ): Promise<void> {
    const { parentId, parentTable, fields } = params;

    for (const field of fields) {
      if (!isComponentField(field)) continue;

      await this.deleteFieldComponentDataInTx(
        tx,
        parentId,
        parentTable,
        field.name,
        field
      );
    }
  }

  private async saveSingleComponent(params: {
    parentId: string;
    parentTable: string;
    fieldName: string;
    componentSlug: string;
    data: ComponentInstanceData;
    locale?: string;
  }): Promise<void> {
    const { parentId, parentTable, fieldName, componentSlug, data, locale } =
      params;

    try {
      const componentMeta =
        await this.registryService.getComponent(componentSlug);
      const tableName = componentMeta.tableName;
      const componentFields = componentMeta.fields;

      // i18n: split translatable values out of the main comp_ write — they live on the
      // companion. `main === data` when the component isn't localized (unchanged path).
      const { schema, main, companion } = this.splitLocalizedComponent(
        componentMeta,
        data
      );

      const existing = await this.getExistingInstances(
        tableName,
        parentId,
        parentTable,
        fieldName
      );

      let instanceId: string;
      if (existing.length > 0) {
        instanceId = existing[0].id;
        const updateData = this.serializeComponentRow(
          main,
          componentFields
        );
        updateData.updated_at = this.formatDateForDb();

        await this.adapter.update(
          tableName,
          updateData,
          this.whereEq("id", instanceId),
          { returning: ["id"] }
        );

        this.logger.debug("Updated single component instance", {
          componentSlug,
          parentId,
          fieldName,
          rowId: instanceId,
        });
      } else {
        const row = this.buildInsertRow({
          data: main,
          componentFields,
          parentId,
          parentTable,
          fieldName,
          order: 0,
          componentType: null,
        });
        instanceId = row.id as string;

        await this.adapter.insert(tableName, row, { returning: ["id"] });

        this.logger.debug("Created single component instance", {
          componentSlug,
          parentId,
          fieldName,
        });
      }

      // i18n: upsert the instance's translatable values into its companion for the locale.
      if (schema) {
        await this.upsertLocalizedComponent(schema, instanceId, companion, locale);
      }
    } catch (error) {
      // Rethrow already-mapped NextlyErrors (and ServiceError shims, which
      // share the cross-realm brand) so factory-thrown errors aren't
      // double-wrapped. Anything else is treated as a raw DB error. Normalise
      // raw driver errors via toDbError(dialect) first so the kind is preserved.
      if (NextlyError.is(error)) throw error;
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  private async saveSingleComponentInTx(
    tx: TransactionContext,
    params: {
      parentId: string;
      parentTable: string;
      fieldName: string;
      componentSlug: string;
      data: ComponentInstanceData;
      locale?: string;
    }
  ): Promise<void> {
    const { parentId, parentTable, fieldName, componentSlug, data, locale } =
      params;

    try {
      const componentMeta =
        await this.registryService.getComponent(componentSlug);
      const tableName = componentMeta.tableName;
      const componentFields = componentMeta.fields;

      // i18n: split translatable values out of the main comp_ write (companion-owned).
      const { schema, main, companion } = this.splitLocalizedComponent(
        componentMeta,
        data
      );

      const existing = await this.getExistingInstancesInTx(
        tx,
        tableName,
        parentId,
        parentTable,
        fieldName
      );

      let instanceId: string;
      if (existing.length > 0) {
        instanceId = existing[0].id;
        const updateData = this.serializeComponentRow(
          main,
          componentFields
        );
        updateData.updated_at = this.formatDateForDb();

        await tx.update(tableName, updateData, this.whereEq("id", instanceId), {
          returning: ["id"],
        });
      } else {
        const row = this.buildInsertRow({
          data: main,
          componentFields,
          parentId,
          parentTable,
          fieldName,
          order: 0,
          componentType: null,
        });
        instanceId = row.id as string;

        await tx.insert(tableName, row, { returning: ["id"] });
      }

      // i18n: upsert the translatable values into the companion within the transaction.
      if (schema) {
        await this.upsertLocalizedComponent(
          schema,
          instanceId,
          companion,
          locale,
          this.txWriteAdapter(tx)
        );
      }
    } catch (error) {
      // See saveSingleComponent — preserve already-mapped NextlyErrors and
      // map raw DB errors via fromDatabaseError. Normalise raw driver errors
      // first so the kind is preserved instead of collapsing to INTERNAL_ERROR.
      if (NextlyError.is(error)) throw error;
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  // Uses diff-based approach: updates by id, inserts new rows for
  // instances without id, deletes rows not present in incoming data.
  private async saveRepeatableComponents(params: {
    parentId: string;
    parentTable: string;
    fieldName: string;
    componentSlug: string;
    data: unknown;
    locale?: string;
  }): Promise<void> {
    const { parentId, parentTable, fieldName, componentSlug, data, locale } =
      params;

    if (!Array.isArray(data)) {
      this.logger.warn("Repeatable component data is not an array", {
        fieldName,
        componentSlug,
      });
      return;
    }

    try {
      const componentMeta =
        await this.registryService.getComponent(componentSlug);
      const tableName = componentMeta.tableName;
      const componentFields = componentMeta.fields;

      const existing = await this.getExistingInstances(
        tableName,
        parentId,
        parentTable,
        fieldName
      );
      const existingMap = this.buildRowMap(existing);
      const incomingIds = new Set<string>();

      const instances = data as ComponentInstanceData[];
      for (let i = 0; i < instances.length; i++) {
        const instance = instances[i];
        const instanceId = instance.id;
        // i18n: split translatable values out per instance (companion-owned). The
        // diff-by-id update keeps the instance id stable, so companion rows for OTHER
        // locales survive a re-save in one locale.
        const { schema, main, companion } = this.splitLocalizedComponent(
          componentMeta,
          instance
        );

        if (instanceId && existingMap.has(instanceId)) {
          incomingIds.add(instanceId);
          const updateData = this.serializeComponentRow(
            main,
            componentFields
          );
          updateData._order = i;
          updateData.updated_at = this.formatDateForDb();

          await this.adapter.update(
            tableName,
            updateData,
            this.whereEq("id", instanceId),
            { returning: ["id"] }
          );
          if (schema) {
            await this.upsertLocalizedComponent(
              schema,
              instanceId,
              companion,
              locale
            );
          }
        } else {
          const row = this.buildInsertRow({
            data: main,
            componentFields,
            parentId,
            parentTable,
            fieldName,
            order: i,
            componentType: null,
          });

          await this.adapter.insert(tableName, row, { returning: ["id"] });
          if (schema) {
            await this.upsertLocalizedComponent(
              schema,
              row.id as string,
              companion,
              locale
            );
          }
        }
      }

      await this.deleteRemovedInstances(tableName, existingMap, incomingIds);

      this.logger.debug("Saved repeatable component instances", {
        componentSlug,
        parentId,
        fieldName,
        count: instances.length,
      });
    } catch (error) {
      // See saveSingleComponent — preserve already-mapped NextlyErrors and
      // map raw DB errors via fromDatabaseError. Normalise raw driver errors
      // first so the kind is preserved instead of collapsing to INTERNAL_ERROR.
      if (NextlyError.is(error)) throw error;
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  private async saveRepeatableComponentsInTx(
    tx: TransactionContext,
    params: {
      parentId: string;
      parentTable: string;
      fieldName: string;
      componentSlug: string;
      data: unknown;
      locale?: string;
    }
  ): Promise<void> {
    const { parentId, parentTable, fieldName, componentSlug, data, locale } =
      params;

    if (!Array.isArray(data)) {
      this.logger.warn("Repeatable component data is not an array", {
        fieldName,
        componentSlug,
      });
      return;
    }

    try {
      const componentMeta =
        await this.registryService.getComponent(componentSlug);
      const tableName = componentMeta.tableName;
      const componentFields = componentMeta.fields;

      const existing = await this.getExistingInstancesInTx(
        tx,
        tableName,
        parentId,
        parentTable,
        fieldName
      );
      const existingMap = this.buildRowMap(existing);
      const incomingIds = new Set<string>();

      const instances = data as ComponentInstanceData[];
      for (let i = 0; i < instances.length; i++) {
        const instance = instances[i];
        const instanceId = instance.id;
        // i18n: split translatable values out (companion-owned) per instance.
        const { schema, main, companion } = this.splitLocalizedComponent(
          componentMeta,
          instance
        );

        if (instanceId && existingMap.has(instanceId)) {
          incomingIds.add(instanceId);
          const updateData = this.serializeComponentRow(
            main,
            componentFields
          );
          updateData._order = i;
          updateData.updated_at = this.formatDateForDb();

          await tx.update(
            tableName,
            updateData,
            this.whereEq("id", instanceId),
            { returning: ["id"] }
          );
          if (schema) {
            await this.upsertLocalizedComponent(
              schema,
              instanceId,
              companion,
              locale,
              this.txWriteAdapter(tx)
            );
          }
        } else {
          const row = this.buildInsertRow({
            data: main,
            componentFields,
            parentId,
            parentTable,
            fieldName,
            order: i,
            componentType: null,
          });

          await tx.insert(tableName, row, { returning: ["id"] });
          if (schema) {
            await this.upsertLocalizedComponent(
              schema,
              row.id as string,
              companion,
              locale,
              this.txWriteAdapter(tx)
            );
          }
        }
      }

      await this.deleteRemovedInstancesInTx(
        tx,
        tableName,
        existingMap,
        incomingIds
      );
    } catch (error) {
      // See saveSingleComponent — preserve already-mapped NextlyErrors and
      // map raw DB errors via fromDatabaseError. Normalise raw driver errors
      // first so the kind is preserved instead of collapsing to INTERNAL_ERROR.
      if (NextlyError.is(error)) throw error;
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  // Each instance specifies its component type via `_componentType`.
  // Instances may span multiple component data tables. Uses diff-based
  // approach across all referenced tables.
  private async saveMultiComponents(params: {
    parentId: string;
    parentTable: string;
    fieldName: string;
    field: ComponentFieldConfig;
    data: unknown;
    locale?: string;
  }): Promise<void> {
    const { parentId, parentTable, fieldName, field, data, locale } = params;
    const allowedSlugs = field.components ?? [];

    const instances = field.repeatable
      ? (data as ComponentInstanceData[])
      : [data as ComponentInstanceData];

    if (!Array.isArray(instances)) {
      this.logger.warn("Multi-component data is not an array", { fieldName });
      return;
    }

    try {
      const existingByTable = new Map<string, ComponentRow[]>();
      const metaCache = new Map<string, DynamicComponentRecord>();

      for (const slug of allowedSlugs) {
        try {
          const meta = await this.registryService.getComponent(slug);
          metaCache.set(slug, meta);

          const rows = await this.getExistingInstances(
            meta.tableName,
            parentId,
            parentTable,
            fieldName
          );
          if (rows.length > 0) {
            existingByTable.set(meta.tableName, rows);
          }
        } catch (error) {
          // Component may not exist yet (pending migration) — skip
          this.logger.debug(
            "Could not load component for multi-component field",
            {
              slug,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }

      const globalExistingMap = new Map<
        string,
        { row: ComponentRow; tableName: string }
      >();
      for (const [tbl, rows] of existingByTable) {
        for (const row of rows) {
          globalExistingMap.set(row.id, { row, tableName: tbl });
        }
      }

      const incomingIds = new Set<string>();

      for (let i = 0; i < instances.length; i++) {
        const instance = instances[i];
        const componentType = instance._componentType;

        if (!componentType) {
          this.logger.warn("Multi-component instance missing _componentType", {
            fieldName,
            index: i,
          });
          continue;
        }

        if (!allowedSlugs.includes(componentType)) {
          this.logger.warn(
            "Multi-component instance has invalid _componentType",
            {
              fieldName,
              componentType,
              allowed: allowedSlugs,
            }
          );
          continue;
        }

        const meta = metaCache.get(componentType);
        if (!meta) continue;

        const tableName = meta.tableName;
        const componentFields = meta.fields;
        const instanceId = instance.id;
        // i18n: split translatable values out per instance using its own component meta.
        const { schema, main, companion } = this.splitLocalizedComponent(
          meta,
          instance
        );

        if (instanceId && globalExistingMap.has(instanceId)) {
          incomingIds.add(instanceId);
          const updateData = this.serializeComponentRow(
            main,
            componentFields
          );
          updateData._order = i;
          updateData._component_type = componentType;
          updateData.updated_at = this.formatDateForDb();

          const existingEntry = globalExistingMap.get(instanceId)!;
          await this.adapter.update(
            existingEntry.tableName,
            updateData,
            this.whereEq("id", instanceId),
            { returning: ["id"] }
          );
          if (schema) {
            await this.upsertLocalizedComponent(
              schema,
              instanceId,
              companion,
              locale
            );
          }
        } else {
          const row = this.buildInsertRow({
            data: main,
            componentFields,
            parentId,
            parentTable,
            fieldName,
            order: i,
            componentType,
          });

          await this.adapter.insert(tableName, row, { returning: ["id"] });
          if (schema) {
            await this.upsertLocalizedComponent(
              schema,
              row.id as string,
              companion,
              locale
            );
          }
        }
      }

      for (const [id, entry] of globalExistingMap) {
        if (!incomingIds.has(id)) {
          await this.adapter.delete(entry.tableName, this.whereEq("id", id));
        }
      }

      this.logger.debug("Saved multi-component instances", {
        parentId,
        fieldName,
        count: instances.length,
      });
    } catch (error) {
      // See saveSingleComponent — preserve already-mapped NextlyErrors and
      // map raw DB errors via fromDatabaseError. Normalise raw driver errors
      // first so the kind is preserved instead of collapsing to INTERNAL_ERROR.
      if (NextlyError.is(error)) throw error;
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  private async saveMultiComponentsInTx(
    tx: TransactionContext,
    params: {
      parentId: string;
      parentTable: string;
      fieldName: string;
      field: ComponentFieldConfig;
      data: unknown;
      locale?: string;
    }
  ): Promise<void> {
    const { parentId, parentTable, fieldName, field, data, locale } = params;
    const allowedSlugs = field.components ?? [];

    const instances = field.repeatable
      ? (data as ComponentInstanceData[])
      : [data as ComponentInstanceData];

    if (!Array.isArray(instances)) {
      this.logger.warn("Multi-component data is not an array", { fieldName });
      return;
    }

    try {
      const existingByTable = new Map<string, ComponentRow[]>();
      const metaCache = new Map<string, DynamicComponentRecord>();

      for (const slug of allowedSlugs) {
        try {
          const meta = await this.registryService.getComponent(slug);
          metaCache.set(slug, meta);

          const rows = await this.getExistingInstancesInTx(
            tx,
            meta.tableName,
            parentId,
            parentTable,
            fieldName
          );
          if (rows.length > 0) {
            existingByTable.set(meta.tableName, rows);
          }
        } catch (error) {
          this.logger.debug(
            "Could not load component for multi-component field",
            {
              slug,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }

      const globalExistingMap = new Map<
        string,
        { row: ComponentRow; tableName: string }
      >();
      for (const [tbl, rows] of existingByTable) {
        for (const row of rows) {
          globalExistingMap.set(row.id, { row, tableName: tbl });
        }
      }

      const incomingIds = new Set<string>();

      for (let i = 0; i < instances.length; i++) {
        const instance = instances[i];
        const componentType = instance._componentType;

        if (!componentType || !allowedSlugs.includes(componentType)) continue;

        const meta = metaCache.get(componentType);
        if (!meta) continue;

        const tableName = meta.tableName;
        const componentFields = meta.fields;
        const instanceId = instance.id;
        // i18n: split translatable values out per instance using its own component meta.
        const { schema, main, companion } = this.splitLocalizedComponent(
          meta,
          instance
        );

        if (instanceId && globalExistingMap.has(instanceId)) {
          incomingIds.add(instanceId);
          const updateData = this.serializeComponentRow(
            main,
            componentFields
          );
          updateData._order = i;
          updateData._component_type = componentType;
          updateData.updated_at = this.formatDateForDb();

          const existingEntry = globalExistingMap.get(instanceId)!;
          await tx.update(
            existingEntry.tableName,
            updateData,
            this.whereEq("id", instanceId),
            { returning: ["id"] }
          );
          if (schema) {
            await this.upsertLocalizedComponent(
              schema,
              instanceId,
              companion,
              locale,
              this.txWriteAdapter(tx)
            );
          }
        } else {
          const row = this.buildInsertRow({
            data: main,
            componentFields,
            parentId,
            parentTable,
            fieldName,
            order: i,
            componentType,
          });

          await tx.insert(tableName, row, { returning: ["id"] });
          if (schema) {
            await this.upsertLocalizedComponent(
              schema,
              row.id as string,
              companion,
              locale,
              this.txWriteAdapter(tx)
            );
          }
        }
      }

      for (const [id, entry] of globalExistingMap) {
        if (!incomingIds.has(id)) {
          await tx.delete(entry.tableName, this.whereEq("id", id));
        }
      }
    } catch (error) {
      // See saveSingleComponent — preserve already-mapped NextlyErrors and
      // map raw DB errors via fromDatabaseError. Normalise raw driver errors
      // first so the kind is preserved instead of collapsing to INTERNAL_ERROR.
      if (NextlyError.is(error)) throw error;
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  private async deleteFieldComponentData(
    parentId: string,
    parentTable: string,
    fieldName: string,
    field: ComponentFieldConfig
  ): Promise<void> {
    const slugs = this.getComponentSlugs(field);

    for (const slug of slugs) {
      try {
        const meta = await this.registryService.getComponent(slug);
        await this.adapter.delete(
          meta.tableName,
          this.whereAnd({
            _parent_id: parentId,
            _parent_table: parentTable,
            _parent_field: fieldName,
          })
        );
      } catch (error) {
        this.logger.debug("Could not delete component data for field", {
          slug,
          fieldName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async deleteFieldComponentDataInTx(
    tx: TransactionContext,
    parentId: string,
    parentTable: string,
    fieldName: string,
    field: ComponentFieldConfig
  ): Promise<void> {
    const slugs = this.getComponentSlugs(field);

    for (const slug of slugs) {
      try {
        const meta = await this.registryService.getComponent(slug);
        await tx.delete(
          meta.tableName,
          this.whereAnd({
            _parent_id: parentId,
            _parent_table: parentTable,
            _parent_field: fieldName,
          })
        );
      } catch (error) {
        this.logger.debug("Could not delete component data for field in tx", {
          slug,
          fieldName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async getExistingInstances(
    tableName: string,
    parentId: string,
    parentTable: string,
    fieldName: string
  ): Promise<ComponentRow[]> {
    try {
      return await this.adapter.select<ComponentRow>(tableName, {
        where: this.whereAnd({
          _parent_id: parentId,
          _parent_table: parentTable,
          _parent_field: fieldName,
        }),
        orderBy: [{ column: "_order", direction: "asc" }],
      });
    } catch (error) {
      this.logger.debug("Could not query component table", {
        tableName,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async getExistingInstancesInTx(
    tx: TransactionContext,
    tableName: string,
    parentId: string,
    parentTable: string,
    fieldName: string
  ): Promise<ComponentRow[]> {
    try {
      return await tx.select<ComponentRow>(tableName, {
        where: this.whereAnd({
          _parent_id: parentId,
          _parent_table: parentTable,
          _parent_field: fieldName,
        }),
        orderBy: [{ column: "_order", direction: "asc" }],
      });
    } catch (error) {
      this.logger.debug("Could not query component table in tx", {
        tableName,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private buildInsertRow(params: {
    data: ComponentInstanceData;
    componentFields: FieldConfig[];
    parentId: string;
    parentTable: string;
    fieldName: string;
    order: number;
    componentType: string | null;
  }): Record<string, unknown> {
    const {
      data,
      componentFields,
      parentId,
      parentTable,
      fieldName,
      order,
      componentType,
    } = params;

    const now = this.formatDateForDb();
    const serializedFields = this.serializeComponentRow(data, componentFields);

    return {
      id: crypto.randomUUID(),
      _parent_id: parentId,
      _parent_table: parentTable,
      _parent_field: fieldName,
      _order: order,
      _component_type: componentType,
      ...serializedFields,
      created_at: now,
      updated_at: now,
    };
  }

  private serializeComponentRow(
    data: ComponentInstanceData,
    fields: FieldConfig[]
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Coerce date-field strings into `Date` objects before column mapping
    // so Drizzle can bind them to `timestamp` columns. JSON request bodies
    // always deliver dates as ISO strings; without this step the adapter
    // throws `value.toISOString is not a function`. Covers every component
    // write path because both `buildInsertRow` and the in-place update
    // sites funnel through here.
    coerceDateFieldsToDate(data, fields);

    const fieldMap = new Map<string, FieldConfig>();
    for (const field of fields) {
      if ("name" in field && field.name) {
        fieldMap.set(field.name, field);
      }
    }

    for (const [key, value] of Object.entries(data)) {
      if (COMPONENT_META_KEYS.has(key)) {
        continue;
      }

      const field = fieldMap.get(key);
      if (!field) {
        continue;
      }

      const columnName = toSnakeCase(key);

      if (
        shouldTreatAsJson(field) &&
        value != null &&
        typeof value === "object"
      ) {
        result[columnName] = JSON.stringify(value);
      } else {
        result[columnName] = value;
      }
    }

    return result;
  }

  private buildRowMap(rows: ComponentRow[]): Map<string, ComponentRow> {
    const map = new Map<string, ComponentRow>();
    for (const row of rows) {
      map.set(row.id, row);
    }
    return map;
  }

  private async deleteRemovedInstances(
    tableName: string,
    existingMap: Map<string, ComponentRow>,
    incomingIds: Set<string>
  ): Promise<void> {
    for (const [id] of existingMap) {
      if (!incomingIds.has(id)) {
        await this.adapter.delete(tableName, this.whereEq("id", id));
      }
    }
  }

  private async deleteRemovedInstancesInTx(
    tx: TransactionContext,
    tableName: string,
    existingMap: Map<string, ComponentRow>,
    incomingIds: Set<string>
  ): Promise<void> {
    for (const [id] of existingMap) {
      if (!incomingIds.has(id)) {
        await tx.delete(tableName, this.whereEq("id", id));
      }
    }
  }

  private getComponentSlugs(field: ComponentFieldConfig): string[] {
    if (field.components && field.components.length > 0) {
      return field.components;
    }
    if (field.component) {
      return [field.component];
    }
    return [];
  }
}
