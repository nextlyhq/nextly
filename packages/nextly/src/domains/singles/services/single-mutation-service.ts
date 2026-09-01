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
import { isFieldGroupField } from "../../../collections/fields/guards";
import type { RBACAccessControlService } from "../../../domains/auth/services/rbac-access-control-service";
import { NextlyError } from "../../../errors/nextly-error";
import type { HookRegistry } from "../../../hooks/hook-registry";
import { keysToSnakeCase, toSnakeCase } from "../../../lib/case-conversion";
import { stripImmutableSystemFields } from "../../../lib/immutable-system-fields";
import {
  LIFECYCLE_STATUSES,
  isLifecycleStatus,
  resolvePublishTransition,
  stripUndefinedStatus,
} from "../../../lib/status-transition";
import {
  buildSingleRevalidationIntent,
  readRevalidateConfig,
} from "../../../revalidation/intent-builders";
import type { RevalidationIntent } from "../../../revalidation/types";
import {
  AccessControlService,
  type CollectionAccessRules,
  isSuperAdminContext,
} from "../../../services/access";
import { expansionAccess } from "../../../services/collections/trust-bound";
import {
  assumedBound,
  narrows,
} from "../../../services/collections/trust-grant";
import type { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import { BaseService } from "../../../shared/base-service";
import {
  SYSTEM_TIMESTAMP_KEYS,
  convertTimestampsToCamelCase,
} from "../../../shared/lib/case-conversion";
import { validateEntryData } from "../../../shared/lib/entry-validation";
import {
  applyFieldReadAccess,
  applyFieldWriteAccess,
  attachFieldValidators,
  runFieldHooks,
} from "../../../shared/lib/field-level-registry";
import {
  coerceDateFieldsToDate,
  normalizeRelationshipFields,
  relationshipValidationView,
} from "../../../shared/lib/field-transform";
import {
  hashPasswordFieldValues,
  stripPasswordFieldValues,
  stripSystemOwnerField,
} from "../../../shared/lib/password-fields";
import type { Logger } from "../../../shared/types";
import { readComponentSubtrees } from "../../field-groups/read-component-subtrees";
import { readFieldGroupType } from "../../field-groups/storage/field-group-type-key";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import {
  COMPANION_PARENT_COLUMN,
  COMPANION_STATUS_COLUMN,
} from "../../i18n/companion-columns";
import {
  isBlank,
  companionRowExists,
  populateCompanionFields,
  readCompanionLocaleStatus,
  readCompanionLocaleStatusAll,
} from "../../i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import { EVERY_LOCALE } from "../../i18n/locale-selector";
import {
  isValidLocale,
  resolveRequestedLocale,
} from "../../i18n/resolve-locale";
import {
  buildCompanionSchema,
  splitLocalizedWrite,
} from "../../i18n/runtime/companion-io";
import {
  cachedCompanionReadiness,
  companionNotReadyMessage,
  resolveCompanionReadiness,
} from "../../i18n/runtime/companion-readiness";
import { captureInTx } from "../../versions/capture-in-tx";
import { resolveDraftHold } from "../../versions/draft-hold";
import { resolveComponentSchemas } from "../../versions/restore-version";
import {
  resolveComponentFieldMap,
  tagComponentTypes,
  tagNestedComponentTypes,
} from "../../versions/tag-component-types";
import { VersionCaptureService } from "../../versions/version-capture-service";
import { withVersionConflictRetry } from "../../versions/version-conflict";
import { VersionsRepository } from "../../versions/versions-repository";
import { workingDraftLocale } from "../../versions/working-draft-locale";
import { expandComponentFields } from "../../webhooks/expand-component-fields";
import { recordMutationEvent } from "../../webhooks/record-mutation-event";
import { isOutboxRecordingActive } from "../../webhooks/recording-activation";
import type { WebhookResource } from "../../webhooks/types";
import type {
  SingleDocument,
  SingleResult,
  UpdateSingleOptions,
} from "../types";

import {
  splitPendingChange,
  writeCompanionValues,
} from "./apply-pending-change";
import { resolveSingleForRequest } from "./ensure-runtime-table";
import {
  SingleQueryService,
  buildSingleHookContext,
  checkSingleAccess,
  getSingleHookCollection,
  resolveNextlyForHooks,
} from "./single-query-service";
import { applyReadShape } from "./single-read-shape";
import type { SingleRegistryService } from "./single-registry-service";
import {
  buildSingleErrorResult,
  normalizeUploadFields,
  serializeJsonFields,
  shouldTreatAsJson,
} from "./single-utils";
import {
  buildSingleWebhookDoc,
  readCompanionLocaleValues,
} from "./single-webhook-doc";

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
    // Asked rather than indexed. Indexing the catalog reads exactly one spelling, so an
    // instance written under the other one is skipped silently — and skipping is what loses it.
    const slug = readFieldGroupType(instance);
    if (slug !== undefined) {
      out.push({
        slug,
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
    private readonly fieldGroupDataService?: FieldGroupDataService,
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
      fieldGroupDataService,
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
  /**
   * Remove a Single's pending working-draft sidecar for one language, under the
   * same row lock a draft save takes.
   *
   * A status-less save to a published Single stores its edit as a working draft
   * rather than overwriting the live row. Discarding removes that sidecar so the
   * editor resets to what is public; the live row and the durable history are
   * both untouched.
   *
   * The lock is what makes it safe to interleave with saves: a save committing
   * between this request's authorization checks and the delete would otherwise
   * have its brand-new draft removed with both requests reporting success. It is
   * a no-op where row locking is unavailable (SQLite, which already serializes
   * writers).
   *
   * Authorization is the caller's concern: the discard handler establishes read
   * and update on the document first. Deleting when no working draft exists is a
   * no-op, not an error.
   */
  async discardWorkingDraft(params: {
    slug: string;
    /**
     * Which language's pending change to discard. A localized Single holds one
     * per language, and removing them all would throw away work in languages the
     * author never opened. Ignored for an unlocalized Single, which has one.
     */
    locale?: string | null;
  }): Promise<void> {
    const singleMeta = await resolveSingleForRequest(
      this.adapter,
      this.singleRegistryService,
      params.slug,
      this.logger
    );
    if (!singleMeta) {
      throw NextlyError.notFound({
        logContext: {
          reason: "discard-working-draft-single-not-found",
          scopeSlug: params.slug,
        },
      });
    }

    await this.adapter.transaction(async tx => {
      // A Single is one row, so its identity comes from reading that row rather
      // than from the request. No row means the document has never been written,
      // which cannot have a pending change against it.
      const row = await tx.selectOne<{ id?: string }>(singleMeta.tableName, {});
      const entryId = row?.id;
      if (entryId === undefined) return;

      // Serialize with concurrent draft-save upserts, which lock this same row
      // before writing the sidecar.
      await tx.lockRow(singleMeta.tableName, entryId);
      await new VersionsRepository(tx).deleteWorkingDraft(
        {
          scopeKind: "single",
          scopeSlug: params.slug,
          entryId,
        },
        workingDraftLocale({
          documentLocalized: singleMeta.localized === true,
          requestLocale: params.locale ?? null,
          defaultLocale: this.localization?.defaultLocale ?? null,
        })
      );
    });
  }

  async update(
    slug: string,
    data: Record<string, unknown>,
    // Named `rawOptions` because the body must not read it: the wildcard locale
    // is resolved away into `options` immediately below. See there.
    rawOptions: UpdateSingleOptions = {}
  ): Promise<SingleResult> {
    // {@link EVERY_LOCALE} is a SWEEP INSTRUCTION, not a write locale. Resolved
    // once, here, so the twenty-odd places below that derive from
    // `options.locale` — `writeLocale`, the snapshot locale, the event payloads
    // — keep receiving a real locale or nothing. Mirrors the collection write
    // path exactly, because a Single scheduled in a release must behave the way
    // an entry scheduled in the same release behaves.
    const sweepAllLocales = rawOptions.locale === EVERY_LOCALE;
    const options: UpdateSingleOptions = sweepAllLocales
      ? { ...rawOptions, locale: undefined }
      : rawOptions;

    this.logger.debug("Updating Single document", { slug, options });

    // The wildcard moves a LIFECYCLE and nothing else — see the same guard on
    // `updateEntry` for why Strapi withholds `"*"` from its update method and
    // why Nextly, having one door for both, has to enforce the split here.
    if (sweepAllLocales) {
      const named = Object.keys(data);
      const statusOnly = named.length === 1 && named[0] === "status";
      // The VALUE, not merely the key — see the collection guard for why a
      // coerced non-string splits the write instead of refusing it.
      if (statusOnly && !isLifecycleStatus(data.status)) {
        return {
          success: false,
          statusCode: 400,
          message:
            `locale '${EVERY_LOCALE}' moves a publication status, so 'status' ` +
            `must be one of ${LIFECYCLE_STATUSES.join(", ")}. Received: ` +
            `${JSON.stringify(data.status)}.`,
        };
      }
      if (!statusOnly) {
        return {
          success: false,
          statusCode: 400,
          message:
            `locale '${EVERY_LOCALE}' moves the publication status of every ` +
            `language and writes nothing else, so it accepts a 'status' patch ` +
            `alone. Received: ${named.length === 0 ? "an empty patch" : named.join(", ")}. ` +
            `To write field values, name the language they belong to.`,
        };
      }
    }

    // Set true once the update transaction commits with a real write (which
    // always appends the outbox event); lets the catch and the `!updated`
    // return report a committed-but-post-hook-failed write as `eventRecorded`
    // even when `success` is false. Declared out here so every return sees it.
    let eventRecorded = false;
    // Set once a row is actually written, independent of the recording and
    // revalidation opt-outs — the durable-write signal the retention pass keys
    // off, so a Single that opts out of BOTH still triggers write-path cleanup.
    let committedWrite = false;
    // Whether the outbox event was actually appended: false when the Single
    // opted out of recording (`webhooks: false`), so the post-commit drain is
    // scheduled only for a write that recorded something. The three single.*
    // events share one resource, so the first call's result covers them all.
    let recorded = false;
    // The tags this write invalidates (`nextly:single:{slug}`), computed after
    // the event is recorded and carried on every post-event return so a
    // committed-but-hook-failed write still flushes its revalidation.
    let revalidationIntent: RevalidationIntent | undefined;
    // Set when the in-transaction transition check refuses the write against the
    // row-locked status. Declared out here (not in `try`) so the catch can read
    // it: the adapter wraps the thrown sentinel in a DatabaseError as the
    // transaction rolls back, so `instanceof` no longer identifies it after the
    // throw, but this result stays correct regardless of how the error is wrapped.
    let transitionDeniedResult: SingleResult | undefined;

    try {
      // 1. Get Single metadata from registry
      const singleMeta = await resolveSingleForRequest(
        this.adapter,
        this.singleRegistryService,
        slug,
        this.logger
      );
      if (!singleMeta) {
        return {
          success: false,
          statusCode: 404,
          message: `Single "${slug}" not found`,
        };
      }

      // 1.05. The wildcard moves a LIFECYCLE, so a Single that has none has
      // nothing for it to move. Mirrors the collection path, and for the same
      // reason: a Single carrying an ordinary user field named `status` has the
      // column and no lifecycle, and letting the wildcard through would write
      // that business field on one locale — a field write, which the wildcard
      // contract refuses. Refused rather than answered as a no-op success, so a
      // scheduled release cannot report itself applied having moved nothing.
      if (
        sweepAllLocales &&
        (singleMeta as { status?: boolean }).status !== true
      ) {
        return {
          success: false,
          statusCode: 400,
          message:
            `Single '${slug}' has no draft/published lifecycle, so locale ` +
            `'${EVERY_LOCALE}' has no publication status to move across its ` +
            `languages.`,
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
        const built = await this.queryService.buildDefaultDocument(singleMeta);
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

      // The component schemas the hold decision needs, resolved OFF the
      // transaction: this reads the component registry, and a registry read
      // inside the transaction would take a second pooled connection that the
      // open transaction is holding.
      const singleComponentSchemas =
        (singleMeta as { status?: boolean }).status === true &&
        singleMeta.versions?.drafts?.enabled === true
          ? await resolveComponentSchemas(fieldConfigs)
          : null;

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
          relationshipValidationView(currentData, fieldConfigs),
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

      // 6.25. Single-level beforeChange hooks, on data the validation gate has
      // just passed. The declaration used to register onto `beforeUpdate`,
      // which runs above at step 5 -- before validation -- so the hook that
      // documents itself as the last chance to shape a stored value saw data
      // the rules had not been applied to yet.
      if (this.hookRegistry.hasHooks("beforeChange", hookCollection)) {
        const beforeChangeResult = await this.hookRegistry.execute(
          "beforeChange",
          buildSingleHookContext({
            collection: hookCollection,
            operation: "update",
            data: currentData,
            originalData: existingDeserialized,
            user: options.user ?? undefined,
            context: sharedContext,
          })
        );
        if (beforeChangeResult !== undefined) {
          currentData = beforeChangeResult;
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

      // A wildcard that no longer carries a status after hooks has nothing to
      // move — same rule, same reasoning, as the collection path. A hook that
      // clears `status` would otherwise turn a document-wide lifecycle change
      // into a write that succeeds having moved nothing, which the release then
      // records as applied because the one language it re-reads was already
      // where it wanted to be.
      if (sweepAllLocales && !isLifecycleStatus(finalStatus)) {
        return {
          success: false,
          statusCode: 409,
          message:
            `locale '${EVERY_LOCALE}' was asked to move this Single's ` +
            `publication status, but after hooks the write carries no status ` +
            `to move. A hook that clears 'status' turns a document-wide ` +
            `lifecycle change into a write that silently does nothing.`,
        };
      }
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
          // Narrows that bypass per RELATED collection. Absent means unchanged;
          // dropping it here would silently restore the full bypass.
          trusted: options.trusted,
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
        if (isFieldGroupField(field) && currentData[field.name] !== undefined) {
          componentFieldData[field.name] = currentData[field.name];
          delete currentData[field.name];
        }
      });

      // 6.5. Password fields store bcrypt hashes, never the submitted
      // value — same guarantee as the collection write paths.
      await hashPasswordFieldValues(currentData, fieldConfigs);

      // 6.5. Normalize upload field values (strip expanded media objects to IDs)
      normalizeUploadFields(currentData, fieldConfigs);

      // 6.5. Relationships come back populated from a read at depth, so reduce
      // them to the references they stand for rather than storing a snapshot
      // of the related row.
      normalizeRelationshipFields(currentData, fieldConfigs);

      // 6.6. Coerce date-field strings into `Date` objects so Drizzle can
      // bind them to `timestamp` columns. Without this step the adapter
      // throws `value.toISOString is not a function` because JSON request
      // bodies always deliver dates as ISO strings.
      coerceDateFieldsToDate(currentData, fieldConfigs);

      // 7. Serialize JSON fields for storage
      const serializedData = serializeJsonFields(currentData, fieldConfigs);

      // 8. Update document in database.
      //
      // System columns are dropped AFTER snake-casing, so a caller cannot reach one by choosing
      // its other spelling: `firstPublishedAt` and `first_published_at` both arrive here as the
      // physical column name and both are refused. This previously removed `id` and `createdAt`
      // only, which left `updatedAt` and the first-publication marker writable from the request —
      // and the marker is meant to be set once, so a caller able to supply it could date a
      // publication that never happened or overwrite a real one.
      const snakeCaseData = stripImmutableSystemFields(
        keysToSnakeCase(serializedData) as Record<string, unknown>,
        "single"
      );
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
      const companionReadiness =
        companion && writeLocale !== undefined
          ? await resolveCompanionReadiness(this.adapter, {
              companionTableName: companion.companionTableName,
              mainTableName: singleMeta.tableName,
              localizedColumns: companion.localizedFields.map(f => f.column),
            })
          : undefined;
      const companionPhysicallyExists = companionReadiness === "ready";
      // A localized single whose companion table does not exist yet has nowhere to put
      // a NON-default locale's values: the split below moves them out of the main
      // payload and the companion upsert is then skipped, so the translation is
      // silently dropped while the write reports success. The window is real —
      // `db:sync` flips the registry's `localized` flag in its own process before the
      // running server creates the companion — so refuse rather than discard.
      //
      // The DEFAULT locale keeps the pre-companion fallback, but only where it can
      // actually work: an entity localized from creation keeps its translatable
      // columns solely on the companion, and its registered runtime table omits them,
      // so those keys would be dropped by the ORM while `updated_at` still moved.
      //
      // Both checks run HERE, before `adapter.transaction` opens. Introspecting from
      // inside it would borrow a second connection while the transaction holds one,
      // which on a small pool means waiting for a connection that cannot be released
      // until this transaction finishes. Resolving it first also keeps the refusal
      // exactly as raised: errors leaving a transaction callback pass through the
      // adapter's error classification, which rewraps anything that is not already a
      // `DatabaseError`.
      if (companion && !companionPhysicallyExists && this.localization) {
        // Captured so the closure below keeps the narrowed type.
        const defaultLocale = this.localization.defaultLocale;
        const refuse = (): never => {
          throw NextlyError.conflict({
            reason: "state",
            message: companionNotReadyMessage("single"),
            logContext: {
              cause: "localized-write-without-companion",
              single: singleMeta.slug,
              locale: writeLocale,
              defaultLocale,
              companionTable: companion.companionTableName,
            },
          });
        };
        if (writeLocale !== undefined && writeLocale !== defaultLocale) {
          refuse();
        }
        // `broken` is the state where the fallback has nowhere to land. Resolved above, on the
        // pooled connection and before the transaction, for the reasons this block already gives.
        // `undefined` means no write locale was named, which never reaches the fallback.
        if (companionReadiness === "broken") refuse();
      }

      // Same pre-transaction, pooled probe for the auto-create default seed: it
      // is keyed on the DEFAULT locale (not the write locale), so it needs its
      // own existence check rather than reusing `companionPhysicallyExists`.
      const seedCompanionExists = autoCreated
        ? await this.queryService.localizedDefaultsCompanionExists(
            singleMeta,
            pendingLocalizedDefaults
          )
        : false;
      let updatedRows: SingleDocument[];
      // Verify every localized field group in this payload can actually be written
      // BEFORE the transaction opens. Inside it the probes would borrow a second
      // connection while the transaction holds one, which on a small pool means
      // waiting for a connection that cannot be released until it finishes. It also
      // keeps the refusal exactly as raised: errors leaving a transaction callback
      // pass through the adapter's error classification, which rewraps anything that
      // is not already a `DatabaseError`.
      await this.fieldGroupDataService?.assertLocalizedFieldGroupsWritable({
        fields: fieldConfigs,
        data: componentFieldData,
        locale: options.locale,
      });

      try {
        // Retry the whole update+capture transaction on a version_no allocation
        // race; the re-run re-reads the max. The single UPDATE is deterministic.
        updatedRows = await withVersionConflictRetry(() =>
          this.adapter.transaction(async tx => {
            // True only when THIS transaction inserted the row AND seeded the
            // default-locale companion with the localized defaults. The version
            // snapshot overlay below is gated on it, not on `autoCreated`: two
            // first writes can race so that this request enters with
            // `autoCreated === true` but then adopts a row another writer already
            // inserted (the `committed` branch), in which case it did NOT seed —
            // the companion may already hold that writer's real translations, and
            // overlaying schema defaults would let a restore overwrite them.
            let didSeedCompanionDefaults = false;
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
                  (existingDoc as { status?: string }).status,
                  seedCompanionExists
                );
                // The seed persists defaults only when the companion physically
                // exists; track that this transaction actually seeded so the
                // snapshot overlay records defaults that were really written.
                didSeedCompanionDefaults = seedCompanionExists;
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
              // The sweep moves companion rows NEITHER test above can see, so a
              // wildcard write is judged as the lifecycle move it is,
              // unconditionally — the same reasoning, and the same hole, as the
              // collection path. With the main row and the default translation
              // already at the target status both tests answer no, while the
              // sweep still takes every other language there.
              if (firesOnMainRow || firesOnCompanion || sweepAllLocales) {
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
            // Only split when the companion physically exists. Splitting first and
            // then skipping the companion upsert (gated on the same flag below) would
            // drop the translatable values on the floor. While the table is absent
            // they stay on the main table — the pre-companion fallback — which the
            // pre-transaction guard above has already proven is actually possible.
            let { main: mainPayload, companion: companionData } =
              companion && companionPhysicallyExists
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

            // Asked UNDER THE LOCK, for the reason the collection path states:
            // a draft save serialises on this same row, so a check that ran
            // before the transaction can be overtaken by one that commits
            // first, and the release would proceed over work it never saw.
            if (
              sweepAllLocales &&
              singleMeta.versions?.drafts?.enabled === true
            ) {
              const writeDraftLocale = workingDraftLocale({
                documentLocalized: singleMeta.localized === true,
                // A wildcard carries no request locale by the time it reaches
                // here: it was resolved away so the body never sees it as one.
                requestLocale: null,
                defaultLocale: this.localization?.defaultLocale ?? null,
              });
              const heldBy = (
                await new VersionsRepository(tx).findAllWorkingDrafts({
                  scopeKind: "single",
                  scopeSlug: slug,
                  entryId: existingDoc.id,
                })
              )
                .map(draft => draft.locale)
                .filter(
                  (locale): locale is string =>
                    locale !== null && locale !== writeDraftLocale
                )
                // Only a configured language can block — see the collection
                // path for why a removed one would make this refusal
                // unsatisfiable rather than merely cautious.
                .filter(locale =>
                  new Set(
                    this.localization?.locales.map(l => l.code) ?? []
                  ).has(locale)
                );
              if (heldBy.length > 0) {
                transitionDeniedResult = {
                  success: false,
                  statusCode: 409,
                  message:
                    `This Single has unpublished changes in ${heldBy.join(", ")}. ` +
                    `Publish or discard them first, or publish each language on ` +
                    `its own — locale '${EVERY_LOCALE}' moves every language's ` +
                    `status and will not decide what happens to work that has ` +
                    `not been released.`,
                };
                throw new SingleStatusTransitionDeniedError();
              }
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

            // The first time this single becomes public, recorded on the row that is about to be
            // written so it commits with the status it describes.
            //
            // Only when the marker is still absent, which is what makes it the FIRST publication
            // rather than the latest: a republish after an unpublish must not move it.
            //
            // A non-default-locale write has already had `status` removed from `mainPayload`
            // above, so it stamps nothing here — that language's publish state lives on the
            // companion, and stamping the main row from it would date the entry's first
            // publication from a translation.
            //
            // `singleHasStatus` further down this block answers a wider question (main row OR
            // companion) and is declared after this point, so it cannot be read here; the main
            // row's own flag is what governs a main-row column.
            const mainStatusWritten = (mainPayload as Record<string, unknown>)
              .status;
            let priorStatuses = new Map<string, string | null>();
            // {@link EVERY_LOCALE}: a document already reachable in ANY language
            // is not being published for the first time.
            //
            // The main row can be draft beside a translation that has been live
            // since before this column existed, and the main row's own
            // transition then reads as a first publication for a document the
            // public could already see. Such a row carries null precisely
            // because its history was never captured, so dating it today would
            // record a publication that never happened. Asked only for a
            // wildcard write, which is the only one that moves languages the
            // main row says nothing about.
            let anotherLanguageWasAlreadyLive = false;
            // Kept for the event step: which language held which status BEFORE
            // the sweep is unrecoverable once it lands, and it decides which
            // transitions are real.
            if (
              sweepAllLocales &&
              companion &&
              companionPhysicallyExists &&
              companion.hasStatus
            ) {
              priorStatuses = await readCompanionLocaleStatusAll(
                tx.getDrizzle<
                  Parameters<typeof readCompanionLocaleStatusAll>[0]
                >(),
                companion.table,
                existingDoc.id,
                // READ inside the transaction, never resolved: resolving issues
                // a query, and a query against a missing relation aborts the
                // whole transaction on PostgreSQL.
                cachedCompanionReadiness(
                  this.adapter,
                  companion.companionTableName
                )
              );
              anotherLanguageWasAlreadyLive = [...priorStatuses.values()].some(
                status => status === "published"
              );
            }
            if (
              (singleMeta as { status?: boolean }).status === true &&
              mainStatusWritten === "published" &&
              preRowMainStatus !== "published" &&
              !anotherLanguageWasAlreadyLive &&
              (preRow as { first_published_at?: unknown } | undefined)
                ?.first_published_at == null
            ) {
              (mainPayload as Record<string, unknown>).first_published_at =
                new Date();
            }

            // Whether this write holds its edit instead of publishing it.
            // The same rule the collection write paths use, so a Single and an
            // entry can never answer differently about the same question.
            //
            // The live status is the one belonging to the language being
            // written: a non-default language's lifecycle lives on its
            // companion `_status`, not on the main row, so reading the main row
            // would judge a translation by another language's state.
            const singleLiveStatus =
              companion &&
              writeLocale !== undefined &&
              this.localization &&
              writeLocale !== this.localization.defaultLocale
                ? await this.readCompanionStatusInTx(
                    tx,
                    companion,
                    existingDoc.id,
                    writeLocale
                  )
                : preRowMainStatus;
            const { hold: holdEdit, draftLocale: singleDraftLocale } =
              resolveDraftHold({
                collectionHasStatus:
                  (singleMeta as { status?: boolean }).status === true,
                draftsVersioningEnabled:
                  singleMeta.versions?.drafts?.enabled === true,
                documentLocalized: singleMeta.localized === true,
                fields: fieldConfigs,
                componentSchemas: singleComponentSchemas,
                namedStatus: (updatePayload as Record<string, unknown>).status,
                liveStatus: singleLiveStatus,
                requestLocale: writeLocale ?? null,
                defaultLocale: this.localization?.defaultLocale ?? null,
              });

            // Publishing folds this language's pending change into the write.
            // Merged BEFORE the payload is re-split: the split moves translated
            // values out of the document and into the companion payload, so
            // merging afterwards would carry them to the main table, which has
            // no column for them.
            //
            // The caller's own payload wins over the draft: a publish that also
            // sets a field is saying something about that field now.
            let promotedDraft = false;
            if (
              !holdEdit &&
              (singleMeta as { status?: boolean }).status === true &&
              singleMeta.versions?.drafts?.enabled === true &&
              (updatePayload as Record<string, unknown>).status === "published"
            ) {
              const pendingDraft = await new VersionsRepository(
                tx
              ).findWorkingDraft(
                {
                  scopeKind: "single",
                  scopeSlug: slug,
                  entryId: existingDoc.id,
                },
                singleDraftLocale
              );
              if (pendingDraft) {
                // The caller's own payload wins over the pending change: a
                // publish that also sets a field is saying something about that
                // field now.
                ({ main: mainPayload, companion: companionData } =
                  splitPendingChange(
                    pendingDraft.snapshot,
                    companion && companionPhysicallyExists ? companion : null,
                    updatePayload
                  ));
                // A non-default language's lifecycle lives on its companion
                // `_status`; the main row must not be clobbered by it.
                if (
                  writeLocale !== undefined &&
                  this.localization &&
                  writeLocale !== this.localization.defaultLocale &&
                  Object.prototype.hasOwnProperty.call(mainPayload, "status")
                ) {
                  delete mainPayload.status;
                }
                promotedDraft = true;
              }
            }

            // Skip the live-row UPDATE for a held edit; the pending change is
            // stored below instead. The stored row still travels onward so
            // everything after this reports the document as it stands, which
            // for a held edit is the published content the public still sees.
            const rows = holdEdit
              ? [existingDoc]
              : await tx.update<SingleDocument>(
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
            // Whether a companion row already exists for the write locale. A row
            // can exist with every translatable value blank/null, which the value
            // read above cannot distinguish from a missing row — so the snapshot
            // locale gate below uses this, not value non-nullness, to decide the
            // locale is the snapshot's own.
            let previousCompanionRowExists = false;
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
                // Read, not resolved: this runs on the write transaction's connection. Any real
                // failure propagates, which this pre-image read needs — it feeds the durable
                // webhook `previous` payload, and a silently nulled `previous` would corrupt
                // `changedFields`.
                readiness: cachedCompanionReadiness(
                  this.adapter,
                  companion.companionTableName
                ),
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
                  writeLocale,
                  cachedCompanionReadiness(
                    this.adapter,
                    companion.companionTableName
                  )
                );
                // A status-bearing companion row always carries a non-null
                // `_status`, so its presence already answers row existence — no
                // extra query.
                previousCompanionRowExists = previousCompanionStatus !== null;
              } else if (singleMeta.versions?.enabled) {
                // Only the version-capture block consumes this, so a non-status
                // companion is probed for existence solely when versioning is on
                // — otherwise this would add a companion round trip to every
                // localized update while the write holds its row lock.
                previousCompanionRowExists = await companionRowExists(
                  tx.getDrizzle<Parameters<typeof companionRowExists>[0]>(),
                  companion.table,
                  existingDoc.id,
                  writeLocale,
                  cachedCompanionReadiness(
                    this.adapter,
                    companion.companionTableName
                  )
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
              this.fieldGroupDataService &&
              this.localization !== undefined &&
              Object.keys(componentFieldData).length > 0
            ) {
              for (const writtenName of Object.keys(componentFieldData)) {
                const fieldConfig = fieldConfigs.find(
                  f => "name" in f && f.name === writtenName
                );
                if (!fieldConfig || !isFieldGroupField(fieldConfig)) continue;
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
                    !(await this.fieldGroupDataService.isComponentLocalized(
                      slug,
                      tx.getDrizzle()
                    ))
                  ) {
                    continue;
                  }
                  const componentFields =
                    (await this.fieldGroupDataService.getComponentFields(
                      slug,
                      tx.getDrizzle()
                    )) ?? [];
                  const localizedNames = resolveLocalizedFieldNames(
                    componentFields.map(cf => ({
                      type: cf.type,
                      name: "name" in cf && cf.name ? cf.name : "",
                      // A contributed declaration is open, so `localized` is
                      // only usable when it really is the flag it names.
                      localized:
                        "localized" in cf && typeof cf.localized === "boolean"
                          ? cf.localized
                          : undefined,
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
                  : await readCompanionLocaleValues(
                      this.adapter,
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

            // Resolve the FULL recording gate ONCE, before assembling any webhook
            // payload. Building the previous/next documents calls
            // populateComponentData (strict) — a per-component read that can throw
            // on a missing/stale component table — and expands the field tree, all
            // of which only ever feed recordMutationEvent. The choke point
            // re-checks the same gate, so for an opted-out Single, or one with no
            // endpoint and audit off, this assembly is pure waste and must not be
            // able to fail a scalar content write.
            const recordingEnabled = isOutboxRecordingActive("single", slug);

            const previousDoc =
              recordingEnabled && preRow
                ? await buildSingleWebhookDoc(
                    this.fieldGroupDataService,
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

            // On a restore, read the CURRENT component subtrees before the save
            // below overwrites them, so the "Before restore" snapshot captured
            // with the version below holds the components the restore replaces.
            // Only for a restore into a versioned single; the common write path
            // never runs this read. Strict, so a real read failure fails the
            // write rather than snapshotting incomplete component data.
            let preRestoreComponents: Record<string, unknown> | undefined;
            if (
              options.sourceVersionNo != null &&
              singleMeta.versions?.enabled
            ) {
              // Mark the pre-restore snapshot as needed the moment this is a
              // versioned restore, independent of the component service: the
              // "Before restore" capture below is gated on this map existing, so
              // tying it to `fieldGroupDataService` would skip the whole snapshot
              // in a boot without that service and lose the replaced parent-row
              // content — the exact data loss this capture exists to prevent.
              // The component subtrees are read only when the service is present.
              preRestoreComponents = {};
              // The named component fields whose current subtrees the snapshot
              // must read before the restore overwrites them.
              const preComponentFields = fieldConfigs.filter(
                (f): f is typeof f & { name: string } =>
                  isFieldGroupField(f) && !!f.name
              );
              if (this.fieldGroupDataService && preComponentFields.length > 0) {
                try {
                  const populated =
                    await this.fieldGroupDataService.populateComponentData({
                      entry: { id: existingDoc.id },
                      parentTable: singleMeta.tableName,
                      fields: fieldConfigs,
                      executor: tx.getDrizzle(),
                      // References only, like the post-write and collection reads:
                      // an expanded relationship/upload would store the whole
                      // related row where the component write path expects an id,
                      // so restoring this snapshot would fail persistence; it
                      // would also smuggle the target's fields past a redaction
                      // list built from this Single's tree alone.
                      depth: 0,
                      strict: true,
                      ...(snapshotLocale !== undefined
                        ? {
                            locale: snapshotLocale,
                            fallbackLocale: false as const,
                          }
                        : {}),
                    });
                  for (const f of preComponentFields) {
                    if (populated[f.name] !== undefined) {
                      preRestoreComponents[f.name] = populated[f.name];
                    }
                  }
                } catch (err) {
                  // Wrap the raw driver error the same way the post-write
                  // snapshot read does: an unwrapped database error would reach
                  // the Single error fallback and ship the driver's own message
                  // (table names, driver details) to the API caller instead of
                  // the canonical internal-error response.
                  throw NextlyError.internal({
                    cause: err instanceof Error ? err : undefined,
                    logContext: {
                      reason:
                        "version-snapshot-single-prerestore-component-read",
                      slug,
                    },
                  });
                }
              }
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
              !holdEdit &&
              this.fieldGroupDataService &&
              Object.keys(attemptComponentData).length > 0
            ) {
              await this.fieldGroupDataService.saveComponentDataInTransaction(
                tx,
                {
                  parentId: existingDoc.id,
                  parentTable: singleMeta.tableName,
                  fields: fieldConfigs,
                  data: attemptComponentData,
                  locale: options.locale,
                  // A component instance is validated by its own pass inside the
                  // field-group service, so the request has to travel with it for a
                  // field rule nested in a field group to see the same `user` a
                  // top-level field rule sees.
                  req: options.user ? { user: options.user } : {},
                }
              );
            }

            // 9.6. i18n: upsert the companion row for the write locale in the SAME
            // transaction, stamping the per-locale `_status`. Fires even when only
            // status changed (companionData empty) so a per-locale unpublish still
            // updates `_status`. Then merge the written values back onto the
            // returned row so the PATCH response and afterChange/afterUpdate hooks
            // see the just-saved translation (the main row omits these columns).
            // Gated on the companion actually being there. The default-locale fallback leaves the
            // translatable values on main, so `companionData` is empty — but a payload carrying a
            // status still reaches here, and upserting `_status` into a table that does not exist
            // fails inside the transaction and rolls back the very write the fallback exists to
            // let through.
            if (
              // A held edit writes no companion row: the translation stored
              // there IS live content, so writing it would publish the
              // translated half of a change whose rest is still pending.
              !holdEdit &&
              // A wildcard does not manufacture a translation: the sweep moves
              // rows that exist rather than inventing a default-language row
              // for a document that has none. A PROMOTED draft is the one thing
              // that is not invention — an author wrote those values and this
              // write is publishing them — so it carries its own permission to
              // land. Without the exception the promotion below still consumes
              // the draft, and the edit reaches no read path at all.
              (!sweepAllLocales ||
                (promotedDraft && Object.keys(companionData).length > 0)) &&
              companion &&
              companionPhysicallyExists &&
              writeLocale !== undefined &&
              (Object.keys(companionData).length > 0 ||
                companionStatus !== undefined)
            ) {
              await writeCompanionValues({
                tx,
                dialect: this.adapter.dialect,
                companionTableName: companion.companionTableName,
                entryId: existingDoc.id,
                locale: writeLocale,
                values: companionData,
                status: companionStatus,
              });
              const row = rows[0] as Record<string, unknown>;
              for (const f of companion.localizedFields) {
                if (
                  Object.prototype.hasOwnProperty.call(companionData, f.column)
                ) {
                  row[f.column] = companionData[f.column];
                }
              }
            }

            // {@link EVERY_LOCALE}: carry the lifecycle to the languages the
            // write above did not name.
            //
            // The write above reaches ONE companion row. Without this a
            // scheduled takedown of a localized Single would leave every
            // translation of it live — the same defect the collection path
            // carried, and it has to be closed in both places because a release
            // member holds either kind.
            //
            // Same transaction as the main-row write, and an UPDATE rather than
            // an upsert: a language with no companion row has no translation,
            // and creating one to mark it published would invent the row whose
            // absence is the record that it was never translated.
            if (
              sweepAllLocales &&
              !holdEdit &&
              companion &&
              companionPhysicallyExists &&
              companion.hasStatus &&
              companionStatus !== undefined
            ) {
              await tx.update(
                companion.companionTableName,
                { [COMPANION_STATUS_COLUMN]: companionStatus },
                {
                  and: [
                    {
                      column: COMPANION_PARENT_COLUMN,
                      op: "=",
                      value: existingDoc.id,
                    },
                  ],
                }
              );
            }

            // Capture a version snapshot atomically with the write when the single
            // opts into versioning. Singles have no many-to-many fields; the
            // updated parent row (top-level keys camelCased to the read shape) plus
            // A promoted pending change is consumed: its content is now live,
            // and leaving the row would re-apply it on the next publish.
            if (promotedDraft) {
              await new VersionsRepository(tx).deleteWorkingDraft(
                {
                  scopeKind: "single",
                  scopeSlug: slug,
                  entryId: existingDoc.id,
                },
                singleDraftLocale
              );
            }

            // Store the pending edit as this Single's working draft for the
            // language being written. Accumulated onto the draft already there
            // rather than re-derived from the stored document: a second
            // status-less save of different fields would otherwise rebuild from
            // live content and silently revert the first pending edit.
            if (holdEdit) {
              const draftRepo = new VersionsRepository(tx);
              const draftRef = {
                scopeKind: "single" as const,
                scopeSlug: slug,
                entryId: existingDoc.id,
              };
              const existingDraft = await draftRepo.findWorkingDraft(
                draftRef,
                singleDraftLocale
              );
              const base = existingDraft
                ? (existingDraft.snapshot as Record<string, unknown>)
                : convertTimestampsToCamelCase({
                    ...(existingDoc as Record<string, unknown>),
                  });
              // The base is the READ shape (field names); `mainPayload` is the
              // WRITE shape (columns). Spreading one onto the other put both
              // spellings of every edited field in the snapshot — the live value
              // under `siteName` and the pending one under `site_name` — so which
              // value a consumer saw depended on which spelling it asked for.
              // The promote read the column and shipped the edit; anything
              // reading by field name got the stale live value.
              //
              // Mapped through the declared fields rather than camel-cased
              // wholesale, for the reason the version capture below gives: a
              // field genuinely named `site_title` must keep its own spelling.
              const pending: Record<string, unknown> = { ...base };
              for (const field of singleMeta.fields) {
                if (field.name === undefined) continue;
                const column = toSnakeCase(field.name);
                if (Object.prototype.hasOwnProperty.call(mainPayload, column)) {
                  pending[field.name] = (
                    mainPayload as Record<string, unknown>
                  )[column];
                }
              }
              // The system columns the loop above does not declare — status and
              // the timestamps — still ride along at the read shape.
              const systemPatch = convertTimestampsToCamelCase({
                ...(mainPayload as Record<string, unknown>),
              });
              for (const key of ["status", ...SYSTEM_TIMESTAMP_KEYS]) {
                if (Object.prototype.hasOwnProperty.call(systemPatch, key)) {
                  pending[key] = systemPatch[key];
                }
              }
              // A localized Single keeps its translatable values on the
              // companion row, so this write's translated values reach the
              // snapshot only by being overlaid here — keyed by field name to
              // match the read shape, as the version capture does.
              if (companion) {
                for (const f of companion.localizedFields) {
                  if (
                    Object.prototype.hasOwnProperty.call(
                      companionData,
                      f.column
                    )
                  ) {
                    pending[f.name] = companionData[f.column];
                  }
                }
              }
              await draftRepo.upsertWorkingDraft({
                ref: draftRef,
                locale: singleDraftLocale,
                snapshot: pending,
                createdBy: options.user?.id ?? null,
              });
            }

            // component subtrees form the snapshot.
            const versionsConfig = singleMeta.versions;
            // A held edit records no durable version: nothing was published, and
            // a version here would enter the history as though it had been.
            if (!holdEdit && versionsConfig?.enabled) {
              // Match the read shape: keep user field keys (field.name, which
              // may contain underscores like `site_title`) exactly, converting
              // only the timestamp columns — camel-casing every key would rewrite
              // those fields and diverge from a normal read.
              const parentRow = convertTimestampsToCamelCase({
                ...(rows[0] as Record<string, unknown>),
              });
              // i18n: a localized single's main row omits translatable columns
              // (split to the companion above), so overlay this locale's FULL
              // post-write translatable state onto the snapshot — otherwise the
              // version records blank translations. This write's own values
              // (`companionData`, serialized strings the JSON-parse pass below
              // normalizes) take precedence; every OTHER field of the write
              // locale falls back to its prior stored translation
              // (`previousCompanionValues`, already read shape). Without that
              // fallback a partial edit that touches only one field would drop
              // the locale's untouched translations from the snapshot and lose
              // them on restore. A prior value is carried whenever the read
              // returned the field AT ALL, null included: an untranslated field
              // is part of the locale's state, so recording it lets a restore
              // reset a field back to empty rather than leaving a later
              // translation standing. Keyed by field.name to match the read
              // shape; mirrors the collection capture, which reads back the full
              // write-locale companion.
              // Set when the fallback carries a REAL (non-null) prior translation
              // into the snapshot. That makes the snapshot locale-specific even
              // when this write touched only shared fields, so the locale tag
              // below must claim the locale — otherwise `restoreVersion` treats a
              // null-locale snapshot as shared-only and drops exactly these
              // recovered translations.
              let overlaidPriorTranslations = false;
              if (companion) {
                for (const f of companion.localizedFields) {
                  if (
                    Object.prototype.hasOwnProperty.call(
                      companionData,
                      f.column
                    )
                  ) {
                    parentRow[f.name] = companionData[f.column];
                  } else if (
                    Object.prototype.hasOwnProperty.call(
                      previousCompanionValues,
                      f.column
                    )
                  ) {
                    const priorValue = previousCompanionValues[f.column];
                    parentRow[f.name] = priorValue;
                    // A phantom null (the locale has no companion row yet) is not
                    // a real translation and must not force the locale tag, or a
                    // shared-only write to an untranslated locale would claim that
                    // language from state that was never its own.
                    if (priorValue != null) overlaidPriorTranslations = true;
                  }
                }
              }
              // First-write auto-create: the companion was seeded with the
              // localized field defaults for fields this update did not supply
              // (queryService.seedLocalizedDefaultsCompanion). Those values are
              // committed but absent from both `rows[0]` (main row omits
              // translatable columns) and `companionData` (only this write's
              // fields), so overlay them for any field this update did not write —
              // otherwise v1 omits persisted content and restoring it drops the
              // seeded defaults. This write's explicit values (overlaid above) win
              // over a default. Gated on the seed having actually run, so a
              // snapshot never records defaults the absent-companion seed skipped.
              //
              // The seed wrote ONLY to the DEFAULT-locale companion row, so these
              // defaults belong to the default-locale snapshot alone. Overlay them
              // only when this first write IS the default locale; a non-default
              // first write must not copy them in, or restoring it would
              // materialize the defaults as real translations in the wrong locale.
              // Gated on `didSeedCompanionDefaults` (set only when THIS
              // transaction inserted and seeded), never `autoCreated`: a request
              // that lost the auto-create race and adopted another writer's row
              // must not overlay schema defaults over that writer's real
              // translations.
              const isDefaultLocaleWrite =
                writeLocale === undefined ||
                writeLocale === this.localization?.defaultLocale;
              let seededDefaultsOverlaid = false;
              if (
                didSeedCompanionDefaults &&
                companion &&
                isDefaultLocaleWrite
              ) {
                const writtenFieldNames = new Set(
                  companion.localizedFields
                    .filter(f =>
                      Object.prototype.hasOwnProperty.call(
                        companionData,
                        f.column
                      )
                    )
                    .map(f => f.name)
                );
                for (const [name, value] of Object.entries(
                  pendingLocalizedDefaults
                )) {
                  if (!writtenFieldNames.has(name)) {
                    parentRow[name] = value;
                    seededDefaultsOverlaid = true;
                  }
                }
              }
              // Redact and normalise before the snapshot is durable: a password
              // hash written into version history stays recoverable after the
              // password changes, and an unparsed JSON field restores wrongly.
              applyReadShape(parentRow, fieldConfigs);
              // Read the component subtrees from the TRANSACTION (read-your-
              // writes, #226): the component save above just persisted them, so
              // the read returns the complete, read-shaped, password-stripped
              // subtrees with no in-memory overlay.
              const components = await readComponentSubtrees({
                fieldGroupDataService: this.fieldGroupDataService,
                tx,
                entryId: existingDoc.id,
                parentTable: singleMeta.tableName,
                fieldConfigs,
                // `snapshotLocale` is undefined when the Single itself is not
                // localized, but its embedded components can still be — and they
                // were saved with `options.locale` just above, so the snapshot
                // has to be read back the same way.
                locale: snapshotLocale,
                reason: "version-snapshot-single-component-read",
                logContext: { slug },
                onReadFailure: err =>
                  this.logger.error(
                    "Version snapshot: failed to read single components; failing the write instead of capturing an incomplete snapshot",
                    {
                      slug,
                      error: err instanceof Error ? err.message : String(err),
                    }
                  ),
              });
              // A component subtree read as the write locale is locale-specific
              // state too, so a component-only translation edit is not mistaken
              // for a shared-field write and left unrestorable.
              // Component schemas the snapshot's tagging needs, resolved once
              // so the walk itself stays synchronous.
              //
              // Read on the transaction's own connection: the registry lookup
              // would otherwise take a second pooled connection while this
              // write transaction still holds one, stalling a small pool.
              const snapshotComponentSchemas = this.fieldGroupDataService
                ? await resolveComponentFieldMap(fieldConfigs, slug =>
                    this.fieldGroupDataService!.getComponentFields(
                      slug,
                      tx.getDrizzle()
                    )
                  )
                : new Map<string, (typeof fieldConfigs)[number][]>();
              const snapshotComponentResolver = (slug: string) =>
                snapshotComponentSchemas.get(slug);

              // On a restore, snapshot the single AS IT IS NOW — before this
              // write overwrites it — so a restore never destroys content
              // written while versioning was off (held in no version). Captured
              // just below the number the restore's own capture takes, which the
              // retention pass already protects as "the content the restore
              // replaced"; it runs no retention itself, so it never trims the
              // version being restored FROM. Built from the pre-write main row,
              // its prior translations, and the components read before the save,
              // tagged like every other snapshot.
              if (options.sourceVersionNo != null && preRestoreComponents) {
                const prevParentRow = convertTimestampsToCamelCase({
                  ...(preRow as Record<string, unknown>),
                });
                if (companion) {
                  for (const f of companion.localizedFields) {
                    if (
                      Object.prototype.hasOwnProperty.call(
                        previousCompanionValues,
                        f.column
                      )
                    ) {
                      prevParentRow[f.name] = previousCompanionValues[f.column];
                    }
                  }
                }
                // Match the snapshot's own `status` field to the version's
                // recorded status: for a per-locale write that status lives on
                // the companion `_status`, so the pre-write main-row status left
                // here would otherwise disagree with `contentStatus` below and
                // undoing this restore would publish content that was draft (or
                // the reverse). A no-op for a default-locale/non-localized write,
                // where `previousLocaleStatus` is already the main-row status.
                if (singleHasStatus) {
                  prevParentRow.status = previousLocaleStatus;
                }
                stripPasswordFieldValues(prevParentRow, fieldConfigs);
                stripSystemOwnerField(prevParentRow);
                for (const field of fieldConfigs) {
                  if (!("name" in field) || !field.name) continue;
                  const v = prevParentRow[field.name];
                  if (shouldTreatAsJson(field) && typeof v === "string") {
                    try {
                      prevParentRow[field.name] = JSON.parse(v);
                    } catch {
                      // Not valid JSON — keep the raw string.
                    }
                  }
                }
                await captureInTx(tx, this.versionCapture, {
                  ref: {
                    scopeKind: "single",
                    scopeSlug: slug,
                    entryId: existingDoc.id,
                  },
                  contentStatus: previousLocaleStatus,
                  parts: {
                    parentRow: tagNestedComponentTypes(
                      prevParentRow,
                      fieldConfigs,
                      snapshotComponentResolver
                    ) as Record<string, unknown>,
                    components: tagComponentTypes(
                      preRestoreComponents,
                      fieldConfigs,
                      snapshotComponentResolver
                    ),
                  },
                  createdBy: options.user?.id ?? null,
                  // Labelled with a locale only when the prior state actually
                  // held locale-specific values — see the post-write capture.
                  locale:
                    Object.keys(previousCompanionValues).length > 0 ||
                    previousCompanionStatus !== null ||
                    Object.keys(preRestoreComponents).length > 0
                      ? (snapshotLocale ?? null)
                      : null,
                  label: "Before restore",
                });
              }

              const capturedLocalizedComponents =
                snapshotLocale !== undefined &&
                Object.keys(components).length > 0;

              // Whether this snapshot holds locale-specific state and is therefore
              // tagged with `snapshotLocale`. Includes `overlaidPriorTranslations`
              // (a shared-field write that folded in a non-null translation) and
              // `previousCompanionRowExists` (the locale has a companion row even
              // if every translated value is currently blank) — so a shared-field
              // write at an already-translated locale is tagged and a restore
              // resets its fields, rather than the null-locale snapshot dropping
              // them. The status handling below stays in lockstep with the tag.
              const isLocaleSpecificSnapshot =
                Object.keys(companionData).length > 0 ||
                companionStatus !== undefined ||
                capturedLocalizedComponents ||
                seededDefaultsOverlaid ||
                overlaidPriorTranslations ||
                previousCompanionRowExists;
              // For a locale-specific snapshot of a status-bearing Single, the
              // status is the WRITE LOCALE's own (`dataLocaleStatus`), not the
              // main row's. A snapshot tagged a draft non-default locale that
              // carried the published main-row status would, on restore, publish
              // that translation. Overlay it onto the snapshot's parent row too so
              // its `status` field matches the recorded `contentStatus`.
              if (singleHasStatus && isLocaleSpecificSnapshot) {
                parentRow.status = dataLocaleStatus;
              }

              await captureInTx(tx, this.versionCapture, {
                ref: {
                  scopeKind: "single",
                  scopeSlug: slug,
                  entryId: existingDoc.id,
                },
                // A locale-specific snapshot records the write locale's own
                // status; otherwise prefer the written status, then the companion
                // `_status` for a per-locale change, then the row's.
                contentStatus:
                  singleHasStatus && isLocaleSpecificSnapshot
                    ? dataLocaleStatus
                    : ((updatePayload as { status?: unknown }).status ??
                      companionStatus ??
                      (parentRow as { status?: unknown }).status),
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
                // `seededDefaultsOverlaid` forces the default-locale tag for a
                // shared-fields-only first write that seeded default-locale
                // translations: without it `companionData` is empty, the locale
                // resolves null, and a restore treats the snapshot as shared-only
                // and drops the seeded defaults. The overlay only runs on a
                // default-locale write, so `snapshotLocale` is the default locale.
                locale: isLocaleSpecificSnapshot
                  ? (snapshotLocale ?? null)
                  : null,
                sourceVersionNo: options.sourceVersionNo ?? null,
                maxPerDoc: versionsConfig.maxPerDoc,
              });
            }

            // A real save SUPERSEDES this author's recovery point, exactly as on
            // the collection write path. The work it held is now in the
            // document, and a Single that kept it would offer the same stale
            // draft back on every open forever -- nothing else ever removes it,
            // because the only other sweep runs when the ENTITY is deleted.
            //
            // Scoped to the SAVING author, so a second editor's unsaved work
            // survives somebody else's save, and inside the write transaction,
            // so a failed save leaves the recovery point rather than destroying
            // the only copy of work it did not store.
            await new VersionsRepository(tx).deleteAutosaves(
              {
                scopeKind: "single",
                scopeSlug: slug,
                entryId: existingDoc.id,
              },
              options.user?.id ?? null
            );

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
            // Assemble the event document only when recording — this is the
            // populateComponentData(strict) read the opt-out must skip. When off,
            // recordMutationEvent ignores `data`, so the raw written row stands in.
            const dataDoc = recordingEnabled
              ? await buildSingleWebhookDoc(
                  this.fieldGroupDataService,
                  tx,
                  existingDoc.id,
                  singleMeta.tableName,
                  rows[0],
                  fieldConfigs,
                  companion,
                  companionPhysicallyExists,
                  eventLocale != null
                    ? dataCompanionValues
                    : defaultViewCompanion,
                  payloadLocale,
                  overlayLocaleStatus ? dataLocaleStatus : undefined
                )
              : rows[0];

            // The single's field tree with component references expanded, so the
            // secret/hidden strip descends into fields declared inside a
            // component. Resolved on the transaction's connection (components
            // already read on it) to avoid taking a second pooled connection
            // while this write still holds one. Skipped on the same opt-out: the
            // per-component registry reads would be pure waste and a scalar write
            // should not be able to fail on them.
            const webhookFields = recordingEnabled
              ? await expandComponentFields(
                  fieldConfigs,
                  async componentSlug =>
                    this.fieldGroupDataService
                      ? await this.fieldGroupDataService.getComponentFields(
                          componentSlug,
                          tx.getDrizzle()
                        )
                      : null
                )
              : fieldConfigs;

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
            // Record only when the same opt-out decision that gated the payload
            // assembly still holds. `recordMutationEvent` re-derives the policy
            // internally, but a dev HMR reload can flip `webhooks` mid-write: if
            // it went false -> true between the check above and here, that
            // internal re-check would record the DEGRADED opt-out payload built
            // above (raw row, no previous, unexpanded components). Gating on the
            // one `recordingEnabled` value read at assembly time keeps the two
            // checks from diverging — either the full payload is recorded, or
            // nothing is. (An opt-out that flips true -> false mid-write likewise
            // records nothing here, which is the safe direction.)
            if (recordingEnabled) {
              recorded = await recordMutationEvent(tx, {
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

              // {@link EVERY_LOCALE}: the languages the sweep moved that the
              // write locale's events above do not cover.
              //
              // Without this a scheduled German publish records nothing for
              // German, so locale-routed consumers stay stale while the release
              // reports success — the same gap the collection path had, and a
              // Single reaches it through a different branch.
              if (
                sweepAllLocales &&
                singleHasStatus &&
                writtenStatus !== undefined &&
                companion &&
                companionPhysicallyExists
              ) {
                // A locale the app no longer configures still has a
                // companion row, and an event tagged with one that normal reads
                // and writes reject would mislead a locale-routed consumer —
                // it names content the application no longer exposes. Both the
                // collection sweep and the publish-all route already filter
                // these, so this is the same decision rather than a new one.
                const configuredLocales = new Set(
                  this.localization?.locales.map(l => l.code) ?? []
                );
                for (const [locale, prior] of priorStatuses) {
                  if (locale === eventLocale) continue;
                  if (
                    configuredLocales.size > 0 &&
                    !configuredLocales.has(locale)
                  ) {
                    continue;
                  }
                  const nowPublished = dataLocaleStatus === "published";
                  const wasPublished = prior === "published";
                  if (nowPublished === wasPublished) continue;
                  const localeValues = await readCompanionLocaleValues(
                    this.adapter,
                    tx,
                    companion,
                    existingDoc.id,
                    locale
                  );
                  // THIS language on both sides, with only the status differing:
                  // a payload tagged `de` carrying the default language's text
                  // would be worse than none, because a consumer cannot tell it
                  // is wrong.
                  const localeDoc = { ...dataDoc, ...localeValues };
                  await recordMutationEvent(tx, {
                    type: nowPublished
                      ? "single.published"
                      : "single.unpublished",
                    resource: {
                      kind: "single",
                      slug,
                      id: existingDoc.id,
                      locale,
                    },
                    data: localeDoc,
                    previous: { ...localeDoc, status: prior },
                    fields: webhookFields,
                    actor,
                  });
                }
              }
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
      // real write is now durable. Cache revalidation follows the CONTENT write,
      // so build its intent whenever a row was written — including an opted-out
      // Single, whose committed content must still bust its ISR tag even though
      // it records no outbox event.
      const wroteRow = updatedRows.length > 0;
      // The row is durable regardless of the recording/revalidation opt-outs.
      committedWrite = wroteRow;
      // `eventRecorded` additionally requires that recording actually happened:
      // the empty-rows path returns before recording, and an opted-out Single
      // records nothing — either way it owes no delivery/drain.
      eventRecorded = wroteRow && recorded;
      if (wroteRow) {
        // A single is consumed sitewide, so its one tag is the whole cascade.
        revalidationIntent = buildSingleRevalidationIntent(
          slug,
          readRevalidateConfig(singleMeta)
        );
      }

      if (updatedRows.length === 0) {
        return {
          success: false,
          statusCode: 500,
          message: "Failed to update Single document",
          // Carries the per-write state; here both are false (no row written) but
          // are threaded for parity with the other returns.
          eventRecorded,
          committed: committedWrite,
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

      // 10.5. Expand upload fields with full media data.
      //
      // Carries the same caller as the relationship expansion below. Media is a
      // system table with no stored rules, so a write that narrowed its bypass
      // has refused that target like any other, and this expansion is the only
      // one that reads it. The two are not alternatives: a Single holding
      // uploads and no relationship field returns before the expansion below
      // does anything, so a bound applied only there reaches nothing.
      updatedDoc = await this.queryService.expandUploadFields(
        updatedDoc,
        fieldConfigs,
        expansionAccess(options)
      );

      // 10.6. Expand relationship fields with full related entry data.
      //
      // The rows this pulls in belong to another collection and carry that
      // collection's field rules. A writer supplied a relationship id, not the
      // related row's protected fields, so returning them here would answer a
      // question the same caller's GET refuses — the write path is not a way
      // around the rule.
      //
      // Enforced for every caller the access gate applies to, which is what the
      // read path does. A caller with no identity is judged as one — the same
      // answer their read would get — and only a trusted write bypasses it,
      // through `overrideAccess` rather than through an absent user.
      updatedDoc = await this.queryService.expandRelationshipFields(
        updatedDoc,
        fieldConfigs,
        // The write response has no depth option of its own; expansion applies
        // its own default.
        undefined,
        {
          enforceFieldAccess: true,
          user: options.user,
          overrideAccess: options.overrideAccess,
          // Narrows that bypass per RELATED collection. Absent means unchanged;
          // dropping it here would silently restore the full bypass.
          trusted: assumedBound(options.trusted),
          authenticatedScope: options.authenticatedScope,
          // The language just written: a target collection's read rule may
          // scope reads by one of its own localized fields, and that filter
          // needs to name a language to be applied at all.
          locale: this.localization
            ? resolveRequestedLocale(this.localization, options.locale)
            : undefined,
          // A trusted write sees the row it just wrote regardless of
          // lifecycle; an untrusted one gets the published default, the
          // same answer its own GET would give.
          // The row this write just produced, read back at its own lifecycle.
          // Withheld from a BOUNDED caller because it propagates into
          // relationship expansion, where an explicit `"all"` is honoured
          // before the narrowed override is consulted — so the bound would be
          // defeated by a status that was never asked for.
          status:
            options.overrideAccess === true && !narrows(options.trusted)
              ? "all"
              : undefined,
        }
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
        revalidationIntent,
        committed: committedWrite,
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
        revalidationIntent,
        committed: committedWrite,
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
