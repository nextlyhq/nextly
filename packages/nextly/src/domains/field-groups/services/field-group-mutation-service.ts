import crypto from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";

import type { FieldConfig } from "../../../collections/fields/types";
import type { FieldGroupFieldConfig } from "../../../collections/fields/types/component";
import { toDbError } from "../../../database/errors";
// Database failures cross this boundary through `NextlyError.fromDatabaseError`,
// and rethrow guards use `NextlyError.is(...)` so an error travelling through
// the shim keeps its original type.
import { NextlyError } from "../../../errors";
import type { DynamicFieldGroupRecord } from "../../../schemas/dynamic-field-groups/types";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { FieldGroupRegistryService } from "../../../services/field-groups/field-group-registry-service";
import { BaseService } from "../../../shared/base-service";
import { validateEntryData } from "../../../shared/lib/entry-validation";
import {
  coerceDateFieldsToDate,
  normalizeRelationshipFields,
} from "../../../shared/lib/field-transform";
import { hashPasswordFieldValues } from "../../../shared/lib/password-fields";
import type { Logger } from "../../../shared/types";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import { resolveRequestedLocale } from "../../i18n/resolve-locale";
import {
  buildCompanionSchema,
  companionTableExists,
  mainTableHasColumn,
  splitLocalizedWrite,
  upsertCompanionRow,
} from "../../i18n/runtime/companion-io";

import {
  COMPONENT_META_KEYS,
  toSnakeCase,
  shouldTreatAsJson,
  type ComponentRow,
  type ComponentInstanceData,
} from "./field-group-utils";

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

function isFieldGroupField(field: FieldConfig): field is FieldGroupFieldConfig {
  return field.type === STORAGE_FORMAT.fieldType;
}

/**
 * Whether each localized field group's companion table physically exists, keyed by slug and
 * resolved BEFORE the write transaction opens.
 *
 * This answers a question that cannot be asked again once a transaction is open. Probing for
 * a relation that does not exist raises an error, and PostgreSQL marks the entire transaction
 * aborted the moment one does — so although the probe catches it and reports "absent", every
 * following statement fails with `current transaction is aborted`. Carrying the pre-resolved
 * answer in is what lets the in-transaction path know without asking.
 */
export type FieldGroupCompanionPresence = ReadonlyMap<string, boolean>;

