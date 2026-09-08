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
import { toJsonColumnValue } from "../../../shared/lib/json-column-value";
import { hashPasswordFieldValues } from "../../../shared/lib/password-fields";
import type { Logger } from "../../../shared/types";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import { resolveRequestedLocale } from "../../i18n/resolve-locale";
import {
  buildCompanionSchema,
  splitLocalizedWrite,
  upsertCompanionRow,
} from "../../i18n/runtime/companion-io";
import {
  cachedCompanionReadiness,
  companionNotReadyMessage,
  resolveCompanionReadiness,
} from "../../i18n/runtime/companion-readiness";
import {
  isFieldGroupType,
  withResolvedFieldGroupReferences,
} from "../storage/field-group-field-type";
import {
  currentFieldGroupTypeKey,
  readFieldGroupType,
} from "../storage/field-group-type-key";

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

  /**
   * The parent write's request context, forwarded to the field validators that run on each
   * component instance. Carries `user` when the write is authenticated.
   *
   * A component instance is validated by its own pass, in its own service, against its own
   * field set — the parent entry's validation never reaches inside it. Without this the
   * instance pass runs with an empty context, so a field rule that reads `req.user` cannot
   * tell an authenticated write from an anonymous one and accepts both.
   *
   * The whole record rather than a bare `user`: it is what the validator receives, so
   * anything else the parent write puts on its request travels with it.
   */
  req?: Record<string, unknown>;
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
  return isFieldGroupType(field.type);
}

/**
 * The component instances a dynamic-zone payload actually contains.
 *
 * A repeatable zone sends an array; a non-repeatable one — the supported default — sends a
 * single object. The pre-transaction check and the write itself both need this answer, and
 * mirroring the normalisation by hand in each is what let them drift: the check read a
 * non-repeatable object as "no instances", so that slug's readiness was never resolved, and the
 * write then went looking for a companion table from inside the transaction. That is precisely
 * the failure the check exists to prevent.
 *
 * Deriving it once means the two cannot disagree about what a payload holds.
 */
