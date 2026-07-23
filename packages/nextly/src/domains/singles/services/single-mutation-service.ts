/**
 * Single Mutation Service
 *
 * Write-path service for Single documents. Handles:
 *
 * - Registry lookup via SingleRegistryService
 * - RBAC access evaluation (`update` operation)
 * - Before/after update hooks
 * - Extraction of component field data into separate comp_{slug} tables
 * - Upload field normalization (strips expanded media objects down to IDs)
 * - JSON field serialization for storage
 * - Post-update document reload with media and relationship expansion
 *
 * Delegates auto-creation, deserialization, upload expansion, and
 * relationship expansion to SingleQueryService so that the read/write
 * paths share a single implementation of those helpers.
 *
 * @module domains/singles/services/single-mutation-service
 * @since 1.0.0
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { actorForWrite } from "../../../auth/request-actor";
import { isComponentField } from "../../../collections/fields/guards";
import type { FieldConfig } from "../../../collections/fields/types";
import type { RBACAccessControlService } from "../../../domains/auth/services/rbac-access-control-service";
import { NextlyError } from "../../../errors/nextly-error";
import type { HookRegistry } from "../../../hooks/hook-registry";
import { keysToSnakeCase } from "../../../lib/case-conversion";
import { AccessControlService } from "../../../services/access";
import type { ComponentDataService } from "../../../services/components/component-data-service";
import { BaseService } from "../../../shared/base-service";
import { convertTimestampsToCamelCase } from "../../../shared/lib/case-conversion";
import { validateEntryData } from "../../../shared/lib/entry-validation";
import {
  applyFieldReadAccess,
  applyFieldWriteAccess,
  attachFieldValidators,
  runFieldHooks,
} from "../../../shared/lib/field-level-registry";
import { coerceDateFieldsToDate } from "../../../shared/lib/field-transform";
import {
  hashPasswordFieldValues,
  stripPasswordFieldValues,
  stripSystemOwnerField,
} from "../../../shared/lib/password-fields";
import type { Logger } from "../../../shared/types";
import { populateCompanionFields } from "../../i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import {
  isValidLocale,
  resolveRequestedLocale,
} from "../../i18n/resolve-locale";
import {
  buildCompanionSchema,
  splitLocalizedWrite,
  upsertCompanionRow,
  type CompanionSchema,
} from "../../i18n/runtime/companion-io";
import { captureInTx } from "../../versions/capture-in-tx";
import {
  resolveComponentFieldMap,
  tagComponentTypes,
  tagNestedComponentTypes,
} from "../../versions/tag-component-types";
import { VersionCaptureService } from "../../versions/version-capture-service";
import { withVersionConflictRetry } from "../../versions/version-conflict";
import { expandComponentFields } from "../../webhooks/expand-component-fields";
import { recordMutationEvent } from "../../webhooks/record-mutation-event";
import type { WebhookResource } from "../../webhooks/types";
import type {
  SingleDocument,
  SingleResult,
  UpdateSingleOptions,
} from "../types";

import {
  SingleQueryService,
  buildSingleHookContext,
  checkSingleAccess,
  getSingleHookCollection,
  resolveNextlyForHooks,
} from "./single-query-service";
import type { SingleRegistryService } from "./single-registry-service";
import {
  buildSingleErrorResult,
  normalizeUploadFields,
  serializeJsonFields,
  shouldTreatAsJson,
} from "./single-utils";

/**
 * SingleMutationService
 *
 * Handles the write-path for Single documents. The get-style helpers
 * needed before/after the update (auto-creation, deserialization,
 * upload/relationship expansion) are delegated to the companion
 * SingleQueryService, which is constructed from the same dependencies.
 */
export class SingleMutationService extends BaseService {
  private readonly queryService: SingleQueryService;

  /** Evaluator for a Single's stored access rules (stateless, zero-arg). */
  private readonly accessControlService: AccessControlService;

