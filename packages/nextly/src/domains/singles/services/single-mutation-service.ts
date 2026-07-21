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

import { isComponentField } from "../../../collections/fields/guards";
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
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import {
  isValidLocale,
  resolveRequestedLocale,
} from "../../i18n/resolve-locale";
import {
  buildCompanionSchema,
  splitLocalizedWrite,
  upsertCompanionRow,
} from "../../i18n/runtime/companion-io";
import { captureInTx } from "../../versions/capture-in-tx";
import { VersionCaptureService } from "../../versions/version-capture-service";
import { withVersionConflictRetry } from "../../versions/version-conflict";
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
                parts: { parentRow, components },
                createdBy: options.user?.id ?? null,
                maxPerDoc: versionsConfig.maxPerDoc,
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