export class FieldGroupMutationService extends BaseService {
  private readonly registryService: FieldGroupRegistryService;

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    registryService: FieldGroupRegistryService,
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
  private async splitLocalizedComponent(
    meta: DynamicFieldGroupRecord,
    data: Record<string, unknown>,
    locale: string | undefined,
    // Present only on the in-transaction path. Both members travel together by design:
    // inside a transaction the companion's existence must ALREADY be known, because asking
    // again means probing a possibly-absent relation, and on PostgreSQL that aborts the
    // whole transaction. Omitted on the pooled path, which is free to probe.
    tx?: {
      adapter: {
        dialect: SupportedDialect;
        executeQuery<T = unknown>(
          sql: string,
          params?: unknown[]
        ): Promise<T[]>;
      };
      presence: FieldGroupCompanionPresence;
    }
  ): Promise<{
    schema: ReturnType<typeof buildCompanionSchema>;
    main: Record<string, unknown>;
    companion: Record<string, unknown>;
    /** Whether the companion physically exists, so callers can reuse it without re-probing. */
    companionExists: boolean;
  }> {
    if (!this.localization || meta.localized !== true) {
      return {
        schema: null,
        main: data,
        companion: {},
        companionExists: false,
      };
    }
    const schema = buildCompanionSchema({
      slug: meta.slug,
      tableName: meta.tableName,
      fields: meta.fields as { name: string; type: string }[],
      dialect: this.adapter.dialect,
      status: false,
    });
    if (!schema)
      return {
        schema: null,
        main: data,
        companion: {},
        companionExists: false,
      };
    // Resolve existence BEFORE splitting. Splitting first and then discovering the
    // companion is absent strands the translatable values: they leave the main payload
    // and the upsert that would have taken them is skipped, so the write reports success
    // having saved nothing. Resolving here also means any refusal is raised before the
    // caller opens its transaction, so it leaves exactly as raised rather than through
    // the adapter's error classification, which rewraps anything that is not already a
    // `DatabaseError`.
    //
    // Inside a transaction the answer is READ, never probed. A probe against a missing
    // relation aborts the entire transaction on PostgreSQL — the error is caught here but
    // the connection is already poisoned, so the fallback write that follows would die
    // with `current transaction is aborted`. `?? true` is unreachable in practice, since
    // the pre-transaction pass walks exactly the slugs this write touches; assuming
    // "provisioned" is the safe way to be wrong, because it fails loudly and atomically
    // instead of quietly writing translatable values to the wrong table.
    const companionExists = tx
      ? (tx.presence.get(meta.slug) ?? true)
      : await companionTableExists(this.adapter, schema.companionTableName);
    if (!companionExists) {
      const writeLocale = resolveRequestedLocale(this.localization, locale);
      if (writeLocale !== this.localization.defaultLocale) {
        throw NextlyError.conflict({
          reason: "state",
          message:
            "Translations are not ready for this field group yet. Restart the app (or re-run `nextly db:sync`) to create its translation table, then try again.",
          logContext: {
            cause: "localized-write-without-companion",
            fieldGroupTable: schema.companionTableName,
            locale: writeLocale,
          },
        });
      }
      // Default language keeps the pre-companion fallback — but only where it can
      // actually work. A field group whose main `comp_*` table never had these
      // columns (localized from creation, or already migrated) would otherwise take
      // this branch and hand the values to a table with nowhere to put them, which
      // fails at the driver as a 500. Refusing turns that into an answer the caller
      // can act on.
      // Only introspect on the pooled path. Inside a parent transaction this would
      // borrow a second connection and deadlock a single-connection pool — and it does
      // not need to, because `assertLocalizedFieldGroupsWritable` has already answered
      // the same question before that transaction opened.
      const fallbackPossible =
        tx !== undefined ||
        (await mainTableHasColumn(
          this.adapter,
          meta.tableName,
          schema.localizedFields[0]?.column
        ));
      if (!fallbackPossible) {
        throw NextlyError.conflict({
          reason: "state",
          message:
            "Translations are not ready for this field group yet. Restart the app (or re-run `nextly db:sync`) to create its translation table, then try again.",
          logContext: {
            cause: "localized-write-without-companion",
            fieldGroupTable: schema.companionTableName,
            locale: writeLocale,
          },
        });
      }
      return { schema: null, main: data, companion: {}, companionExists };
    }
    const { main, companion } = splitLocalizedWrite(
      data,
      schema.localizedFields
    );
    // The main row goes through serializeComponentRow, but the companion is upserted directly.
    // Serialize the companion values the same way so a JSON-backed localized field (richText/
    // group/json) is JSON-stringified and a Date is stored as text, not written as a raw object.
    return {
      schema,
      main,
      companion: this.serializeCompanionValues(companion, schema, meta.fields),
      companionExists,
    };
  }

  /**
   * Serialize a localized component's companion payload (keyed by snake_case column) so its
   * values match the storage form serializeComponentRow produces for the main row: object
   * values for JSON-backed fields become JSON strings; Date values become ISO strings.
   */
  private serializeCompanionValues(
    companion: Record<string, unknown>,
    schema: NonNullable<ReturnType<typeof buildCompanionSchema>>,
    fields: FieldConfig[]
  ): Record<string, unknown> {
    const fieldByColumn = new Map<string, FieldConfig>();
    for (const lf of schema.localizedFields) {
      const field = fields.find(f => "name" in f && f.name === lf.name);
      if (field) fieldByColumn.set(lf.column, field);
    }
    const out: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(companion)) {
      const field = fieldByColumn.get(column);
      if (value instanceof Date) {
        out[column] = value.toISOString();
      } else if (
        field &&
        shouldTreatAsJson(field) &&
        value != null &&
        typeof value === "object"
      ) {
        out[column] = JSON.stringify(value);
      } else {
        out[column] = value;
      }
    }
    return out;
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
      if (!isFieldGroupField(field)) continue;

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