function resolveZoneInstances(
  field: FieldGroupFieldConfig,
  value: unknown
): ComponentInstanceData[] {
  const raw = field.repeatable ? value : [value];
  return Array.isArray(raw) ? (raw as ComponentInstanceData[]) : [];
}

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
    // Inside a transaction the answer is READ, never resolved. Resolving issues a query, and a
    // query against a missing relation aborts the entire transaction on PostgreSQL — after which
    // the fallback write that follows dies with `current transaction is aborted`.
    //
    // An unknown answer there means "not usable", never "provisioned". The two are not equally
    // safe to guess wrong: not-usable takes the fallback, which writes to the main table and fails
    // loudly there if the columns are gone, whereas guessing provisioned splits the values out and
    // upserts into a table that may not exist — reintroducing the abort this avoids.
    // `assertLocalizedFieldGroupsWritable` has already resolved every slug this payload writes, so
    // an unknown answer here also means the two paths have drifted.
    const readiness = tx
      ? cachedCompanionReadiness(this.adapter, schema.companionTableName)
      : await resolveCompanionReadiness(this.adapter, {
          companionTableName: schema.companionTableName,
          mainTableName: meta.tableName,
          localizedColumns: schema.localizedFields.map(f => f.column),
        });
    const companionExists = readiness === "ready";
    if (!companionExists) {
      const writeLocale = resolveRequestedLocale(this.localization, locale);
      if (writeLocale !== this.localization.defaultLocale) {
        throw NextlyError.conflict({
          reason: "state",
          message: companionNotReadyMessage("field group"),
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
      // `broken` is the state where the fallback has nowhere to land. Only the pooled path can
      // reach that verdict: inside a parent transaction readiness is whatever was resolved before
      // it opened, and that pass has already refused this payload if the fallback was impossible.
      if (readiness === "broken") {
        throw NextlyError.conflict({
          reason: "state",
          message: companionNotReadyMessage("field group"),
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
      } else if (field && shouldTreatAsJson(field)) {
        // Same encoder as the main row: a companion holds the localized subset
        // of the same fields, so a scalar JSON document has to be written the
        // same way on both sides or a translation reads back differently from
        // the value it was translated from.
        out[column] = toJsonColumnValue(value);
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
   * Walk a payload's field-group fields with their references resolved.
   *
   * Both save paths — pooled and in-transaction — iterate the same fields the
   * same way: resolve the references at the boundary (a migrated definition
   * carries them under `fieldGroup` / `fieldGroups`, which the readers below
   * do not open), skip an absent value, clear on null, and hand a present
   * value to the path's own write. One iteration is what keeps the two paths
   * from drifting about what a payload holds.
   */
  private async eachFieldGroupWrite(
    fields: FieldConfig[],
    data: Record<string, unknown>,
    handlers: {
      clear: (field: FieldGroupFieldConfig) => Promise<void>;
      save: (field: FieldGroupFieldConfig, fieldData: unknown) => Promise<void>;
    }
  ): Promise<void> {
    for (const field of fields) {
      if (!isFieldGroupField(field)) continue;

      const f = withResolvedFieldGroupReferences(field);
      const fieldData = data[f.name];

      if (fieldData === undefined) continue;
      // On update, null means "clear this field" — delete existing instances
      if (fieldData === null) {
        await handlers.clear(f);
        continue;
      }
      await handlers.save(f, fieldData);
    }
  }

  /**
   * Save component data for all component fields of a parent entry.
   */
  async saveComponentData(params: SaveComponentDataParams): Promise<void> {
    const { parentId, parentTable, fields, data, locale, req } = params;

    await this.eachFieldGroupWrite(fields, data, {
      clear: async f => {
        await this.deleteFieldComponentData(parentId, parentTable, f.name, f);
      },
      save: async (f, fieldData) => {
        if (f.components && f.components.length > 0) {
          await this.saveMultiComponents({
            parentId,
            parentTable,
            fieldName: f.name,
            field: f,
            data: fieldData,
            locale,
            req,
          });
        } else if (f.component) {
          if (f.repeatable) {
            await this.saveRepeatableComponents({
              parentId,
              parentTable,
              fieldName: f.name,
              componentSlug: f.component,
              data: fieldData,
              locale,
              req,
            });
          } else {
            await this.saveSingleComponent({
              parentId,
              parentTable,
              fieldName: f.name,
              componentSlug: f.component,
              data: fieldData as ComponentInstanceData,
              locale,
              req,
            });
          }
        }
      },
    });
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
   * Idempotent and read-only — it resolves readiness and writes nothing to the database.
   *
   * Returns nothing. What it leaves behind is a resolved readiness verdict for every field-group
   * type this payload writes, which the in-transaction path then reads rather than asking for. An
   * explicit map used to carry that answer through three services and every intermediate helper;
   * the verdict is the same fact, kept where the question is asked.
   */
  async assertLocalizedFieldGroupsWritable(
    params: Pick<SaveComponentDataParams, "fields" | "data" | "locale">
  ): Promise<void> {
    if (!this.localization) return;
    const resolved = new Set<string>();
    for (const field of params.fields) {
      if (!isFieldGroupField(field)) continue;

      // Same boundary resolution the write performs, so the references this
      // check warms and judges are the ones the write will read.
      const f = withResolvedFieldGroupReferences(field);

      // Warming comes FIRST, before the payload is consulted at all. A snapshot reads every
      // component the entity holds, not the ones this save happens to mention, and it reads them
      // through the caller's transaction where readiness can only be read and never resolved. A
      // field omitted from the payload entirely is the commonest way to reach that state, so
      // skipping it here would leave its components with no verdict and their translated values
      // missing from the durable record.
      //
      // Warming is not refusing. The refusal below still walks only what the payload writes,
      // because a permitted type whose companion is missing must not fail a save that never
      // mentions it.
      for (const permitted of f.components ?? [f.component]) {
        if (typeof permitted !== "string") continue;
        await this.resolveComponentReadiness(permitted);
      }

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
      if (f.components && f.components.length > 0) {
        for (const instance of resolveZoneInstances(field, value)) {
          // Asked through the same reader the WRITE uses. This preflight exists to raise a
          // conflict before the transaction opens, so it has to judge exactly the instances the
          // write will accept — an instance the write recognises but this does not skips the
          // check entirely and fails later, inside the transaction or at the driver.
          const type = readFieldGroupType(instance);
          if (type !== undefined && f.components.includes(type)) {
            slugs.add(type);
          }
        }
      } else if (f.component) {
        slugs.add(f.component);
      }
      for (const slug of slugs) {
        if (resolved.has(slug)) continue;
        resolved.add(slug);
        const meta = await this.registryService.getComponentBySlug(slug);
        if (!meta || meta.localized !== true) continue;
        // Reuse the same split the write performs: it raises the 409 when the
        // companion is missing and the fallback is unavailable, which is exactly the
        // decision needed here — and on the pooled adapter, outside any transaction.
        // Resolving it here is also what the write inside the transaction reads back,
        // so it never has to ask a question that would abort the transaction to answer.
        await this.splitLocalizedComponent(meta, {}, params.locale);
      }
    }
  }

  /**
   * Resolve one field group's companion readiness on the pooled connection, without judging it.
   *
   * Warming only: the caller decides what an unusable companion means, and for a type this write
   * does not touch the answer is simply "nothing to do". What matters is that the verdict exists
   * before a transaction opens, because inside one it can only be read.
   */
  private async resolveComponentReadiness(slug: string): Promise<void> {
    const meta = await this.registryService.getComponentBySlug(slug);
    if (!meta || meta.localized !== true) return;
    const schema = buildCompanionSchema({
      slug: meta.slug,
      tableName: meta.tableName,
      fields: meta.fields as { name: string; type: string }[],
      dialect: this.adapter.dialect,
      status: false,
    });
    if (!schema) return;
    await resolveCompanionReadiness(this.adapter, {
      companionTableName: schema.companionTableName,
      mainTableName: meta.tableName,
      localizedColumns: schema.localizedFields.map(f => f.column),
    });
  }

  async saveComponentDataInTransaction(
    tx: TransactionContext,
    params: SaveComponentDataParams
  ): Promise<void> {
    const { parentId, parentTable, fields, data, locale, req } = params;

    await this.eachFieldGroupWrite(fields, data, {
      clear: async f => {
        await this.deleteFieldComponentDataInTx(
          tx,
          parentId,
          parentTable,
          f.name,
          f
        );
      },
      save: async (f, fieldData) => {
        if (f.components && f.components.length > 0) {
          await this.saveMultiComponentsInTx(tx, {
            parentId,
            parentTable,
            fieldName: f.name,
            field: f,
            data: fieldData,
            locale,
            req,
          });
        } else if (f.component) {
          if (f.repeatable) {
            await this.saveRepeatableComponentsInTx(tx, {
              parentId,
              parentTable,
              fieldName: f.name,
              componentSlug: f.component,
              data: fieldData,
              locale,
              req,
            });
          } else {
            await this.saveSingleComponentInTx(tx, {
              parentId,
              parentTable,
              fieldName: f.name,
              componentSlug: f.component,
              data: fieldData as ComponentInstanceData,
              locale,
              req,
            });
          }
        }
      },
    });
  }

  /**
   * Delete all component data for a parent entry.
   */
  async deleteComponentData(params: DeleteComponentDataParams): Promise<void> {
    const { parentId, parentTable, fields } = params;

    for (const field of fields) {
      if (!isFieldGroupField(field)) continue;

      // Same boundary resolution as the save paths: the row cleanup finds the
      // tables through the field's slugs, which a migrated definition carries
      // under fieldGroup / fieldGroups — unresolved, every nested row the
      // entry owns would be orphaned here.
      const f = withResolvedFieldGroupReferences(field);

      await this.deleteFieldComponentData(parentId, parentTable, f.name, f);
    }
  }

  async deleteComponentDataInTransaction(
    tx: TransactionContext,
    params: DeleteComponentDataParams
  ): Promise<void> {
    const { parentId, parentTable, fields } = params;

    for (const field of fields) {
      if (!isFieldGroupField(field)) continue;

      // Same boundary resolution as the pooled delete path above.
      const f = withResolvedFieldGroupReferences(field);

      await this.deleteFieldComponentDataInTx(
        tx,
        parentId,
        parentTable,
        f.name,
        f
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
    req?: Record<string, unknown>;
  }): Promise<void> {
    const {
      parentId,
      parentTable,
      fieldName,
      componentSlug,
      data,
      locale,
      req,
    } = params;

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
        existing.length > 0 ? "update" : "create",
        req
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
      req?: Record<string, unknown>;
    }
  ): Promise<void> {
    const {
      parentId,
      parentTable,
      fieldName,
      componentSlug,
      data,
      locale,
      req,
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
        existing.length > 0 ? "update" : "create",
        req
      );

      // i18n: split translatable values out of the main comp_ write (companion-owned).
      const { schema, main, companion } = await this.splitLocalizedComponent(
        componentMeta,
        data,
        locale,
        // Never probe from in here: the answer was resolved before this transaction
        // opened, because asking now would mean querying a possibly-absent relation,
        // and on PostgreSQL that aborts the transaction outright.
        { adapter: this.txWriteAdapter(tx) }
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
    req?: Record<string, unknown>;
  }): Promise<void> {
    const {
      parentId,
      parentTable,
      fieldName,
      componentSlug,
      data,
      locale,
      req,
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
          instanceId && existingMap.has(instanceId) ? "update" : "create",
          req
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
      req?: Record<string, unknown>;
    }
  ): Promise<void> {
    const {
      parentId,
      parentTable,
      fieldName,
      componentSlug,
      data,
      locale,
      req,
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
          { adapter: this.txWriteAdapter(tx) }
        );

        await this.prepareInstanceForWrite(
          instance,
          componentFields,
          instanceId && existingMap.has(instanceId) ? "update" : "create",
          req
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
    req?: Record<string, unknown>;
  }): Promise<void> {
    const { parentId, parentTable, fieldName, field, data, locale, req } =
      params;
    const allowedSlugs = field.components ?? [];

    // Shared with the pre-transaction check, so the two cannot disagree about which
    // instances this payload holds.
    const instances = resolveZoneInstances(field, data);

    if (instances.length === 0 && data !== null && data !== undefined) {
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
        // Asked rather than indexed: an instance written under the other spelling of this key
        // would otherwise read as missing, and a missing type is DROPPED below.
        const componentType = readFieldGroupType(instance);

        if (!componentType) {
          this.logger.warn(
            `Multi-component instance missing ${currentFieldGroupTypeKey}`,
            {
              fieldName,
              index: i,
            }
          );
          continue;
        }

        if (!allowedSlugs.includes(componentType)) {
          this.logger.warn(
            `Multi-component instance has invalid ${currentFieldGroupTypeKey}`,
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
          instanceId && globalExistingMap.has(instanceId) ? "update" : "create",
          req
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
      req?: Record<string, unknown>;
    }
  ): Promise<void> {
    const { parentId, parentTable, fieldName, field, data, locale, req } =
      params;
    const allowedSlugs = field.components ?? [];

    // Shared with the pre-transaction check, so the two cannot disagree about which
    // instances this payload holds.
    const instances = resolveZoneInstances(field, data);

    if (instances.length === 0 && data !== null && data !== undefined) {
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
        // Asked rather than indexed, for the same reason: an unresolved type skips the row.
        const componentType = readFieldGroupType(instance);

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
          { adapter: this.txWriteAdapter(tx) }
        );

        await this.prepareInstanceForWrite(
          instance,
          componentFields,
          instanceId && globalExistingMap.has(instanceId) ? "update" : "create",
          req
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
   *
   * `req` is the parent write's request context. It reaches the field
   * validators unchanged, so a rule on a component field sees the same `user`
   * a rule on a top-level field would. Defaults to an empty record: a caller
   * with no request (an internal write, a seed) supplies no context, which is
   * what an unauthenticated write looks like anyway.
   */
  private async prepareInstanceForWrite(
    instance: ComponentInstanceData,
    componentFields: FieldConfig[],
    mode: "create" | "update",
    req: Record<string, unknown> = {}
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

    const issues = await validateEntryData(instance, componentFields, {
      mode,
      req,
    });
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

      result[columnName] = shouldTreatAsJson(field)
        ? toJsonColumnValue(value)
        : value;
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
