import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldConfig } from "../../../collections/fields/types";
import type { ComponentFieldConfig } from "../../../collections/fields/types/component";
import type { DynamicComponentRecord } from "../../../schemas/dynamic-components/types";
import type { CollectionRelationshipService } from "../../../services/collections/collection-relationship-service";
import type { ComponentRegistryService } from "../../../services/components/component-registry-service";
import { BaseService } from "../../../shared/base-service";
import { stripPasswordFieldValues } from "../../../shared/lib/password-fields";
import type { Logger } from "../../../shared/types";
import { populateCompanionFields } from "../../i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import {
  isValidLocale,
  resolveFallbackChain,
  resolveRequestedLocale,
} from "../../i18n/resolve-locale";
import { buildCompanionSchema } from "../../i18n/runtime/companion-io";

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

  /**
   * i18n: requested read locale. When set and an embedded component is localized, its
   * translatable fields resolve per language from the component's companion `_locales` table
   * (with fallback). Threaded down from the parent entity's read.
   */
  locale?: string;
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
  /** i18n: requested read locale (see PopulateComponentDataParams.locale). */
  locale?: string;
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
    relationshipService?: CollectionRelationshipService,
    // i18n: when set and an embedded component is localized, its translatable fields
    // resolve/write per language via the component's companion `comp_<slug>_locales` table.
    private readonly localization?: SanitizedLocalizationConfig
  ) {
    super(adapter, logger);
    this.registryService = registryService;
    this.relationshipService = relationshipService;
  }

  /**
   * i18n: overlay a localized component's translatable fields onto its deserialized
   * instance data from the companion `comp_<slug>_locales` table for the requested locale
   * (with fallback). No-op when localization is off, the component isn't localized, no
   * locale was requested, or it has no translatable fields. `dataArray` is mutated in place;
   * each item must carry the instance `id` (deserializeComponentRow sets it).
   */
  private async overlayLocalizedComponent(
    meta: DynamicComponentRecord,
    dataArray: Record<string, unknown>[],
    locale: string | undefined,
    fallbackLocale?: string | false
  ): Promise<void> {
    if (
      !this.localization ||
      locale === "all" ||
      meta.localized !== true ||
      dataArray.length === 0
    ) {
      return;
    }
    const companion = buildCompanionSchema({
      slug: meta.slug,
      tableName: meta.tableName,
      fields: meta.fields as { name: string; type: string }[],
      dialect: this.adapter.dialect,
      // Components are never Draft/Published — companion has no `_status`.
      status: false,
    });
    if (!companion) return;
    // Resolve an absent `locale` to the default (the parent read treats no explicit `?locale` as
    // the default locale), so a default-locale read still overlays the component's companion
    // values instead of returning the omitted main-table columns.
    const requested = resolveRequestedLocale(this.localization, locale);
    const localeChain = this.resolveComponentLocaleChain(
      requested,
      fallbackLocale
    );
    await populateCompanionFields({
      db: this.adapter.getDrizzle(),
      companionTable: companion.table,
      localizedFields: companion.localizedFields,
      rows: dataArray,
      localeChain,
      idKey: "id",
    });
    // JSON-backed localized fields (richText/group/repeater/json) are stored as serialized text
    // in the companion; parse them back so reads return object shapes, matching the main-table
    // deserialization the parent already ran before this overlay.
    const jsonLocalized = companion.localizedFields.filter(lf => {
      const def = meta.fields.find(f => "name" in f && f.name === lf.name);
      return def ? shouldTreatAsJson(def) : false;
    });
    if (jsonLocalized.length > 0) {
      for (const row of dataArray) {
        for (const lf of jsonLocalized) {
          const value = row[lf.name];
          if (typeof value === "string") {
            try {
              row[lf.name] = JSON.parse(value);
            } catch {
              // A non-JSON string (or already-parsed value) stays as-is.
            }
          }
        }
      }
    }
  }

  /**
   * Build the fallback chain for a component read, honoring a per-request `fallbackLocale`
   * (`false`/`"none"` disables fallback; a named locale overrides the configured chain),
   * mirroring the collection read path so the admin's no-fallback edit mode works for
   * embedded components too.
   */
  private resolveComponentLocaleChain(
    requested: string,
    fallbackLocale: string | false | undefined
  ): string[] {
    if (!this.localization) return [requested];
    if (fallbackLocale === false || fallbackLocale === "none") {
      return [requested];
    }
    if (
      typeof fallbackLocale === "string" &&
      isValidLocale(this.localization, fallbackLocale)
    ) {
      const seen = new Set<string>();
      return [
        requested,
        ...resolveFallbackChain(this.localization, fallbackLocale),
      ].filter(code => (seen.has(code) ? false : (seen.add(code), true)));
    }
    if (this.localization.fallback === false) return [requested];
    return resolveFallbackChain(this.localization, requested);
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
      locale,
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
            currentDepth,
            locale
          );
        } else if (field.component) {
          if (field.repeatable) {
            result[fieldName] = await this.populateRepeatableField(
              entryId,
              parentTable,
              fieldName,
              field.component,
              depth,
              currentDepth,
              locale
            );
          } else {
            result[fieldName] = await this.populateSingleField(
              entryId,
              parentTable,
              fieldName,
              field.component,
              depth,
              currentDepth,
              locale
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
      locale,
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
            currentDepth,
            locale
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
              currentDepth,
              locale
            );
            fieldDataMaps.set(field.name, dataMap);
          } else {
            const dataMap = await this.batchPopulateSingleField(
              entryIds,
              parentTable,
              field.name,
              field.component,
              depth,
              currentDepth,
              locale
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
    currentDepth: number,
    locale?: string
  ): Promise<Record<string, unknown> | null> {
    const meta = await this.registryService.getComponent(componentSlug);
    const componentFields = meta.fields;
    const rows = await this.getExistingInstances(
      meta.tableName,
      parentId,
      parentTable,
      fieldName
    );

    if (rows.length === 0) return null;

    let data = this.deserializeComponentRow(rows[0], componentFields, false);
    // i18n: overlay translatable fields from the companion for the requested locale.
    await this.overlayLocalizedComponent(meta, [data], locale);
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
    currentDepth: number,
    locale?: string
  ): Promise<Record<string, unknown>[]> {
    const meta = await this.registryService.getComponent(componentSlug);
    const componentFields = meta.fields;
    const rows = await this.getExistingInstances(
      meta.tableName,
      parentId,
      parentTable,
      fieldName
    );

    let dataArray = rows.map(row =>
      this.deserializeComponentRow(row, componentFields, false)
    );

    // i18n: overlay translatable fields per instance from the companion.
    await this.overlayLocalizedComponent(meta, dataArray, locale);

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
    currentDepth: number,
    locale?: string
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
          allRows.push({ row, fields: meta.fields, slug });
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
      // i18n: overlay translatable fields from the row's component companion. getComponent
      // is registry-cached, so the per-row meta lookup is cheap; dynamic-zone instances
      // may span several component types, each with its own companion.
      const meta = await this.registryService.getComponent(slug);
      await this.overlayLocalizedComponent(meta, [data], locale);
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
    currentDepth: number,
    locale?: string
  ): Promise<Map<string, unknown>> {
    const meta = await this.registryService.getComponent(componentSlug);
    const componentFields = meta.fields;
    const rows = await this.batchGetInstances(
      meta.tableName,
      parentIds,
      parentTable,
      fieldName
    );

    // Deserialize first (one per parent), i18n-overlay the whole batch in a single
    // companion query, THEN expand relationships — overlay must precede expansion
    // because expand may return a new object, breaking the mutate-in-place reference.
    const collected: { parentId: string; data: Record<string, unknown> }[] = [];
    for (const row of rows) {
      const parentId = row._parent_id;
      if (!collected.some(c => c.parentId === parentId)) {
        collected.push({
          parentId,
          data: this.deserializeComponentRow(row, componentFields, false),
        });
      }
    }
    await this.overlayLocalizedComponent(
      meta,
      collected.map(c => c.data),
      locale
    );

    const result = new Map<string, unknown>();
    for (const { parentId, data } of collected) {
      result.set(
        parentId,
        await this.expandComponentRelationships(
          data,
          componentSlug,
          componentFields,
          depth,
          currentDepth + 1
        )
      );
    }
    return result;
  }

  private async batchPopulateRepeatableField(
    parentIds: string[],
    parentTable: string,
    fieldName: string,
    componentSlug: string,
    depth: number,
    currentDepth: number,
    locale?: string
  ): Promise<Map<string, unknown>> {
    const meta = await this.registryService.getComponent(componentSlug);
    const componentFields = meta.fields;

    const rows = await this.batchGetInstances(
      meta.tableName,
      parentIds,
      parentTable,
      fieldName
    );

    // Deserialize all (rows arrive ordered by (_parent_id, _order)), overlay the whole
    // batch once, then expand — same ordering constraint as batchPopulateSingleField.
    const entries: { parentId: string; data: Record<string, unknown> }[] =
      rows.map(row => ({
        parentId: row._parent_id,
        data: this.deserializeComponentRow(row, componentFields, false),
      }));
    await this.overlayLocalizedComponent(
      meta,
      entries.map(e => e.data),
      locale
    );

    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const { parentId, data } of entries) {
      if (!grouped.has(parentId)) grouped.set(parentId, []);
      grouped
        .get(parentId)!
        .push(
          await this.expandComponentRelationships(
            data,
            componentSlug,
            componentFields,
            depth,
            currentDepth + 1
          )
        );
    }
    return grouped;
  }

  private async batchPopulateMultiComponentField(
    parentIds: string[],
    parentTable: string,
    fieldName: string,
    field: ComponentFieldConfig,
    depth: number,
    currentDepth: number,
    locale?: string
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
            fields: meta.fields,
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
        // i18n: overlay the instance's translatable fields from its component companion
        // before relationship expansion (registry-cached meta lookup).
        const itemMeta = await this.registryService.getComponent(slug);
        await this.overlayLocalizedComponent(itemMeta, [data], locale);
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

    // Password fields are write-only; strip stored hashes (including any
    // nested in group/repeater containers) before the instance is returned.
    stripPasswordFieldValues(result, componentFields);

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

      return expanded;
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