  /**
   * Answer, BEFORE the caller opens its transaction, whether every localized field group in
   * this payload can actually be written.
   *
   * Two reasons it cannot wait until the write itself. The probes borrow a connection from the
   * pool, so running them inside the parent transaction waits for a connection that cannot be
   * released until that transaction finishes; and answering here keeps a refusal exactly as
   * raised, rather than passing it through the adapter's error classification on the way out of
   * a transaction callback, which rewraps anything that is not already a `DatabaseError`.
   *
   * Idempotent and read-only — it introspects and probes, and writes nothing.
   */
  async assertLocalizedFieldGroupsWritable(
    params: Pick<SaveComponentDataParams, "fields" | "data" | "locale">
  ): Promise<FieldGroupCompanionPresence> {
    const presence = new Map<string, boolean>();
    if (!this.localization) return presence;
    for (const field of params.fields) {
      if (!isFieldGroupField(field)) continue;
      const value = params.data[field.name];
      if (value === undefined || value === null) continue;
      // Mirror `saveComponentData`'s dispatch exactly, including its precedence: a field
      // carrying both `components` and `component` is written as a dynamic zone, so
      // deciding `component` first here would check a type the write never touches.
      //
      // For a dynamic zone the type travels per instance, so the PAYLOAD decides what is
      // written, not the field's list of permitted types. Walking the permitted list
      // instead would probe types absent from this write — and would refuse a perfectly
      // good save whenever some other permitted type happened to be missing its
      // companion. Deduplicated, because a zone commonly repeats one type.
      const slugs = new Set<string>();
      if (field.components && field.components.length > 0) {
        for (const instance of Array.isArray(value) ? value : []) {
          const type = (instance as Record<string, unknown> | null)?.[
            STORAGE_FORMAT.wireTypeKey
          ];
          if (typeof type === "string" && field.components.includes(type)) {
            slugs.add(type);
          }
        }
      } else if (field.component) {
        slugs.add(field.component);
      }
      for (const slug of slugs) {
        if (presence.has(slug)) continue;
        const meta = await this.registryService.getComponentBySlug(slug);
        if (!meta || meta.localized !== true) continue;
        // Reuse the same split the write performs: it raises the 409 when the
        // companion is missing and the fallback is unavailable, which is exactly the
        // decision needed here — and on the pooled adapter, outside any transaction.
        // Its verdict on existence is then carried into the transaction, so the write
        // never has to ask a question that would abort the transaction to answer.
        const { companionExists } = await this.splitLocalizedComponent(
          meta,
          {},
          params.locale
        );
        presence.set(slug, companionExists);
      }
    }
    return presence;
  }