  /**
   * Stateless version-capture service. Records a durable version snapshot
   * inside the update transaction when the single opts into versioning.
   */
  private readonly versionCapture = new VersionCaptureService();

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly singleRegistryService: SingleRegistryService,
    private readonly hookRegistry: HookRegistry,
    private readonly componentDataService?: ComponentDataService,
    private readonly rbacAccessControlService?: RBACAccessControlService,
    // i18n: when set and the single is localized, writes route translatable field
    // values to the companion `single_<slug>_locales` row for the write's locale.
    private readonly localization?: SanitizedLocalizationConfig,
    accessControlService?: AccessControlService
  ) {
    super(adapter, logger);
    this.accessControlService =
      accessControlService ?? new AccessControlService();
    this.queryService = new SingleQueryService(
      adapter,
      logger,
      singleRegistryService,
      hookRegistry,
      componentDataService,
      rbacAccessControlService,
      localization
    );
  }

  // ============================================================
  // Webhook helpers
  // ============================================================

  /**
   * Assemble a Single's main row plus its component subtrees into the read
   * shape the outbox event carries — timestamps camelCased, this locale's
   * translatable values overlaid by field name, password and system-owner
   * columns stripped, JSON-backed fields parsed, and component subtrees
   * populated. UNtagged (unlike the version snapshot, which tags component
   * types): the webhook payload ships the plain read shape.
   *
   * Reused for BOTH the post-write `data` and the pre-write `previous` so the
   * changed-field diff compares like with like. `companionValues` is keyed by
   * companion column and carries the FULL locale state for this side (all
   * stored translations, not only the columns this write touched), so the two
   * documents diff symmetrically and a partial edit still reports untouched
   * translations on both sides. Components are read on the caller's
   * transaction (read-your-writes) so a post-write call sees the subtrees just
   * saved and a pre-write call sees the prior ones. `localeStatus`, when
   * provided, overrides the assembled `status` so a per-locale write reports
   * the write locale's own publish state rather than the main row's.
   */
  private async buildSingleWebhookDoc(
    tx: TransactionContext,
    entryId: string,
    parentTable: string,
    row: Record<string, unknown>,
    fieldConfigs: FieldConfig[],
    companion: CompanionSchema | null,
    companionValues: Record<string, unknown>,
    snapshotLocale: string | undefined,
    localeStatus?: string
  ): Promise<Record<string, unknown>> {
    // Keep user field keys (which may contain underscores like `site_title`)
    // exactly; convert only the timestamp columns so the shape matches a read.
    const parentRow = convertTimestampsToCamelCase({ ...row });
    // A localized single's main row omits translatable columns (split to the
    // companion), so overlay this locale's values back on, keyed by field.name.
    if (companion) {
      for (const f of companion.localizedFields) {
        if (Object.prototype.hasOwnProperty.call(companionValues, f.column)) {
          parentRow[f.name] = companionValues[f.column];
        }
        // The post-write main row may carry the raw snake_case companion column
        // (merged back after the upsert); the read shape keys a translatable
        // value by field name only, so drop the raw column so `data` and
        // `previous` keep an identical key set.
        if (f.column !== f.name && f.column in parentRow) {
          delete parentRow[f.column];
        }
      }
    }
    // Never let password hashes or the system owner column reach a webhook
    // payload — same redaction the read/response path applies.
    stripPasswordFieldValues(parentRow, fieldConfigs);
    stripSystemOwnerField(parentRow);
    // Parse JSON-backed fields (richtext, group, json, ...) to the read shape:
    // on SQLite the row holds them as strings, so an unparsed value would not
    // match a normal read.
    for (const field of fieldConfigs) {
      if (!("name" in field) || !field.name) continue;
      const value = parentRow[field.name];
      if (shouldTreatAsJson(field) && typeof value === "string") {
        try {
          parentRow[field.name] = JSON.parse(value);
        } catch {
          // Not valid JSON — keep the raw string.
        }
      }
    }
    // Read the component subtrees on the transaction so the assembly sees the
    // right generation (post-write: just saved; pre-write: prior). A read
    // failure fails the write instead of shipping an incomplete payload.
    const components: Record<string, unknown> = {};
    if (this.componentDataService) {
      const componentFields = fieldConfigs.filter(
        (f): f is typeof f & { name: string } => isComponentField(f) && !!f.name
      );
      if (componentFields.length > 0) {
        try {
          const populated =
            await this.componentDataService.populateComponentData({
              entry: { id: entryId },
              parentTable,
              fields: fieldConfigs,
              executor: tx.getDrizzle(),
              // Keep a component's relationship/upload references as stored IDs
              // rather than expanding them into full related entries: the
              // sensitive-field list is built from this Single's tree only, so an
              // expanded related entry could smuggle its own hidden/password
              // fields into the payload. Matches the collection snapshot read.
              depth: 0,
              // Read as the locale the components were written at, with no
              // fallback, so an embedded localized component reports this
              // language's text rather than another standing in for it.
              ...(snapshotLocale !== undefined
                ? {
                    locale: snapshotLocale,
                    fallbackLocale: false as const,
                  }
                : {}),
            });
          for (const f of componentFields) {
            if (populated[f.name] !== undefined) {
              components[f.name] = populated[f.name];
            }
          }
        } catch (err) {
          throw NextlyError.internal({
            cause: err instanceof Error ? err : undefined,
            logContext: {
              reason: "webhook-single-component-read",
              table: parentTable,
            },
          });
        }
      }
    }
    const doc: Record<string, unknown> = { ...parentRow, ...components };
    // Overlay the resolved per-locale status: for a non-default-locale write the
    // main row keeps the default language's status, so the assembled `status`
    // above is the wrong one for this locale — replace it with the caller's.
    if (localeStatus !== undefined) {
      doc.status = localeStatus;
    }
    return doc;
  }

  /**
   * The write locale's per-locale `_status`, or null when the companion row
   * has none.
   *
   * Read with raw `tx.execute` (matching upsertCompanionRow): the companion
   * `_locales` table is not in the Drizzle schema, and the CRUD helpers
   * camelCase result keys, which would rename `_status`.
   */
  private async readCompanionLocaleStatus(
    tx: TransactionContext,
    companionTableName: string,
    entryId: string,
    locale: string
  ): Promise<string | null> {
    const isMysqlDialect = this.adapter.dialect === "mysql";
    const quote = (id: string) => (isMysqlDialect ? `\`${id}\`` : `"${id}"`);
    const placeholder = (i: number) =>
      this.adapter.dialect === "postgresql" ? `$${i}` : "?";
    const rows = await tx.execute<{ _status?: unknown }>(
      `SELECT ${quote("_status")} FROM ${quote(companionTableName)} ` +
        `WHERE ${quote("_parent")} = ${placeholder(1)} AND ${quote("_locale")} = ${placeholder(2)} LIMIT 1`,
      [entryId, locale]
    );
    const status = rows[0]?._status;
    return typeof status === "string" ? status : null;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Update a Single document by slug.
   *
   * Auto-creates the document if it doesn't exist, then applies the
   * provided partial data.
   */
  async update(
    slug: string,
    data: Record<string, unknown>,
    options: UpdateSingleOptions = {}
  ): Promise<SingleResult> {
    this.logger.debug("Updating Single document", { slug, options });

    try {
      // 1. Get Single metadata from registry
      const singleMeta = await this.singleRegistryService.getSingleBySlug(slug);
      if (!singleMeta) {
        return {
          success: false,
          statusCode: 404,
          message: `Single "${slug}" not found`,
        };
      }

      // 1.1. reject an unknown write locale rather than silently writing the
      // translatable values into the DEFAULT companion row (which would overwrite real
      // default content). Mirrors the collection write path.
      if (
        this.localization &&
        options.locale &&
        !isValidLocale(this.localization, options.locale)
      ) {
        return {
          success: false,
          statusCode: 400,
          message:
            `Unknown locale '${options.locale}'. Configured locales: ` +
            `${this.localization.locales.map(l => l.code).join(", ")}.`,
        };
      }

      // 1.5. Load the current document first (no auto-create yet) so an
      // owner-only stored rule can compare ownership, then run the access
      // check (stored rules + RBAC) before any hooks/DB writes.
      let existingDoc = await this.adapter.selectOne<SingleDocument>(
        singleMeta.tableName,
        {}
      );

      const accessDenied = await checkSingleAccess({
        slug,
        operation: "update",
        user: options.user,
        overrideAccess: options.overrideAccess,
        routeAuthorized: options.routeAuthorized,
        rbacAccessControlService: this.rbacAccessControlService,
        accessControlService: this.accessControlService,
        accessRules: singleMeta.accessRules,
        document: existingDoc ?? undefined,
        logger: this.logger,
      });
      if (accessDenied) {
        return accessDenied;
      }

      // 2. Ensure document exists (auto-create if it did not yet exist).
      if (!existingDoc) {
        this.logger.info("Auto-creating Single document before update", {
          slug,
        });
        existingDoc = await this.queryService.createDefaultDocument(singleMeta);
      }

      // Deserialize for hook context
      const existingDeserialized = this.queryService.deserializeJsonFields(
        existingDoc,
        singleMeta.fields
      );

      // 3. Build shared context for hooks (seed with caller-provided context)
      const sharedContext: Record<string, unknown> = { ...options.context };
      const hookCollection = getSingleHookCollection(slug);

      // 4. Execute beforeOperation hook
      let currentData = { ...data };

      if (this.hookRegistry.hasHooks("beforeOperation", hookCollection)) {
        const beforeOpResult = await this.hookRegistry.executeBeforeOperation({
          collection: hookCollection,
          operation: "update",
          args: { data: currentData, id: existingDoc.id },
          user: options.user ?? undefined,
          context: sharedContext,
          req: {
            nextly: resolveNextlyForHooks(),
          },
        });
        if (beforeOpResult?.data) {
          currentData = beforeOpResult.data;
        }
      }

      // 5. Execute beforeChange hooks (beforeUpdate equivalent for Singles)
      if (this.hookRegistry.hasHooks("beforeUpdate", hookCollection)) {
        const beforeContext = buildSingleHookContext({
          collection: hookCollection,
          operation: "update",
          data: currentData,
          originalData: existingDeserialized,
          user: options.user ?? undefined,
          context: sharedContext,
        });
        const modifiedData = await this.hookRegistry.execute(
          "beforeUpdate",
          beforeContext
        );
        if (modifiedData !== undefined) {
          currentData = modifiedData;
        }
      }

      const fieldConfigs = singleMeta.fields;

      // 6.1. Field-level access + beforeValidate hooks (functions resolved
      // via the field-level registry; serialized field defs drop them).
      // Runs BEFORE component extraction so component fields cannot bypass
      // write access, hooks, or validation.
      await applyFieldWriteAccess({
        kind: "single",
        slug,
        data: currentData,
        operation: "update",
        user: options.user,
        overrideAccess: options.overrideAccess,
        id: existingDoc.id,
      });
      await runFieldHooks({
        kind: "single",
        slug,
        phase: "beforeValidate",
        data: currentData,
        operation: "update",
        user: options.user,
      });

      // i18n: build the companion schema + write-locale context up front so validation is
      // language-aware and the split/upsert below reuse it. `companion` is null when the single
      // isn't localized (unchanged path) — gate on THIS single's `localized` flag so a
      // non-localized single in a localized app doesn't route to a companion never created.
      const companion =
        this.localization && singleMeta.localized === true
          ? buildCompanionSchema({
              slug,
              tableName: singleMeta.tableName,
              fields: singleMeta.fields as { name: string; type: string }[],
              dialect: this.adapter.dialect,
              status: (singleMeta as { status?: boolean }).status === true,
            })
          : null;
      const writeLocale =
        companion && this.localization
          ? resolveRequestedLocale(this.localization, options.locale)
          : undefined;
      // The locale this write's content belongs to. `writeLocale` covers the
      // Single's own translations; when it has none, embedded components may
      // still be localized. Those were written at the requested locale, or at
      // the configured default when none was named — the component write and
      // read both resolve `undefined` that way, so the default is recorded
      // explicitly rather than left null and unplaceable.
      const snapshotLocale =
        writeLocale ??
        (this.localization
          ? resolveRequestedLocale(this.localization, options.locale)
          : undefined);
      const localizedFieldNames = new Set(
        (companion?.localizedFields ?? []).map(f => f.name)
      );
      // A non-default-locale write may leave required localized fields blank (they fall back
      // until translated); only the default-locale write enforces required. Mirrors collections.
      const enforceLocalizedRequired =
        !companion ||
        writeLocale === undefined ||
        !this.localization ||
        writeLocale === this.localization.defaultLocale;

      // 6.2. Enforce the schema's declared rules on the server — the same
      // gate the collection write paths run. Singles updates are PATCH
      // semantics: absent keys stay untouched, provided keys must hold.
      {
        const validationIssues = await validateEntryData(
          currentData,
          attachFieldValidators("single", slug, fieldConfigs),
          {
            mode: "update",
            req: options.user ? { user: options.user } : {},
            localizedFieldNames,
            enforceLocalizedRequired,
          }
        );
        if (validationIssues.length > 0) {
          throw NextlyError.validation({ errors: validationIssues });
        }
      }

      // 6.3. Field-level beforeChange hooks (after validation, before
      // hashing/serialization).
      await runFieldHooks({
        kind: "single",
        slug,
        phase: "beforeChange",
        data: currentData,
        operation: "update",
        user: options.user,
      });

      // 6.4. Extract component field data (stored in separate comp_{slug}
      // tables) AFTER the access/hooks/validation pipeline above has seen
      // the component fields.
      const componentFieldData: Record<string, unknown> = {};
      fieldConfigs.forEach(field => {
        if (isComponentField(field) && currentData[field.name] !== undefined) {
          componentFieldData[field.name] = currentData[field.name];
          delete currentData[field.name];
        }
      });

      // 6.5. Password fields store bcrypt hashes, never the submitted
      // value — same guarantee as the collection write paths.
      await hashPasswordFieldValues(currentData, fieldConfigs);

      // 6.5. Normalize upload field values (strip expanded media objects to IDs)
      normalizeUploadFields(currentData, fieldConfigs);

      // 6.6. Coerce date-field strings into `Date` objects so Drizzle can
      // bind them to `timestamp` columns. Without this step the adapter
      // throws `value.toISOString is not a function` because JSON request
      // bodies always deliver dates as ISO strings.
      coerceDateFieldsToDate(currentData, fieldConfigs);

      // 7. Serialize JSON fields for storage
      const serializedData = serializeJsonFields(currentData, fieldConfigs);

      // 8. Remove id and createdAt from update data (if present)
      delete serializedData.id;
      delete serializedData.createdAt;

      // 9. Update document in database
      const snakeCaseData = keysToSnakeCase(serializedData) as Record<
        string,
        unknown
      >;
      // Commit the scalar update, the component subtree writes, the companion
      // upsert, AND the version snapshot atomically so any failure rolls back the
      // others (no partial single/localized/version state). The rows are RETURNED
      // from the callback (not assigned to an outer variable), so the value read
      // below is only ever the committed result. A localized single writes
      // `mainPayload` (translatable columns moved to the companion).
      let updatedRows: SingleDocument[];
      try {
        // Retry the whole update+capture transaction on a version_no allocation
        // race; the re-run re-reads the max. The single UPDATE is deterministic.
        updatedRows = await withVersionConflictRetry(() =>
          this.adapter.transaction(async tx => {
            // Build the payload inside the closure so a retried attempt after a
            // concurrent winner stamps a FRESH `updated_at`, rather than reusing
            // a timestamp created before the first attempt (which could commit an
            // older time than the winning write and reverse row/snapshot order).
            const updatePayload = {
              ...snakeCaseData,
              updated_at: new Date(),
            };

            // 8.5. i18n: for a localized single, split translatable columns out of
            // the main update — they live on the companion `single_<slug>_locales`
            // row, not the main table. `companion` and `writeLocale` were resolved
            // above (before validation); the split reuses them. Done inside the
            // closure so a retry re-splits the freshly-timestamped payload.
            const { main: mainPayload, companion: companionData } = companion
              ? splitLocalizedWrite(updatePayload, companion.localizedFields)
              : {
                  main: updatePayload,
                  companion: {} as Record<string, unknown>,
                };

            // per-locale status. The status the companion row carries —
            // from `updatePayload` (not `mainPayload`, which may have `status`
            // stripped just below). Captured so a status-only unpublish still
            // stamps the per-locale `_status`.
            const companionStatus =
              companion?.hasStatus &&
              typeof (updatePayload as Record<string, unknown>).status ===
                "string"
                ? ((updatePayload as Record<string, unknown>).status as string)
                : undefined;
            // The main table's `status` is the single's entry-level (default-locale)
            // publish state, so a per-locale write for a NON-default locale must not
            // clobber it — that language's draft/publish lives on the companion
            // `_status` (stamped by the upsert after commit).
            if (
              writeLocale !== undefined &&
              this.localization &&
              writeLocale !== this.localization.defaultLocale &&
              Object.prototype.hasOwnProperty.call(mainPayload, "status")
            ) {
              delete (mainPayload as Record<string, unknown>).status;
            }

            // Read the pre-write main row on THIS transaction before the update
            // overwrites it, so the outbox `previous` reports the prior state
            // and the changed-field diff is accurate. Re-read every attempt
            // (deterministic pre-write) so a version-conflict retry still
            // reports the true prior document.
            const preRow = await tx.selectOne<Record<string, unknown>>(
              singleMeta.tableName,
              {}
            );
            // The main row's prior status, captured before any overlay. Read
            // once and never mutated onto `preRow`: the per-locale status is
            // threaded to the `previous` doc via `localeStatus` instead, so the
            // captured main row stays the true main-table state.
            const preRowMainStatus =
              typeof preRow?.status === "string" ? preRow.status : undefined;

            const rows = await tx.update<SingleDocument>(
              singleMeta.tableName,
              mainPayload,
              this.whereEq("id", existingDoc.id),
              { returning: "*" }
            );

            // Nothing updated: return the empty result; the 500 is surfaced after
            // the (empty) transaction, and the component write is skipped.
            if (rows.length === 0) {
              return rows;
            }

            // Build the outbox `previous` NOW — after the main update but before
            // the component save and companion upsert below — so its component
            // subtrees and companion values are still the prior generation. The
            // main row was captured into `preRow` before the update.
            // `previousCompanionValues` carries EVERY stored translation for the
            // write locale (not just the touched columns) so a partial localized
            // edit still reports the untouched translations on both sides and
            // `previous`/`data` diff symmetrically.
            const previousCompanionValues: Record<string, unknown> = {};
            let previousCompanionStatus: string | null = null;
            if (companion && writeLocale !== undefined) {
              const preLocaleRow: Record<string, unknown> = {
                id: existingDoc.id,
              };
              await populateCompanionFields({
                db: tx.getDrizzle<
                  Parameters<typeof populateCompanionFields>[0]["db"]
                >(),
                companionTable: companion.table,
                localizedFields: companion.localizedFields,
                rows: [preLocaleRow],
                localeChain: [writeLocale],
              });
              for (const f of companion.localizedFields) {
                if (preLocaleRow[f.name] !== undefined) {
                  previousCompanionValues[f.column] = preLocaleRow[f.name];
                }
              }
              // This locale's committed status, read before the upsert. Gated
              // on `hasStatus`: querying `_status` on a companion without it
              // would fail the whole write.
              if (companion.hasStatus) {
                previousCompanionStatus = await this.readCompanionLocaleStatus(
                  tx,
                  companion.companionTableName,
                  existingDoc.id,
                  writeLocale
                );
              }
            }
            // The full post-write locale state: prior stored translations
            // overlaid with the columns this write touched. No extra DB read —
            // the prior values were just read above and `companionData` holds
            // this write's serialized translatable values.
            const dataCompanionValues: Record<string, unknown> = {
              ...previousCompanionValues,
              ...companionData,
            };

            // Whether the single stores this write's status per locale. True
            // only for a non-default-locale write on a status-bearing companion;
            // the default locale's status lives on the main row.
            const isPerLocaleStatusWrite =
              !!companion?.hasStatus &&
              writeLocale !== undefined &&
              writeLocale !== this.localization?.defaultLocale;
            // Does this single have any status concept at all (main-row status
            // or per-locale companion status)?
            const singleHasStatus =
              (singleMeta as { status?: boolean }).status === true ||
              companion?.hasStatus === true;
            // The status this write assigns: the patch's status (kept on
            // `updatePayload` even when the main column is left untouched for a
            // non-default locale) or the per-locale companion status. Undefined
            // for a content-only edit, which transitions nothing.
            const writtenStatus =
              (typeof (updatePayload as { status?: unknown }).status ===
              "string"
                ? ((updatePayload as { status?: unknown }).status as string)
                : undefined) ?? companionStatus;
            // The status this write moves away from. For a per-locale write it
            // is this locale's committed companion `_status`; a non-default
            // locale with no companion row yet is unpublished ("draft"), NOT the
            // main row's status. Otherwise it is the main row's prior status.
            const previousLocaleStatus = isPerLocaleStatusWrite
              ? (previousCompanionStatus ?? "draft")
              : preRowMainStatus;
            // The status the write leaves this locale in: a content-only write
            // keeps the current status.
            const dataLocaleStatus = writtenStatus ?? previousLocaleStatus;

            const previousDoc = preRow
              ? await this.buildSingleWebhookDoc(
                  tx,
                  existingDoc.id,
                  singleMeta.tableName,
                  preRow,
                  fieldConfigs,
                  companion,
                  previousCompanionValues,
                  snapshotLocale,
                  previousLocaleStatus
                )
              : null;

            // Clone per attempt: saveComponentDataInTransaction mutates the data
            // in place (hashing passwords, assigning ids), so a conflict retry
            // must start from the user's original values, and the snapshot below
            // uses this post-save copy (ids populated) rather than the raw input.
            const attemptComponentData = structuredClone(componentFieldData);

            // 9.5. Save component field data to separate comp_{slug} tables. The
            // write locale is threaded so an embedded localized component stores
            // its translatable fields to the companion for this language.
            if (
              this.componentDataService &&
              Object.keys(attemptComponentData).length > 0
            ) {
              await this.componentDataService.saveComponentDataInTransaction(
                tx,
                {
                  parentId: existingDoc.id,
                  parentTable: singleMeta.tableName,
                  fields: fieldConfigs,
                  data: attemptComponentData,
                  locale: options.locale,
                }
              );
            }

            // 9.6. i18n: upsert the companion row for the write locale in the SAME
            // transaction, stamping the per-locale `_status`. Fires even when only
            // status changed (companionData empty) so a per-locale unpublish still
            // updates `_status`. Then merge the written values back onto the
            // returned row so the PATCH response and afterChange/afterUpdate hooks
            // see the just-saved translation (the main row omits these columns).
            if (
              companion &&
              writeLocale !== undefined &&
              (Object.keys(companionData).length > 0 ||
                companionStatus !== undefined)
            ) {
              const txWriteAdapter = {
                dialect: this.adapter.dialect,
                executeQuery: <T = unknown>(sql: string, params?: unknown[]) =>
                  tx.execute<T>(sql, params as never),
              };
              await upsertCompanionRow(
                txWriteAdapter,
                companion.companionTableName,
                existingDoc.id,
                writeLocale,
                companionData,
                companionStatus
              );
              const row = rows[0] as Record<string, unknown>;
              for (const f of companion.localizedFields) {
                if (
                  Object.prototype.hasOwnProperty.call(companionData, f.column)
                ) {
                  row[f.column] = companionData[f.column];
                }
              }
            }

            // Capture a version snapshot atomically with the write when the single
            // opts into versioning. Singles have no many-to-many fields; the
            // updated parent row (top-level keys camelCased to the read shape) plus
            // component subtrees form the snapshot.
            const versionsConfig = singleMeta.versions;
            if (versionsConfig?.enabled) {
              // Match the read shape: keep user field keys (field.name, which
              // may contain underscores like `site_title`) exactly, converting
              // only the timestamp columns — camel-casing every key would rewrite
              // those fields and diverge from a normal read.
              const parentRow = convertTimestampsToCamelCase({
                ...(rows[0] as Record<string, unknown>),
              });
              // i18n: a localized single's main row omits translatable columns
              // (split to the companion above), so overlay this locale's written
              // translatable values back onto the snapshot — otherwise the version
              // records blank translations. Keyed by field.name to match the read
              // shape; the JSON-parse pass below then normalizes any JSON-backed
              // localized values (companionData holds serialized strings). Mirrors
              // the collection capture path.
              if (companion) {
                for (const f of companion.localizedFields) {
                  if (
                    Object.prototype.hasOwnProperty.call(
                      companionData,
                      f.column
                    )
                  ) {
                    parentRow[f.name] = companionData[f.column];
                  }
                }
              }
              // Never let password hashes into durable version history: the row
              // carries bcrypt hashes (hashPasswordFieldValues ran before the
              // write), and a later password change would otherwise leave the
              // superseded hash permanently recoverable via the snapshot. The
              // response is redacted separately (stripPasswordFieldValues at the
              // return), which does not cover this snapshot.
              stripPasswordFieldValues(parentRow, fieldConfigs);
              // Strip the system owner column (created_by) too, matching the
              // read/response redaction, so history does not retain a stable
              // owner id or let a restore overwrite ownership.
              stripSystemOwnerField(parentRow);
              // Parse JSON-backed fields (richtext, group, json, ...) to the read
              // shape: on SQLite the returned row holds them as strings, so an
              // unparsed snapshot would not match a normal read on restore.
              for (const field of fieldConfigs) {
                if (!("name" in field) || !field.name) continue;
                const value = parentRow[field.name];
                if (shouldTreatAsJson(field) && typeof value === "string") {
                  try {
                    parentRow[field.name] = JSON.parse(value);
                  } catch {
                    // Not valid JSON — keep the raw string.
                  }
                }
              }
              // Read the component subtrees from the TRANSACTION (read-your-
              // writes, #226): the component save above just persisted them, so
              // the read returns the complete, read-shaped, password-stripped
              // subtrees with no in-memory overlay. A read failure fails the
              // capture (rolls back) rather than persisting an incomplete snapshot.
              const components: Record<string, unknown> = {};
              if (this.componentDataService) {
                const componentFields = fieldConfigs.filter(
                  (f): f is typeof f & { name: string } =>
                    isComponentField(f) && !!f.name
                );
                if (componentFields.length > 0) {
                  try {
                    const populated =
                      await this.componentDataService.populateComponentData({
                        entry: { id: existingDoc.id },
                        parentTable: singleMeta.tableName,
                        fields: fieldConfigs,
                        executor: tx.getDrizzle(),
                        // Read as the locale the components were written at,
                        // with no fallback, so an embedded localized component
                        // records this language's text rather than another's
                        // standing in for it. `writeLocale` is undefined when
                        // the Single itself is not localized, but its embedded
                        // components can still be — and they were saved with
                        // `options.locale` just above, so the snapshot has to
                        // be read back the same way.
                        ...(snapshotLocale !== undefined
                          ? {
                              locale: snapshotLocale,
                              fallbackLocale: false as const,
                            }
                          : {}),
                      });
                    for (const f of componentFields) {
                      if (populated[f.name] !== undefined) {
                        components[f.name] = populated[f.name];
                      }
                    }
                  } catch (err) {
                    this.logger.error(
                      "Version snapshot: failed to read single components; failing the write instead of capturing an incomplete snapshot",
                      {
                        slug,
                        error: err instanceof Error ? err.message : String(err),
                      }
                    );
                    throw NextlyError.internal({
                      cause: err instanceof Error ? err : undefined,
                      logContext: {
                        reason: "version-snapshot-single-component-read",
                        slug,
                      },
                    });
                  }
                }
              }
              // A component subtree read as the write locale is locale-specific
              // state too, so a component-only translation edit is not mistaken
              // for a shared-field write and left unrestorable.
              // Component schemas the snapshot's tagging needs, resolved once
              // so the walk itself stays synchronous.
              //
              // Read on the transaction's own connection: the registry lookup
              // would otherwise take a second pooled connection while this
              // write transaction still holds one, stalling a small pool.
              const snapshotComponentSchemas = this.componentDataService
                ? await resolveComponentFieldMap(fieldConfigs, slug =>
                    this.componentDataService!.getComponentFields(
                      slug,
                      tx.getDrizzle()
                    )
                  )
                : new Map<string, (typeof fieldConfigs)[number][]>();
              const snapshotComponentResolver = (slug: string) =>
                snapshotComponentSchemas.get(slug);

              const capturedLocalizedComponents =
                snapshotLocale !== undefined &&
                Object.keys(components).length > 0;

              await captureInTx(tx, this.versionCapture, {
                ref: {
                  scopeKind: "single",
                  scopeSlug: slug,
                  entryId: existingDoc.id,
                },
                // Prefer the written status; for a per-locale status change it moved
                // to the companion `_status`, so fall back to that before the row's.
                contentStatus:
                  (updatePayload as { status?: unknown }).status ??
                  companionStatus ??
                  (parentRow as { status?: unknown }).status,
                // Tagged for the snapshot alone: the same component values
                // feed the outbox event, whose payload is read shape.
                parts: {
                  // A component inside a group or repeater rides in that
                  // container's JSON on the row rather than appearing in the
                  // components map — the same shape the collection capture
                  // reaches through. `snapshotComponentResolver` supplies the
                  // inner schemas so a component inside a component is reached
                  // as well.
                  parentRow: tagNestedComponentTypes(
                    parentRow,
                    fieldConfigs,
                    snapshotComponentResolver
                  ) as Record<string, unknown>,
                  components: tagComponentTypes(
                    components,
                    fieldConfigs,
                    snapshotComponentResolver
                  ),
                },
                createdBy: options.user?.id ?? null,
                // Labelled with a locale only when locale-specific state was
                // actually captured. A localized Single routes every write
                // through `writeLocale`, including one touching only shared
                // fields on a locale with no companion row — that snapshot
                // holds no translations and keeps the MAIN row's status, so
                // calling it that locale's would let a restore publish a
                // language from state that was never its own.
                locale:
                  Object.keys(companionData).length > 0 ||
                  companionStatus !== undefined ||
                  capturedLocalizedComponents
                    ? (snapshotLocale ?? null)
                    : null,
                sourceVersionNo: options.sourceVersionNo ?? null,
                maxPerDoc: versionsConfig.maxPerDoc,
              });
            }

            // Append the outbox event(s) in the SAME transaction, so they commit
            // with the write and are never recorded for a write that rolls back.
            // Runs whether or not versioning is enabled, and only on a real write
            // (the empty-rows early return above already bailed). Recorded
            // unconditionally (the endpoint gate lives at fan-out), mirroring the
            // collection write path.

            // Assemble the just-written document in the outbox read shape.
            // `dataCompanionValues` supplies this locale's FULL post-write
            // translation state (prior values overlaid with this write's
            // columns); components are read on the transaction (read-your-writes).
            const dataDoc = await this.buildSingleWebhookDoc(
              tx,
              existingDoc.id,
              singleMeta.tableName,
              rows[0],
              fieldConfigs,
              companion,
              dataCompanionValues,
              snapshotLocale,
              dataLocaleStatus
            );

            // The single's field tree with component references expanded, so the
            // secret/hidden strip descends into fields declared inside a
            // component. Resolved on the transaction's connection (components
            // already read on it) to avoid taking a second pooled connection
            // while this write still holds one.
            const webhookFields = await expandComponentFields(
              fieldConfigs,
              async slug =>
                this.componentDataService
                  ? await this.componentDataService.getComponentFields(
                      slug,
                      tx.getDrizzle()
                    )
                  : null
            );

            // A publish/unpublish is a status change, so only a write that
            // ASSIGNS a status can trigger one — the `writtenStatus` gate keeps
            // a content-only edit from transitioning. The prior/next states are
            // this locale's own (`previousLocaleStatus`/`dataLocaleStatus`,
            // resolved above), so a first non-default-locale publish under a
            // published default still fires `single.published` and a draft write
            // never emits a false `single.unpublished`.
            const publishedTransition =
              singleHasStatus &&
              dataLocaleStatus === "published" &&
              previousLocaleStatus !== "published";
            const unpublishedTransition =
              singleHasStatus &&
              writtenStatus !== undefined &&
              dataLocaleStatus !== "published" &&
              previousLocaleStatus === "published";

            const actor = actorForWrite(options.actor ?? null, options.user);
            // A component subtree read at the write locale is per-locale state,
            // so a component-only translation edit counts as locale-specific.
            const eventComponentFields = fieldConfigs.filter(
              (f): f is typeof f & { name: string } =>
                isComponentField(f) && !!f.name
            );
            const eventHasLocalizedComponents =
              snapshotLocale !== undefined &&
              eventComponentFields.some(f => dataDoc[f.name] !== undefined);
            // `locale` rides only when the write genuinely stored per-locale
            // data: this write touched localized Single columns, set a per-locale
            // status, or captured localized component state. A plain
            // non-localized Single gets none. Mirrors the version-capture gate so
            // the event and the snapshot agree on what is locale-specific.
            const eventLocale: string | null =
              Object.keys(companionData).length > 0 ||
              companionStatus !== undefined ||
              eventHasLocalizedComponents
                ? (snapshotLocale ?? null)
                : null;
            // `single` FORBIDS a `collection` slug; `locale` rides only when the
            // single (or an embedded component) is localized, so a receiver can
            // tell one language's write apart from another's.
            const resource: WebhookResource = {
              kind: "single",
              id: existingDoc.id,
              ...(eventLocale != null ? { locale: eventLocale } : {}),
            };
            await recordMutationEvent(tx, {
              type: "single.updated",
              resource,
              data: dataDoc,
              previous: previousDoc,
              fields: webhookFields,
              actor,
            });
            // A publish emits BOTH `single.updated` and `single.published` (and
            // an unpublish both `single.updated` and `single.unpublished`), so a
            // consumer subscribes to whichever it needs.
            if (publishedTransition) {
              await recordMutationEvent(tx, {
                type: "single.published",
                resource,
                data: dataDoc,
                previous: previousDoc,
                fields: webhookFields,
                actor,
              });
            }
            if (unpublishedTransition) {
              await recordMutationEvent(tx, {
                type: "single.unpublished",
                resource,
                data: dataDoc,
                previous: previousDoc,
                fields: webhookFields,
                actor,
              });
            }

            return rows;
          })
        );
      } catch (error) {
        // A component validation failure (NextlyError) thrown inside the
        // transaction callback is re-wrapped as a database error by the adapter;
        // recover it from the cause so an invalid component update still yields
        // the original validation response (400) instead of a generic 500.
        const cause = (error as { cause?: unknown } | null)?.cause;
        if (cause instanceof NextlyError) {
          throw cause;
        }
        throw error;
      }

      if (updatedRows.length === 0) {
        return {
          success: false,
          statusCode: 500,
          message: "Failed to update Single document",
        };
      }

      let updatedDoc = updatedRows[0];

      // 10. Deserialize JSON fields for response
      updatedDoc = this.queryService.deserializeJsonFields(
        updatedDoc,
        fieldConfigs
      );

      // 10.1. Field-level afterChange hooks observe the PERSISTED values —
      // run before response expansion so hooks see stored IDs, not the
      // populated media/relationship objects the response returns.
      await runFieldHooks({
        kind: "single",
        slug,
        phase: "afterChange",
        data: updatedDoc,
        operation: "update",
        user: options.user,
      });

      // 10.5. Expand upload fields with full media data
      updatedDoc = await this.queryService.expandUploadFields(
        updatedDoc,
        fieldConfigs
      );

      // 10.6. Expand relationship fields with full related entry data
      updatedDoc = await this.queryService.expandRelationshipFields(
        updatedDoc,
        fieldConfigs
      );

      // 11. Execute afterChange hooks (afterUpdate equivalent for Singles)
      if (this.hookRegistry.hasHooks("afterUpdate", hookCollection)) {
        const afterContext = buildSingleHookContext({
          collection: hookCollection,
          operation: "update",
          data: updatedDoc,
          originalData: existingDeserialized,
          user: options.user ?? undefined,
          context: sharedContext,
        });
        const transformedData = await this.hookRegistry.execute(
          "afterUpdate",
          afterContext
        );
        if (transformedData !== undefined) {
          updatedDoc = transformedData;
        }
      }

      this.logger.info("Single document updated", { slug, id: updatedDoc.id });

      // Redact the response: drop write-only password hashes and any field
      // the caller may write but not read (parity with the query path), so a
      // mutation response can never echo a value the reader is denied. A
      // route-authorized REST caller isn't a trusted-server read, so its
      // override does not skip redaction (mirrors the collection path).
      stripPasswordFieldValues(updatedDoc, fieldConfigs);
      await applyFieldReadAccess({
        kind: "single",
        slug,
        entry: updatedDoc,
        user: options.user,
        overrideAccess: options.overrideAccess && !options.routeAuthorized,
      });

      return {
        success: true,
        statusCode: 200,
        data: updatedDoc,
      };
    } catch (error) {
      this.logger.error("Failed to update Single document", { slug, error });
      return buildSingleErrorResult(error, "Failed to update Single document");
    }
  }
}
