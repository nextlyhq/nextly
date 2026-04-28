import crypto from "node:crypto";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { TransactionContext } from "@revnixhq/adapter-drizzle/types";

import type { FieldConfig } from "../../../collections/fields/types";
import type { ComponentFieldConfig } from "../../../collections/fields/types/component";
// PR 4 migration: ServiceError throws replaced with NextlyError. The legacy
// `ServiceError.fromDatabaseError` boundary maps to `NextlyError.fromDatabaseError`,
// and the `instanceof ServiceError` rethrow guards become `NextlyError.is(...)`
// so any error type travelling through the shim is preserved.
import { NextlyError } from "../../../errors";
import type { DynamicComponentRecord } from "../../../schemas/dynamic-components/types";
import type { ComponentRegistryService } from "../../../services/components/component-registry-service";
import { BaseService } from "../../../shared/base-service";
import type { Logger } from "../../../shared/types";

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
    registryService: ComponentRegistryService
  ) {
    super(adapter, logger);
    this.registryService = registryService;
  }

  /**
   * Save component data for all component fields of a parent entry.
   */
  async saveComponentData(params: SaveComponentDataParams): Promise<void> {
    const { parentId, parentTable, fields, data } = params;

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
        });
      } else if (field.component) {
        if (field.repeatable) {
          await this.saveRepeatableComponents({
            parentId,
            parentTable,
            fieldName,
            componentSlug: field.component,
            data: fieldData,
          });
        } else {
          await this.saveSingleComponent({
            parentId,
            parentTable,
            fieldName,
            componentSlug: field.component,
            data: fieldData as ComponentInstanceData,
          });
        }
      }
    }
  }

  async saveComponentDataInTransaction(
    tx: TransactionContext,
    params: SaveComponentDataParams
  ): Promise<void> {
    const { parentId, parentTable, fields, data } = params;

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
        });
      } else if (field.component) {
        if (field.repeatable) {
          await this.saveRepeatableComponentsInTx(tx, {
            parentId,
            parentTable,
            fieldName,
            componentSlug: field.component,
            data: fieldData,
          });
        } else {
          await this.saveSingleComponentInTx(tx, {
            parentId,
            parentTable,
            fieldName,
            componentSlug: field.component,
            data: fieldData as ComponentInstanceData,
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
  }): Promise<void> {
    const { parentId, parentTable, fieldName, componentSlug, data } = params;

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

      if (existing.length > 0) {
        const rowId = existing[0].id;
        const updateData = this.serializeComponentRow(data, componentFields);
        updateData.updated_at = this.formatDateForDb();

        await this.adapter.update(
          tableName,
          updateData,
          this.whereEq("id", rowId),
          { returning: ["id"] }
        );

        this.logger.debug("Updated single component instance", {
          componentSlug,
          parentId,
          fieldName,
          rowId,
        });
      } else {
        const row = this.buildInsertRow({
          data,
          componentFields,
          parentId,
          parentTable,
          fieldName,
          order: 0,
          componentType: null,
        });

        await this.adapter.insert(tableName, row, { returning: ["id"] });

        this.logger.debug("Created single component instance", {
          componentSlug,
          parentId,
          fieldName,
        });
      }
    } catch (error) {
      // Rethrow already-mapped NextlyErrors (and ServiceError shims, which
      // share the cross-realm brand) so factory-thrown errors aren't
      // double-wrapped. Anything else is treated as a raw DB error.
      if (NextlyError.is(error)) throw error;
      throw NextlyError.fromDatabaseError(error);
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
    }
  ): Promise<void> {
    const { parentId, parentTable, fieldName, componentSlug, data } = params;

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

      if (existing.length > 0) {
        const rowId = existing[0].id;
        const updateData = this.serializeComponentRow(data, componentFields);
        updateData.updated_at = this.formatDateForDb();

        await tx.update(tableName, updateData, this.whereEq("id", rowId), {
          returning: ["id"],
        });
      } else {
        const row = this.buildInsertRow({
          data,
          componentFields,
          parentId,
          parentTable,
          fieldName,
          order: 0,
          componentType: null,
        });

        await tx.insert(tableName, row, { returning: ["id"] });
      }
    } catch (error) {
      // See saveSingleComponent — preserve already-mapped NextlyErrors and
      // map raw DB errors via fromDatabaseError.
      if (NextlyError.is(error)) throw error;
      throw NextlyError.fromDatabaseError(error);
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
  }): Promise<void> {
    const { parentId, parentTable, fieldName, componentSlug, data } = params;

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

        if (instanceId && existingMap.has(instanceId)) {
          incomingIds.add(instanceId);
          const updateData = this.serializeComponentRow(
            instance,
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
        } else {
          const row = this.buildInsertRow({
            data: instance,
            componentFields,
            parentId,
            parentTable,
            fieldName,
            order: i,
            componentType: null,
          });

          await this.adapter.insert(tableName, row, { returning: ["id"] });
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
      // map raw DB errors via fromDatabaseError.
      if (NextlyError.is(error)) throw error;
      throw NextlyError.fromDatabaseError(error);
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
    }
  ): Promise<void> {
    const { parentId, parentTable, fieldName, componentSlug, data } = params;

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

        if (instanceId && existingMap.has(instanceId)) {
          incomingIds.add(instanceId);
          const updateData = this.serializeComponentRow(
            instance,
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
        } else {
          const row = this.buildInsertRow({
            data: instance,
            componentFields,
            parentId,
            parentTable,
            fieldName,
            order: i,
            componentType: null,
          });

          await tx.insert(tableName, row, { returning: ["id"] });
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
      // map raw DB errors via fromDatabaseError.
      if (NextlyError.is(error)) throw error;
      throw NextlyError.fromDatabaseError(error);
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
  }): Promise<void> {
    const { parentId, parentTable, fieldName, field, data } = params;
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

        if (instanceId && globalExistingMap.has(instanceId)) {
          incomingIds.add(instanceId);
          const updateData = this.serializeComponentRow(
            instance,
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
        } else {
          const row = this.buildInsertRow({
            data: instance,
            componentFields,
            parentId,
            parentTable,
            fieldName,
            order: i,
            componentType,
          });

          await this.adapter.insert(tableName, row, { returning: ["id"] });
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
      // map raw DB errors via fromDatabaseError.
      if (NextlyError.is(error)) throw error;
      throw NextlyError.fromDatabaseError(error);
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
    }
  ): Promise<void> {
    const { parentId, parentTable, fieldName, field, data } = params;
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

        if (instanceId && globalExistingMap.has(instanceId)) {
          incomingIds.add(instanceId);
          const updateData = this.serializeComponentRow(
            instance,
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
        } else {
          const row = this.buildInsertRow({
            data: instance,
            componentFields,
            parentId,
            parentTable,
            fieldName,
            order: i,
            componentType,
          });

          await tx.insert(tableName, row, { returning: ["id"] });
        }
      }

      for (const [id, entry] of globalExistingMap) {
        if (!incomingIds.has(id)) {
          await tx.delete(entry.tableName, this.whereEq("id", id));
        }
      }
    } catch (error) {
      // See saveSingleComponent — preserve already-mapped NextlyErrors and
      // map raw DB errors via fromDatabaseError.
      if (NextlyError.is(error)) throw error;
      throw NextlyError.fromDatabaseError(error);
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