  async saveComponentDataInTransaction(
    tx: TransactionContext,
    params: SaveComponentDataParams,
    // Resolved by `assertLocalizedFieldGroupsWritable` before this transaction opened.
    // Required rather than optional: inside a transaction there is no safe way to work it
    // out, since probing a missing companion aborts the transaction on PostgreSQL.
    presence: FieldGroupCompanionPresence
  ): Promise<void> {
    const { parentId, parentTable, fields, data, locale } = params;

    for (const field of fields) {
      if (!isFieldGroupField(field)) continue;

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
          presence,
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
            presence,
          });
        } else {
          await this.saveSingleComponentInTx(tx, {
            parentId,
            parentTable,
            fieldName,
            componentSlug: field.component,
            data: fieldData as ComponentInstanceData,
            locale,
            presence,
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
      if (!isFieldGroupField(field)) continue;

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
      if (!isFieldGroupField(field)) continue;

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

      const existing = await this.getExistingInstances(
        tableName,
        parentId,
        parentTable,
        fieldName
      );

      // Hash/prepare password fields on `data` BEFORE splitting: splitLocalizedComponent
      // copies `main`/`companion` from `data` by value, so hashing after the split would
      // leave the pre-hash plaintext in `main` and write it to the comp_ row.
      await this.prepareInstanceForWrite(
        data,
        componentFields,
        existing.length > 0 ? "update" : "create"
      );

      // i18n: split translatable values out of the main comp_ write — they live on the
      // companion. `main === data` when the component isn't localized (unchanged path).
      const { schema, main, companion } = await this.splitLocalizedComponent(
        componentMeta,
        data,
        locale
      );

      let instanceId: string;
      if (existing.length > 0) {
        instanceId = existing[0].id;
        const updateData = this.serializeComponentRow(main, componentFields);
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
        await this.upsertLocalizedComponent(
          schema,
          instanceId,
          companion,
          locale
        );
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
      presence: FieldGroupCompanionPresence;
    }
  ): Promise<void> {
    const {
      parentId,
      parentTable,
      fieldName,
      componentSlug,
      data,
      locale,
      presence,
    } = params;

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

      // Hash/prepare password fields on `data` BEFORE splitting: splitLocalizedComponent
      // copies `main`/`companion` from `data` by value, so hashing after the split would
      // leave the pre-hash plaintext in `main` and write it to the comp_ row.
      await this.prepareInstanceForWrite(
        data,
        componentFields,
        existing.length > 0 ? "update" : "create"
      );

      // i18n: split translatable values out of the main comp_ write (companion-owned).
      const { schema, main, companion } = await this.splitLocalizedComponent(
        componentMeta,
        data,
        locale,
        // Never probe from in here: the answer was resolved before this transaction
        // opened, because asking now would mean querying a possibly-absent relation,
        // and on PostgreSQL that aborts the transaction outright.
        { adapter: this.txWriteAdapter(tx), presence }
      );

      let instanceId: string;
      if (existing.length > 0) {
        instanceId = existing[0].id;
        const updateData = this.serializeComponentRow(main, componentFields);
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
        const { schema, main, companion } = await this.splitLocalizedComponent(
          componentMeta,
          instance,
          locale
        );

        await this.prepareInstanceForWrite(
          instance,
          componentFields,
          instanceId && existingMap.has(instanceId) ? "update" : "create"
        );

        if (instanceId && existingMap.has(instanceId)) {
          incomingIds.add(instanceId);
          const updateData = this.serializeComponentRow(main, componentFields);
          updateData[STORAGE_FORMAT.columns.order] = i;
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
      presence: FieldGroupCompanionPresence;
    }
  ): Promise<void> {
    const {
      parentId,
      parentTable,
      fieldName,
      componentSlug,
      data,
      locale,
      presence,
    } = params;

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
        const { schema, main, companion } = await this.splitLocalizedComponent(
          componentMeta,
          instance,
          locale,
          // Never probe from in here: the answer was resolved before this transaction
          // opened, because asking now would mean querying a possibly-absent relation,
          // and on PostgreSQL that aborts the transaction outright.
          { adapter: this.txWriteAdapter(tx), presence }
        );

        await this.prepareInstanceForWrite(
          instance,
          componentFields,
          instanceId && existingMap.has(instanceId) ? "update" : "create"
        );

        if (instanceId && existingMap.has(instanceId)) {
          incomingIds.add(instanceId);
          const updateData = this.serializeComponentRow(main, componentFields);
          updateData[STORAGE_FORMAT.columns.order] = i;
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
    field: FieldGroupFieldConfig;
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
      const metaCache = new Map<string, DynamicFieldGroupRecord>();

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
        const componentType = instance[STORAGE_FORMAT.wireTypeKey];

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
        const { schema, main, companion } = await this.splitLocalizedComponent(
          meta,
          instance,
          locale
        );

        await this.prepareInstanceForWrite(
          instance,
          componentFields,
          instanceId && globalExistingMap.has(instanceId) ? "update" : "create"
        );

        if (instanceId && globalExistingMap.has(instanceId)) {
          incomingIds.add(instanceId);
          const updateData = this.serializeComponentRow(main, componentFields);
          updateData[STORAGE_FORMAT.columns.order] = i;
          updateData[STORAGE_FORMAT.columns.type] = componentType;
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
      field: FieldGroupFieldConfig;
      data: unknown;
      locale?: string;
      presence: FieldGroupCompanionPresence;
    }
  ): Promise<void> {
    const { parentId, parentTable, fieldName, field, data, locale, presence } =
      params;
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
      const metaCache = new Map<string, DynamicFieldGroupRecord>();

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
        const componentType = instance[STORAGE_FORMAT.wireTypeKey];

        if (!componentType || !allowedSlugs.includes(componentType)) continue;

        const meta = metaCache.get(componentType);
        if (!meta) continue;

        const tableName = meta.tableName;
        const componentFields = meta.fields;
        const instanceId = instance.id;
        // i18n: split translatable values out per instance using its own component meta.
        const { schema, main, companion } = await this.splitLocalizedComponent(
          meta,
          instance,
          locale,
          // Never probe from in here: the answer was resolved before this transaction
          // opened, because asking now would mean querying a possibly-absent relation,
          // and on PostgreSQL that aborts the transaction outright.
          { adapter: this.txWriteAdapter(tx), presence }
        );

        await this.prepareInstanceForWrite(
          instance,
          componentFields,
          instanceId && globalExistingMap.has(instanceId) ? "update" : "create"
        );

        if (instanceId && globalExistingMap.has(instanceId)) {
          incomingIds.add(instanceId);
          const updateData = this.serializeComponentRow(main, componentFields);
          updateData[STORAGE_FORMAT.columns.order] = i;
          updateData[STORAGE_FORMAT.columns.type] = componentType;
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
    field: FieldGroupFieldConfig
  ): Promise<void> {
    const slugs = this.getComponentSlugs(field);

    for (const slug of slugs) {
      try {
        const meta = await this.registryService.getComponent(slug);
        await this.adapter.delete(
          meta.tableName,
          this.whereAnd({
            [STORAGE_FORMAT.columns.parentId]: parentId,
            [STORAGE_FORMAT.columns.parentTable]: parentTable,
            [STORAGE_FORMAT.columns.parentField]: fieldName,
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
    field: FieldGroupFieldConfig
  ): Promise<void> {
    const slugs = this.getComponentSlugs(field);

    for (const slug of slugs) {
      try {
        // Resolve the component on the transaction's own connection: on a small
        // pool the delete transaction already holds the only connection, so a
        // pooled registry read here could wait on itself and hang the delete.
        const meta = await this.registryService.getComponent(
          slug,
          tx.getDrizzle()
        );
        await tx.delete(
          meta.tableName,
          this.whereAnd({
            [STORAGE_FORMAT.columns.parentId]: parentId,
            [STORAGE_FORMAT.columns.parentTable]: parentTable,
            [STORAGE_FORMAT.columns.parentField]: fieldName,
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
          [STORAGE_FORMAT.columns.parentId]: parentId,
          [STORAGE_FORMAT.columns.parentTable]: parentTable,
          [STORAGE_FORMAT.columns.parentField]: fieldName,
        }),
        orderBy: [{ column: STORAGE_FORMAT.columns.order, direction: "asc" }],
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
          [STORAGE_FORMAT.columns.parentId]: parentId,
          [STORAGE_FORMAT.columns.parentTable]: parentTable,
          [STORAGE_FORMAT.columns.parentField]: fieldName,
        }),
        orderBy: [{ column: STORAGE_FORMAT.columns.order, direction: "asc" }],
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
      [STORAGE_FORMAT.columns.parentId]: parentId,
      [STORAGE_FORMAT.columns.parentTable]: parentTable,
      [STORAGE_FORMAT.columns.parentField]: fieldName,
      [STORAGE_FORMAT.columns.order]: order,
      [STORAGE_FORMAT.columns.type]: componentType,
      ...serializedFields,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Enforce the component schema on an instance before it is persisted.
   * Component instances live in their own tables, so the parent entry's
   * validate/hash pass never reaches them; without this, required / length /
   * range / option rules on component fields go unchecked server-side and a
   * `password` field inside a component would be stored in plaintext.
   * Validation runs before hashing so length rules see the plaintext value,
   * matching the parent entry pipeline. `mode` is "update" for an instance
   * that already exists (so a write-only password left empty keeps the stored
   * hash) and "create" for a new one.
   */
  private async prepareInstanceForWrite(
    instance: ComponentInstanceData,
    componentFields: FieldConfig[],
    mode: "create" | "update"
  ): Promise<void> {
    // A component instance must be a plain object. A primitive (e.g. a bare
    // string sent for a non-repeatable component field) would make the field
    // validator's `field.name in data` throw a TypeError, surfacing as a 500
    // instead of a validation error, so reject the shape up front.
    const value: unknown = instance;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw NextlyError.validation({
        errors: [
          {
            path: "",
            code: "INVALID_TYPE",
            message: "Component data must be an object.",
          },
        ],
      });
    }
    // Reduced in place, and before validation, because both halves of the write
    // depend on it. A validator is written against a field's public value, the
    // document id, and would otherwise be handed the populated row. The
    // localized split then copies values out of this same object into the
    // companion payload, which never reaches `serializeComponentRow` — so a
    // reference left populated here is stored there as a snapshot of the row.
    normalizeRelationshipFields(instance, componentFields);

    const issues = await validateEntryData(instance, componentFields, { mode });
    if (issues.length > 0) {
      throw NextlyError.validation({ errors: issues });
    }
    await hashPasswordFieldValues(instance, componentFields);
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

    // A relationship read at depth comes back populated, and a multi-target one
    // as `{ relationTo, value: row }`. Serializing that as it arrives would
    // store a snapshot of the related row in the column, which later reads
    // would serve in place of reloading the target.
    normalizeRelationshipFields(data, fields);

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

  private getComponentSlugs(field: FieldGroupFieldConfig): string[] {
    if (field.components && field.components.length > 0) {
      return field.components;
    }
    if (field.component) {
      return [field.component];
    }
    return [];
  }
}
