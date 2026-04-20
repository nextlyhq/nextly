import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import type { FieldConfig } from "../../../collections/fields/types";
import type { ComponentFieldConfig } from "../../../collections/fields/types/component";
import type { CollectionRelationshipService } from "../../../services/collections/collection-relationship-service";
import type { ComponentRegistryService } from "../../../services/components/component-registry-service";
import { BaseService } from "../../../shared/base-service";
import type { Logger } from "../../../shared/types";

import {
  DEFAULT_COMPONENT_DEPTH,
  POPULATE_INTERNAL_COLUMNS,
  toSnakeCase,
  shouldTreatAsJson,
  type ComponentRow,
} from "./component-utils";

/**
 * Parameters for populating component data on a single parent entry.
 */
export interface PopulateComponentDataParams {
  /** The entry to populate with component data */
  entry: Record<string, unknown>;

  /** Database table name of the parent entity (e.g., 'dc_pages', 'single_homepage') */
  parentTable: string;

  /** Field definitions of the parent entity (to detect component fields) */
  fields: FieldConfig[];

  /**
   * Depth for relationship/upload field expansion within component data.
   * 0: Return IDs only. 1+: Recursive expansion.
   * @default 2
   */
  depth?: number;

  /**
   * Current depth level (internal use for recursive expansion).
   * @internal
   */
  currentDepth?: number;

  /**
   * Field selection whitelist for optimization.
   * When provided, only component fields with `select[fieldName] === true` are populated.
   */
  select?: Record<string, boolean>;
}

/**
 * Parameters for populating component data on multiple parent entries (batch).
 */
export interface PopulateComponentDataManyParams {
  entries: Record<string, unknown>[];
  parentTable: string;
  fields: FieldConfig[];
  depth?: number;
  currentDepth?: number;
  select?: Record<string, boolean>;
}

// Duplicated here (and in the mutation service) to avoid a cross-domain
// import into collections just for a type predicate.
function isComponentField(field: FieldConfig): field is ComponentFieldConfig {
  return field.type === "component";
}

