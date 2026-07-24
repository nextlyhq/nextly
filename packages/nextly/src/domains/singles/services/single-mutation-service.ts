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
import { and, eq, type Column } from "drizzle-orm";

import { actorForWrite } from "../../../auth/request-actor";
import { isComponentField } from "../../../collections/fields/guards";
import type { FieldConfig } from "../../../collections/fields/types";
import type { RBACAccessControlService } from "../../../domains/auth/services/rbac-access-control-service";
import { NextlyError } from "../../../errors/nextly-error";
import type { HookRegistry } from "../../../hooks/hook-registry";
import { keysToSnakeCase } from "../../../lib/case-conversion";
import {
  resolvePublishTransition,
  stripUndefinedStatus,
} from "../../../lib/status-transition";
import {
  AccessControlService,
  type CollectionAccessRules,
  isSuperAdminContext,
} from "../../../services/access";
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
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import {
  isBlank,
  populateCompanionFields,
  readCompanionLocaleStatus,
} from "../../i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import {
  isValidLocale,
  resolveRequestedLocale,
} from "../../i18n/resolve-locale";
import {
  buildCompanionSchema,
  companionTableExists,
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
 * The component instances a written component field value actually stored,
 * each paired with its slug and its written data. A single-component field
 * (`component`) yields one instance keyed by its config slug; a dynamic-zone
 * field (`components`) yields one per written block, each discriminated by
 * `_componentType` — so only the blocks the write used are returned, never the
 * whole allow-list. Used to decide whether a component write was per-locale.
 */
function writtenComponentInstances(
  fieldConfig: { component?: string; components?: string[] },
  value: unknown
): Array<{ slug: string; data: Record<string, unknown> }> {
  if (fieldConfig.component) {
    // A fixed single-component field is one instance; with `repeatable: true`
    // the value is an array of instances, all under the same component slug.
    const slug = fieldConfig.component;
    const items = Array.isArray(value) ? value : value != null ? [value] : [];
    return items
      .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
      .map(d => ({ slug, data: d }));
  }
  const instances = Array.isArray(value) ? value : value != null ? [value] : [];
  const out: Array<{ slug: string; data: Record<string, unknown> }> = [];
  for (const instance of instances) {
    if (
      instance &&
      typeof instance === "object" &&
      "_componentType" in instance &&
      typeof (instance as { _componentType?: unknown })._componentType ===
        "string"
    ) {
      out.push({
        slug: (instance as { _componentType: string })._componentType,
        data: instance as Record<string, unknown>,
      });
    }
  }
  return out;
}

/**
 * Thrown inside the write transaction when the publish/unpublish transition is
 * refused against the ROW-LOCKED status, to abort (roll back) the transaction.
 * The matching 403 is carried out-of-band on `transitionDeniedResult` rather
 * than on the error, because the adapter re-wraps a thrown error as a
 * DatabaseError when the transaction rolls back, so an `instanceof` check no
 * longer identifies it after the throw.
 */
class SingleStatusTransitionDeniedError extends NextlyError {
  constructor() {
    super({
      code: "FORBIDDEN",
      publicMessage: "Publishing this document is not allowed.",
    });
    this.name = "SingleStatusTransitionDeniedError";
  }
}

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
   * Read a Single's FULL companion translation state for one locale, keyed by
   * companion column — every localized field carries its stored value or is
   * absent (untranslated). Used to assemble the default-locale view for a
   * shared-field event on a localized Single, whose write locale may differ
   * from the default and so is not already in hand.
   */
  private async readCompanionLocaleValues(
    tx: TransactionContext,
    companion: CompanionSchema,
    entryId: string,
    locale: string
  ): Promise<Record<string, unknown>> {
    const localeRow: Record<string, unknown> = { id: entryId };
    await populateCompanionFields({
      db: tx.getDrizzle<Parameters<typeof populateCompanionFields>[0]["db"]>(),
      companionTable: companion.table,
      localizedFields: companion.localizedFields,
      rows: [localeRow],
      localeChain: [locale],
      // This read feeds a durable webhook payload and the caller has already
      // confirmed the companion table exists, so a real read failure must abort
      // the write rather than silently ship nulled default-view translations.
      strict: true,
    });
    const values: Record<string, unknown> = {};
    for (const f of companion.localizedFields) {
      if (localeRow[f.name] !== undefined) {
        values[f.column] = localeRow[f.name];
      }
    }
    return values;
  }

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
    companionExists: boolean,
    companionValues: Record<string, unknown>,
    snapshotLocale: string | undefined,
    localeStatus?: string
  ): Promise<Record<string, unknown>> {
    // Keep user field keys (which may contain underscores like `site_title`)
    // exactly; convert only the timestamp columns so the shape matches a read.
    const parentRow = convertTimestampsToCamelCase({ ...row });
    // A localized single's main row omits translatable columns (split to the
    // companion), so overlay this locale's values back on, keyed by field.name.
    // Skip the overlay when the companion table does not physically exist yet
    // (a localized single before its companion migration runs): in that
    // unmigrated state the translatable values still live on the main row, so
    // nulling them here would drop existing translations and report bogus
    // changed fields.
    if (companion && companionExists) {
      // A shared field can legitimately be NAMED like a localized field's
      // physical column (e.g. a shared `meta_title` next to localized
      // `metaTitle` → column `meta_title`); never drop such a real field.
      const mainFieldNames = new Set(
        fieldConfigs
          .map(f => ("name" in f ? f.name : undefined))
          .filter((n): n is string => !!n)
      );
      for (const f of companion.localizedFields) {
        // Every localized field appears in the read shape — its stored/written
        // value or null (untranslated), matching populateCompanionFields — so a
        // partial translation write's payload lists all localized fields, not
        // only the touched ones.
        parentRow[f.name] = Object.prototype.hasOwnProperty.call(
          companionValues,
          f.column
        )
          ? companionValues[f.column]
          : null;
        // The post-write main row may carry the raw snake_case companion column
        // (merged back after the upsert); the read shape keys a translatable
        // value by field name only, so drop the raw column so `data` and
        // `previous` keep an identical key set — unless it is itself a declared
        // shared field, whose value must survive.
        if (
          f.column !== f.name &&
          f.column in parentRow &&
          !mainFieldNames.has(f.column)
        ) {
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
              // This read feeds the durable webhook payload inside the write
              // transaction, so a component read failure must roll the write
              // back rather than ship a payload with silently-missing component
              // data and a corrupted changed-field diff.
              strict: true,
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

    // Set true once the update transaction commits with a real write (which
    // always appends the outbox event); lets the catch and the `!updated`
    // return report a committed-but-post-hook-failed write as `eventRecorded`
    // even when `success` is false. Declared out here so every return sees it.
    let eventRecorded = false;
    // Set when the in-transaction transition check refuses the write against the
    // row-locked status. Declared out here (not in `try`) so the catch can read
    // it: the adapter wraps the thrown sentinel in a DatabaseError as the
    // transaction rolls back, so `instanceof` no longer identifies it after the
    // throw, but this result stays correct regardless of how the error is wrapped.
    let transitionDeniedResult: SingleResult | undefined;

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
        // A scoped API key is judged on its own grants here too, so the session
        // super-admin bypass does not apply to it on the primary update gate.
        authenticatedScope: options.authenticatedScope,
        accessControlService: this.accessControlService,
        accessRules: singleMeta.accessRules,
        document: existingDoc ?? undefined,
        logger: this.logger,
      });
      if (accessDenied) {
        return accessDenied;
      }

      // 2. Resolve the document to write against. When the Single has never been
      // written, build its default in memory but DO NOT persist it yet. The
      // publish-transition gate below runs after hooks (it needs the post-hook
      // status), and a first write refused there must not leave a row behind —
      // one a concurrent writer could have populated and that a rollback delete
      // would then destroy. The default is inserted only once the write
      // (including any publish) is authorized.
      let autoCreated = false;
      let pendingAutoCreateValues: Record<string, unknown> | null = null;
      // Translatable defaults to seed onto the default-locale companion when the
      // auto-create actually inserts a row (they cannot live on the main table).
      let pendingLocalizedDefaults: Record<string, unknown> = {};
      if (!existingDoc) {
        this.logger.info("Preparing default Single document before update", {
          slug,
        });
        const built = this.queryService.buildDefaultDocument(singleMeta);
        existingDoc = built.document;
        pendingAutoCreateValues = built.insertValues;
        pendingLocalizedDefaults = built.localizedDefaults;
        autoCreated = true;
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

      // 6.35. Authorize a change to the single's published state, judged on the
      // post-hook data. Publishing needs `publish-<slug>` and unpublishing
      // `unpublish-<slug>`, on top of update — editing and publishing are
      // separate capabilities, mirroring the collection write path. A write
      // targeting a non-default locale publishes through that locale's companion
      // `_status` (only when a string status was provided) and does not move the
      // main row; a default-locale or non-localized write moves the main-row
      // status. The gate no-ops when the single has no draft/published lifecycle,
      // and a trusted write bypasses it.
      //
      // TOCTOU-safe: the permission (and any owner-only/custom rule) for the ONE
      // op this write could require is pre-resolved here, OFF the write
      // transaction's connection, but the transition is CLASSIFIED against the
      // status read UNDER THE ROW LOCK inside the transaction (below). Only
      // "published" can publish; any other explicit value can only unpublish a
      // currently-published row — so the candidate op is fully determined by the
      // status this write persists, and a concurrent writer that changes the
      // published state between now and the lock cannot slip a real transition
      // past the gate (a stale-status window the pre-transaction classification
      // left open before).
      const singleHasStatus =
        (singleMeta as { status?: boolean }).status === true;
      // An explicit `status: undefined` (own key) names no status change; strip
      // it so the transition gate and the write agree — a kept undefined status
      // would be sanitized to SQL NULL and silently unpublish a published Single
      // without the gate.
      stripUndefinedStatus(currentData);
      const finalStatus = (currentData as { status?: unknown }).status;
      const isNonDefaultLocaleWrite =
        companion?.hasStatus === true &&
        writeLocale !== undefined &&
        writeLocale !== this.localization?.defaultLocale;
      // The MAIN row status this write moves (a non-default-locale write leaves it
      // untouched — the split strips it from the main payload).
      const mainNextStatus = isNonDefaultLocaleWrite ? undefined : finalStatus;
      // The write locale's companion `_status` — any localized write providing a
      // string status stamps it, INCLUDING the default locale (whose status also
      // lands on the companion row). The split only persists a string value.
      const writesCompanionStatus =
        companion?.hasStatus === true && typeof finalStatus === "string";
      const companionNextStatus = writesCompanionStatus
        ? finalStatus
        : undefined;
      // The one status this write persists, keyed to pick the single permission it
      // could require. For a non-default-locale write it is the companion
      // `_status`; otherwise the main-row status (both derive from `finalStatus`,
      // so they can only agree on the op — never conflict).
      const transitionNextStatus = isNonDefaultLocaleWrite
        ? companionNextStatus
        : mainNextStatus;
      // The guard carries the pre-resolved PERMISSION denial (document-
      // independent, judged off this transaction's connection) plus, when the
      // op's stored rule is document-dependent (owner-only/custom), the rules to
      // re-evaluate against the ROW-LOCKED document inside the transaction. A
      // custom transition rule keyed on a mutable field must not be judged
      // against the stale pre-transaction document.
      let transitionGuard: {
        op: "publish" | "unpublish";
        permissionDenied: SingleResult | null;
        documentRule: CollectionAccessRules | null;
      } | null = null;
      if (
        singleHasStatus &&
        !options.overrideAccess &&
        transitionNextStatus !== undefined
      ) {
        const transitionOp =
          transitionNextStatus === "published" ? "publish" : "unpublish";
        // Defer a document-dependent (owner-only/custom) rule for this op to the
        // under-lock re-check; public/authenticated/role-based rules are decided
        // here since they need no document. A session super-admin bypasses stored
        // rules on every transport (matching checkSingleAccess) — but NOT via a
        // scoped API key — so no document rule is installed for them, or the
        // under-lock evaluation (which does not re-apply the bypass) would wrongly
        // 403 an admin on an owner-only/custom Single they do not own.
        const isSuperAdminSession =
          isSuperAdminContext(options.user) &&
          options.authenticatedScope?.actorType !== "apiKey";
        const opRule = (singleMeta.accessRules as CollectionAccessRules)?.[
          transitionOp
        ] as { type?: string } | undefined;
        const deferDocumentRule =
          !isSuperAdminSession &&
          (opRule?.type === "owner-only" || opRule?.type === "custom");
        const permissionDenied = await checkSingleAccess({
          slug,
          operation: transitionOp,
          user: options.user,
          overrideAccess: options.overrideAccess,
          // NOT route-authorized: the route authorizes a Single write as
          // `update`, never as `publish`/`unpublish`, so the RBAC check for the
          // transition permission must actually run.
          routeAuthorized: false,
          rbacAccessControlService: this.rbacAccessControlService,
          // A scoped API key is judged on its own publish/unpublish grant, not
          // the key owner's — the route only checked `update` against the scope.
          authenticatedScope: options.authenticatedScope,
          accessControlService: this.accessControlService,
          accessRules: singleMeta.accessRules,
          document: existingDoc ?? undefined,
          deferStoredRuleEval: deferDocumentRule,
          logger: this.logger,
        });
        // Only guard under the lock when there is something to enforce there: a
        // pre-resolved permission denial, or a deferred document rule to re-judge.
        if (permissionDenied || deferDocumentRule) {
          transitionGuard = {
            op: transitionOp,
            permissionDenied,
            documentRule: deferDocumentRule
              ? (singleMeta.accessRules as CollectionAccessRules)
              : null,
          };
        }
      }

      // The auto-created default is persisted INSIDE the update transaction
      // below (not here), so the insert commits atomically with the update,
      // component saves, companion upsert, and version capture — a failure in any
      // of them rolls the default back instead of orphaning it, and a refused
      // publish (enforced under the lock below) rolls its insert back too.

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
      // Probe the companion `_locales` table's existence on the POOLED adapter
      // BEFORE the write transaction opens. Two reasons it must be here and not
      // inside the transaction: with a single-connection pool the transaction
      // holds the only connection, so a pooled probe inside it would deadlock;
      // and probing on the transaction connection would abort the whole
      // transaction on Postgres when the not-yet-migrated table is absent. The
      // in-transaction companion reads are skipped when this is false.
      const companionPhysicallyExists =
        companion && writeLocale !== undefined
          ? await companionTableExists(
              this.adapter,
              companion.companionTableName
            )
          : false;
      let updatedRows: SingleDocument[];
      try {
        // Retry the whole update+capture transaction on a version_no allocation
        // race; the re-run re-reads the max. The single UPDATE is deterministic.
        updatedRows = await withVersionConflictRetry(() =>
          this.adapter.transaction(async tx => {
            // First-write auto-create, committed atomically with the update. A
            // failed update/component/companion/version write rolls the insert
            // back rather than orphaning a default row, and no compensating
            // delete is needed. Idempotent: a `beforeUpdate` hook that read the
            // Single may already have auto-created the row (via `get`), and a
            // version-conflict retry re-enters this closure — in both cases the
            // existing row is reused instead of inserting a duplicate.
            if (autoCreated && pendingAutoCreateValues) {
              const committed = await tx.selectOne<SingleDocument>(
                singleMeta.tableName,
                {}
              );
              if (committed) {
                existingDoc = committed;
              } else {
                existingDoc = await tx.insert<SingleDocument>(
                  singleMeta.tableName,
                  pendingAutoCreateValues,
                  { returning: "*" }
                );
                // Seed the default-locale companion with the localized defaults
                // in the same transaction as the insert, so a localized field's
                // default is not stranded as null. The caller's companion write
                // for the write locale (below) then overlays only the fields it
                // supplied. No-op for a non-localized single.
                await this.queryService.seedLocalizedDefaultsCompanion(
                  tx,
                  singleMeta,
                  existingDoc.id,
                  pendingLocalizedDefaults,
                  (existingDoc as { status?: string }).status
                );
              }
            }
            // Unreachable: the pre-transaction step always resolves `existingDoc`
            // to a loaded or in-memory default, and the block above only replaces
            // it with another row. Narrows the closure-captured value to non-null.
            if (!existingDoc) {
              throw NextlyError.internal({
                logContext: {
                  slug,
                  reason: "single row missing after auto-create",
                },
              });
            }

            // TOCTOU-safe transition enforcement: reclassify the publish/unpublish
            // transition against the status read UNDER THE ROW LOCK here — the
            // committed main row, plus the write locale's companion `_status` for a
            // localized write — not the pre-transaction pooled read. This closes
            // two windows the earlier pre-transaction classification left open: a
            // concurrent writer that changed the published state after that read,
            // AND a hook/concurrent writer whose row was just adopted above (the
            // `committed ?? insert` branch) — the transition is judged against the
            // row this update actually mutates. The PERMISSION was pre-resolved
            // into `transitionGuard` off this transaction's connection (no
            // permission read here); a document-dependent (owner-only/custom)
            // rule is re-evaluated against the row-locked document below. Runs
            // before the UPDATE, so throwing rolls the transaction back — including
            // any auto-create insert above — with nothing persisted and no
            // compensating delete.
            if (transitionGuard) {
              // Lock + read the committed main row in the SAME query (`forUpdate`).
              // A plain read would, on MySQL's repeatable-read isolation, return
              // this transaction's snapshot (established by the pre-lock fetch) and
              // miss a concurrent writer's publish/unpublish; `FOR UPDATE` always
              // sees the latest committed row. SQLite serializes writers via BEGIN
              // IMMEDIATE, so the lock is a no-op and its committed read is current.
              const lockedRow = await tx.selectOne<SingleDocument>(
                singleMeta.tableName,
                { where: this.whereEq("id", existingDoc.id), forUpdate: true }
              );
              const lockedMainStatus =
                ((lockedRow as { status?: unknown } | null)?.status as
                  | string
                  | undefined) ?? null;
              // The write locale's committed companion `_status`, read under the
              // main-row lock: every write to this Single takes the main-row lock
              // first, so the companion read is serialized with concurrent writers.
              const lockedCompanionStatus =
                writesCompanionStatus && companion && writeLocale !== undefined
                  ? await this.readCompanionStatusInTx(
                      tx,
                      companion,
                      existingDoc.id,
                      writeLocale
                    )
                  : null;
              // The guard fires if EITHER the main row or the companion `_status`
              // makes the guarded transition against its row-locked prior status.
              const firesOnMainRow =
                mainNextStatus !== undefined &&
                resolvePublishTransition(lockedMainStatus, mainNextStatus) ===
                  transitionGuard.op;
              const firesOnCompanion =
                companionNextStatus !== undefined &&
                resolvePublishTransition(
                  lockedCompanionStatus,
                  companionNextStatus
                ) === transitionGuard.op;
              if (firesOnMainRow || firesOnCompanion) {
                // Permission first (pre-resolved, no DB read): a caller lacking
                // publish-<slug>/unpublish-<slug> is denied regardless of the row.
                if (transitionGuard.permissionDenied) {
                  transitionDeniedResult = transitionGuard.permissionDenied;
                  throw new SingleStatusTransitionDeniedError();
                }
                // Then the deferred document-dependent (owner-only/custom) rule,
                // judged against the ROW-LOCKED document (`lockedRow`) — not the
                // stale pre-transaction one — so a custom rule keyed on a mutable
                // field sees the committed value this update transitions from.
                // Pure evaluation, no metadata or permission read.
                if (transitionGuard.documentRule && lockedRow) {
                  const docResult =
                    await this.accessControlService.evaluateAccess(
                      transitionGuard.documentRule,
                      transitionGuard.op,
                      {
                        user: options.user
                          ? {
                              id: options.user.id,
                              role: options.user.role,
                              roles: options.user.roles,
                              email: options.user.email,
                            }
                          : undefined,
                      },
                      typeof (lockedRow as { id?: unknown }).id === "string"
                        ? (lockedRow as { id: string }).id
                        : undefined,
                      lockedRow
                    );
                  if (!docResult.allowed) {
                    transitionDeniedResult = {
                      success: false,
                      statusCode: 403,
                      message:
                        docResult.reason ??
                        `Access denied: ${transitionGuard.op} on single "${slug}" is not permitted`,
                    };
                    throw new SingleStatusTransitionDeniedError();
                  }
                }
              }
            }

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

            // Take the row lock the UPDATE below needs anyway, before reading
            // the prior main row and companion values. Without it a concurrent
            // update can commit between this read and this attempt's UPDATE,
            // leaving `previous` predating the other writer's fields while the
            // post-write document carries them — the diff would then attribute
            // that change to this event. Locking a few statements early costs
            // little since the UPDATE takes the same lock until commit either
            // way; the adapter no-ops where row locking is unsupported (SQLite
            // already serializes writers via BEGIN IMMEDIATE).
            await tx.lockRow(singleMeta.tableName, existingDoc.id);

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
            // `companionPhysicallyExists` was probed off the transaction above;
            // skip the in-transaction companion reads when the table is absent.
            if (
              companion &&
              writeLocale !== undefined &&
              companionPhysicallyExists
            ) {
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
                // This pre-image read feeds the durable webhook `previous`
                // payload and the table is already known to exist, so a real
                // read failure must abort the write rather than silently ship a
                // nulled `previous` (which would corrupt `changedFields`).
                strict: true,
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
                // Read on the write transaction's Drizzle handle (read-your-
                // writes, no raw SQL) so the prior per-locale status is the one
                // this attempt sees before the upsert below overwrites it.
                previousCompanionStatus = await readCompanionLocaleStatus(
                  tx.getDrizzle<
                    Parameters<typeof readCompanionLocaleStatus>[0]
                  >(),
                  companion.table,
                  existingDoc.id,
                  writeLocale
                );
              }
            }
            // The full post-write locale state: prior stored translations
            // overlaid with the columns this write touched. No extra DB read —
            // the prior values were just read above and `companionData` holds
            // this write's serialized translatable values.
            // Normalize blank written translations ("") to null so `data`
            // matches the read-shape convention `populateCompanionFields` used
            // for `previous`; without this a blank→blank edit would show
            // `data.field === ""` vs `previous === null` and appear in
            // `changedFields` for a field whose effective value did not change.
            const normalizedWrittenCompanion: Record<string, unknown> = {};
            for (const [column, value] of Object.entries(companionData)) {
              normalizedWrittenCompanion[column] = isBlank(value)
                ? null
                : value;
            }
            const dataCompanionValues: Record<string, unknown> = {
              ...previousCompanionValues,
              ...normalizedWrittenCompanion,
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

            // Whether this write genuinely stored per-locale component data.
            // Derived from the write INPUT (`componentFieldData`), not the read-
            // back doc: a scalar-only edit persists no component data, so it is
            // not mistaken for a localized component write. A non-localized
            // component written at a locale is the narrower edge this shares
            // with the version-capture gate.
            // A component write is per-locale only when a WRITTEN component's OWN
            // definition is localized. That is the exact gate the storage path
            // uses (`meta.localized !== true` keeps all of a component's data on
            // its shared main table), so it holds both ways: a non-localized
            // Single can embed a localized component (whose write DOES store
            // per-locale data), and a localized Single can embed a purely shared
            // one. Reading inner field types instead would over-tag a shared
            // component that merely carries text fields as locale-specific.
            let wroteLocalizedComponents = false;
            if (
              snapshotLocale !== undefined &&
              this.componentDataService &&
              this.localization !== undefined &&
              Object.keys(componentFieldData).length > 0
            ) {
              for (const writtenName of Object.keys(componentFieldData)) {
                const fieldConfig = fieldConfigs.find(
                  f => "name" in f && f.name === writtenName
                );
                if (!fieldConfig || !isComponentField(fieldConfig)) continue;
                // The instances this write actually stored: a single-component
                // field yields one; a dynamic-zone field yields each written
                // `_componentType` block (only the blocks the write used).
                const instances = writtenComponentInstances(
                  fieldConfig,
                  componentFieldData[writtenName]
                );
                let anyLocalizedWrite = false;
                for (const { slug, data } of instances) {
                  // A component stores per-locale data only when its OWN
                  // definition is localized AND the write touches one of its
                  // localized fields — its shared fields stay on the main
                  // comp_* row for every locale. So a write that changes only a
                  // localized component's shared fields is NOT per-locale.
                  if (
                    !(await this.componentDataService.isComponentLocalized(
                      slug,
                      tx.getDrizzle()
                    ))
                  ) {
                    continue;
                  }
                  const componentFields =
                    (await this.componentDataService.getComponentFields(
                      slug,
                      tx.getDrizzle()
                    )) ?? [];
                  const localizedNames = resolveLocalizedFieldNames(
                    componentFields.map(cf => ({
                      type: cf.type,
                      name: "name" in cf && cf.name ? cf.name : "",
                      localized: "localized" in cf ? cf.localized : undefined,
                    })),
                    true
                  );
                  if (localizedNames.some(name => data[name] !== undefined)) {
                    anyLocalizedWrite = true;
                    break;
                  }
                }
                if (anyLocalizedWrite) {
                  wroteLocalizedComponents = true;
                  break;
                }
              }
            }
            // `locale` rides the event only when the write genuinely stored
            // per-locale data: it touched localized Single columns, set a
            // per-locale status, or wrote localized component data. A plain
            // non-localized Single (or a shared-field-only edit) gets none, so a
            // receiver can tell one language's write apart from another's.
            const eventLocale: string | null =
              Object.keys(companionData).length > 0 ||
              companionStatus !== undefined ||
              wroteLocalizedComponents
                ? (snapshotLocale ?? null)
                : null;
            // Only overlay a per-locale status onto the outbox docs for a
            // genuinely per-locale event — one that rides a `locale` or that
            // assigned a status. Otherwise leave the assembled MAIN-row status
            // in place so a non-locale-specific write (e.g. a shared-field edit
            // on a non-default locale with no companion row) does not report a
            // per-locale "draft" over a published main row. Applied symmetrically
            // to `previous` and `data` so the diff stays like-for-like.
            const overlayLocaleStatus =
              eventLocale != null || writtenStatus !== undefined;
            // For a shared/non-locale-specific event on a LOCALIZED single, the
            // payload represents the default view (a no-locale read resolves to
            // the default locale), so it must carry the default locale's
            // translations — not null them out (empty companion values) and not
            // the write locale's content (which would be unlabeled
            // locale-specific data). A shared-field write never touches any
            // localized column, so the default locale's translations are the
            // same before and after; a default-locale (or non-localized) write
            // already read them into `previousCompanionValues`, while a
            // non-default write locale needs them read explicitly.
            const defaultLocale = this.localization?.defaultLocale;
            let defaultViewCompanion: Record<string, unknown> = {};
            let defaultViewLocale: string | undefined;
            if (
              eventLocale == null &&
              companion &&
              companionPhysicallyExists &&
              defaultLocale !== undefined
            ) {
              defaultViewLocale = defaultLocale;
              defaultViewCompanion =
                writeLocale === defaultLocale
                  ? previousCompanionValues
                  : await this.readCompanionLocaleValues(
                      tx,
                      companion,
                      existingDoc.id,
                      defaultLocale
                    );
            }

            // The locale the payload REPRESENTS. A locale-specific event reads
            // component subtrees at, and overlays translations for, the write
            // locale; a shared event on a localized single reads the default
            // view; a non-localized single has no locale.
            const payloadLocale = eventLocale ?? defaultViewLocale;

            const previousDoc = preRow
              ? await this.buildSingleWebhookDoc(
                  tx,
                  existingDoc.id,
                  singleMeta.tableName,
                  preRow,
                  fieldConfigs,
                  companion,
                  companionPhysicallyExists,
                  eventLocale != null
                    ? previousCompanionValues
                    : defaultViewCompanion,
                  payloadLocale,
                  overlayLocaleStatus ? previousLocaleStatus : undefined
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
                        // Surface a read failure (the catch below fails the
                        // write) instead of silently capturing an incomplete
                        // component snapshot in durable version history.
                        strict: true,
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
            // columns); a shared-field event instead carries the default view
            // (`defaultViewCompanion`), which the shared write left untouched.
            // Components are read on the transaction (read-your-writes).
            const dataDoc = await this.buildSingleWebhookDoc(
              tx,
              existingDoc.id,
              singleMeta.tableName,
              rows[0],
              fieldConfigs,
              companion,
              companionPhysicallyExists,
              eventLocale != null ? dataCompanionValues : defaultViewCompanion,
              payloadLocale,
              overlayLocaleStatus ? dataLocaleStatus : undefined
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
            // `slug` identifies WHICH single changed so a receiver can route the
            // event without scanning for the opaque document id; `single` still
            // FORBIDS an entry `collection` (the slug never feeds the collections
            // filter). `locale` rides only when the single (or an embedded
            // component) is localized, so a receiver can tell one language's
            // write apart from another's.
            const resource: WebhookResource = {
              kind: "single",
              slug,
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

      // The transaction committed (a throw would have propagated above), so a
      // real write is now durable together with its outbox event. Gate on the
      // written row: the empty-rows path returns from the tx before recording
      // anything, so it owes no delivery.
      eventRecorded = updatedRows.length > 0;

      if (updatedRows.length === 0) {
        return {
          success: false,
          statusCode: 500,
          message: "Failed to update Single document",
          // Carries the per-write state; here it is false (nothing was recorded
          // for an empty write) but is threaded for parity with the other returns.
          eventRecorded,
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
        eventRecorded,
      };
    } catch (error) {
      // A publish-transition refused against the row-locked status aborts the
      // write; return the 403 the pre-transaction guard resolved, not a 500.
      // Read from the out-of-band result rather than `instanceof`: the adapter
      // wraps the thrown sentinel in a DatabaseError before it reaches here.
      if (transitionDeniedResult) {
        return transitionDeniedResult;
      }
      this.logger.error("Failed to update Single document", { slug, error });
      // A post-commit step (afterChange/afterUpdate hook, response expansion)
      // can throw after the event is already durable; carry `eventRecorded` so
      // the fast-drain still fires for a committed-but-hook-failed write.
      return {
        ...buildSingleErrorResult(error, "Failed to update Single document"),
        eventRecorded,
      };
    }
  }

  /**
   * The write locale's committed per-locale `_status`, read INSIDE the write
   * transaction (on its connection) for the under-lock publish-transition gate.
   *
   * Reads through `tx.getDrizzle()` so it sees the transaction's own writes and
   * is serialized with concurrent writers by the main-row lock taken just before
   * it. The companion `_locales` table is a runtime Drizzle table object rather
   * than part of the static schema, so its columns are reached off the object
   * built by `buildCompanionSchema` — the same way `populateCompanionFields`
   * queries it. `(_parent, _locale)` is the companion primary key, so the lookup
   * returns at most one row.
   */
  private async readCompanionStatusInTx(
    tx: TransactionContext,
    companion: { table: unknown },
    parentId: string,
    locale: string
  ): Promise<string | null> {
    const table = companion.table as Record<string, Column>;
    const drizzle = tx.getDrizzle<{
      select: () => {
        from: (t: unknown) => {
          where: (c: unknown) => Promise<Record<string, unknown>[]>;
        };
      };
    }>();
    const rows = (await drizzle
      .select()
      .from(companion.table)
      .where(and(eq(table._parent, parentId), eq(table._locale, locale)))) as {
      _status?: unknown;
    }[];

    const status = rows[0]?._status;
    return typeof status === "string" ? status : null;
  }
}