export class ComponentQueryService extends BaseService {
  private readonly registryService: ComponentRegistryService;
  private relationshipService?: CollectionRelationshipService;

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    registryService: ComponentRegistryService,
    relationshipService?: CollectionRelationshipService
  ) {
    super(adapter, logger);
    this.registryService = registryService;
    this.relationshipService = relationshipService;
  }

  setRelationshipService(service: CollectionRelationshipService): void {
    if (!this.relationshipService) {
      this.relationshipService = service;
    }
  }

  /**
   * Populate component data for a single parent entry.
   */
  async populateComponentData(
    params: PopulateComponentDataParams
  ): Promise<Record<string, unknown>> {
    const {
      entry,
      parentTable,
      fields,
      depth = DEFAULT_COMPONENT_DEPTH,
      currentDepth = 0,
      select,
    } = params;
    const entryId = entry.id as string;
    if (!entryId) return entry;

    const result = { ...entry };

    for (const field of fields) {
      if (!isComponentField(field)) continue;
      const fieldName = field.name;

      if (!this.shouldPopulateField(fieldName, select)) {
        continue;
      }

      try {
        if (field.components && field.components.length > 0) {
          result[fieldName] = await this.populateMultiComponentField(
            entryId,
            parentTable,
            fieldName,
            field,
            depth,
            currentDepth
          );
        } else if (field.component) {
          if (field.repeatable) {
            result[fieldName] = await this.populateRepeatableField(
              entryId,
              parentTable,
              fieldName,
              field.component,
              depth,
              currentDepth
            );
          } else {
            result[fieldName] = await this.populateSingleField(
              entryId,
              parentTable,
              fieldName,
              field.component,
              depth,
              currentDepth
            );
          }
        }
      } catch (error) {
        this.logger.debug("Could not populate component field", {
          fieldName,
          error: error instanceof Error ? error.message : String(error),
        });
        result[fieldName] = this.getPopulateDefaultValue(field);
      }
    }

    return result;
  }

  /**
   * Populate component data for multiple parent entries (batch).
   */
  async populateComponentDataMany(
    params: PopulateComponentDataManyParams
  ): Promise<Record<string, unknown>[]> {
    const {
      entries,
      parentTable,
      fields,
      depth = DEFAULT_COMPONENT_DEPTH,
      currentDepth = 0,
      select,
    } = params;
    if (entries.length === 0) return entries;

    const entryIds = entries
      .map(e => e.id as string)
      .filter((id): id is string => Boolean(id));
    if (entryIds.length === 0) return entries;

    const componentFields: ComponentFieldConfig[] = [];
    for (const field of fields) {
      if (isComponentField(field)) {
        if (!this.shouldPopulateField(field.name, select)) {
          continue;
        }
        componentFields.push(field);
      }
    }
    if (componentFields.length === 0) return entries;

    const fieldDataMaps = new Map<string, Map<string, unknown>>();

    for (const field of componentFields) {
      try {
        if (field.components && field.components.length > 0) {
          const dataMap = await this.batchPopulateMultiComponentField(
            entryIds,
            parentTable,
            field.name,
            field,
            depth,
            currentDepth
          );
          fieldDataMaps.set(field.name, dataMap);
        } else if (field.component) {
          if (field.repeatable) {
            const dataMap = await this.batchPopulateRepeatableField(
              entryIds,
              parentTable,
              field.name,
              field.component,
              depth,
              currentDepth
            );
            fieldDataMaps.set(field.name, dataMap);
          } else {
            const dataMap = await this.batchPopulateSingleField(
              entryIds,
              parentTable,
              field.name,
              field.component,
              depth,
              currentDepth
            );
            fieldDataMaps.set(field.name, dataMap);
          }
        }
      } catch (error) {
        this.logger.debug("Could not batch populate component field", {
          fieldName: field.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return entries.map(entry => {
      const entryId = entry.id as string;
      if (!entryId) return entry;

      const result = { ...entry };

      for (const field of componentFields) {
        const dataMap = fieldDataMaps.get(field.name);
        if (dataMap && dataMap.has(entryId)) {
          result[field.name] = dataMap.get(entryId);
        } else {
          result[field.name] = this.getPopulateDefaultValue(field);
        }
      }

      return result;
    });
  }

  private async populateSingleField(
    parentId: string,
    parentTable: string,
    fieldName: string,
    componentSlug: string,
    depth: number,
    currentDepth: number
  ): Promise<Record<string, unknown> | null> {
    const meta = await this.registryService.getComponent(componentSlug);
    const componentFields = meta.fields as FieldConfig[];
    const rows = await this.getExistingInstances(
      meta.tableName,
      parentId,
      parentTable,
      fieldName
    );

    if (rows.length === 0) return null;

    let data = this.deserializeComponentRow(rows[0], componentFields, false);
    data = await this.expandComponentRelationships(
      data,
      componentSlug,
      componentFields,
      depth,
      currentDepth + 1
    );

    return data;
  }

  private async populateRepeatableField(
    parentId: string,
    parentTable: string,
    fieldName: string,
    componentSlug: string,
    depth: number,
    currentDepth: number
  ): Promise<Record<string, unknown>[]> {
    const meta = await this.registryService.getComponent(componentSlug);
    const componentFields = meta.fields as FieldConfig[];
    const rows = await this.getExistingInstances(
      meta.tableName,
      parentId,
      parentTable,
      fieldName
    );

    let dataArray = rows.map(row =>
      this.deserializeComponentRow(row, componentFields, false)
    );

    dataArray = await this.expandComponentRelationshipsMany(
      dataArray,
      componentSlug,
      componentFields,
      depth,
      currentDepth + 1
    );

    return dataArray;
  }

  private async populateMultiComponentField(
    parentId: string,
    parentTable: string,
    fieldName: string,
    field: ComponentFieldConfig,
    depth: number,
    currentDepth: number
  ): Promise<Record<string, unknown>[]> {
    const allowedSlugs = field.components ?? [];
    const allRows: {
      row: ComponentRow;
      fields: FieldConfig[];
      slug: string;
    }[] = [];

    for (const slug of allowedSlugs) {
      try {
        const meta = await this.registryService.getComponent(slug);
        const rows = await this.getExistingInstances(
          meta.tableName,
          parentId,
          parentTable,
          fieldName
        );
        for (const row of rows) {
          allRows.push({ row, fields: meta.fields as FieldConfig[], slug });
        }
      } catch (error) {
        this.logger.debug("Could not load component for populate", {
          slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    allRows.sort((a, b) => (a.row._order ?? 0) - (b.row._order ?? 0));

    const results: Record<string, unknown>[] = [];
    for (const { row, fields, slug } of allRows) {
      let data = this.deserializeComponentRow(row, fields, true);
      data = await this.expandComponentRelationships(
        data,
        slug,
        fields,
        depth,
        currentDepth + 1
      );
      results.push(data);
    }

    return results;
  }

  private async batchPopulateSingleField(
    parentIds: string[],
    parentTable: string,
    fieldName: string,
    componentSlug: string,
    depth: number,
    currentDepth: number
  ): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>();
    const meta = await this.registryService.getComponent(componentSlug);
    const componentFields = meta.fields as FieldConfig[];
    const rows = await this.batchGetInstances(
      meta.tableName,
      parentIds,
      parentTable,
      fieldName
    );

    for (const row of rows) {
      const parentId = row._parent_id;
      if (!result.has(parentId)) {
        let data = this.deserializeComponentRow(row, componentFields, false);
        data = await this.expandComponentRelationships(
          data,
          componentSlug,
          componentFields,
          depth,
          currentDepth + 1
        );
        result.set(parentId, data);
      }
    }

    return result;
  }

  private async batchPopulateRepeatableField(
    parentIds: string[],
    parentTable: string,
    fieldName: string,
    componentSlug: string,
    depth: number,
    currentDepth: number
  ): Promise<Map<string, unknown>> {
    const grouped = new Map<string, Record<string, unknown>[]>();
    const meta = await this.registryService.getComponent(componentSlug);
    const componentFields = meta.fields as FieldConfig[];

    const rows = await this.batchGetInstances(
      meta.tableName,
      parentIds,
      parentTable,
      fieldName
    );

    // Rows arrive ordered by (_parent_id, _order), preserving array order per parent
    for (const row of rows) {
      const parentId = row._parent_id;
      if (!grouped.has(parentId)) {
        grouped.set(parentId, []);
      }
      let data = this.deserializeComponentRow(row, componentFields, false);
      data = await this.expandComponentRelationships(
        data,
        componentSlug,
        componentFields,
        depth,
        currentDepth + 1
      );
      grouped.get(parentId)!.push(data);
    }

    return grouped as Map<string, unknown>;
  }

  private async batchPopulateMultiComponentField(
    parentIds: string[],
    parentTable: string,
    fieldName: string,
    field: ComponentFieldConfig,
    depth: number,
    currentDepth: number
  ): Promise<Map<string, unknown>> {
    const allowedSlugs = field.components ?? [];

    const groupedByParent = new Map<
      string,
      { row: ComponentRow; fields: FieldConfig[]; slug: string }[]
    >();

    for (const slug of allowedSlugs) {
      try {
        const meta = await this.registryService.getComponent(slug);
        const rows = await this.batchGetInstances(
          meta.tableName,
          parentIds,
          parentTable,
          fieldName
        );
        for (const row of rows) {
          const parentId = row._parent_id;
          if (!groupedByParent.has(parentId)) {
            groupedByParent.set(parentId, []);
          }
          groupedByParent.get(parentId)!.push({
            row,
            fields: meta.fields as FieldConfig[],
            slug,
          });
        }
      } catch (error) {
        this.logger.debug("Could not load component for batch populate", {
          slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const result = new Map<string, unknown>();
    for (const [parentId, items] of groupedByParent) {
      items.sort((a, b) => (a.row._order ?? 0) - (b.row._order ?? 0));

      const expandedItems: Record<string, unknown>[] = [];
      for (const { row, fields, slug } of items) {
        let data = this.deserializeComponentRow(row, fields, true);
        data = await this.expandComponentRelationships(
          data,
          slug,
          fields,
          depth,
          currentDepth + 1
        );
        expandedItems.push(data);
      }

      result.set(parentId, expandedItems);
    }

    return result;
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

  // Results are ordered by `(_parent_id ASC, _order ASC)` so grouped
  // results maintain correct array ordering.
  private async batchGetInstances(
    tableName: string,
    parentIds: string[],
    parentTable: string,
    fieldName: string
  ): Promise<ComponentRow[]> {
    if (parentIds.length === 0) return [];

    try {
      return await this.adapter.select<ComponentRow>(tableName, {
        where: {
          and: [
            { column: "_parent_id", op: "IN", value: parentIds },
            { column: "_parent_table", op: "=", value: parentTable },
            { column: "_parent_field", op: "=", value: fieldName },
          ],
        },
        orderBy: [
          { column: "_parent_id", direction: "asc" },
          { column: "_order", direction: "asc" },
        ],
      });
    } catch (error) {
      this.logger.debug("Could not batch query component table", {
        tableName,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private deserializeComponentRow(
    row: ComponentRow,
    componentFields: FieldConfig[],
    includeComponentType: boolean
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    result.id = row.id;

    if (includeComponentType && row._component_type) {
      result._componentType = row._component_type;
    }

    const fieldByColumn = new Map<string, FieldConfig>();
    for (const field of componentFields) {
      if ("name" in field && field.name) {
        fieldByColumn.set(toSnakeCase(field.name), field);
      }
    }

    for (const [key, value] of Object.entries(row)) {
      if (key === "id" || POPULATE_INTERNAL_COLUMNS.has(key)) continue;

      const field = fieldByColumn.get(key);
      const fieldName: string =
        field && "name" in field && typeof field.name === "string"
          ? field.name
          : key;

      if (
        field &&
        shouldTreatAsJson(field) &&
        value != null &&
        typeof value === "string"
      ) {
        try {
          result[fieldName] = JSON.parse(value);
        } catch {
          result[fieldName] = value;
        }
      } else {
        result[fieldName] = value ?? null;
      }
    }

    return result;
  }

  private getPopulateDefaultValue(
    field: ComponentFieldConfig
  ): null | unknown[] {
    if (field.repeatable || (field.components && field.components.length > 0)) {
      return [];
    }
    return null;
  }

  private shouldPopulateField(
    fieldName: string,
    select?: Record<string, boolean>
  ): boolean {
    if (!select || Object.keys(select).length === 0) {
      return true;
    }
    return select[fieldName] === true;
  }

  private async expandComponentRelationships(
    componentData: Record<string, unknown>,
    componentSlug: string,
    componentFields: FieldConfig[],
    depth: number,
    currentDepth: number
  ): Promise<Record<string, unknown>> {
    if (!this.relationshipService) {
      return componentData;
    }

    if (depth === 0 || currentDepth >= depth) {
      return componentData;
    }

    try {
      // FieldConfig[] and FieldDefinition[] are structurally compatible
      // for the purposes of relationship expansion.
      const fields = componentFields as unknown as Parameters<
        typeof this.relationshipService.expandRelationships
      >[2];

      const expanded = await this.relationshipService.expandRelationships(
        componentData,
        `comp:${componentSlug}`,
        fields,
        { depth, currentDepth }
      );

      return expanded as Record<string, unknown>;
    } catch (error) {
      this.logger.debug("Could not expand relationships in component data", {
        componentSlug,
        error: error instanceof Error ? error.message : String(error),
      });
      return componentData;
    }
  }

  private async expandComponentRelationshipsMany(
    componentDataArray: Record<string, unknown>[],
    componentSlug: string,
    componentFields: FieldConfig[],
    depth: number,
    currentDepth: number
  ): Promise<Record<string, unknown>[]> {
    if (!this.relationshipService || depth === 0 || currentDepth >= depth) {
      return componentDataArray;
    }

    return Promise.all(
      componentDataArray.map(data =>
        this.expandComponentRelationships(
          data,
          componentSlug,
          componentFields,
          depth,
          currentDepth
        )
      )
    );
  }
}
