/**
 * CollectionMutationService — Write/mutation operations for collection entries.
 *
 * Extracted from CollectionEntryService (6,490-line god file) to handle all
 * create, update, and delete operations with hooks, validation, and relationships.
 *
 * Responsibilities:
 * - Create new entries with hooks, validation, relationships
 * - Update existing entries with hooks, validation
 * - Delete entries with hooks and cascading
 * - Transaction-aware variants of all CRUD operations
 * - Field uniqueness checking for stored hook validation
 * - Single-entry transaction helpers for batch operations
 */

import { isDeepStrictEqual } from "node:util";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  TransactionContext,
  TransactionOptions,
  WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";
import {
  eq,
  ne,
  and,
  like,
  ilike,
  inArray,
  type SQLWrapper,
} from "drizzle-orm";

// `OperationType` was removed during the PR 4 migration — this module no longer
// references it, so we import only `BeforeOperationArgs`.
import type { BeforeOperationArgs } from "@nextly/hooks/types";
import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { holdsGrant } from "../../../auth/access/gate-adapters";
import {
  actorForVisitor,
  userHoldsPermission,
} from "../../../auth/access/resolve-actor";
import type { RuleFilter } from "../../../auth/access/rule-answer";
import {
  askEachLanguage,
  currentRuleLanguage,
  readLanguagesFor,
  withRuleLanguage,
  writeAsNamedLanguagesFor,
  writeLanguagesFor,
} from "../../../auth/access/rule-language";
import {
  type AuthenticatedScope,
  scopeHoldsSuperAdmin,
} from "../../../auth/authenticated-scope";
import {
  effectiveCallerScope,
  runWithCallerScope,
} from "../../../auth/caller-scope";
import { currentPrincipal } from "../../../auth/principal-scope";
import { actorForWrite, type RequestActor } from "../../../auth/request-actor";
import { isFieldGroupField } from "../../../collections/fields/guards";
import type { FieldConfig } from "../../../collections/fields/types";
// PR 4 migration: switched from mapDbErrorToServiceError to NextlyError.
import { toDbError } from "../../../database/errors";
import {
  asNotMigrated,
  collectionNotMigrated,
  collectionRowNotMigrated,
} from "../../../database/with-db-errors";
// The public CollectionServiceResult shape is preserved because the legacy
// CollectionEntryService facade and CollectionBulkService still consume it;
// only the internal error mapping changed. fromDatabaseError keeps driver
// text out of the wire and routes identifying detail to logContext (§13.8).
import { NEXTLY_ERROR_STATUS, NextlyError } from "../../../errors";
import {
  errorEnvelopeFields,
  errorFromServiceEnvelope,
} from "../../../errors/from-service-envelope";
import { withOriginalError } from "../../../errors/original-error";
import type { ValidationPublicData } from "../../../errors/public-data";
import { emitDocumentEvent } from "../../../events/domain-events";
import { getEventBus } from "../../../events/event-bus";
// A working draft as an after-hook compares against it (`markedDraft`): marked
// as the draft it is diffed with is, so a repeat draft save does not report the
// marker as changing. Shared with the in-transaction phase, which marks one the
// same way.
import {
  type InTransactionCall,
  inTransactionHandlersFor,
  markedDraft,
  replacedByUpdate,
  runInTransactionPhaseFor,
  writtenByUpdate,
} from "../../../hooks/in-transaction-call";
import type { InTransactionHandlerSet } from "../../../hooks/in-transaction-phase";
import { resolveRequestFacts } from "../../../hooks/request-facts";
import { recordFlattenedError } from "../../../hooks/side-effect-warnings";
import { toSnakeCase } from "../../../lib/case-conversion";
import {
  isStatusOnlyWrite,
  stripImmutableSystemFields,
  writeGateFor,
} from "../../../lib/immutable-system-fields";
import {
  LIFECYCLE_STATUSES,
  isLifecycleStatus,
  resolveFirstPublishedStamp,
  resolvePublishTransition,
  selectPublicationTransition,
  stripUndefinedStatus,
} from "../../../lib/status-transition";
import {
  buildEntryRevalidationIntent,
  readRevalidateConfig,
  readStringField,
} from "../../../revalidation/intent-builders";
import type { RevalidationIntent } from "../../../revalidation/types";
import { permissionSlug } from "../../../schemas/_zod/rbac";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import type { ResolvedVersionsConfig } from "../../../schemas/versions/types";
import type { CollectionFileManager } from "../../../services/collection-file-manager";
import type {
  CollectionRelationshipService,
  RelationshipDbExecutor,
} from "../../../services/collections/collection-relationship-service";
import { narrows } from "../../../services/collections/trust-grant";
import type { TrustBound } from "../../../services/collections/trust-grant";
import type { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import {
  convertTimestampsToCamelCase,
  rehydrateSystemTimestamps,
  SYSTEM_TIMESTAMP_KEYS,
} from "../../../shared/lib/case-conversion";
import {
  declaredFieldNames,
  refusalIssues,
  resolvePromotedDocument,
} from "../../../shared/lib/denied-change";
import { detachData } from "../../../shared/lib/detach";
import {
  hookChangedWholeNumberIssues,
  validateEntryData,
  type EntryWriteContext,
  type ValidationIssue,
  type ValidatableField,
} from "../../../shared/lib/entry-validation";
import { applyFieldDefaults } from "../../../shared/lib/field-defaults";
import {
  anyFieldGroupHasAccessRule,
  applyFieldReadAccess,
  applyFieldWriteAccess,
  hasFieldAccessRule,
  resolvedCallerGrants,
  callerAccessGrants,
  type CallerGrants,
  attachFieldValidators,
  getFieldFunctions,
  runFieldHooks,
} from "../../../shared/lib/field-level-registry";
import {
  coerceDateFieldsToDate,
  normalizeRelationshipFields,
  relationshipValidationView,
} from "../../../shared/lib/field-transform";
import { filterKeys } from "../../../shared/lib/filterable-fields";
import { toJsonColumnValue } from "../../../shared/lib/json-column-value";
import {
  carryStoredPasswords,
  type FieldGroupReach,
  hasPasswordField,
  hashPasswordFieldValues,
  NO_FIELD_GROUPS,
  reachesPasswordField,
  stripPasswordFieldValues,
  stripServerOnlyColumns,
} from "../../../shared/lib/password-fields";
import {
  assignRepeaterRowIds,
  reachesRepeaterField,
} from "../../../shared/lib/repeater-row-ids";
import {
  issuesTheReaderMaySee,
  type IssueReader,
} from "../../../shared/lib/unreadable-field-issues";
import { recordWriteReceipt } from "../../../shared/lib/write-receipt";
import {
  isWriteIntegrityFailure,
  markWriteIntegrityFailure,
} from "../../../shared/write-integrity";
import type { SupportedDialect } from "../../../types/database";
import { editsOver } from "../../audit/lifecycle-fields";
import { willRecordMutationActivity } from "../../audit/record-activity";
import {
  recordSaveEvent,
  recordTransitionEvents,
  recordWriteEvent,
  type StatusMove,
  type WriteEventInput,
} from "../../content-events/write-event";
import { dashboardPinsPresent } from "../../dashboard/dashboard-pins";
import { transactionTableProbe } from "../../dashboard/table-presence";
import type { DynamicCollectionService } from "../../dynamic-collections";
import { refuseWriteIfRemovedFromCode } from "../../dynamic-collections/services/removed-from-code-writes";
import {
  applyFieldGroupWriteAccessToDocument,
  applyInlineFieldGroupWriteAccess,
  keepDeniedAtStoredOnUpdate,
  keepDeniedFieldGroupsInDraft,
  reachesFieldGroup,
  withStoredFieldGroups,
} from "../../field-groups/field-group-write-access";
import {
  liveFieldGroupReadPass,
  sharedPerTransaction,
} from "../../field-groups/live-read-access";
import { isMissingTable } from "../../field-groups/migration/session";
import { passwordReachOf } from "../../field-groups/password-reach";
import { readComponentSubtreesByLocale } from "../../field-groups/read-component-subtrees";
import {
  fieldGroupWriteAccessOf,
  type FieldGroupWriteAccess,
} from "../../field-groups/services/field-group-mutation-service";
import { referencedFieldGroupFields } from "../../field-groups/storage/field-group-field-type";
import {
  isFieldLocalized,
  resolveLocalizedFieldNames,
} from "../../i18n/classify-fields";
import {
  COMPANION_LOCALE_COLUMN,
  COMPANION_PARENT_COLUMN,
  COMPANION_STATUS_COLUMN,
  resolveEffectiveLocaleStatus,
} from "../../i18n/companion-columns";
import {
  companionRowExists,
  populateCompanionFieldsAllLocales,
  populateCompanionFieldsByLanguage,
  readCompanionLocaleStatus,
  readCompanionLocaleStatusAll,
  readCompanionLocaleStatusAllOf,
  isBlank,
} from "../../i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import { forgetRecoveryPointIn } from "../../i18n/forget-recovery-point";
import {
  languagesChangedConflict,
  languagesGoingLiveFrom,
  languagesPromotedChangeReaches,
  languagesToAsk,
  unaskedLanguages,
} from "../../i18n/languages-going-live";
import { EVERY_LOCALE } from "../../i18n/locale-selector";
import {
  type LocalizationSource,
  localizationNow,
  storedLanguageCodes,
} from "../../i18n/localization-source";
import { COMPANION_DEFAULT_STATUS } from "../../i18n/migration/generate-up";
import { reachesLocalizedFieldGroup } from "../../i18n/per-language-fields";
import {
  isValidLocale,
  resolveLocaleChain,
  resolveRequestedLocale,
} from "../../i18n/resolve-locale";
import {
  companionHasStatusColumn,
  companionContentStamp,
  companionWriteVia,
  upsertCompanionRow,
  type CompanionSchema,
} from "../../i18n/runtime/companion-io";
import {
  cachedCompanionReadiness,
  type CompanionReadiness,
  companionFoundMissing,
  companionNotReadyMessage,
  isCompanionReady,
  resolveCompanionReadiness,
} from "../../i18n/runtime/companion-readiness";
import { stopReleasesHolding } from "../../releases/early-stop";
import { liveColumnNames } from "../../schema/pipeline/diff/introspect-live";
import {
  sharedComparison,
  type SharedComparison,
} from "../../singles/services/live-shared-single";
import { assembleDocument } from "../../versions/assemble-document";
import { captureInTx } from "../../versions/capture-in-tx";
import {
  bumpDocumentRevision,
  changerColumns,
  documentVersionOn,
  mainRowBump,
  setDocumentVersion,
  translationChangeColumns,
  translationRevisionBumpColumns,
  translationTableOf,
  updateTimeOf,
  versionLanguagesFor,
  withDocumentVersion,
  withoutDocumentVersionKeys,
} from "../../versions/document-revision";
import {
  draftComponentValues,
  mergeComponentPatches,
} from "../../versions/draft-components";
import { resolveDraftHold } from "../../versions/draft-hold";
import { storeDraftSave } from "../../versions/draft-save";
import { isDraftSplitEligible } from "../../versions/draft-split-eligibility";
import {
  mediaUsageTablePresent,
  sweepDeletedDocument,
} from "../../versions/entity-teardown";
import { languagesHoldingWorkingDrafts } from "../../versions/held-working-drafts";
import { recordOverwriteIfAsked } from "../../versions/overwrite-record";
import {
  combinedDraft,
  draftsKeptByPart,
  findPartDrafts,
  holdsPendingChange,
  partKeysOf,
  partsPromoted,
  SHARED_DRAFT_SLOT,
  sharedFieldsJudged,
  storePartDrafts,
  translatedWhenSharedChanged,
} from "../../versions/part-drafts";
import {
  judgeSharedValues,
  type LanguageOutcome,
  languagesGoingLiveAsStored,
  languagesTold,
  type NamedVerdict,
  nameVerdict,
  type PendingChange,
  pendingChangesInSaveOrder,
  promotionBlockers,
  promotionIssuesOf,
  type PublishAllBlocker,
  type RefuseSharedFields,
  sharedStateForPublish,
  storedLanguageOutcomes,
  withVerdictState,
} from "../../versions/publish-all-plan";
import { hasLifecycle } from "../../versions/recorded-status";
import { removePendingChangeJudged } from "../../versions/remove-pending-change";
import {
  buildRestorePayload,
  type ComponentSchemas,
  type RestoreSchemaContext,
} from "../../versions/restore-snapshot";
import { resolveComponentSchemas } from "../../versions/restore-version";
import {
  asIdSet,
  type FieldNameReader,
  outOfDateSharedFields,
  readableFieldNames,
  recordSharedBase,
  releaseSharedBase,
  sharedValuesConflict,
  snapshotRecord,
  takenLiveValues,
  type TakenLiveValues,
  takeLiveSharedValuesInto,
  wholeWritableFields,
} from "../../versions/shared-publish-base";
import {
  assertVersionNamesEvery,
  certainlyStale,
  type DecodedVersion,
  type DocumentRevisionState,
  givenOf,
  judgedLanguage,
  judgeLanguageRow,
  judgedLanguageStates,
  judgeMainRow,
  languagesJudged,
  type PartState,
  poolRevisionReader,
  refuseIfLanguageMoved,
  refuseIfMainMoved,
  releaseRunExemptFor,
  type StaleWrite,
  type StaleWriteHolder,
  staleVersionErrorFor,
  type VersionCheck,
  versionCheckFor,
} from "../../versions/stale-version";
import {
  containedComponentResolver,
  rehydrateSnapshotDates,
  resolveComponentFieldMap,
  stripSingleComponentTags,
  tagComponentTypes,
  tagNestedComponentTypes,
} from "../../versions/tag-component-types";
import {
  underSavepoint,
  VersionCaptureService,
} from "../../versions/version-capture-service";
import { versionConflictRetries } from "../../versions/version-conflict";
import {
  type VersionRef,
  VersionsRepository,
  type VersionRow,
} from "../../versions/versions-repository";
import { workingDraftLocale } from "../../versions/working-draft-locale";
import { expandComponentFields } from "../../webhooks/expand-component-fields";
import { projectFields } from "../../webhooks/project-fields";
import {
  recordEntryActivity,
  recordMutationEvent,
} from "../../webhooks/record-mutation-event";
import {
  getWebhookEmitSpec,
  isRecordingDisabledByConfig,
} from "../../webhooks/recording-policy";
import type { SensitiveFieldSource } from "../../webhooks/sensitive-fields";
import { statusEventsFor } from "../../webhooks/status-events";
import type { WebhookResource } from "../../webhooks/types";
import {
  releaseWorkflowPinsOnPublish,
  withdrawApprovalsOnSave,
} from "../../workflows/approval-follows-content";
import {
  closeReviewOnDiscard,
  removeDeletedDocumentReviewStates,
} from "../../workflows/review-state-cleanup";
import {
  localizedFilterContext,
  type FilterConditionSources,
} from "../query/filter-condition";

import {
  PUBLISH_ALL_LOCALES,
  WITHDRAW_ALL_LOCALES,
  type AllLocalesLifecycleParams,
  type LifecycleDirection,
  type LifecycleParts,
  movesLanguage,
  movesShared,
} from "./all-locales-lifecycle";
import type {
  CollectionAccessService,
  FilteredWrite,
} from "./collection-access-service";
import type {
  CollectionHookService,
  QueryDatabaseParams,
} from "./collection-hook-service";
import { collectionDbOptions, resolveEntryId } from "./collection-id";
import { fieldTrustOf } from "./collection-query-service";
import type { CollectionServiceResult, UserContext } from "./collection-types";
import {
  toCamelCase,
  isJsonFieldType,
  isRelationshipField,
  normalizeNestedRelationships,
  normalizeUploadFields,
  collectionFields,
  collectionTableName,
  generateSlug,
  normalizeSlugPath,
} from "./collection-utils";
import type { PartsState } from "./publish-parts";
import { requiresEveryLanguage } from "./require-every-language";
import {
  entryWriteContext,
  fieldAccessPass,
  holdStoredExpectation,
  refuseUnlessWhole,
  refuseUnstoredKeys,
} from "./stored-field-read";
import {
  prepareWriteMatch,
  writeMatchOf,
  type FilteredWriteMatch,
  type ReadReach,
} from "./write-filter-match";

/** The Drizzle executor shape the companion-join readers accept (a transaction
 * handle's `getDrizzle()` result, or the pooled `this.db`). */
type CompanionReadDb = Parameters<
  typeof populateCompanionFieldsAllLocales
>[0]["db"];

/**
 * Re-exported for the bulk write loops, which read it to decide whether an
 * error raised after a row was written may be softened into a per-item failure
 * or must abort the shared transaction. Defined in `shared/write-integrity` so
 * the recorders that SET the mark do not have to import this service graph.
 */
export { isWriteIntegrityFailure };

/**
 * Emit a post-commit `collection.<slug>.<action>` event (D8/D51). Observe-only,
 * best-effort: fired once the write's transaction has committed, before the
 * after* hooks that run after that commit, and wrapped so a missing/erroring
 * bus can never break the mutation. A write made on a caller's transaction
 * holds it for that transaction's commit (`announceAtCommit`); its after*
 * hooks run inline, before the commit, so there they come first. Use a hook
 * (in-transaction) to modify/abort; use this to react.
 *
 * Listeners are handed detached copies of the row and the user: they are
 * called synchronously, before the after-hooks, and a listener that changed a
 * nested value it was handed would otherwise change what those hooks, and the
 * write's caller, are handed.
 */
function emitCollectionEvent(
  action: CollectionEventAction,
  collection: string,
  data: Record<string, unknown>,
  user: unknown
): void {
  deliverCollectionEvent(
    action,
    collection,
    detachedForListeners(data),
    detachedForListeners(user)
  );
}

type CollectionEventAction = "created" | "updated" | "deleted";

/**
 * Put the event on the bus, handed `data` and `user` as they are: the caller
 * has detached them already (`emitCollectionEvent` at once, `announceAtCommit`
 * when the write registers the event).
 */
function deliverCollectionEvent(
  action: CollectionEventAction,
  collection: string,
  data: Record<string, unknown>,
  user: unknown
): void {
  try {
    getEventBus().emit(`collection.${collection}.${action}`, {
      collection,
      id: data.id,
      data,
      user,
    });
  } catch {
    // Best-effort — never surface event-dispatch failures to the caller.
  }
}

/**
 * A copy of `value` sharing nothing with it, for an event's listeners. A
 * value the structured clone refuses (one holding a function, say) is copied
 * one level deep instead, which still keeps a listener from replacing or
 * removing its fields.
 */
function detachedForListeners<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value !== null && typeof value === "object" ? { ...value } : value;
  }
}

/** A write's words for an entry that is not there, naming it in a batch item. */
function missingEntryMessage(entryId: string, identify: boolean): string {
  return identify ? `Entry not found: ${entryId}` : "Entry not found";
}

/**
 * A batch item's refusal answered as missing, in the words its missing entry
 * gets, so an entry the caller may not read cannot be told apart from one
 * that is not there. Any other refusal is returned as it is.
 */
function asMissingItem<T>(
  refused: CollectionServiceResult<T>,
  entryId: string,
  identify: boolean
): CollectionServiceResult<T> {
  if (!identify || refused.statusCode !== NEXTLY_ERROR_STATUS.NOT_FOUND) {
    return refused;
  }
  return { ...refused, message: missingEntryMessage(entryId, identify) };
}

/**
 * Convert any thrown error into the legacy CollectionServiceResult shape.
 *
 * - NextlyError instances pass through (publicMessage / statusCode preserved).
 * - DbErrors map via NextlyError.fromDatabaseError so driver text never reaches
 *   the wire; status & generic message come from §8.2 mapping.
 * - Anything else falls back to the caller-supplied default (status 500 unless
 *   overridden) without leaking error.message in cases the spec disallows it.
 *
 * Identifier-bearing detail in `logContext` is dropped from the result shape
 * because that shape is publicly surfaced — callers reading `result.message`
 * must only ever see §13.8-compliant generic strings.
 */
function errorToServiceResult<T = unknown>(
  error: unknown,
  fallback: { statusCode?: number; defaultMessage: string },
  dialect: SupportedDialect
): CollectionServiceResult<T> {
  if (NextlyError.is(error)) {
    // Kept for the log before the detail is dropped below. The boundary
    // rebuilds an error from what survives this shape, so without this the
    // `cause` and `logContext` the thrower attached are gone before anything
    // logs them and every unexpected failure looks alike.
    recordFlattenedError(error);
    // Preserve per-field validation issues: the dispatcher and Direct API
    // rebuild the canonical envelope from this result, and without the
    // errors array the admin cannot map failures onto form fields.
    const validationErrors =
      error.code === "VALIDATION_ERROR"
        ? (error.publicData as ValidationPublicData | undefined)?.errors
        : undefined;
    // The envelope carries the thrown error itself, not just what survives
    // being made public, so the boundary that rebuilds from it can keep the
    // original as the rebuilt error's `cause`. Symbol-keyed, so it cannot
    // reach a response body.
    return withOriginalError(
      {
        success: false,
        statusCode: error.statusCode,
        // The canonical code rides along so boundary translators can rebuild
        // the exact error (409 alone cannot separate DUPLICATE from CONFLICT).
        code: error.code,
        // A localized error selects its message by key, so dropping it leaves a
        // client unable to render anything but the default string.
        ...(error.messageKey !== undefined
          ? { messageKey: error.messageKey }
          : {}),
        // Public by definition -- it is what `toResponseJSON` puts on the wire --
        // so it rides the envelope and the boundary can rebuild an error whose
        // meaning lives in it rather than in its code.
        ...(error.publicData !== undefined
          ? { publicData: error.publicData }
          : {}),
        message: error.publicMessage,
        data: null,
        ...(validationErrors ? { errors: validationErrors } : {}),
      },
      error
    );
  }
  // Free helper takes dialect explicitly (no `this`) so callers pass
  // `this.dialect` from BaseService. Normalising raw driver errors first
  // is what keeps unique/fk violations from collapsing to INTERNAL_ERROR.
  const mapped = NextlyError.fromDatabaseError(toDbError(dialect, error));
  // The mapping is where a unique or FK violation gains the context that says
  // WHICH constraint; the envelope below drops it, so it is kept here too.
  recordFlattenedError(mapped);
  // Both mapped branches carry the provenance too. A driver failure is the
  // case where the chained cause is worth the most — it is the only place the
  // constraint that actually rejected the write is named.
  if (mapped.code === "INTERNAL_ERROR") {
    return withOriginalError(
      {
        success: false,
        statusCode: fallback.statusCode ?? 500,
        message:
          error instanceof Error ? error.message : fallback.defaultMessage,
        data: null,
      },
      mapped
    );
  }
  return withOriginalError(
    {
      success: false,
      statusCode: mapped.statusCode,
      // Same passthrough as the NextlyError branch: a unique-violation maps to
      // DUPLICATE here, and the code keeps that distinction across the envelope.
      code: mapped.code,
      message: mapped.publicMessage,
      data: null,
    },
    mapped
  );
}

/**
 * Aborts (rolls back) a write transaction when a publish/unpublish transition is
 * refused against the row-locked status. Extends {@link NextlyError} for the same
 * reason {@link VersionConflictError} does — a bare `Error` is disallowed in this
 * package — and is always caught inside the method (the 403 to return is read
 * from an out-of-band variable, since the adapter wraps this on the way out), so
 * it never reaches the API boundary.
 */
class StatusTransitionDeniedError extends NextlyError {
  constructor() {
    super({
      code: "FORBIDDEN",
      publicMessage:
        "You do not have permission to change the published state.",
      logMessage: "Publish transition denied against the row-locked status",
    });
    this.name = "StatusTransitionDeniedError";
  }
}

/**
 * Thrown inside the update transaction when a language's pending change holds
 * a shared value someone else has published since it began, so the write rolls
 * back. Like {@link StatusTransitionDeniedError} it is always caught inside the
 * method: the fields travel out of band and the refusal is built after the
 * transaction, where the caller's field read rules can be asked which of them
 * may be named.
 */
class SharedValuesOutOfDateError extends NextlyError {
  constructor() {
    super({
      code: "CONFLICT",
      publicMessage: "Shared values have changed since this change began.",
      logMessage: "Pending change holds out-of-date shared values",
    });
    this.name = "SharedValuesOutOfDateError";
  }
}

/**
 * A caller's publish/unpublish authorization for a collection, resolved ONCE on
 * the pooled connection BEFORE a write transaction opens. Each field holds the
 * 403 result to return if that op is attempted, or `null` when the op is allowed
 * (or the collection has no lifecycle / the write is trusted).
 *
 * The transaction/batch write paths consult this under the row lock instead of
 * reading permission storage inside the transaction: the permission a write can
 * require is fully determined by the FINAL status it persists (only `"published"`
 * can publish; any other explicit value can only unpublish a published row), so
 * resolving both ops up front lets the in-transaction step classify the
 * transition against the row-locked status and look up the answer with no DB read
 * — closing both the TOCTOU window and the pooled-read-inside-a-transaction stall.
 */
export interface TransitionAuthorization {
  publishDenied: CollectionServiceResult | null;
  unpublishDenied: CollectionServiceResult | null;
}

/**
 * What the working-draft write needs from the caller that reached it.
 *
 * Every field is one all three write paths already hold at that point. A field
 * a caller cannot supply honestly does not belong here — it would mean the
 * write is deciding something the caller has already decided differently.
 */
/** Everything both transaction create entry points accept. */
/** Everything both transaction update entry points accept. */
/** Everything both transaction delete entry points accept. */
interface DeleteEntryWriteParams {
  /** Arbitrary data passed to this operation's hooks via context. */
  context?: Record<string, unknown>;
  /** The HTTP request behind this operation, when one produced it. */
  request?: Request;
  collectionName: string;
  user?: UserContext;
  /**
   * Trusted server work. The batch caller honours it at its once-per-batch
   * gate, and the transaction API's gate returns before any check on it.
   */
  overrideAccess?: boolean;
  /**
   * The caller's own grants when they arrived on an API key.
   *
   * Pinned as the ambient scope for the whole operation, so every gate below
   * judges the key on its own grants rather than its owner's — the super-admin
   * bypass belongs to the session path, never to a key issued narrower than
   * the account behind it.
   */
  authenticatedScope?: AuthenticatedScope;
  /** Who performed the delete, recorded on the outbox event. */
  actor?: RequestActor;
}

/** The only things that differ between the two delete entry points. */
/**
 * A batch's delete gate, asked once before its transaction opened, where its
 * rule answered a filter: each row is matched against it under its lock.
 */
export interface DeleteRowFilter {
  readonly denied: null;
  readonly filter: RuleFilter;
  readonly read?: ReadReach;
}

/** The delete gate's answer, as one ask of it gives it. */
type DeleteGateAnswer = Awaited<
  ReturnType<CollectionAccessService["checkCollectionWrite"]>
>;

/**
 * A delete batch's gate asked in each language its collection keeps, each
 * time told that one: each row is judged by the answers of the languages it
 * holds, as a delete removes each of them.
 */
export interface DeleteRowLanguages {
  /**
   * For each set of languages the batch's entries hold, keyed by
   * `languageSetKey`, the answer in each of them, told that one and the set,
   * as a delete of one such entry is asked.
   */
  readonly bySet: ReadonlyMap<string, ReadonlyMap<string, DeleteGateAnswer>>;
  /** The answer for an entry holding no row in any language, asked once. */
  readonly once: DeleteGateAnswer;
}

/** One key for a set of languages, whatever order they were read in. */
function languageSetKey(languages: readonly string[]): string {
  return [...languages].sort().join(",");
}

interface DeleteEntryWriteOptions {
  /** Which shape of the row gate to apply — see the comment at its use. */
  rowGate:
    | "access-service"
    | "batch-hoisted"
    | DeleteRowFilter
    | DeleteRowLanguages;
  /** Run user hooks. Access and recording are NOT hooks and always run. */
  runHooks: boolean;
  /** Name the missing id in a 404, so a failing batch item is identifiable. */
  identifyMissingEntry: boolean;
  /** Message for a failure that carries no message of its own. */
  failureMessage: string;
}

interface UpdateEntryWriteParams {
  /** Arbitrary data passed to this operation's hooks via context. */
  context?: Record<string, unknown>;
  /** The HTTP request behind this operation, when one produced it. */
  request?: Request;
  collectionName: string;
  user?: UserContext;
  overrideAccess?: boolean;
  // See createEntry: route-authorized REST responses stay redacted.
  routeAuthorized?: boolean;
  /** Who performed the write, recorded on the outbox event. */
  actor?: RequestActor;
  /**
   * Publish/unpublish authorization resolved before the transaction opened,
   * so the transition is enforced under the row lock with no permission read
   * inside it.
   */
  transitionAuth?: TransitionAuthorization;
  /**
   * The caller's authenticated scope. A scoped API key is judged on its OWN
   * update grant, so a super-admin-owned key cannot update other users' rows.
   */
  authenticatedScope?: AuthenticatedScope;
  /**
   * The batch this write is one of, whose component definitions it is judged
   * against, read once for them all. Its relations are not: under the row
   * lock each entry's are read for it alone (`storedRelationsOf`).
   *
   * @internal
   */
  goingLiveBatch?: GoingLiveRelationsBatch;
}

/** The only things that differ between the two update entry points. */
/**
 * A row's own gate and its answer ({@link CollectionMutationService.rowVerdict}),
 * asked before a batch's transaction opened.
 */
export interface RowVerdict {
  gate: "update" | "publish" | "unpublish";
  denied: CollectionServiceResult | null;
  /**
   * The filter the gate's rule answered, where it was asked of a caller that
   * matches the row against it, with what it was asked as.
   */
  filter?: {
    params: FilteredWriteCheck["params"];
    access: { filter?: RuleFilter; read?: ReadReach };
  };
}

interface UpdateEntryWriteOptions {
  /**
   * Which shape of the row gate to apply. `access-service` asks
   * `checkCollectionAccess` for the whole verdict; `batch-hoisted` asks
   * nothing here, because the batch caller ran that gate once before the
   * transaction opened; a {@link RowVerdict} is this row's own gate, asked
   * by the batch before its transaction opened. See the comment at the use
   * site.
   */
  rowGate: "access-service" | "batch-hoisted" | RowVerdict;
  /**
   * Run user hooks. All-or-nothing on purpose. Validation, access and
   * recording are NOT hooks and always run.
   */
  runHooks: boolean;
  /** Name the missing id in a 404, so a failing batch item is identifiable. */
  identifyMissingEntry: boolean;
  /** Message for a failure that carries no code of its own. */
  failureMessage: string;
}

/** What judging what a lifecycle write puts live needs: see `goingLiveIssues`. */
interface GoingLiveArgs {
  collectionName: string;
  entryId: string;
  /** The collection's resolved table, which its components are stored against. */
  tableName: string;
  /** The write locale; `undefined` for the unlocalized write. */
  locale: string | undefined;
  user: UserContext | undefined;
  /** Who a refusal is told to; see `EntryValidationArgs.reader`. */
  reader: IssueReader;
  fields: FieldDefinition[];
  /** The caller's payload, after hooks, shaped for the row. */
  finalData: Record<string, unknown>;
  componentFieldData: Record<string, unknown>;
  manyToManyData: Record<string, string[]>;
  manyToManyFields: FieldDefinition[];
  splitComponentSchemas: ComponentSchemas | null;
  /** How a working draft is restored, or `null` when none can be promoted. */
  promoteRestoreCtx: RestoreSchemaContext | null;
  /** Where the entry's working draft is read from. */
  drafts: Pick<VersionsRepository, "findWorkingDraft">;
  /** The batch's reads, when judged for many entries at once. */
  reads?: GoingLiveReads;
  /** The batch the entry's components and relationships are read in, if any. */
  relationsBatch?: GoingLiveRelationsBatch;
  draftLocaleKey: string | null;
  collectionHasStatus: boolean;
  /** The status the write will persist, if it names one. */
  transitionNextStatus: unknown;
  /** Whether the write moves every language at once. */
  sweepAllLocales: boolean;
  existingEntry: Record<string, unknown>;
  /** The write's locale split, or `null` for a collection without one. */
  localizedUpdate: {
    writeLocale: string;
    localizedFieldValues?: Record<string, unknown>;
    hasStatus?: boolean;
  } | null;
}

/**
 * How a promoted working draft is restored onto the live row: which system
 * columns the row has, and how its components and languages are read.
 */
function promoteRestoreContext(args: {
  collection: unknown;
  fields: FieldDefinition[];
  collectionHasStatus: boolean;
  splitComponentSchemas: ComponentSchemas | null;
  documentLocalized: boolean;
}): RestoreSchemaContext {
  const isPlugin =
    (
      (args.collection as Record<string, unknown>).admin as
        | Record<string, unknown>
        | undefined
    )?.isPlugin === true;
  return {
    hasStatus: args.collectionHasStatus,
    hasSlug: !isPlugin || args.fields.some(f => f.name === "slug"),
    hasTitle: !isPlugin || args.fields.some(f => f.name === "title"),
    componentSchemas: args.splitComponentSchemas ?? undefined,
    documentLocalized: args.documentLocalized,
    // A working draft always knows which language it holds: it is keyed by
    // that language, and a write that cannot name one does not store a draft
    // at all. So the snapshot's locale is never the unknown one here, and its
    // translatable values need not be held back.
    localeUnknown: false,
  };
}

/**
 * Whether a write upserts its language's translation row: one write and
 * publish of every language alike, so the two cannot disagree on when a
 * promoted language's row is written.
 *
 * A write of one language always does, when it has columns to write. A write
 * of every language never does on its own account: it moves every row that
 * exists, and inventing a status-only row for a language with none would
 * manufacture the record whose absence means "not translated", a published
 * translation with no content. A PROMOTED pending change is the exception,
 * since an author wrote those values and the write publishes them; without
 * it the promotion consumes the change and the edit reaches no read path.
 *
 * Gated on the translated CONTENT the change carries, not on the companion
 * columns (which also hold the structural `_status` the write sets) nor on the
 * mere presence of translated keys: a pending change stores a whole-document
 * snapshot, so a language never translated appears in it with every
 * translated field null, and counting keys would read those nulls as
 * authorship. An EXISTING row takes its authored write unconditionally, clears
 * included: refusing one would leave the old translation live while the
 * promotion deletes the change that asked for it. An ABSENT row is brought
 * into being only by content genuinely translated, by `isBlank`'s definition,
 * under which an empty string is not translated.
 */
function upsertsTranslation(args: {
  localizedUpdate: {
    companionData: Record<string, unknown>;
    localizedFieldValues: Record<string, unknown>;
  };
  /** Whether the write moves every language at once. */
  everyLanguage: boolean;
  /** Whether the values are a promoted pending change's. */
  promoted: boolean;
  /** Whether the language's row exists, read before the write. */
  rowExists: boolean;
}): boolean {
  const { localizedUpdate } = args;
  return (
    (!args.everyLanguage ||
      (args.promoted &&
        (args.rowExists ||
          Object.values(localizedUpdate.localizedFieldValues).some(
            value => !isBlank(value)
          )))) &&
    Object.keys(localizedUpdate.companionData).length > 0
  );
}

/**
 * A language's split as a publish of every language reads and writes it, kept
 * to the language its pending change is stored under. The split resolves a
 * language the app no longer configures to the default, whose row would then
 * be read as that language's and take its translated values.
 */
function keptToLanguage<T extends { writeLocale: string }>(
  split: T | null,
  locale: string | null
): T | null {
  return split !== null && locale !== null && split.writeLocale !== locale
    ? { ...split, writeLocale: locale }
    : split;
}

/**
 * What a change of every language's status settled before its transaction
 * opened; see `lifecycleAllLocalesPreconditions`.
 */
type LifecycleAllLocalesReady = Extract<
  Awaited<
    ReturnType<CollectionMutationService["lifecycleAllLocalesPreconditions"]>
  >,
  { ready: unknown }
>["ready"];

/**
 * An entry's document as stored, read on a write's transaction, with the
 * parts it is assembled from; see `storedDocumentOnTx`.
 */
interface StoredDocument {
  document: Record<string, unknown>;
  committedLocaleStatus: string | null;
  localizedValues: Record<string, unknown>;
  parentRow: Record<string, unknown>;
  components: Record<string, unknown>;
  manyToMany: Record<string, string[]>;
}

/**
 * The shared fields a language's pending change edits, judged against the entry's live row: each
 * shared field the change holds whose value differs from the live one. Read where a language's
 * change holds the shared values too, so a publish of it alone would write them. A field the row
 * does not carry under its name or its column name is not judged.
 */
function sharedFieldsEdited(
  fields: readonly { name: string; translatable: boolean }[],
  pending: Readonly<Record<string, unknown>>,
  live: Readonly<Record<string, unknown>>
): string[] {
  const comparable = (value: unknown): string =>
    JSON.stringify(
      value instanceof Date ? value.toISOString() : (value ?? null)
    );
  return fields.flatMap(field => {
    if (field.translatable || !(field.name in pending)) return [];
    const column = field.name.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
    const key =
      field.name in live ? field.name : column in live ? column : undefined;
    if (key === undefined) return [];
    return comparable(pending[field.name]) === comparable(live[key])
      ? []
      : [field.name];
  });
}

/**
 * A pending change's language as stored, read before its promotion is judged.
 * Every change's language is read; one missing is a defect, refused rather
 * than judged against an empty document, which every field would differ from.
 */
function storedLiveOf(
  stored: ReadonlyMap<string | null, Record<string, unknown>>,
  locale: string | null
): Record<string, unknown> {
  const live = stored.get(locale);
  if (live) return live;
  throw NextlyError.internal({
    logContext: { reason: "publish-all-live-document-unread", locale },
  });
}

/**
 * One language's pending change as a publish of every language writes it,
 * judged under the row lock before anything is written.
 */
interface PendingPromotion {
  /** The slot the change is kept under. */
  locale: string | null;
  /** The main row's columns, keyed by SQL column name. */
  columns: Record<string, unknown>;
  /**
   * The change's translated values and the language they are written to, or
   * `null` where nothing is written to a translation row.
   */
  translation: {
    companionTableName: string;
    writeLocale: string;
    companionData: Record<string, unknown>;
  } | null;
  componentFieldData: Record<string, unknown>;
  manyToManyData: Record<string, string[]>;
  /**
   * The document the promotion writes, as a write sends it, for the
   * validators of a field inside a field-group instance it saves.
   */
  payload: Record<string, unknown>;
  /** Whether the promotion writes content of the caller's own over the change. */
  carriesContent: boolean;
}

/**
 * Reads a judgement of what goes live makes, served for a whole batch of one
 * collection's entries at once: the companion resolved once, and each entry's
 * language statuses and translations from one query per batch (per language).
 * Absent, each is read for the one entry, as a write reads it.
 */
interface GoingLiveReads {
  companion: CompanionSchema | null;
  /** The entries' components and many-to-many ids, read for them all at once. */
  relations: GoingLiveRelationsBatch;
  languageStatuses(entryId: string): Promise<Map<string, string | null> | null>;
  translations(
    entryId: string,
    locale: string
  ): Promise<Record<string, unknown>>;
}

/** What a release's write judges with, the same for every entry. */
type ReleaseWriteContext = Omit<
  GoingLiveArgs,
  | "collectionName"
  | "entryId"
  | "user"
  | "reader"
  | "existingEntry"
  | "drafts"
  | "reads"
  | "relationsBatch"
>;

/** What judging the languages a publish puts live needs. */
interface LanguagesGoLiveArgs {
  /**
   * The parts a publish of chosen parts moves: only their languages are judged, and every one at
   * fault is reported, each issue naming its language, so the publisher sees all of them at once.
   * Absent, every language going live is judged and the first at fault refuses the publish.
   */
  parts?: LifecycleParts;
  collectionName: string;
  entryId: string;
  row: Record<string, unknown>;
  patch: Record<string, unknown>;
  writeLocale: string | undefined;
  writeLocaleValues: Record<string, unknown>;
  /** Whether each language keeps its own status, in the companion. */
  perLocaleStatus: boolean;
  everyLanguage: boolean;
  /**
   * Whether the write locale's document goes live by promoting its pending
   * draft, which the promotion has already judged as it goes live.
   */
  writeLocalePromoted: boolean;
  /**
   * The languages whose pending change a publish of every language promotes,
   * each judged as its promotion goes live and so not again as stored.
   */
  promotedLocales?: ReadonlySet<string>;
  /**
   * Languages judged as stored beside those the statuses put live: with a
   * pending change promoted, every stored translation, since the change can
   * rewrite the shared values beneath a language already live.
   */
  alsoGoingLive?: readonly string[];
  fields: FieldDefinition[];
  user: UserContext | undefined;
  /** Who a refusal is told to; see `EntryValidationArgs.reader`. */
  reader: IssueReader;
  /**
   * The transaction the publish runs in, when it is judged under its row
   * lock. Every read then runs on it; absent, they run on the pool.
   */
  tx?: TransactionContext;
  /** The batch's reads, when judged for many entries at once. */
  reads?: GoingLiveReads;
  /** What the document's components and relationships go live from. */
  relations: GoingLiveRelationArgs;
}

/**
 * What a publish judges a document's components and many-to-many
 * relationships from: the stored ones, with the write's own over them.
 */
interface GoingLiveRelationArgs {
  /** The collection's resolved table, which its components are stored against. */
  tableName: string;
  manyToManyFields: FieldDefinition[];
  /** The write's own component values, which `shapeWriteParts` took off the patch. */
  componentFieldData: Record<string, unknown>;
  /** The write's own many-to-many ids, taken off the patch the same way. */
  manyToManyData: Record<string, string[]>;
  /** How a single component the write patches is merged, where known. */
  componentSchemas: ComponentSchemas | null;
  /** The batch they are read in, when the document publishes with others. */
  batch?: GoingLiveRelationsBatch;
}

/**
 * A collection document's components and junction many-to-many relationships,
 * as a publish judges them.
 *
 * Neither sits on the document's row: a component's values live in tables of
 * its own, and a many-to-many relationship in a junction. A publish judges the
 * stored row in update mode, where an absent key is not judged, so a document
 * built from the row and its translations alone put a required component or
 * relationship missing from storage live unchecked. These are read as stored,
 * every such field with a key of its own, and the write's own values laid over
 * them.
 *
 * Read for many documents at once where a publish judges many: a batch, a bulk
 * publish, a release's readiness. One read per field for the whole batch,
 * never one per document.
 */

/** A document's top-level component values and many-to-many ids, as stored. */
export interface StoredRelations {
  components: Record<string, unknown>;
  manyToMany: Record<string, string[]>;
}

/**
 * How a batch's stored relations are read, on the connection the judgement
 * runs on: components in a language, many-to-many ids the same in every one.
 */
export interface StoredRelationsLoad {
  components(
    entryIds: readonly string[],
    language: string | undefined
  ): Promise<Map<string, Record<string, unknown>>>;
  manyToMany(
    entryIds: readonly string[]
  ): Promise<Map<string, Record<string, string[]>>>;
}

/**
 * Ids per statement. Each id binds one parameter, and SQLite's default limit of
 * 999 is the lowest across the supported dialects, so a larger batch is read
 * in several statements: the size the versions repository deletes in.
 */
const RELATION_READ_CHUNK = 500;

/** `read` over `ids` in statement-sized runs, its answers merged. */
async function inChunks<T>(
  ids: readonly string[],
  read: (chunk: readonly string[]) => Promise<Map<string, T>>
): Promise<Map<string, T>> {
  const all = new Map<string, T>();
  for (let at = 0; at < ids.length; at += RELATION_READ_CHUNK) {
    for (const [id, value] of await read(
      ids.slice(at, at + RELATION_READ_CHUNK)
    )) {
      all.set(id, value);
    }
  }
  return all;
}

/**
 * The stored relations of a batch of one collection's documents, read for all
 * of them the first time any is asked for: the components once per language
 * asked for, the many-to-many ids once. A document outside the batch is read
 * on its own.
 *
 * The relations are only for reads on the pool, which judge ahead of any
 * lock. A judgement on a transaction holds the lock of the one row it judges,
 * so the other rows' relations read with it could still change before the
 * transaction locks them; it reads its own row's alone (`storedRelationsOf`).
 *
 * @internal
 */
export class GoingLiveRelationsBatch {
  private readonly entryIds: readonly string[];
  private readonly components = new Map<
    string,
    Promise<Map<string, Record<string, unknown>>>
  >();
  private manyToMany:
    | Promise<Map<string, Record<string, string[]>>>
    | undefined;
  private readonly definitions = new Map<
    string,
    Promise<FieldConfig[] | null>
  >();

  constructor(entryIds: readonly string[]) {
    this.entryIds = [...new Set(entryIds)];
  }

  /**
   * Whether this batch holds `entryId` and nothing else: the row a
   * transaction has locked, whose relations no other writer can change under
   * it, so every judgement in that transaction may share the batch's reads.
   */
  holdsOnly(entryId: string): boolean {
    return this.entryIds.length === 1 && this.entryIds[0] === entryId;
  }

  /**
   * A component's own fields, read once for the batch through `read`: a
   * batch writes documents, not definitions, so every document is judged
   * against the same ones. Unlike the relations, safe to share on a
   * transaction too, which locks rows, not definitions.
   */
  componentFields(
    slug: string,
    read: () => Promise<FieldConfig[] | null>
  ): Promise<FieldConfig[] | null> {
    let found = this.definitions.get(slug);
    if (found === undefined) {
      found = read();
      this.definitions.set(slug, found);
    }
    return found;
  }

  /**
   * One document's stored relations, its components in `language`, through
   * `load`. The two reads are awaited in turn, one statement at a time on the
   * connection they run on.
   */
  async read(
    entryId: string,
    language: string | undefined,
    load: StoredRelationsLoad
  ): Promise<StoredRelations> {
    if (!this.entryIds.includes(entryId)) {
      const components = await load.components([entryId], language);
      const manyToMany = await load.manyToMany([entryId]);
      return {
        components: components.get(entryId) ?? {},
        manyToMany: manyToMany.get(entryId) ?? {},
      };
    }
    // `undefined` is the default resolution, a language of its own here.
    const key = language === undefined ? "" : `:${language}`;
    let components = this.components.get(key);
    if (components === undefined) {
      components = load.components(this.entryIds, language);
      this.components.set(key, components);
    }
    const ofDocument = (await components).get(entryId) ?? {};
    this.manyToMany ??= load.manyToMany(this.entryIds);
    return {
      components: ofDocument,
      manyToMany: (await this.manyToMany).get(entryId) ?? {},
    };
  }
}

/**
 * The batch a judgement of one entry reads its stored relations through. Off
 * a transaction, the batch it is judged with, read ahead of any lock. On a
 * transaction, that batch only where it holds this entry alone, which the
 * transaction has locked, so every language judged in it reads the entry's
 * relations once; a batch holding any other entry is never shared there,
 * since those rows are not locked yet and another writer could change them
 * before the transaction reaches them. Otherwise a batch of its own.
 *
 * @internal
 */
export function relationsBatchFor(args: {
  entryId: string;
  onTransaction: boolean;
  shared: GoingLiveRelationsBatch | undefined;
}): GoingLiveRelationsBatch {
  const { shared } = args;
  const sharable =
    shared !== undefined &&
    (!args.onTransaction || shared.holdsOnly(args.entryId));
  return sharable ? shared : new GoingLiveRelationsBatch([args.entryId]);
}

/** What reading a batch's stored relations needs. */
interface StoredRelationsRead {
  entryIds: readonly string[];
  collectionName: string;
  /** The collection's resolved table: a custom `dbName` is not the slug's. */
  parentTable: string;
  fields: readonly FieldDefinition[];
  manyToManyFields: readonly FieldDefinition[];
  /**
   * The transaction's executor, where the judgement runs inside one; absent
   * on the pool, where a component table not yet created reads as empty.
   */
  executor?: unknown;
  fieldGroups:
    | Pick<FieldGroupDataService, "populateComponentDataMany">
    | undefined;
  relationships: Pick<
    CollectionRelationshipService,
    "fetchManyToManyTargetIdsOf"
  >;
}

/**
 * Each document's top-level component values, keyed by document id: one read
 * per component field for every 500 documents. A component missing from
 * storage reads as its empty value (`null` for one, `[]` for a repeatable
 * component or a zone), and a read that fails refuses rather than reading as
 * empty.
 *
 * Refused where the collection has component fields and no field-group
 * service is registered: its components cannot be read, and a document judged
 * without them would go live unchecked.
 */
export async function readStoredComponents(
  args: Omit<StoredRelationsRead, "manyToManyFields" | "relationships"> & {
    /** Read in this language exactly, with no fallback; absent, the default resolution. */
    language: string | undefined;
  }
): Promise<Map<string, Record<string, unknown>>> {
  const componentFields = args.fields.filter(field =>
    isFieldGroupField(field as unknown as FieldConfig)
  );
  if (componentFields.length === 0) return new Map();
  const fieldGroups = args.fieldGroups;
  if (fieldGroups === undefined) {
    throw NextlyError.configuration({
      logMessage:
        "A collection with component fields cannot be published: no field-group service is registered, so its components cannot be read and judged. Boot with the field-group services registered.",
      logContext: {
        collection: args.collectionName,
        fields: componentFields.map(field => field.name),
      },
    });
  }
  return inChunks(args.entryIds, async chunk => {
    const populated = await fieldGroups.populateComponentDataMany({
      entries: chunk.map(id => ({ id })),
      parentTable: args.parentTable,
      fields: args.fields as unknown as FieldConfig[],
      depth: 0,
      strict: true,
      ...(args.executor === undefined ? {} : { executor: args.executor }),
      ...(args.language === undefined
        ? {}
        : { locale: args.language, fallbackLocale: false as const }),
    });
    return new Map(
      populated.map(entry => [
        String(entry.id),
        Object.fromEntries(
          componentFields
            .filter(field => entry[field.name] !== undefined)
            .map(field => [field.name, entry[field.name]])
        ),
      ])
    );
  });
}

/**
 * Each document's many-to-many ids, keyed by document id: one junction read
 * per field for every 500 documents, a document with no links holding `[]`.
 * The ids are every stored one, a target since unpublished included, as the
 * write itself reads them.
 */
export async function readStoredManyToMany(
  args: Omit<StoredRelationsRead, "parentTable" | "fieldGroups">
): Promise<Map<string, Record<string, string[]>>> {
  return inChunks(args.entryIds, async chunk => {
    const byDocument = new Map<string, Record<string, string[]>>(
      chunk.map(id => [id, {}])
    );
    for (const field of args.manyToManyFields) {
      const targets = await args.relationships.fetchManyToManyTargetIdsOf(
        args.collectionName,
        chunk,
        field,
        args.executor as RelationshipDbExecutor | undefined
      );
      for (const [id, links] of byDocument) {
        links[field.name] = targets.get(id) ?? [];
      }
    }
    return byDocument;
  });
}

/** A document's many-to-many ids, each field's that holds a list. */
function manyToManyValuesIn(
  document: Record<string, unknown>,
  manyToManyFields: readonly FieldDefinition[]
): Record<string, string[]> {
  const values: Record<string, string[]> = {};
  for (const field of manyToManyFields) {
    const value = document[field.name];
    if (Array.isArray(value)) values[field.name] = value.map(String);
  }
  return values;
}

/**
 * The language rules a publish judges in, with a required top-level component
 * enforced for the default language only, as a translated field's `required`
 * is: one finished language can go live while another is incomplete. The
 * validator relaxes `required` for the names it is given outside the default
 * language, so the components' names join the translated fields'.
 */
export function componentsRequiredInDefaultLanguage<
  T extends {
    localizedFieldNames: ReadonlySet<string>;
    enforceLocalizedRequired: boolean;
  },
>(
  context: T,
  fields: readonly FieldDefinition[],
  /**
   * Whether the document differs by language: it has translated fields, or
   * reaches a localized field group, whose values its own translations hold.
   * One that does not is one document in every language, its components as
   * much the default language's as anyone's.
   */
  perLanguage: boolean
): T {
  if (context.enforceLocalizedRequired || !perLanguage) {
    return context;
  }
  const components = fields
    .filter(field => isFieldGroupField(field as unknown as FieldConfig))
    .map(field => field.name);
  if (components.length === 0) return context;
  return {
    ...context,
    localizedFieldNames: new Set([
      ...context.localizedFieldNames,
      ...components,
    ]),
  };
}

/**
 * The values a document goes live with for its components and many-to-many
 * relationships: the stored ones, with the write's own over them. A single
 * component the write patches is merged sub-field by sub-field, as the write
 * merges it; a repeatable component, a zone and a relationship the write
 * names are replaced whole.
 */
export function relationsGoingLive(args: {
  stored: StoredRelations;
  fields: readonly FieldDefinition[];
  componentSchemas: ComponentSchemas | null;
  /** The write's own component values. */
  components: Record<string, unknown>;
  /** The write's own many-to-many ids. */
  manyToMany: Record<string, string[]>;
}): Record<string, unknown> {
  return {
    ...mergeComponentPatches(
      args.stored.components,
      args.components,
      args.fields as unknown as FieldConfig[],
      args.componentSchemas
    ),
    ...args.stored.manyToMany,
    ...args.manyToMany,
  };
}

/** What judging one document against its collection's rules needs. */
interface EntryValidationArgs {
  data: Record<string, unknown>;
  fields: FieldDefinition[];
  collectionName: string;
  mode: "create" | "update";
  user: UserContext | undefined;
  /**
   * Who the refusal is told to: an issue on a field they may not read is told
   * without naming it. Required, so no write path can forget to say.
   */
  reader: IssueReader;
  /**
   * The language the document is, where a write judges several in turn; see
   * `issuesTheReaderMaySee`.
   */
  readLocale?: string;
  /**
   * The language a single-language write is in, where the document is kept
   * per language. Validators reading what the entry already stores read this
   * language's value; absent means the app's default language.
   */
  writeLocale?: string;
  /**
   * Whether the document merges stored values the request did not carry (a
   * go-live merge, a promoted draft). The whole-number rule binds values a
   * caller writes, so it skips such a document — see the option's comment on
   * `ValidateEntryOptions` for the boundary.
   */
  assembledFromStorage?: boolean;
  /**
   * The paths that hold a value kept from the stored row because a rule
   * denies it to this writer — the restore's answer, which the whole-number
   * rule skips: a legacy stored fraction under a denied path is the row's
   * own content, not this write's. Absent on a write that restores nothing.
   */
  storedProvenancePaths?: ReadonlySet<string>;
  /** What `localizedRequiredContext` resolved for a localized write. */
  localeCtx?: {
    localizedFieldNames: ReadonlySet<string>;
    enforceLocalizedRequired: boolean;
    /** Whether the document differs by language; see `publishLanguageContext`. */
    perLanguage?: boolean;
  };
  /** The stored entry's id, on an update. */
  id?: string;
  /** The write's own transaction, where it runs inside one. */
  tx?: TransactionContext;
  /**
   * Whether the document goes live: its top-level component instances are
   * then judged by their own fields' rules as well, in the default language,
   * as a required component is. A rule tightened since an instance was saved
   * would otherwise go live unjudged.
   */
  goesLive?: boolean;
  /** The batch the document goes live with, which reads definitions once. */
  batch?: GoingLiveRelationsBatch;
}

interface CreateEntryWriteParams {
  /**
   * The caller's own grants when they arrived on an API key.
   *
   * Declared here because a route may NARROW its scope before a transactional
   * write, and this is the only way that narrowing reaches the gate. The
   * transaction methods sit outside the plugin facade's `CONTEXT_INDEX`, so the
   * proxy binds them straight through and the re-pinning wrapper never runs;
   * the access check would otherwise read the request's ORIGINAL scope from
   * `AsyncLocalStorage` and authorize a grant the route had deliberately given
   * up. Absent means "use whatever the request pinned", which is right for the
   * caller that did not narrow.
   */
  authenticatedScope?: AuthenticatedScope;
  /** Arbitrary data passed to this operation's hooks via context. */
  context?: Record<string, unknown>;
  /** The HTTP request behind this operation, when one produced it. */
  request?: Request;
  collectionName: string;
  user?: UserContext;
  overrideAccess?: boolean;
  // See createEntry: route-authorized REST responses stay redacted.
  routeAuthorized?: boolean;
  /**
   * Who performed the write. The bulk callers already spread this in; until
   * it was declared here it was received and dropped, so every event and
   * activity entry these paths recorded attributed an API-key write to the
   * key's OWNER as though a person had made it.
   */
  actor?: RequestActor;
  /**
   * Publish authorization resolved before the transaction opened, so the
   * transition is enforced under the row lock with no permission read inside
   * it. Self-resolved on the pooled connection when a caller does not pass one.
   */
  transitionAuth?: TransitionAuthorization;
}

/** The only things that differ between the two create entry points. */
interface CreateEntryWriteOptions {
  /**
   * Run the collection-level `create` access check here. False only for the
   * batch worker, whose callers run it once per batch before opening the
   * transaction rather than once per entry inside it.
   */
  enforceCollectionAccess: boolean;
  /**
   * Run user hooks. All-or-nothing on purpose: a collection-level handler
   * running while the field-level one is skipped would be the gate half
   * applied. Validation, access and recording are NOT hooks and always run.
   */
  runHooks: boolean;
  /** Shape the caller's `body` in place rather than a copy of it. */
  shapeCallerObject: boolean;
  /** Message for a failure that carries no code of its own. */
  failureMessage: string;
}

interface WorkingDraftWriteContext {
  collection: unknown;
  collectionHasStatus: boolean;
  /** The entry's own table, whose version counter a held edit moves. */
  tableName: string;
  componentFieldData: Record<string, unknown>;
  /**
   * The locale this document's working draft is keyed under, from
   * `workingDraftLocale`. `null` is the unlocalized slot, not "unknown": the
   * store, the read overlay, the promote and the discard must all derive it the
   * same way, because a draft written under one key and looked for under
   * another is never found again and the edit disappears without an error.
   */
  draftLocale: string | null;
  fields: FieldDefinition[];
  manyToManyData: Record<string, string[]>;
  params: {
    collectionName: string;
    entryId: string;
    /** The language the write named, which its components were read in. */
    locale?: string;
    user?: UserContext;
    /** Who made the write, for the save's history event. */
    actor?: RequestActor;
    /** The version a restore write restored; recorded on the save's version. */
    sourceVersionNo?: number | null;
    /** The write's trust and key scope, for the held field groups' own rules. */
    overrideAccess?: boolean;
    authenticatedScope?: AuthenticatedScope;
  };
  parentRow: Record<string, unknown>;
  /**
   * The live parent row before this write, at `parentRow`'s shape. A first
   * held save is compared with the live document built from it: `parentRow`
   * already carries this write, so it cannot tell a change from none.
   */
  liveParentRow: Record<string, unknown>;
  snapshotComponents: Record<string, unknown> | undefined;
  snapshotM2M: Record<string, string[]> | undefined;
  splitComponentSchemas: ComponentSchemas | null;
  updatePayload: Record<string, unknown>;
  /**
   * The update filters that judged this write. A held edit may not change a
   * field one of them names: the live row was matched, and the edit, put
   * live later, could leave the entry outside the filter.
   */
  updateFilters?: readonly FilteredWriteCheck[];
  /**
   * The translatable fields this save wrote, which the locale split moved
   * out of `updatePayload`. Kept by part (`part-drafts`), they are what makes
   * a save touch its language's draft.
   */
  translatedKeys?: readonly string[];
}

/** What the caller needs back: the draft as a read would shape it, and its predecessor. */
interface WorkingDraftWriteResult {
  /** The update filter a held edit changes a field of, which holds nothing. */
  refusedBy?: FilteredWriteCheck;
  workingDraftDocument?: Record<string, unknown>;
  /** The draft BEFORE this save, so a hook diffing old against new is like-for-like. */
  priorWorkingDraftDocument?: Record<string, unknown>;
}

/**
 * One filter a write was judged by: its match, and the gate parameters it was
 * asked with, which name the action and answer an entry outside it.
 */
interface FilteredWriteCheck {
  match: FilteredWriteMatch;
  params: Parameters<CollectionAccessService["refusalOutsideFilter"]>[0] & {
    operation: FilteredWrite;
  };
  /** The filter itself, which names the fields its match reads. */
  filter: RuleFilter;
  /**
   * Whether the caller may read the entry, as matched beside the filter on
   * the row last judged: a refusal of the write once it is under way is in
   * words where it may, and the missing entry's where it may not.
   */
  reads: boolean;
}

/** A filter a write in the caller's own transaction was judged by. */
interface FilteredTransactionWrite extends FilteredWriteCheck {
  schema: Record<string, SQLWrapper | undefined> & { id: SQLWrapper };
}

/**
 * The gate question a release asks of a write it will make: asked of a
 * named caller, never as route-authorized, and of the key where one adds the
 * document.
 */
function writeFilterQuestion(params: {
  collectionName: string;
  action: FilteredWrite;
  user: UserContext;
  authenticatedScope?: AuthenticatedScope;
}) {
  return {
    collectionName: params.collectionName,
    operation: params.action,
    user: params.user,
    overrideAccess: false,
    routeAuthorized: false,
    ...(params.authenticatedScope
      ? { authenticatedScope: params.authenticatedScope }
      : {}),
  };
}

/**
 * Whether a held edit changes a field `filter` names, or may: a filter's
 * match moves only through the fields it reads, so an edit leaving each as
 * the live document holds it cannot take the entry out of the filter. A
 * dotted key names the field it starts with. A name the collection does not
 * declare, and the live document does not hold, cannot be compared, and
 * counts as changed.
 */
function changesFieldFilterNames(
  filter: RuleFilter,
  draft: Record<string, unknown>,
  live: Record<string, unknown>,
  fields: readonly FieldDefinition[]
): boolean {
  for (const key of filterKeys(filter)) {
    const name = key.split(".")[0];
    const known = fields.some(field => field.name === name) || name in live;
    if (!known || !isDeepStrictEqual(draft[name], live[name])) return true;
  }
  return false;
}

/**
 * The update's patch without the stamp the write adds to it: `updatedAt` is
 * set by the write, never sent, so a validator is not shown it as sent.
 */
function sentFields(
  updatePayload: Record<string, unknown>
): Record<string, unknown> {
  const sent = { ...updatePayload };
  delete sent.updatedAt;
  return sent;
}

/**
 * How a rewrite of one language's pending change is judged: the version its
 * request gave, the entry's row and translation table, and the language it
 * is judged on (none where the entry keeps no translations).
 */
type PendingChangeJudging = {
  check: VersionCheck;
  table: string;
  id: string;
  languagesTable: string | null;
  locale: string | undefined;
};

export class CollectionMutationService extends BaseService {
  /** The site's languages as they are now: the source may be the language registry. */
  private get localization(): SanitizedLocalizationConfig | undefined {
    return localizationNow(this.localizationSource);
  }

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly fileManager: CollectionFileManager,
    private readonly collectionService: DynamicCollectionService,
    private readonly relationshipService: CollectionRelationshipService,
    private readonly accessService: CollectionAccessService,
    private readonly hookService: CollectionHookService,
    private readonly fieldGroupDataService?: FieldGroupDataService,
    /**
     * Normalized localization config (i18n M5). When set and a collection is localized, writes
     * route translatable field values to the companion `_locales` row for the write's locale.
     * Absent → non-localized behavior (unchanged).
     */
    private readonly localizationSource?: LocalizationSource
  ) {
    super(adapter, logger);
  }

  /**
   * The caller's grants resolver for the field rules this service judges
   * (see `callerAccessGrants`), a visitor's read from the Public role this
   * service's collection gate reads: every pass builds it here, so none is
   * handed another database's Public role.
   */
  private callerGrants(
    user: Record<string, unknown> | undefined,
    authenticatedScope?: AuthenticatedScope,
    executor?: unknown
  ): () => Promise<CallerGrants> {
    return callerAccessGrants(
      user,
      authenticatedScope,
      executor,
      this.accessService.fieldRuleVisitor
    );
  }

  /** {@link callerGrants}, resolved now (see `resolvedCallerGrants`). */
  private resolvedGrants(
    user: Record<string, unknown> | undefined,
    authenticatedScope?: AuthenticatedScope
  ): Promise<() => Promise<CallerGrants>> {
    return resolvedCallerGrants(
      user,
      authenticatedScope,
      this.accessService.fieldRuleVisitor
    );
  }

  /**
   * The access a field-group save made as `caller` is handed, its visitor
   * judged by the same Public role as {@link callerGrants}.
   */
  private fieldGroupAccess(
    caller: Parameters<typeof fieldGroupWriteAccessOf>[0]
  ): FieldGroupWriteAccess {
    // Through the one builder, which carries the service's visitor loader.
    return fieldGroupWriteAccessOf(caller, this.accessService.fieldRuleVisitor);
  }

  /**
   * Stateless version-capture service. Records a durable version snapshot
   * inside the write transaction when the collection opts into versioning, so
   * the version commits atomically with the content write.
   */
  private readonly versionCapture = new VersionCaptureService();

  /**
   * What every hook-running operation derives from its collection record and
   * request before its first hook: its field definitions, the stored hooks,
   * the physical table (which honours `dbName`), a context shared by all of
   * this request's hooks, and the caller's request facts — resolved once, so
   * every hook phase is told the same thing and none re-reads a header.
   */
  private operationSetup(
    collection: unknown,
    params: {
      collectionName: string;
      context?: Record<string, unknown>;
      request?: Parameters<typeof resolveRequestFacts>[0];
    }
  ): {
    fields: FieldDefinition[];
    storedHooks: ReturnType<CollectionHookService["getStoredHooks"]>;
    tableName: string;
    sharedContext: Record<string, unknown>;
    requestFacts: ReturnType<typeof resolveRequestFacts>;
  } {
    return {
      fields: collectionFields(collection),
      storedHooks: this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      ),
      tableName: collectionTableName(collection, params.collectionName),
      sharedContext: { ...params.context },
      requestFacts: resolveRequestFacts(params.request),
    };
  }

  /**
   * Emit the document-level status events for one transition (post-commit).
   *
   * Fires the general `statusTransition` event (the seam workflows/item 9 build
   * on) plus the specific `statusChanged` / `published` events existing
   * subscribers already listen on, so current behavior is preserved. Create as
   * `published` has no prior status to change from, so it passes
   * `emitStatusChanged: false` to keep emitting only `published` (and now the
   * general transition), never `statusChanged`.
   *
   * `locale` is set only for a per-locale (companion `_status`) transition on a
   * localized collection; when present it rides on every emitted payload so a
   * subscriber can tell a single-language transition apart from a document-wide
   * one (a document-wide publish carries no `locale`).
   */
  /**
   * The collection's field tree with component references expanded.
   *
   * A component reference names its target by slug and carries no inline
   * children, so without this the secret/hidden walk never sees fields declared
   * inside a component and their values would ship in the event payload.
   */
  private async webhookFieldTree(
    fields: readonly SensitiveFieldSource[],
    // Executor to resolve component schemas on. When called inside an open
    // transaction, pass `tx.getDrizzle()`: resolving on the default pooled
    // connection would take a second connection while the tx holds one and can
    // starve a small pool. Omit it (the default) when no transaction is open.
    executor?: unknown
  ): Promise<SensitiveFieldSource[]> {
    const dataService = this.fieldGroupDataService;
    return expandComponentFields(fields, async slug =>
      dataService ? await dataService.getComponentFields(slug, executor) : null
    );
  }

  /**
   * {@link webhookFieldTree}, but SKIPPED when the collection opted out of
   * recording. Component expansion issues a registry read per component slug, and
   * `recordMutationEvent` short-circuits on the opt-out before it ever reads
   * `fields` — so for a `webhooks: false` collection that work is pure waste, and
   * a scalar write should never be able to fail on a component/relation read it
   * does not need. Returns the raw fields unchanged in that case (they go unread).
   */
  private async webhookFieldTreeIfRecording(
    collectionSlug: string,
    fields: readonly SensitiveFieldSource[],
    executor?: unknown
  ): Promise<readonly SensitiveFieldSource[]> {
    // Gate only on a decision that holds for the WHOLE write. The endpoint/audit
    // flag can flip on between this pre-record expansion and the in-transaction
    // recordMutationEvent, and a registry-stored (`db`) opt-out can be flipped by
    // the background policy refresh for the same reason; skipping expansion here
    // while the choke point then records would ship component-nested
    // secret/hidden values unstripped. Config-sourced opt-outs (`code` and
    // `plugin`, which is what the form-builder's submissions collection uses)
    // cannot change mid-write, so they still skip the work. The choke point
    // still gates the actual write, so a gated-off collection records nothing —
    // only this expansion runs, exactly as before endpoint gating.
    if (isRecordingDisabledByConfig("collection", collectionSlug))
      return fields;
    return this.webhookFieldTree(fields, executor);
  }

  /**
   * Emit a collection's curated create event (e.g. `form.submission.created`)
   * when it declared `webhooks.emit`, INSIDE the caller's transaction so it
   * commits with the row. The payload is a default-deny projection of the
   * created document, so a collection that opted its `entry.*` events out for
   * PII ships only the allowlisted fields, on a resource kind (e.g. `form`) the
   * per-collection opt-out does not gate. Returns whether a row was recorded so
   * the caller folds it into its fast-drain gate; a no-op for ordinary
   * collections. Applied at every create seam so the collection-level contract
   * holds for the direct, transaction, and bulk create paths alike.
   */
  private async recordCuratedCreateEvent(
    tx: Parameters<typeof recordMutationEvent>[0],
    collectionName: string,
    entryId: string,
    createdDocument: Record<string, unknown>,
    actor: RequestActor,
    fields: readonly SensitiveFieldSource[],
    writeLocale?: string
  ): Promise<boolean> {
    const emitSpec = getWebhookEmitSpec("collection", collectionName);
    if (!emitSpec) return false;
    const locale = writeLocale ? { locale: writeLocale } : {};
    // `emitSpec.kind` is a non-entry family (normalization rejects entry.*), so
    // the resource carries a `slug` and never a `collection`: the per-collection
    // opt-out that suppressed the raw entry.* events does not gate this kind.
    const resource: WebhookResource = {
      kind: emitSpec.kind,
      slug: collectionName,
      id: entryId,
      ...locale,
    };
    // Expand the field tree so a password/hidden value nested inside an
    // allowlisted group/component/repeater is still stripped from the
    // (default-deny) projection: the curated event ships data, so it needs the
    // same sensitive-field stripping the raw entry.* events get. The recording is
    // a write-integrity operation — a failure (component expansion or the outbox
    // insert) must roll the write back, never commit the row without its promised
    // event — so mark it for the bulk/transaction create loops, which otherwise
    // convert an error into a soft per-item failure and continue.
    try {
      const sensitiveFields = await this.webhookFieldTree(
        fields,
        tx.getDrizzle()
      );
      return await recordMutationEvent(tx, {
        type: emitSpec.event,
        resource,
        // Default-deny projection: only the allowlisted keys ship, so a PII
        // collection's sensitive columns never reach the payload.
        data: projectFields(createdDocument, emitSpec.fields),
        previous: null,
        fields: sensitiveFields,
        actor,
      });
    } catch (err) {
      throw markWriteIntegrityFailure(err);
    }
  }

  /**
   * Record one event in this document's history, on the write's own
   * transaction, whatever the collection's webhook settings: history is the
   * document's own record, not a delivery.
   */
  private async recordHistoryEvent(
    tx: TransactionContext,
    collection: string,
    id: string,
    event: Omit<WriteEventInput, "subject">
  ): Promise<{ id: string }> {
    try {
      return await recordWriteEvent(
        tx,
        { adapter: this.adapter },
        { subject: { kind: "collection", slug: collection, id }, ...event }
      );
    } catch (err) {
      // A change never stands without its event: the batch and transaction
      // loops must abort the transaction, not keep its write as a soft
      // per-item failure.
      throw markWriteIntegrityFailure(err);
    }
  }

  /**
   * Rewrite the record of which media items this entry uses from what its
   * tables hold now, on the write's own transaction, so the record commits or
   * rolls back with the write that changed it. Called once everything the
   * write changes is in the transaction. Nothing is recorded before
   * `nextly migrate` has created the record's table: asked on the
   * transaction's own connection, as a catalogue read that cannot abort it.
   */
  private async recordEntryMediaUsage(
    tx: TransactionContext,
    args: {
      collectionName: string;
      entryId: string;
      tableName: string;
      fields: readonly FieldDefinition[];
      /**
       * Whether the write held its change as a working draft: it then stored
       * nothing, so there is nothing to read again.
       */
      heldDraft?: boolean;
    }
  ): Promise<void> {
    if (args.heldDraft === true) return;
    try {
      const present = await mediaUsageTablePresent(
        this.adapter,
        this.logger,
        transactionTableProbe(this.adapter, tx)
      );
      if (!present) return;
      // Loaded on the first write that records, not with the service.
      const { recordStoredDocumentUsage } = await import(
        "../../media/usage/stored-document-usage"
      );
      const companion = await this.fileManager.loadCompanionSchema(
        args.collectionName,
        tx.getDrizzle()
      );
      // The translations are read only where they are there: before the
      // translations migration they sit on the main row, which is read anyway.
      // Remembered, never resolved, inside a transaction (see
      // `splitLocalizedWriteData`).
      const translations =
        companion !== null &&
        cachedCompanionReadiness(this.adapter, companion.companionTableName) ===
          "ready"
          ? companion
          : null;
      const entryId = String(args.entryId);
      await recordStoredDocumentUsage(
        tx,
        {
          fieldGroupDataService: this.fieldGroupDataService,
          locales: storedLanguageCodes(this.localizationSource),
          maxParams: this.adapter.getCapabilities().maxParamsPerQuery,
        },
        { kind: "collection", slug: args.collectionName, documentId: entryId },
        {
          tableName: args.tableName,
          rowId: entryId,
          fields: args.fields as unknown as FieldConfig[],
          translations,
        }
      );
    } catch (err) {
      // A write never stands with a record that disagrees with it: the batch
      // and transaction loops must abort, not keep the write as a soft
      // per-item failure.
      throw markWriteIntegrityFailure(err);
    }
  }

  /**
   * Rebuild the record of which media items every entry of a collection uses,
   * from what its tables hold, for `nextly media reindex-usage`. A page of
   * entries' ids at a time, read by id after the last one read, so an entry
   * created or deleted while it runs moves no other entry onto a page already
   * read; each entry on a transaction of its own. Returns how many entries it
   * read.
   */
  async rebuildMediaUsage(collectionName: string): Promise<number> {
    const collection =
      await this.collectionService.getCollection(collectionName);
    const fields = collectionFields(collection);
    const tableName = collectionTableName(collection, collectionName);
    // The translations' readiness is remembered here, off any transaction,
    // for the reads inside each page's (see `warmLocalizedReadiness`).
    await this.warmLocalizedReadiness(collectionName);
    // Loaded by the rebuild, not with the service.
    const { lockDocument } = await import(
      "../../media/usage/media-usage-store"
    );
    const pageSize = 200;
    let read = 0;
    let after: string | number | undefined;
    for (;;) {
      const rows = await this.adapter.select<{ id: string | number }>(
        tableName,
        {
          columns: ["id"],
          ...(after === undefined
            ? {}
            : { where: { and: [{ column: "id", op: ">", value: after }] } }),
          orderBy: [{ column: "id", direction: "asc" }],
          limit: pageSize,
        }
      );
      for (const row of rows) {
        // Each entry on a transaction of its own that locks its row before
        // it reads anything, so an entry being saved is read as the save
        // leaves it (`lockDocument`).
        await this.adapter.transaction(async tx => {
          await lockDocument(tx, tableName, String(row.id));
          await this.recordEntryMediaUsage(tx, {
            collectionName,
            entryId: String(row.id),
            tableName,
            fields,
          });
        });
      }
      if (rows.length > 0) {
        read += rows.length;
        after = rows[rows.length - 1].id;
      }
      if (rows.length < pageSize) return read;
    }
  }

  /**
   * A save in this document's history; see `recordSaveEvent`. Every save that records a version
   * comes through here, so here, on the same transaction, a save that changed an approved part
   * also withdraws that approval (`withdrawApprovalsOnSave`). `inPlaceTranslated` names the
   * translated fields of a save written in place on a translated document, which changes what
   * every language shows of the fields they share; a held save, or one on a document without
   * translations, leaves it out.
   */
  private async recordSaveHistory(
    tx: TransactionContext,
    collection: string,
    id: string,
    save: Omit<Parameters<typeof recordSaveEvent>[2], "subject">,
    inPlaceTranslated: readonly string[] | null = null
  ): Promise<void> {
    try {
      await recordSaveEvent(
        tx,
        { adapter: this.adapter },
        { subject: { kind: "collection", slug: collection, id }, ...save }
      );
      await withdrawApprovalsOnSave(
        tx,
        { adapter: this.adapter },
        {
          document: {
            scopeKind: "collection",
            scopeSlug: collection,
            entryId: id,
          },
          versionNo: save.versionNo,
          locale: save.locale ?? null,
          actor: save.actor,
          personName: save.personName ?? null,
          inPlaceTranslated,
        }
      );
    } catch (err) {
      // See `recordHistoryEvent`: the transaction must not keep the write, and a save that left
      // an approval standing over content it no longer covers must not be kept either.
      throw markWriteIntegrityFailure(err);
    }
  }

  /**
   * The translated fields of a collection written in place, for the approvals a save withdraws
   * (`recordSaveHistory`): every field a language keeps on its own, or null when the collection
   * keeps no translations. `collection` is the collection's record as the write read it, which
   * `readCollectionWriteMeta` hands over untyped, so its `localized` flag is read by a guard.
   */
  private translatedFieldsOf(
    collection: unknown,
    fields: readonly FieldDefinition[]
  ): string[] | null {
    const localized =
      typeof collection === "object" &&
      collection !== null &&
      "localized" in collection &&
      collection.localized === true;
    if (!localized) return null;
    return resolveLocalizedFieldNames([...fields], true);
  }

  /**
   * Record an overwrite in this document's history, when the update said to
   * overwrite: whatever the collection keeps, in the write's transaction, so
   * a save that cannot record it is not kept either. Whom it replaced is read
   * from `before`, the rows as the save found them before writing. See
   * `recordOverwriteIfAsked` in `versions/overwrite-record`.
   */
  private async recordOverwriteIfAsked(
    tx: TransactionContext,
    check: VersionCheck,
    target: {
      collection: string;
      id: string;
      actor: RequestActor | null | undefined;
      user: UserContext | undefined;
    },
    before: {
      main: DocumentRevisionState | undefined;
      language: PartState | undefined;
      /** Every language's row, for a write over all of them at once. */
      languages?: readonly PartState[];
      locale: string | undefined;
    }
  ): Promise<void> {
    await recordOverwriteIfAsked(
      tx,
      { adapter: this.adapter },
      check,
      {
        subject: { kind: "collection", slug: target.collection, id: target.id },
        actor: actorForWrite(target.actor, target.user),
        personName: target.user?.name ?? null,
        locale: before.locale ?? null,
      },
      before
    ).catch(err => {
      // See `recordHistoryEvent`: the transaction must not keep the write.
      throw markWriteIntegrityFailure(err);
    });
  }

  /** This document's status moves in its history; see `recordTransitionEvents`. */
  private recordTransitionHistory(
    tx: TransactionContext,
    collection: string,
    id: string,
    write: {
      actor: RequestActor;
      personName?: string | null;
      isCreate?: boolean;
      versionNo?: number | null;
    },
    moves: readonly StatusMove[]
  ): Promise<void> {
    return (
      recordTransitionEvents(
        tx,
        { adapter: this.adapter },
        { subject: { kind: "collection", slug: collection, id }, ...write },
        moves
      )
        // A publish closes the published parts' review cycles: what workflows pinned for them is
        // released on the same transaction, decided by the same moves the history records.
        .then(() =>
          releaseWorkflowPinsOnPublish(
            tx,
            { scopeKind: "collection", scopeSlug: collection, entryId: id },
            write,
            moves
          )
        )
        .catch(err => {
          // See `recordHistoryEvent`: the transaction must not keep the write.
          throw markWriteIntegrityFailure(err);
        })
    );
  }

  /**
   * Record the lifecycle status events for one transition
   * (`entry.published`/`entry.unpublished`/`entry.status_changed`) into the
   * outbox, INSIDE the caller's write transaction so they commit atomically with
   * the content write and inherit the recording opt-out (each call routes through
   * `recordMutationEvent`, which short-circuits on a `webhooks: false`
   * collection). `statusEventsFor` decides the event set; a no-op transition
   * (`from === to`, or a write that set no `status`) records nothing. Reuses the
   * document/`previous`/`fields` the surrounding write already assembled for its
   * `entry.created`/`entry.updated` event, so an opted-out write pays nothing
   * extra. Returns whether any event was appended, so the caller folds it into
   * the same `eventRecorded` signal that gates the fast-drain and retention pass.
   */
  private async recordStatusEvents(
    tx: TransactionContext,
    args: {
      collection: string;
      id: string;
      locale?: string;
      from: string | null;
      to: string | null | undefined;
      isCreate: boolean;
      data: Record<string, unknown>;
      previous: Record<string, unknown> | null;
      fields: readonly SensitiveFieldSource[];
      actor: RequestActor | null;
    }
  ): Promise<boolean> {
    // Only a real string status can be a lifecycle transition; a write that set
    // no status field has nothing to emit.
    if (typeof args.to !== "string") return false;
    const types = statusEventsFor({
      from: args.from,
      to: args.to,
      isCreate: args.isCreate,
    });
    if (types.length === 0) return false;
    const statusChange = { from: args.from, to: args.to };
    let recorded = false;
    for (const type of types) {
      const did = await recordMutationEvent(tx, {
        type,
        resource: {
          kind: "entry",
          collection: args.collection,
          id: args.id,
          ...(args.locale !== undefined ? { locale: args.locale } : {}),
        },
        data: args.data,
        previous: args.previous,
        fields: args.fields,
        actor: args.actor,
        statusChange,
      });
      recorded = recorded || did;
    }
    return recorded;
  }

  /**
   * The read-shape parent document a programmatic (tx-API / batch / publish)
   * write event carries: JSON container fields parsed, then password hashes and
   * the internal owner column (created_by) stripped — the same server-side
   * fields the interactive create/update paths remove before building their
   * event, so a stable user id never leaves in a webhook envelope. Operates on a
   * shallow copy so the caller's row is not mutated. Many-to-many/component
   * subtrees are not assembled here (the parent columns are the event payload on
   * these paths); the full relational assembly rides the version-capture work.
   */
  /**
   * Redact a row on its way into durable history.
   *
   * The same pair at four sites, which is four chances for one of them to
   * learn about a new server-only column and the others not to. A password
   * hash reaching version history stays recoverable after the password
   * changes, and the owner column would let a restore overwrite ownership.
   */
  private redactSnapshotRow(
    row: Record<string, unknown>,
    fields: FieldDefinition[],
    /**
     * The physical table the row was written to, as the write resolved it.
     * Taken rather than rebuilt from the slug, because contributed hidden
     * columns are keyed by the physical name and a `dbName` collection's
     * differs from `dc_<slug>`.
     */
    tableName: string,
    /** Where the password strip follows field groups held inline. */
    reach: FieldGroupReach
  ): void {
    stripPasswordFieldValues(row, fields, reach);
    stripServerOnlyColumns(row, tableName);
  }

  private readShapeEventDocument(
    row: Record<string, unknown>,
    fields: readonly unknown[],
    /** The SQL table the row came from, for its contributed columns. */
    tableName: string,
    /** Where the password strip follows field groups held inline. */
    reach: FieldGroupReach
  ): Record<string, unknown> {
    const doc = convertTimestampsToCamelCase(
      this.deserializeJsonFieldsForSnapshot(
        { ...row },
        fields as Parameters<typeof this.deserializeJsonFieldsForSnapshot>[1]
      )
    );
    stripPasswordFieldValues(
      doc,
      fields as Parameters<typeof stripPasswordFieldValues>[1],
      reach
    );
    stripServerOnlyColumns(doc, tableName);
    return doc;
  }

  /**
   * Where the password walk follows the field groups `fields` hold inline,
   * read on `executor`: a write inside a transaction passes its own, since a
   * pooled read there waits on the connection the transaction holds.
   */
  private passwordReach(
    fields: readonly unknown[],
    executor?: unknown
  ): Promise<FieldGroupReach> {
    return passwordReachOf(fields, this.fieldGroupDataService, executor);
  }

  /**
   * Assemble a full read-shape document for a row written on a caller's
   * transaction: the already read-shaped parent columns plus a fresh read of the
   * row's component subtrees and many-to-many id arrays on that same
   * transaction. Returns both the composed parts (so a caller can index a
   * version snapshot from them without a second relations read) and the
   * assembled document (the shape the outbox event carries).
   *
   * The tx-API and batch write paths build only the parent row inline; routing
   * their event payload through here gives it the same relational completeness
   * the interactive paths carry. These paths route no localized write, so the
   * relations are read without a locale (a single set of values).
   *
   * `needsRelations` gates the relational read: it is skipped when neither a
   * version nor an event will consume the result (versioning off AND the
   * collection opted out of webhooks). `buildFullSnapshotRelations` issues a
   * query per component and m2m field and deliberately fails the write on a read
   * error, so running it for a write that consumes nothing would add avoidable
   * per-item query cost and could roll back an otherwise valid scalar write on an
   * unrelated relation read. When skipped, the parent columns are the document.
   */
  private async readTxDocumentParts(
    tx: TransactionContext,
    args: {
      collectionName: string;
      tableName: string;
      entryId: string;
      // Already read-shaped (JSON parsed, timestamps camelCased) and stripped of
      // password/system-owner fields by the caller.
      parentRow: Record<string, unknown>;
      fields: FieldDefinition[];
      manyToManyFields: FieldDefinition[];
      needsRelations: boolean;
    }
  ): Promise<{
    documentParts: {
      parentRow: Record<string, unknown>;
      components: Record<string, unknown>;
      manyToMany: Record<string, string[]>;
    };
    document: Record<string, unknown>;
  }> {
    let components: Record<string, unknown> = {};
    let manyToMany: Record<string, string[]> = {};
    if (args.needsRelations) {
      try {
        ({ components, manyToMany } = await this.buildFullSnapshotRelations(
          tx,
          args.entryId,
          args.collectionName,
          args.tableName,
          args.fields,
          args.manyToManyFields
        ));
      } catch (err) {
        // The content row is already written on the caller's transaction. A
        // failed relation read must abort it rather than be swallowed into a
        // soft per-item failure that commits a row whose snapshot and event
        // silently dropped a component or relationship; mark it so the batch
        // loops re-throw instead of continuing.
        throw markWriteIntegrityFailure(err);
      }
    }
    const documentParts = {
      parentRow: args.parentRow,
      components,
      manyToMany,
    };
    return { documentParts, document: assembleDocument(documentParts) };
  }

  /**
   * Capture one durable version snapshot on a caller's transaction from parts
   * already assembled by {@link readTxDocumentParts}, when the collection opts
   * into versioning. A no-op otherwise, so a tx-API or batch write into a
   * non-versioned collection stays free of the tagging walk.
   *
   * The snapshot commits atomically with the content write on the caller's
   * transaction — history never records a write that later rolls back. These
   * paths route no localized parent write, but an unlocalized collection can
   * still embed a localized component, whose subtree was read at the default
   * locale; the version is then tagged with that locale so a restore knows which
   * language to write the component into (mirroring the interactive paths). A
   * snapshot with no component state carries no locale.
   */
  private async captureTxVersion(
    tx: TransactionContext,
    args: {
      collectionName: string;
      entryId: string;
      // The written row's own status value; indexed as the version's status.
      contentStatus: unknown;
      createdBy: string | null;
      versionsConfig: ResolvedVersionsConfig | null | undefined;
      documentParts: {
        parentRow: Record<string, unknown>;
        components: Record<string, unknown>;
        manyToMany: Record<string, string[]>;
      };
      fields: FieldDefinition[];
      /**
       * The locale this snapshot's translatable values belong to, when the
       * write put any there. Absent means the snapshot carries no per-locale
       * parent state and the component rule below decides.
       */
      localeTag?: string;
      /** An update, whose save may change nothing; a create always records. */
      onlyIfChanged?: boolean;
      /** Whether the collection has the Draft/Published lifecycle. */
      lifecycle: boolean;
    }
  ): Promise<number | null> {
    // The version recorded, or null when versioning is off or the save
    // changed nothing.
    if (!args.versionsConfig?.enabled) {
      return null;
    }
    try {
      const { versionNo } = await captureInTx(tx, this.versionCapture, {
        onlyIfChanged: args.onlyIfChanged === true,
        lifecycle: args.lifecycle,
        ref: {
          scopeKind: "collection",
          scopeSlug: args.collectionName,
          entryId: args.entryId,
        },
        contentStatus: args.contentStatus,
        // Tagged for the snapshot alone: `documentParts` is also what the outbox
        // event carries, and that payload is read shape.
        parts: await this.snapshotPartsFor(args.documentParts, args.fields, tx),
        createdBy: args.createdBy,
        // The locale this snapshot belongs to: the one the write put
        // translatable parent values in, when it did. Otherwise the component
        // rule — the subtrees were read at the default locale (these paths
        // pass no write locale), so tag the version with it when there are
        // any, exactly as the interactive create/update paths do. Null when
        // the snapshot carries neither, since there is then one set of values
        // and nothing to disambiguate.
        locale:
          args.localeTag ??
          (Object.keys(args.documentParts.components ?? {}).length > 0
            ? this.componentSnapshotLocale(undefined)
            : null),
        maxPerDoc: args.versionsConfig.maxPerDoc,
      });
      return versionNo;
    } catch (err) {
      // The content row is already written on the caller's transaction. A
      // capture failure (e.g. component-schema resolution while tagging) must
      // abort that transaction rather than be swallowed into a soft per-item
      // failure that commits an unversioned row; mark it so the batch loops
      // re-throw instead of continuing.
      throw markWriteIntegrityFailure(err);
    }
  }

  /**
   * Record everything a create owes once its row is in the transaction: the
   * many-to-many junction rows, the durable version snapshot, the outbox
   * event, and the revalidation intent.
   *
   * Shared by the transaction API and the batch worker so a create through
   * either is captured AND observable — the invariant the interactive and
   * delete-in-tx paths already hold. Every write lands on the caller's `tx`,
   * so it commits with the entry and never survives a rollback;
   * `eventRecorded` is reported back for the owning caller to flush its drain
   * after IT commits.
   *
   * The version and the event are built from ONE relations read — the
   * freshly-inserted parent row in read shape plus its component subtrees and
   * m2m id arrays on `tx` — so both carry the same complete document.
   *
   * The intent is computed here, before any after-hook runs and before
   * redaction can strip the slug, so a throwing hook cannot lose it.
   *
   * Recording and capture are NOT user hooks, so they run even for a caller
   * that skips hooks.
   */
  // Flagged on CRAP only (cyclomatic 12, cognitive 9 are both under their
  // thresholds); CRAP multiplies complexity by MISSING coverage, and the
  // coverage term here is estimated rather than measured. It is covered, by the
  // integration suites rather than by unit tests: disabling the outbox event
  // inside this method turns four tests in write-path-events-matrix red, two
  // for the transaction API and two for the batch worker.
  // fallow-ignore-next-line complexity
  private async recordCreateSideEffects(
    tx: TransactionContext,
    args: {
      collectionName: string;
      tableName: string;
      /** The freshly-inserted row, as the insert returned it. */
      entry: Record<string, unknown>;
      collection: unknown;
      fields: FieldDefinition[];
      manyToManyFields: FieldDefinition[];
      manyToManyData: Record<string, string[]>;
      user?: UserContext;
      actor?: RequestActor;
      /** The locale this create's translatable values were written in, if any. */
      localeTag?: string;
      /** The in-transaction handlers this write took, which will be run. */
      inTransactionHandlers: InTransactionHandlerSet;
    }
  ): Promise<{
    eventRecorded: boolean;
    revalidationIntent: RevalidationIntent | undefined;
    /** The created document in read shape, as the outbox event carries it. */
    document: Record<string, unknown>;
  }> {
    const entryId = args.entry.id as string;

    // Handle many-to-many relationships on the caller's transaction so the
    // junction writes commit atomically with the entry.
    const txExecutor = tx.getDrizzle<RelationshipDbExecutor>();
    for (const field of args.manyToManyFields) {
      const relatedIds = args.manyToManyData[field.name];
      if (relatedIds && relatedIds.length > 0) {
        await this.relationshipService.insertManyToManyRelations(
          args.collectionName,
          entryId,
          field,
          relatedIds,
          txExecutor
        );
      }
    }

    const versionsConfig = (args.collection as Record<string, unknown>)
      .versions as ResolvedVersionsConfig | null | undefined;
    // Skip the per-field component/m2m reads when neither a version nor an
    // event will consume them (versioning off AND recording disabled by
    // config). Gated on `isRecordingDisabledByConfig` — the SAME config-stable
    // decision the webhook field-tree uses — so the relations and the stripped
    // field tree are always assembled together: a decision that can flip
    // mid-write (a stored opt-out or endpoint activation) never leaves a
    // recorded event with a parent-only payload.
    const needsRelations =
      !!versionsConfig?.enabled ||
      !isRecordingDisabledByConfig("collection", args.collectionName) ||
      // A curated `webhooks.emit` consumes the assembled document too — its
      // allowlist may include a component/m2m field — so assemble relations
      // even when the raw entry.* recording is opted out for this collection.
      getWebhookEmitSpec("collection", args.collectionName) !== undefined ||
      // An in-transaction handler is handed the whole document, as on the
      // create that opens its own transaction.
      args.inTransactionHandlers.length > 0;
    const { documentParts: createdParts, document: createdDocument } =
      await this.readTxDocumentParts(tx, {
        collectionName: args.collectionName,
        tableName: args.tableName,
        entryId,
        parentRow: this.readShapeEventDocument(
          args.entry,
          args.fields,
          args.tableName,
          await this.passwordReach(args.fields, tx.getDrizzle())
        ),
        fields: args.fields,
        manyToManyFields: args.manyToManyFields,
        needsRelations,
      });
    const createdVersionNo = await this.captureTxVersion(tx, {
      lifecycle: hasLifecycle(args.collection),
      collectionName: args.collectionName,
      entryId,
      contentStatus: args.entry.status,
      createdBy: args.user?.id ?? null,
      versionsConfig,
      documentParts: createdParts,
      fields: args.fields,
      // See `captureTxVersion`: a create that wrote translatable values put
      // them in one language, and an untagged snapshot of them reads as
      // shared.
      localeTag: args.localeTag,
    });
    const eventFields = await this.webhookFieldTreeIfRecording(
      args.collectionName,
      args.fields,
      tx.getDrizzle()
    );
    const eventActor = actorForWrite(args.actor, args.user);
    // Which media items the new entry uses, from what the create stored.
    await this.recordEntryMediaUsage(tx, {
      collectionName: args.collectionName,
      entryId,
      tableName: args.tableName,
      fields: args.fields,
    });
    // The document's first history event, in the caller's transaction.
    await this.recordHistoryEvent(tx, args.collectionName, entryId, {
      kind: "created",
      actor: eventActor,
      personName: args.user?.name ?? null,
      ...(args.localeTag ? { parts: { locales: [args.localeTag] } } : {}),
      toState: typeof args.entry.status === "string" ? args.entry.status : null,
      versionNo: createdVersionNo,
    });
    let eventRecorded = await recordMutationEvent(tx, {
      type: "entry.created",
      resource: {
        kind: "entry",
        collection: args.collectionName,
        id: entryId,
        // The language this create's translatable values went into, as the
        // interactive create reports it.
        ...(args.localeTag ? { locale: args.localeTag } : {}),
      },
      data: createdDocument,
      previous: null,
      fields: eventFields,
      actor: eventActor,
    });
    // Emit the collection's curated create event too (a no-op unless it
    // declared `webhooks.emit`), so a form/PII collection created through the
    // transaction and bulk paths gets the same event as the direct path.
    const curatedCreateRecorded = await this.recordCuratedCreateEvent(
      tx,
      args.collectionName,
      entryId,
      createdDocument,
      eventActor,
      args.fields,
      // Every side effect of this create describes the same language the values
      // were written in. A receiver reads the locale from the resource, so one
      // that omits it is delivered as belonging to no translation in
      // particular — and they must not disagree with each other about which
      // translation they are reporting.
      args.localeTag
    );
    eventRecorded = eventRecorded || curatedCreateRecorded;
    // A create landing directly on `published` is also a publish lifecycle
    // event, gated on the collection's Draft/Published flag so an ordinary
    // user `status` field is not mistaken for a lifecycle change. `from` is
    // null (nothing to transition from), so only `entry.published` is emitted.
    if ((args.collection as { status?: boolean }).status === true) {
      const createdStatusRecorded = await this.recordStatusEvents(tx, {
        collection: args.collectionName,
        id: entryId,
        ...(args.localeTag ? { locale: args.localeTag } : {}),
        from: null,
        to: args.entry.status as string | null | undefined,
        isCreate: true,
        data: createdDocument,
        previous: null,
        fields: eventFields,
        actor: eventActor,
      });
      eventRecorded = createdStatusRecorded || eventRecorded;
      // A create straight onto published is a publish in history too.
      await this.recordTransitionHistory(
        tx,
        args.collectionName,
        entryId,
        {
          actor: eventActor,
          personName: args.user?.name ?? null,
          isCreate: true,
          versionNo: createdVersionNo,
        },
        [{ locale: args.localeTag, from: null, to: args.entry.status }]
      );
    }

    return {
      eventRecorded,
      document: createdDocument,
      revalidationIntent: buildEntryRevalidationIntent(
        args.collectionName,
        readRevalidateConfig(args.collection),
        {
          id: entryId,
          slug: readStringField(args.entry, "slug"),
          // Without it the locale-specific tag for this id is never flushed,
          // so the new translation stays behind a cached miss.
          ...(args.localeTag ? { locale: args.localeTag } : {}),
        }
      ),
    };
  }

  /**
   * Assemble a removed entry as the read shape the create/update events carry —
   * JSON container fields parsed, component subtrees and many-to-many id arrays
   * populated, password and system-owner fields stripped — so a delete event
   * reports the document in a shape consistent with every other event. Reads the
   * relations on the delete transaction, so the caller MUST build this BEFORE the
   * cascade delete removes them.
   */
  private async buildDeletedDocument(
    tx: TransactionContext,
    args: {
      collectionName: string;
      entryId: string;
      tableName: string;
      row: Record<string, unknown>;
      fields: FieldDefinition[];
      /**
       * Locale whose companion translations to merge into the snapshot. For a
       * migrated localized collection the main row holds no translatable values,
       * so without this the payload omits every localized field.
       */
      locale?: string;
    }
    // Returns the assembled document plus the locale that actually applied — set
    // only when the collection is localized — so the caller tags `resource.locale`
    // with the same locale the payload represents (and omits it otherwise).
  ): Promise<{ document: Record<string, unknown>; locale?: string }> {
    const { collectionName, entryId, tableName, row, fields, locale } = args;
    const manyToManyFields = fields.filter(
      f => f.type === "relationship" && f.options?.relationType === "manyToMany"
    );

    // Overlay the locale's translatable values from the companion table before
    // deserializing, so a localized field still held as a JSON string is parsed
    // to the read shape too — matching how the update path builds `previous`.
    const merged: Record<string, unknown> = {
      ...convertTimestampsToCamelCase({ ...row }),
    };
    let appliedLocale: string | undefined;
    if (locale && this.localization) {
      // A companion schema means the collection is localized; only then does the
      // locale disambiguate the payload, so only then is it recorded. Bound to
      // the transaction connection so the metadata read does not re-enter the
      // pool from inside the caller's transaction.
      const companion = await this.fileManager.loadCompanionSchema(
        collectionName,
        tx.getDrizzle()
      );
      if (companion) {
        appliedLocale = locale;
        Object.assign(
          merged,
          await this.readCompanionLocalizedValues(
            tx,
            collectionName,
            entryId,
            locale
          )
        );
      }
    }

    const parentRow = this.deserializeJsonFieldsForSnapshot(merged, fields);
    this.redactSnapshotRow(
      parentRow,
      fields,
      tableName,
      await this.passwordReach(fields, tx.getDrizzle())
    );

    const { components, manyToMany } = await this.buildFullSnapshotRelations(
      tx,
      entryId,
      collectionName,
      tableName,
      fields,
      manyToManyFields,
      appliedLocale
    );

    return {
      document: assembleDocument({ parentRow, components, manyToMany }),
      locale: appliedLocale,
    };
  }

  private transitionStatus(args: {
    collection: string;
    id: unknown;
    data: Record<string, unknown>;
    user?: UserContext;
    previousStatus: string | null;
    status: string;
    emitStatusChanged: boolean;
    locale?: string;
  }): void {
    const docBase = {
      id: args.id,
      data: args.data,
      user: args.user,
      ...(args.locale !== undefined ? { locale: args.locale } : {}),
    };
    emitDocumentEvent("statusTransition", args.collection, {
      ...docBase,
      previousStatus: args.previousStatus,
      status: args.status,
    });
    if (args.emitStatusChanged) {
      emitDocumentEvent("statusChanged", args.collection, {
        ...docBase,
        previousStatus: args.previousStatus,
        status: args.status,
      });
    }
    if (args.status === "published" && args.previousStatus !== "published") {
      emitDocumentEvent("published", args.collection, docBase);
    }
  }

  /**
   * A write's top-level payload as its caller sent it, for the validators of
   * a field inside a field-group instance, which `PluginFieldValidateArgs.data`
   * promises the write: the processed data with what the write lifted out of
   * it put back, its relations and field groups (`lifted`) and, for a
   * translation, the language's values and status, which the language split
   * moves to the companion row.
   */
  private writtenPayload(
    finalData: Record<string, unknown>,
    lifted: ReadonlyArray<Record<string, unknown>>,
    localized:
      | {
          localizedFieldValues: Record<string, unknown>;
          companionData: Record<string, unknown>;
        }
      | null
      | undefined
  ): Record<string, unknown> {
    const status = localized?.companionData._status;
    // A copy of its own: the field-group save prepares its instances in place
    // (defaults, hashing), and a validator must see each as it was sent. Its
    // containers are copied, so a value that cannot be cloned stays itself.
    return detachData(
      Object.assign(
        { ...finalData },
        localized?.localizedFieldValues,
        typeof status === "string" ? { status } : {},
        ...lifted
      )
    );
  }

  /**
   * The entry write a validation is for, reading on the connection this write
   * uses: `tx` inside a transaction, the pool before one opens.
   *
   * A field type judging a value against stored rows — a component that must
   * not end up containing itself — has to see what this write sees. Inside a
   * batch that is the batch's own transaction, because the rows it wrote
   * before this one are visible nowhere else until it commits.
   */
  private validationWrite(
    slug: string,
    id: string | undefined,
    tx?: TransactionContext,
    locale?: string,
    // The write's top-level payload, for a field-group instance's validators,
    // which are otherwise handed the instance; see `EntryWriteContext.payload`.
    payload?: Record<string, unknown>
  ): EntryWriteContext {
    const defaultLocale = this.localization?.defaultLocale ?? null;
    const write = entryWriteContext({
      kind: "collection",
      slug,
      ...(id === undefined ? {} : { id }),
      ...(locale === undefined ? {} : { locale }),
      connection:
        tx === undefined
          ? { db: this.adapter, executor: undefined, defaultLocale }
          : { db: tx, executor: tx.getDrizzle(), defaultLocale },
    });
    return payload === undefined ? write : { ...write, payload };
  }

  /**
   * Refuse a write whose values break the collection's rules.
   *
   * One place for what every write path asks of validation — the validation
   * view of the data, the field validators registered for it, the caller, and
   * the entry write a field type may read stored rows through — so a write
   * path cannot hand a validator a different connection from the one its write
   * runs on.
   */
  private async assertEntryValid(args: EntryValidationArgs): Promise<void> {
    const issues = await this.entryIssues(args);
    if (issues.length > 0) {
      throw NextlyError.validation({ errors: issues });
    }
  }

  /**
  /**
   * The component schemas the hook walk resolves for a component held in a
   * group or repeater, by slug, or nothing when the fields hold none: the
   * gate judged such a component's value against these fields before the
   * hooks ran, so the walk that judges what the hooks left behind resolves
   * the same schemas. On the pool, as the gate on these paths reads.
   */
  private async hookWalkComponentResolver(
    fields: FieldDefinition[],
    executor?: unknown
  ) {
    return containedComponentResolver(
      fields as unknown as FieldConfig[],
      async componentSlug =>
        (await this.fieldGroupDataService?.getComponentFields(
          componentSlug,
          executor
        )) ?? null,
      false
    );
  }

  /**
   * What {@link assertEntryValid} refuses a write with, without refusing it:
   * every violation, or none.
   */
  private async entryIssues(
    args: EntryValidationArgs
  ): Promise<ValidationIssue[]> {
    const view = this.validationView(args.data, args.fields);
    // A component's fields, on the write's connection, read once for the
    // whole batch where the document goes live with others.
    const componentFieldsOf = (componentSlug: string) => {
      const read = async () =>
        (await this.fieldGroupDataService?.getComponentFields(
          componentSlug,
          args.tx?.getDrizzle()
        )) ?? null;
      return args.batch === undefined
        ? read()
        : args.batch.componentFields(componentSlug, read);
    };
    // In the default language, or in any where the document has no
    // translated fields and so is the same document in every language.
    const judgeInstances =
      args.goesLive === true &&
      (args.localeCtx === undefined ||
        args.localeCtx.enforceLocalizedRequired ||
        args.localeCtx.perLanguage === false);
    const issues = await validateEntryData(
      view,
      attachFieldValidators("collection", args.collectionName, args.fields),
      {
        mode: args.mode,
        req: args.user ? { user: args.user } : {},
        ...(args.assembledFromStorage ? { assembledFromStorage: true } : {}),
        ...(args.storedProvenancePaths
          ? { storedProvenancePaths: args.storedProvenancePaths }
          : {}),
        ...args.localeCtx,
        // A component inside a group or repeater is judged here, since no
        // component write reaches it; read on the write's own connection.
        // Going live, a top-level one too, in the default language.
        componentFields: await containedComponentResolver(
          args.fields as unknown as FieldConfig[],
          componentFieldsOf,
          judgeInstances
        ),
        judgeComponentInstances: judgeInstances,
        // Going live in a language whose component rules are not enforced,
        // a component held in a group or repeater is left alone too.
        ...(args.goesLive === true && !judgeInstances
          ? { judgeContainedComponents: false }
          : {}),
        write: this.validationWrite(
          args.collectionName,
          args.id ??
            suppliedCreateId(args.mode, args.collectionName, args.data),
          args.tx,
          // The language judged: each in turn where a write judges several,
          // else the one this write is in.
          args.readLocale ?? args.writeLocale
        ),
      }
    );
    // The document judged can hold fields the caller may not read; their
    // issues are told without naming them or their values.
    if (issues.length === 0) return issues;
    const service = this.fieldGroupDataService;
    const collection = await this.collectionService.getCollection(
      args.collectionName,
      args.tx?.getDrizzle()
    );
    return issuesTheReaderMaySee(issues, {
      kind: "collection",
      slug: args.collectionName,
      document: view,
      fields: args.fields as unknown as FieldConfig[],
      fieldGroups: service && {
        getComponentFields: componentFieldsOf,
      },
      executor: args.tx?.getDrizzle(),
      entryId: args.id,
      tableName: collectionTableName(collection, args.collectionName),
      // As this service reads the document in that language.
      readLanguage:
        args.readLocale === undefined
          ? undefined
          : readLanguagesFor(this.localization, args.readLocale),
      // A stored entry the reader may not read is shown to them in no part.
      // A read limited to a filter is not matched against this entry here,
      // so it is judged as one that may not reach it.
      rowReadable:
        args.id === undefined
          ? undefined
          : async () => {
              const read = await this.accessService.checkCollectionRead({
                collectionName: args.collectionName,
                user: args.user,
                authenticatedScope: args.reader.authenticatedScope,
                executor: args.tx?.getDrizzle(),
              });
              return read.denied === null && read.filter === undefined;
            },
      // Judged by the Public role this service's own gate reads.
      reader: {
        ...args.reader,
        grants:
          args.reader.grants ??
          this.callerGrants(
            args.reader.user,
            args.reader.authenticatedScope,
            args.tx?.getDrizzle()
          ),
      },
    });
  }

  /**
   * The document a validator is shown.
   *
   * A relationship read at a populating depth comes back as the related row,
   * and a multi-target one wrapped with the collection it names. A field's
   * public value is the document id, and a custom validator is written against
   * that — handed a row it compares an object to a string, or calls a string
   * method on it and throws.
   *
   * Reduced on a detached copy rather than in place, because the submitted
   * shape is what the hooks between here and storage still expect to see.
   */
  private validationView(
    data: Record<string, unknown>,
    fields: FieldDefinition[]
  ): Record<string, unknown> {
    return relationshipValidationView(data, fields as unknown as FieldConfig[]);
  }

  /**
   * The language rules a publish judges a document going live in, as
   * {@link localizedRequiredContext} gives them, with its components'
   * `required` relaxed outside the default language where the document differs
   * by language, and whether it does.
   */
  private async publishLanguageContext(args: {
    collectionName: string;
    locale: string | undefined;
    fields: FieldDefinition[];
    tx?: TransactionContext;
    companion?: CompanionSchema | null;
  }): Promise<{
    localizedFieldNames: ReadonlySet<string>;
    enforceLocalizedRequired: boolean;
    perLanguage: boolean;
  }> {
    const context = await this.localizedRequiredContext(
      args.collectionName,
      args.locale,
      args.tx?.getDrizzle(),
      args.companion
    );
    const perLanguage =
      context.localizedFieldNames.size > 0 ||
      (await this.reachesLocalizedFieldGroup(args.fields, args.tx));
    return {
      ...componentsRequiredInDefaultLanguage(context, args.fields, perLanguage),
      perLanguage,
    };
  }

  /**
   * Build the locale-aware inputs for {@link validateEntryData} on a localized-collection write
   * (i18n M5b). `required` on a localized field is enforced only for the default-language row so the
   * "publish default now, translate later" workflow proceeds; shared required fields are always
   * enforced. For a non-localized collection this yields an empty set and enforce=true, so the
   * canonical validator behaves exactly as it does elsewhere. Localized field names come from the
   * companion schema, so a localized collection that has not been migrated yet (localized columns
   * still on the main table) treats no field as localized, matching the pre-migration behavior.
   */
  private async localizedRequiredContext(
    collectionName: string,
    locale: string | undefined,
    /**
     * A transaction's own executor, when this is asked from inside one: the
     * metadata read would otherwise take a second pooled connection.
     */
    executor?: unknown,
    /** The companion already resolved for a batch; read when absent. */
    resolved?: CompanionSchema | null
  ): Promise<{
    localizedFieldNames: ReadonlySet<string>;
    enforceLocalizedRequired: boolean;
  }> {
    const companion =
      resolved !== undefined
        ? resolved
        : await this.fileManager.loadCompanionSchema(collectionName, executor);
    const localizedFieldNames = new Set(
      (companion?.localizedFields ?? []).map(f => f.name)
    );
    const enforceLocalizedRequired =
      !this.localization ||
      resolveRequestedLocale(this.localization, locale) ===
        this.localization.defaultLocale;
    return { localizedFieldNames, enforceLocalizedRequired };
  }

  /**
   * reject an unrecognized write locale with a 400 instead of silently mapping it to
   * the default locale (which would write the translatable values into the DEFAULT companion
   * row, potentially overwriting real default content). Returns a 400 result, or null when the
   * locale is absent/valid or localization is off.
   */
  private rejectInvalidWriteLocale(
    locale: string | undefined
  ): CollectionServiceResult | null {
    if (!locale || !this.localization) return null;
    if (isValidLocale(this.localization, locale)) return null;
    return {
      success: false,
      statusCode: 400,
      message:
        `Unknown locale '${locale}'. Configured locales: ` +
        `${this.localization.locales.map(l => l.code).join(", ")}.`,
      data: null,
    };
  }

  /**
   * Split `entryData` (snake_case keys) into main-table data and companion data for a localized
   * collection: localized columns move to `companionData` and are removed from `mainData` (the
   * migrated main table no longer has them). Returns `null` when the collection isn't localized
   * or the companion table doesn't exist yet (dev/unmigrated → localized cols stay on main).
   */
  /**
   * The locale a component subtree in a snapshot belongs to.
   *
   * Component tables are per-locale whether or not their parent is, and a write
   * that names no locale still reaches them at the configured default — the
   * component read and write both resolve `undefined` that way. Recording null
   * would leave that snapshot unplaceable, so the default is made explicit
   * here. Without localization configured there are no per-locale rows and
   * nothing to record.
   */
  private componentSnapshotLocale(
    requested: string | undefined
  ): string | null {
    if (!this.localization) return null;
    return resolveRequestedLocale(this.localization, requested);
  }

  /**
   * The companion row a CREATE writes: the new parent, the write's locale, the
   * translatable values, and the staleness stamp. An insert rather than an
   * upsert, because a parent this transaction has just created has no row to
   * conflict with — the update paths upsert instead.
   *
   * The stamp is not optional and not restated per caller: a create that
   * forgot it leaves every new document's translations reading as UNKNOWN
   * until each locale is rewritten, and a staleness signal that never fires
   * for new content is invisible. Both create paths call this, so they cannot
   * come to disagree about what a new translation carries.
   */
  /**
   * A translated collection's translation table when it is there, read on the
   * caller's transaction; null for a collection that keeps no translations or
   * whose table is not there yet. Asked of the catalog rather than taken from
   * the write, which writes no translation row for a held edit, so the
   * version a write answers with names the languages a read's will.
   */
  private async translationTableOnTx(
    tx: TransactionContext,
    collection: unknown,
    tableName: string
  ): Promise<string | null> {
    if ((collection as { localized?: boolean }).localized !== true) return null;
    if (!this.localization) return null;
    const table = `${tableName}_locales`;
    const live = await liveColumnNames(tx.getDrizzle(), this.dialect, [table]);
    return live.has(table.toLowerCase()) ? table : null;
  }

  private async insertCompanionRow(
    tx: TransactionContext,
    localizedWrite: {
      companionTableName: string;
      writeLocale: string;
      companionData: Record<string, unknown>;
    },
    parentId: unknown,
    savedBy: RequestActor
  ): Promise<void> {
    await tx.insert(
      localizedWrite.companionTableName,
      {
        _parent: parentId,
        _locale: localizedWrite.writeLocale,
        ...localizedWrite.companionData,
        ...companionContentStamp(
          localizedWrite.companionData,
          localizedWrite.companionTableName,
          this.dialect
        ),
      },
      {}
    );
    // The row's counter starts at its default, 1. Its changer is set by name:
    // a translation table's runtime model does not declare the column, so the
    // insert above, built from that model, cannot carry it.
    await tx.update(
      localizedWrite.companionTableName,
      translationChangeColumns(savedBy, this.dialect),
      {
        and: [
          { column: "_parent", op: "=", value: String(parentId) },
          { column: "_locale", op: "=", value: localizedWrite.writeLocale },
        ],
      }
    );
  }

  /**
   * Whether a collection's translation table is ready to be written: what a
   * localized write decides from (`splitLocalizedWriteData`), and what a
   * save's version is judged by, so a save is judged on a language exactly
   * when its write goes to that language's row. Inside a caller's
   * transaction (`executor`) only a remembered verdict is read; see there.
   */
  private async companionReadinessOf(
    companion: {
      companionTableName: string;
      localizedFields: readonly { column: string }[];
    },
    executor?: unknown
  ): Promise<CompanionReadiness | undefined> {
    return executor
      ? cachedCompanionReadiness(this.adapter, companion.companionTableName)
      : await resolveCompanionReadiness(this.adapter, {
          companionTableName: companion.companionTableName,
          mainTableName: companion.companionTableName.replace(/_locales$/, ""),
          localizedColumns: companion.localizedFields.map(f => f.column),
        });
  }

  /**
   * A collection's translation schema when its table is ready to be written,
   * else null: the languages a save's version must name are those of a ready
   * table, as a read's version names them only then.
   */
  private async readyCompanionOf(
    collectionName: string,
    executor?: unknown
  ): Promise<{ companionTableName: string } | null> {
    if (!this.localization) return null;
    const companion = await this.fileManager.loadCompanionSchema(
      collectionName,
      executor
    );
    if (!companion) return null;
    return (await this.companionReadinessOf(companion, executor)) === "ready"
      ? companion
      : null;
  }

  private async splitLocalizedWriteData(
    collectionName: string,
    entryData: Record<string, unknown>,
    locale: string | undefined,
    isCreate: boolean,
    /**
     * Transaction-bound executor, when this runs inside a caller's transaction.
     * The companion metadata read would otherwise check out a second pooled
     * connection the open transaction is holding, which stalls against a small
     * pool.
     */
    executor?: unknown
  ): Promise<{
    companionTableName: string;
    writeLocale: string;
    companionData: Record<string, unknown>;
    // The same written localized values, keyed by FIELD NAME (companionData is
    // keyed by snake_case column). A version snapshot merges these onto the
    // parent so the read-shape snapshot carries this locale's translatable
    // values instead of dropping them.
    localizedFieldValues: Record<string, unknown>;
    // Whether the companion carries a per-locale `_status` column. Reading that
    // column on a collection without it fails the whole write, so every read of
    // it must be gated on this.
    hasStatus: boolean;
    // The companion's runtime Drizzle table, for reads of the locale's own row
    // (its `_status`) through the shared typed reader.
    companionTable: unknown;
  } | null> {
    if (!this.localization) return null;
    const companion = await this.fileManager.loadCompanionSchema(
      collectionName,
      executor
    );
    if (!companion) return null;

    // Route to the companion ONLY when it physically exists (the migration has run). Before
    // `migrate`, the dev auto-sync leaves localized columns on the MAIN table (Option B), so
    // writes must go there — return null and let the localized values flow to main as today.
    //
    // Resolved here, before the transaction opens. Everything downstream — including the read-back
    // that runs inside it — reads the answer rather than asking again.
    // Inside a caller's transaction the verdict may only be REMEMBERED, never
    // resolved: resolving issues a pooled query, which waits for the
    // connection this transaction holds, and on PostgreSQL a query against a
    // missing relation marks the whole transaction aborted — after which the
    // real write dies naming an innocent statement.
    //
    // What that costs, stated rather than assumed: the cached read answers
    // `ready` or nothing at all, so a verdict nobody warmed is indistinguishable
    // here from a collection that was never migrated, and both take the
    // pre-migration fallback below. The entry points that open their OWN
    // transaction warm it first (`warmLocalizedReadiness` in the batch
    // services), so they always have an answer. The `*InTransaction` entry
    // points cannot: the transaction is the caller's and already open, and
    // warming inside it is the very thing this avoids. A caller that opens its
    // own transaction without warming therefore gets the fallback, which is
    // right for a collection whose values still live on the main table and
    // fatal for one localized from creation — the driver rejects the write, as
    // it did before any of this. Refusing on an unknown verdict instead would
    // turn the first case into an error to buy a better message for the
    // second. Unknown is handled below as any other
    // not-ready answer is, which is the same fallback as before.
    const readiness = await this.companionReadinessOf(companion, executor);
    if (readiness !== "ready") {
      // The main table carries no language of its own, so anything written there
      // while the companion is missing is later read as the DEFAULT language —
      // that is the assumption the companion seed makes when it copies those
      // columns across. A write in another language therefore has nowhere honest
      // to go, and both ways of letting it through lose content:
      //
      //   UPDATE overwrites. The row already holds the default language on main,
      //   so a non-default write replaces it and regenerates the slug from the
      //   translation, silently and with a success response.
      //
      //   CREATE mis-files. The values land on main, and the seed then copies
      //   them into the default language's row — so Spanish text is served as
      //   English, and Spanish itself has no translation at all.
      //
      // The window is real: `db:sync` flips the registry's `localized` flag in
      // its own process while the running server has yet to create the companion.
      // Refuse either way; the default language still writes to main, which is
      // the documented pre-migration fallback.
      const requested = resolveRequestedLocale(this.localization, locale);
      if (requested !== this.localization.defaultLocale) {
        throw NextlyError.conflict({
          reason: "state",
          message: companionNotReadyMessage("collection"),
          logContext: {
            cause: "localized-write-without-companion",
            collection: collectionName,
            locale: requested,
            defaultLocale: this.localization.defaultLocale,
            companionTable: companion.companionTableName,
          },
        });
      }
      // The default language keeps the fallback, but only where it can actually
      // work. A collection localized from creation keeps its translatable columns
      // solely on the companion, and the generated main-table schema omits them, so
      // returning null here would leave those values in the main payload for a table
      // that has no columns for them. That write cannot land: it reaches the driver
      // and fails as a 500. Refusing here says the same thing in terms the caller can
      // act on, and says it before anything is attempted.
      if (readiness === "broken") {
        throw NextlyError.conflict({
          reason: "state",
          message: companionNotReadyMessage("collection"),
          logContext: {
            cause: "localized-write-without-companion",
            collection: collectionName,
            locale: requested,
            companionTable: companion.companionTableName,
          },
        });
      }
      return null;
    }

    const writeLocale = resolveRequestedLocale(this.localization, locale);
    const companionData: Record<string, unknown> = {};
    const localizedFieldValues: Record<string, unknown> = {};
    for (const field of companion.localizedFields) {
      // createEntry passes snake_case keys (already converted); updateEntry passes camelCase
      // field names. Accept either; always store under the snake_case companion column.
      const key = Object.prototype.hasOwnProperty.call(entryData, field.column)
        ? field.column
        : Object.prototype.hasOwnProperty.call(entryData, field.name)
          ? field.name
          : null;
      if (key !== null) {
        companionData[field.column] = entryData[key];
        // Keep a field-name-keyed copy for the version snapshot (read shape).
        localizedFieldValues[field.name] = entryData[key];
        delete entryData[key]; // migrated main table has no localized columns
      }
    }

    // i18n M6: per-locale draft/publish. The companion `_status` for the write's locale comes
    // from the write's status value. On create it defaults to 'draft'; on update it changes
    // ONLY when `status` is explicitly in the patch (so editing German content doesn't
    // un-publish German).
    if (companion.hasStatus) {
      const statusVal = entryData.status;
      if (typeof statusVal === "string") {
        companionData._status = statusVal;
      } else if (isCreate) {
        companionData._status = COMPANION_DEFAULT_STATUS;
      }

      // the main table's `status` gates entry-level visibility (the read
      // path filters rows on it). A per-locale status change for a NON-default
      // locale must NOT clobber it — otherwise unpublishing e.g. German would
      // unpublish the whole entry (all locales). Only the default-locale write is
      // the entry-level status action, so strip `status` from the main payload for
      // any other locale. `writeLocale` is already resolved/validated above.
      if (
        writeLocale !== this.localization.defaultLocale &&
        Object.prototype.hasOwnProperty.call(entryData, "status")
      ) {
        delete entryData.status;
      }
    }

    return {
      companionTableName: companion.companionTableName,
      writeLocale,
      companionData,
      localizedFieldValues,
      hasStatus: companion.hasStatus,
      companionTable: companion.table,
    };
  }

  /**
   * Turn post-hook update input into the column/relation shapes the write path
   * persists, mutating `data` in place into the main-row payload and returning
   * the pieces that live outside it. Relationships and uploads are reduced to
   * ids; component and many-to-many fields are pulled out of `data` (they store
   * in their own tables); JSON, date, slug, and upload columns are serialized.
   *
   * Pure and free of database access, so it runs the same off-transaction for a
   * normal write and inside the transaction when a publish promotes an
   * accumulated working draft — the draft's stored snapshot is shaped through
   * this exact path so promoted content reaches the row identically to a direct
   * write. `manyToManyFields` is passed in rather than recomputed because the
   * caller reuses the same list for the junction rewrite later in the write.
   */
  /**
   * Field-group values, removed from a write payload for their own tables.
   *
   * Mutates `data` in place, since it is the object that continues to the
   * main-row write, and returns what was taken out keyed by field name. The
   * one implementation every write path shapes with: the ordinary create and
   * update each carried a copy and the transactional writes carried none,
   * and that difference was an insert that failed on the first field group
   * and an update that dropped it without a word.
   */
  private extractComponentFieldData(
    data: Record<string, unknown>,
    fields: FieldDefinition[]
  ): Record<string, unknown> {
    const componentFieldData: Record<string, unknown> = {};
    for (const field of fields) {
      if (isFieldGroupField(field) && data[field.name] !== undefined) {
        componentFieldData[field.name] = data[field.name];
        delete data[field.name];
      }
    }
    return componentFieldData;
  }

  /**
   * The field rules of the field groups a create stores inline, inside its
   * groups and repeaters, applied in place: no field-group save reaches an
   * instance stored in its container's column, so it is judged here, as the
   * caller the entry's own fields are judged as.
   */
  private async judgeInlineFieldGroups(args: {
    data: Record<string, unknown>;
    fields: FieldDefinition[];
    params: {
      user?: UserContext;
      overrideAccess?: boolean;
      authenticatedScope?: AuthenticatedScope;
    };
    executor?: unknown;
    /** The write's own resolver, so the entry's pass and this one share it. */
    grants: () => Promise<CallerGrants>;
  }): Promise<void> {
    await applyInlineFieldGroupWriteAccess({
      data: args.data,
      fields: args.fields as unknown as FieldConfig[],
      source: this.fieldGroupDataService,
      operation: "create",
      access: { ...this.fieldGroupAccess(args.params), grants: args.grants },
      executor: args.executor,
    });
  }

  /**
   * The stored entry an update's field rules are judged against, in the
   * update's representation: the main row, with the write language's
   * translated values where the collection keeps them on a companion row. A
   * translated group or repeater is written there whole, so without its
   * stored value a denied child of it would be erased rather than kept.
   *
   * The companion is read only where a field rule can ask: the collection's
   * own, or a field group's when the collection holds one, which judges an
   * instance held inline in a translated container. A trusted write runs no
   * rule, and an update with no such rule pays nothing more.
   */
  /**
   * The stored value an update's containers are written over, for the two
   * steps that pair what it sends with what is stored: the passwords it keeps
   * (`carryStoredPasswords`) and the repeater row ids it keeps
   * (`assignRepeaterRowIds`). `row` is the row as stored, hashes included; a
   * translated container's stored value is the write language's companion
   * row, read on the write's connection. `undefined` where the fields hold
   * neither a password nor a repeater, so such an update reads nothing more.
   */
  private async storedContainersForWrite(args: {
    row: Record<string, unknown>;
    fields: FieldDefinition[];
    reach: FieldGroupReach;
    collectionName: string;
    entryId: string;
    locale?: string;
    tx?: { getDrizzle<T = unknown>(): T };
  }): Promise<Record<string, unknown> | undefined> {
    if (
      !reachesPasswordField(args.fields, args.reach) &&
      !reachesRepeaterField(args.fields, args.reach)
    ) {
      return undefined;
    }
    // Off a transaction, the companion's readiness is resolved first: its
    // read is skipped where none is known, and a translated container's
    // stored value is on the companion row alone. A transaction's caller
    // resolved it before opening one.
    if (this.localization && !args.tx) {
      await this.warmCompanionReadiness(args.collectionName);
    }
    const translated = this.localization
      ? await this.readCompanionLocalizedValues(
          args.tx ?? { getDrizzle: <T = unknown>() => this.db as T },
          args.collectionName,
          args.entryId,
          resolveRequestedLocale(this.localization, args.locale)
        )
      : {};
    return { ...args.row, ...translated };
  }

  private async storedForCarryForward(args: {
    row: Record<string, unknown>;
    fields: FieldDefinition[];
    tableName: string;
    collectionName: string;
    entryId: string;
    locale?: string;
    /** The caller's transaction, when the update runs inside one. */
    tx?: { getDrizzle<T = unknown>(): T };
    overrideAccess?: boolean;
  }): Promise<Record<string, unknown>> {
    const translated =
      this.localization &&
      args.overrideAccess !== true &&
      (hasFieldAccessRule("collection", args.collectionName, "update") ||
        (anyFieldGroupHasAccessRule("update") &&
          reachesFieldGroup(args.fields as unknown as FieldConfig[])))
        ? await this.readCompanionLocalizedValues(
            args.tx ?? { getDrizzle: <T = unknown>() => this.db as T },
            args.collectionName,
            args.entryId,
            resolveRequestedLocale(this.localization, args.locale)
          )
        : {};
    return this.readShapeEventDocument(
      { ...args.row, ...translated },
      args.fields,
      args.tableName,
      await this.passwordReach(args.fields, args.tx?.getDrizzle())
    );
  }

  /**
   * The field rules a create applies to `data`, told the id the entry is
   * stored under where the collection keeps the one the caller sent.
   */
  private applyCreateFieldRules(
    params: {
      collectionName: string;
      user?: UserContext;
      authenticatedScope?: AuthenticatedScope;
      overrideAccess?: boolean;
    },
    data: Record<string, unknown>,
    grants: () => Promise<CallerGrants>
  ): Promise<void> {
    return applyFieldWriteAccess({
      kind: "collection",
      slug: params.collectionName,
      data,
      operation: "create",
      id: suppliedCreateId("create", params.collectionName, data),
      user: params.user,
      authenticatedScope: params.authenticatedScope,
      overrideAccess: params.overrideAccess,
      grants,
    });
  }

  /**
   * The field rules an update applies beyond the entry's own fields, with
   * every denied value inside a container kept as the row holds it, in place;
   * see `keepDeniedAtStoredOnUpdate`.
   */
  private async keepDeniedFieldsAtStored(args: {
    data: Record<string, unknown>;
    /**
     * The entry's id as stored, so owner- and record-aware rules can
     * evaluate: never the one the request named.
     */
    storedId: string;
    collectionName: string;
    stored: Record<string, unknown>;
    /** The entry's table, to read the instances it holds in their own. */
    tableName: string;
    fields: FieldDefinition[];
    params: {
      user?: UserContext;
      overrideAccess?: boolean;
      authenticatedScope?: AuthenticatedScope;
      /** The language the write is made in. */
      locale?: string;
    };
    executor?: unknown;
    /**
     * The paths that hold a value kept from the stored row because a rule
     * denies it to this writer, with the value each path holds, so the
     * whole-number rule leaves them to the row unless a hook changed one —
     * a legacy stored fraction under one is the row's own content, not
     * this write's. Empty on a write that restores nothing.
     */
  }): Promise<{
    storedPaths: ReadonlySet<string>;
    storedValues: ReadonlyMap<string, unknown>;
  }> {
    // One resolver for the entry's rules and the field groups', read on the
    // write's own connection: inside a transaction, the pool's would wait on
    // the connection the transaction holds and miss its writes.
    const grants = this.callerGrants(
      args.params.user,
      args.params.authenticatedScope,
      args.executor
    );
    const access = { ...this.fieldGroupAccess(args.params), grants };
    // The parent row alone carries no field-group instance, so what an update
    // removes is read here or judged against nothing: in the write's own
    // language, and in each other one, since a removal removes them all.
    const storedIn = this.storedFieldGroupsInLanguages({
      stored: args.stored,
      tableName: args.tableName,
      fields: args.fields,
      access,
      executor: args.executor,
    });
    return keepDeniedAtStoredOnUpdate({
      data: args.data,
      stored: await storedIn.read(args.params.locale),
      storedIn,
      fields: args.fields as unknown as FieldConfig[],
      source: this.fieldGroupDataService,
      access,
      executor: args.executor,
      // The entry's own rules, in the same judgment: a group is written whole,
      // so a denied child of one keeps its stored value rather than clearing.
      ownRules: document =>
        applyFieldWriteAccess({
          kind: "collection",
          slug: args.collectionName,
          data: document,
          operation: "update",
          user: args.params.user,
          authenticatedScope: args.params.authenticatedScope,
          overrideAccess: args.params.overrideAccess,
          id: args.storedId,
          grants,
        }),
    });
  }

  /**
   * Where an entry's stored field-group instances are read in each of the
   * site's languages, on `executor`: `stored` with the instances it holds in
   * their own tables, in the language asked (the default when none is).
   */
  private storedFieldGroupsInLanguages(args: {
    stored: Record<string, unknown>;
    tableName: string;
    fields: FieldDefinition[];
    access: FieldGroupWriteAccess;
    executor?: unknown;
  }): {
    locales: string[];
    read: (locale?: string) => Promise<Record<string, unknown>>;
  } {
    return {
      locales: this.localization?.locales.map(l => l.code) ?? [],
      read: locale =>
        withStoredFieldGroups({
          stored: args.stored,
          parentTable: args.tableName,
          fields: args.fields as unknown as FieldConfig[],
          source: this.fieldGroupDataService,
          access: args.access,
          executor: args.executor,
          locale,
        }),
    };
  }

  /**
   * Write extracted field-group values on the caller's transaction.
   *
   * No locale: the transactional writes take none, so a localized component
   * writes the default locale, as the rest of that path does. Readiness is
   * read rather than resolved here, which is why a caller that opens its own
   * transaction warms it first (`warmLocalizedReadiness`).
   *
   * A failure here is a write-integrity failure: the parent row is already
   * written, and a component instance is validated by its own pass inside the
   * field-group service, so a bad instance surfaces only now. Reported as a
   * soft per-item failure, a batch under `stopOnError: false` would carry on
   * and commit a row without the component it promised; marked, the batch
   * loop aborts and the transaction rolls back, and a single transactional
   * write rethrows into its caller's transaction the same way.
   */
  private async saveComponentFieldDataInTx(
    tx: TransactionContext,
    args: {
      parentId: string;
      tableName: string;
      fields: FieldDefinition[];
      data: Record<string, unknown>;
      user?: UserContext;
      /** Who the write is made as, for each instance's own field rules. */
      access: FieldGroupWriteAccess;
      /**
       * The host write's context, so a field inside an instance that reads the
       * library (a blocks field's composition) judges it on this write.
       */
      write: EntryWriteContext;
      /**
       * Whether `data` is the row's own, carried by an assembled document the
       * write promotes or publishes: the instances' own pass then leaves a
       * legacy stored fraction alone, as the gate judged this document.
       */
      assembledFromStorage?: boolean;
    }
  ): Promise<void> {
    if (!this.fieldGroupDataService || Object.keys(args.data).length === 0) {
      return;
    }
    try {
      await this.fieldGroupDataService.saveComponentDataInTransaction(tx, {
        parentId: args.parentId,
        parentTable: args.tableName,
        fields: args.fields as unknown as FieldConfig[],
        data: args.data,
        locale: undefined,
        req: args.user ? { user: args.user } : {},
        // Who the write is made as, for each instance's own field rules.
        access: args.access,
        write: args.write,
        assembledFromStorage: args.assembledFromStorage,
      });
    } catch (error: unknown) {
      throw markWriteIntegrityFailure(error);
    }
  }

  private shapeWriteParts(
    data: Record<string, unknown>,
    fields: FieldDefinition[],
    manyToManyFields: FieldDefinition[],
    collection: unknown,
    /**
     * What repeater rows are given ids against: the stored value the write
     * replaces (`undefined` for none, so every row without an id gets a fresh
     * one), and where the walk follows field groups held inline.
     */
    rowIds: {
      stored: Record<string, unknown> | undefined;
      reach: FieldGroupReach;
    }
  ): {
    manyToManyData: Record<string, string[]>;
    componentFieldData: Record<string, unknown>;
  } {
    // Normalize relationship field values (extract IDs from objects with display properties)
    // This must happen before many-to-many extraction and JSON serialization
    // Walks containers too: a reference left populated inside a group or
    // repeater is serialized to JSON as the row and never read back as a
    // reference.
    normalizeRelationshipFields(data, fields as unknown as FieldConfig[]);

    // Normalize upload field values (extract IDs from populated media objects)
    normalizeUploadFields(data, fields);

    // Every repeater row gets its saved id: after the field rules and the
    // password pass have decided the value, and after references are reduced
    // to ids so an unchanged row compares equal to the stored one; before the
    // field groups placed on the entry are taken off to their own tables,
    // whose write gives their rows ids.
    assignRepeaterRowIds(data, rowIds.stored, fields, rowIds.reach);

    const manyToManyData: Record<string, string[]> = {};

    // Extract many-to-many data from data (after hooks)
    manyToManyFields.forEach(field => {
      if (data[field.name] !== undefined) {
        manyToManyData[field.name] = Array.isArray(data[field.name])
          ? (data[field.name] as string[])
          : data[field.name] === null
            ? []
            : [data[field.name] as string];
        delete data[field.name]; // Remove from main update
      }
    });

    // Field-group values go to their own comp_{slug} tables, not this row.
    const componentFieldData = this.extractComponentFieldData(data, fields);

    // Normalize relationship data inside repeater/group fields before serialization.
    // The admin panel may send full relationship objects ({id, title, slug, ...})
    // inside repeater rows — strip these down to just IDs to prevent bloated JSON.
    fields.forEach(field => {
      if (
        (field.type === "repeater" || field.type === "group") &&
        data[field.name] != null &&
        typeof data[field.name] === "object"
      ) {
        const nestedFields = field.fields || [];
        if (
          nestedFields.some(
            f =>
              isRelationshipField(f.type) ||
              f.type === "repeater" ||
              f.type === "group"
          )
        ) {
          if (field.type === "repeater" && Array.isArray(data[field.name])) {
            data[field.name] = (data[field.name] as unknown[]).map(
              (row: unknown) =>
                row && typeof row === "object" && !Array.isArray(row)
                  ? normalizeNestedRelationships(
                      row as Record<string, unknown>,
                      nestedFields
                    )
                  : row
            );
          } else if (
            field.type === "group" &&
            !Array.isArray(data[field.name])
          ) {
            data[field.name] = normalizeNestedRelationships(
              data[field.name] as Record<string, unknown>,
              nestedFields
            );
          }
        }
      }
    });

    this.serializeJsonFieldValues(data, fields);

    this.serializeHasManyRelationships(data, fields);

    // Convert date-field strings into `Date` objects so Drizzle can bind
    // them to `timestamp` columns. See `coerceDateFieldsToDate` for the
    // failure mode this guards against.
    coerceDateFieldsToDate(data, fields);

    // Sanitize slug if provided in update
    // - Dynamic collections (UI-created) always have a slug column
    // - Plugin collections (isPlugin: true) only have slug if explicitly defined
    const isPluginCollection =
      (
        (collection as Record<string, unknown>).admin as
          | Record<string, unknown>
          | undefined
      )?.isPlugin === true;
    const hasSlugField = fields.some(f => f.name === "slug");
    const shouldHandleSlug = isPluginCollection ? hasSlugField : true;

    if (shouldHandleSlug && data.slug !== undefined) {
      if (typeof data.slug === "string" && data.slug.trim()) {
        // The collection's own slug rule: one segment, or a path where it
        // stores paths, refused here when it cannot be one.
        const name = (collection as { slug?: unknown }).slug;
        data.slug =
          typeof name === "string"
            ? this.slugAsStored(name, data.slug, true)
            : generateSlug(data.slug);
      } else {
        // If slug is empty/null, remove it from update to keep existing value
        delete data.slug;
      }
    }

    // Final safety pass: ensure upload field values are IDs, not populated objects.
    fields.forEach(field => {
      if (field.type === "upload" && data[field.name] != null) {
        const val = data[field.name];
        if (typeof val === "object" && val !== null && !Array.isArray(val)) {
          data[field.name] =
            "id" in val &&
            typeof (val as Record<string, unknown>).id === "string"
              ? (val as Record<string, unknown>).id
              : null;
        } else if (Array.isArray(val)) {
          data[field.name] = val.map((item: unknown) =>
            typeof item === "string"
              ? item
              : typeof item === "object" && item !== null && "id" in item
                ? (item as Record<string, unknown>).id
                : item
          );
        }
      }
    });

    return { manyToManyData, componentFieldData };
  }

  /**
   * Return a shallow copy of `row` with JSON-backed field values (richtext,
   * blocks, array, group, json) parsed from their stored string form, matching
   * the read shape so a version snapshot equals a normal read. Non-JSON and
   * already-parsed values pass through; a parse failure keeps the raw string.
   * Never mutates the input.
   */
  /**
   * A localized document as it stands live, in the shape a version snapshot
   * holds, and the fields every language shares in it. The main row's shared
   * columns, its shared components, and its many-to-many relations: a publish
   * writes each from the pending change. A translated field, and a component
   * whose values are kept per language, belong to their language.
   *
   * @param main The live main row, shaped as a snapshot's is.
   */
  private async liveSharedDocument(
    tx: TransactionContext,
    args: {
      collectionName: string;
      entryId: string;
      tableName: string;
      fields: FieldDefinition[];
      main: Record<string, unknown>;
      locale: string | null;
    }
  ): Promise<SharedComparison & { live: Record<string, unknown> }> {
    const { collectionName, entryId, tableName, fields, main } = args;
    const executor = tx.getDrizzle();
    const junctions = fields.filter(
      f => f.type === "relationship" && f.options?.relationType === "manyToMany"
    );
    const relations = await this.buildFullSnapshotRelations(
      tx,
      entryId,
      collectionName,
      tableName,
      fields,
      junctions,
      args.locale ?? undefined
    );
    const live = assembleDocument(
      await this.snapshotPartsFor({ parentRow: main, ...relations }, fields, tx)
    );
    const companion = await this.fileManager.loadCompanionSchema(
      collectionName,
      executor
    );
    const schema = fields as unknown as FieldConfig[];
    const service = this.fieldGroupDataService;
    return {
      live,
      ...(await sharedComparison({
        fields: schema,
        translated: new Set(
          (companion?.localizedFields ?? []).map(f => f.name)
        ),
        document: live,
        componentFields: service
          ? await resolveComponentFieldMap(schema, slug =>
              service.getComponentFields(slug, executor)
            )
          : new Map<string, FieldConfig[]>(),
        isComponentLocalized: slug =>
          service
            ? service.isComponentLocalized(slug, executor)
            : Promise.resolve(false),
        unordered: junctions.map(f => f.name),
      })),
    };
  }

  private deserializeJsonFieldsForSnapshot(
    row: Record<string, unknown>,
    fields: FieldDefinition[]
  ): Record<string, unknown> {
    const out = { ...row };
    for (const field of fields) {
      const value = out[field.name];
      if (
        isJsonFieldType(field.type, field) &&
        typeof value === "string" &&
        value
      ) {
        try {
          out[field.name] = JSON.parse(value);
        } catch {
          // Not valid JSON — keep the raw string.
        }
      }
    }
    return out;
  }

  /**
   * Refuse a publish unless every language it puts live from storage is valid
   * as it goes live.
   *
   * One language for an ordinary publish: the write locale, unless it was live
   * already, since a language already published was judged as published and
   * re-sending the status changes nothing that goes live. Every stored
   * translation not yet live for a publish of every language, each judged as
   * its own publish would judge it: its values on the row, the default
   * language's `required` rules where it is the default. A language whose
   * pending draft the promotion has just judged is not judged twice.
   */
  private async assertLanguagesGoLiveValid(
    args: LanguagesGoLiveArgs
  ): Promise<void> {
    const issues = await this.languagesGoLiveIssues(args);
    if (issues.length > 0) {
      throw NextlyError.validation({ errors: issues });
    }
  }

  /**
   * Whether a promotion of this collection's entries can ask a field rule, and
   * so needs the caller's grants: the collection's own update rules, or any
   * field group's create or update rules, since a promotion judges every
   * instance its document holds by its field group's own rules. The one
   * answer both a publish and a release's readiness give before resolving
   * grants, so a release is judged by the rules its publish runs.
   */
  private promotionRulesCanAsk(collectionName: string): boolean {
    return (
      hasFieldAccessRule("collection", collectionName, "update") ||
      anyFieldGroupHasAccessRule("update") ||
      anyFieldGroupHasAccessRule("create")
    );
  }

  /**
   * What the release's write of each of these entries would be refused with
   * by validation and field rules, keyed by entry id, judged now and without
   * writing: the release's own write — the status `action` names, every
   * language at once, as `user`. Its status through the field rules the
   * write applies to it ({@link lifecyclePatchIssues}); then what goes live,
   * or the working draft the write folds in, through {@link goingLiveIssues}
   * and the promotion's field rules, the judgements the write itself makes.
   *
   * Batched: the collection, its schema, the rows and the working drafts are
   * read once for all the entries, and each entry is then judged on its own.
   * The write's hooks are not run, since they may reach outside this process;
   * a hook that rewrites the document is judged at the write itself. An entry
   * that is not there, or a collection with no draft/published lifecycle,
   * answers with nothing to report.
   */
  async releasePublishIssues(params: {
    collectionName: string;
    entryIds: readonly string[];
    user: UserContext;
    action: "publish" | "unpublish";
  }): Promise<Map<string, ValidationIssue[]>> {
    const issues = new Map<string, ValidationIssue[]>(
      params.entryIds.map(id => [id, []])
    );
    if (params.entryIds.length === 0) return issues;
    const collection = await this.releaseCollection(params.collectionName);
    if (!this.keepsStatus(collection)) {
      return issues;
    }
    // A translation table without its per-language status cannot be read for
    // what goes live, and the write refuses on it first: that refusal is the
    // diagnosis (`releaseCompanionLacksStatus`), so there is nothing to judge.
    if (await this.companionLacksStatus(params.collectionName)) return issues;
    const shared = await this.releaseWriteContext(
      collection,
      params.collectionName,
      params.action === "publish" ? "published" : "draft"
    );
    const rows = await this.storedEntries(
      params.collectionName,
      params.entryIds
    );
    const drafts = await this.releaseWorkingDrafts(
      shared,
      params.collectionName,
      [...rows.keys()]
    );
    // The author's grants, once for the batch, where a field rule could ask:
    // as the write resolves them, and only where it would.
    const grants = this.promotionRulesCanAsk(params.collectionName)
      ? await this.resolvedGrants(params.user, undefined)
      : null;
    const reads = await this.goingLiveReadsOf(params.collectionName, [
      ...rows.keys(),
    ]);
    // The documents a promotion's rules compare against, read for the whole
    // batch.
    const live =
      grants === null || drafts.size === 0
        ? new Map<string, Record<string, unknown>>()
        : await this.storedDocumentsOf({
            collectionName: params.collectionName,
            rows: new Map([...rows].filter(([id]) => drafts.has(id))),
            tableName: collectionTableName(collection, params.collectionName),
            fields: shared.fields,
            manyToManyFields: shared.manyToManyFields,
            locale: shared.localizedUpdate?.writeLocale,
            reads,
          });
    for (const [entryId, existingEntry] of rows) {
      // The write refuses here first: a status the rules remove leaves it
      // nothing to move.
      const denied =
        grants === null
          ? []
          : await this.lifecyclePatchIssues(shared, {
              collectionName: params.collectionName,
              entryId,
              user: params.user,
              grants,
            });
      if (denied.length > 0) {
        issues.set(entryId, denied);
        continue;
      }
      const found = await this.goingLiveIssues({
        ...shared,
        collectionName: params.collectionName,
        entryId,
        user: params.user,
        // Told to the author the release is judged for.
        reader: { user: params.user },
        existingEntry,
        // Served from the batch's one read, by the entry it was asked for.
        drafts: {
          findWorkingDraft: ref => Promise.resolve(drafts.get(ref.entryId)),
        },
        reads,
      });
      const draft = drafts.get(entryId);
      const stored = live.get(entryId);
      if (
        grants !== null &&
        draft !== undefined &&
        stored !== undefined &&
        shared.promoteRestoreCtx !== null
      ) {
        found.push(
          ...(await this.promotionAccessIssues(shared, {
            collectionName: params.collectionName,
            entryId,
            snapshot: draft.snapshot,
            restoreCtx: shared.promoteRestoreCtx,
            live: stored,
            user: params.user,
            grants,
          }))
        );
      }
      issues.set(entryId, found);
    }
    return issues;
  }

  /**
   * The working drafts a release's write would fold in, keyed by entry id:
   * none where the collection keeps no draft apart from its live row.
   * Shared by every release read of what goes live, so they all mean the same
   * draft.
   */
  private async releaseWorkingDrafts(
    shared: ReleaseWriteContext,
    collectionName: string,
    entryIds: readonly string[]
  ): Promise<Map<string, VersionRow>> {
    if (shared.promoteRestoreCtx === null) return new Map();
    return new VersionsRepository(this.adapter).findWorkingDraftsOf(
      { scopeKind: "collection", scopeSlug: collectionName },
      entryIds,
      shared.draftLocaleKey
    );
  }

  /**
   * Each of these entries as a release would put it live, keyed by id: its
   * working draft where the write would fold one in, otherwise the document as
   * stored. Read as storage holds it, with no read hooks and no reader's
   * access, so a hook that reshapes a value for readers does not hide what is
   * stored. Batched: the rows, their drafts, components and many-to-many ids
   * are read once for all the entries. An entry that is not there, or a
   * collection with no draft/published lifecycle, is absent from the answer;
   * so is a collection whose translations lack their status, which cannot be
   * read (`releaseCompanionLacksStatus` reports it).
   */
  async releaseGoingLiveDocuments(params: {
    collectionName: string;
    entryIds: readonly string[];
  }): Promise<Map<string, Record<string, unknown>>> {
    const documents = new Map<string, Record<string, unknown>>();
    if (params.entryIds.length === 0) return documents;
    const collection = await this.releaseCollection(params.collectionName);
    if (!this.keepsStatus(collection)) {
      return documents;
    }
    if (await this.companionLacksStatus(params.collectionName)) {
      return documents;
    }
    const shared = await this.releaseWriteContext(
      collection,
      params.collectionName,
      "published"
    );
    const rows = await this.storedEntries(
      params.collectionName,
      params.entryIds
    );
    const drafts = await this.releaseWorkingDrafts(
      shared,
      params.collectionName,
      [...rows.keys()]
    );
    const stored = await this.storedDocumentsOf({
      collectionName: params.collectionName,
      rows: new Map([...rows].filter(([id]) => !drafts.has(id))),
      tableName: collectionTableName(collection, params.collectionName),
      fields: shared.fields,
      manyToManyFields: shared.manyToManyFields,
      locale: shared.localizedUpdate?.writeLocale,
      reads: await this.goingLiveReadsOf(params.collectionName, [
        ...rows.keys(),
      ]),
    });
    for (const id of rows.keys()) {
      const snapshot = drafts.get(id)?.snapshot;
      const document =
        typeof snapshot === "object" && snapshot !== null
          ? (snapshot as Record<string, unknown>)
          : stored.get(id);
      if (document !== undefined) documents.set(id, document);
    }
    return documents;
  }

  /**
   * What a release's write judges with that is the same for every entry of
   * the collection: its fields, the payload it writes, and how a working
   * draft would be promoted and keyed.
   */
  private async releaseWriteContext(
    collection: unknown,
    collectionName: string,
    status: "published" | "draft"
  ): Promise<ReleaseWriteContext> {
    const fields = collectionFields(collection);
    const finalData: Record<string, unknown> = { status };
    const manyToManyFields = fields.filter(
      f => f.type === "relationship" && f.options?.relationType === "manyToMany"
    );
    // A status alone holds no repeater row, so nothing is paired.
    const { manyToManyData, componentFieldData } = this.shapeWriteParts(
      finalData,
      fields,
      manyToManyFields,
      collection,
      { stored: undefined, reach: NO_FIELD_GROUPS }
    );
    const versionsConfig = (collection as Record<string, unknown>).versions as
      | ResolvedVersionsConfig
      | null
      | undefined;
    const documentLocalized =
      (collection as { localized?: boolean }).localized === true;
    // As the write resolves them: the components only once the cheap
    // disqualifiers pass, and the split from the shared predicate.
    const splitComponentSchemas =
      versionsConfig?.drafts?.enabled === true && !hasPasswordField(fields)
        ? await resolveComponentSchemas(fields as unknown as FieldConfig[])
        : null;
    const splitEnabled = isDraftSplitEligible({
      collectionHasStatus: true,
      draftsVersioningEnabled: versionsConfig?.drafts?.enabled === true,
      fields: fields as unknown as FieldConfig[],
      componentSchemas: splitComponentSchemas,
    });
    return {
      // Every language: the wildcard resolves to the unlocalized write.
      locale: undefined,
      tableName: collectionTableName(collection, collectionName),
      fields,
      finalData,
      componentFieldData,
      manyToManyData,
      manyToManyFields,
      splitComponentSchemas,
      promoteRestoreCtx: splitEnabled
        ? promoteRestoreContext({
            collection,
            fields,
            collectionHasStatus: true,
            splitComponentSchemas,
            documentLocalized,
          })
        : null,
      draftLocaleKey: this.wildcardDraftLocale(collection),
      collectionHasStatus: true,
      transitionNextStatus: status,
      sweepAllLocales: true,
      localizedUpdate: await this.splitLocalizedWriteData(
        collectionName,
        finalData,
        undefined,
        false
      ),
    };
  }

  /**
   * The slot a document-wide write's own working draft is kept under: the
   * wildcard carries no request locale by the time it is written.
   */
  private wildcardDraftLocale(collection: unknown): string | null {
    return workingDraftLocale({
      documentLocalized:
        (collection as { localized?: boolean }).localized === true,
      requestLocale: null,
      defaultLocale: this.localization?.defaultLocale ?? null,
    });
  }

  /**
   * For each of these entries, the other languages whose unreleased work a
   * release's document-wide write would be refused over, keyed by entry id,
   * read now from the pool in one query: the same rule the write asks under
   * its row lock.
   */
  async releaseHeldDraftLocales(params: {
    collectionName: string;
    entryIds: readonly string[];
  }): Promise<Map<string, string[]>> {
    const held = new Map<string, string[]>(params.entryIds.map(id => [id, []]));
    if (params.entryIds.length === 0) return held;
    const collection = await this.releaseCollection(params.collectionName);
    if (collection === null || !this.keepsWorkingDrafts(collection)) {
      return held;
    }
    const drafted = await new VersionsRepository(
      this.adapter
    ).findPendingChangeLocales("collection", params.collectionName, [
      ...new Set(params.entryIds),
    ]);
    for (const entryId of params.entryIds) {
      held.set(
        entryId,
        this.heldLanguages(collection, drafted.get(entryId) ?? [])
      );
    }
    return held;
  }

  /**
   * Whether a release's collection has the draft/published status turned on.
   * The collection arrives as an `object`, so `in` narrows it to the field
   * rather than a cast asserting a shape.
   */
  private keepsStatus(collection: object | null): boolean {
    return (
      collection !== null &&
      "status" in collection &&
      collection.status === true
    );
  }

  /**
   * The collection a release's member names, or `null` once it has been
   * deleted. A deleted collection holds no drafts and no document to publish:
   * the member is a document that is gone, which the release's existence
   * check reports, so the readiness answer must not fail over it.
   */
  private async releaseCollection(
    collectionName: string
  ): Promise<object | null> {
    try {
      return (await this.collectionService.getCollection(
        collectionName
      )) as object;
    } catch (error) {
      if (NextlyError.isCode(error, "NOT_FOUND")) return null;
      throw error;
    }
  }

  /** Whether the collection keeps working drafts at all. */
  private keepsWorkingDrafts(collection: unknown): boolean {
    return (
      (collection as { versions?: { drafts?: { enabled?: boolean } } }).versions
        ?.drafts?.enabled === true
    );
  }

  /**
   * The configured languages, other than a document-wide write's own, among
   * those holding a working draft, through `languagesHoldingWorkingDrafts`.
   */
  private heldLanguages(
    collection: unknown,
    draftLocales: Iterable<string | null>
  ): string[] {
    return languagesHoldingWorkingDrafts({
      draftLocales,
      writeDraftLocale: this.wildcardDraftLocale(collection),
      configuredLocales: this.localization?.locales.map(l => l.code) ?? [],
    });
  }

  /**
   * What a write moving an entry's lifecycle would be refused with by
   * validation of what it puts live, or nothing.
   *
   * Two judgements, made before the write's transaction opens, the first
   * deciding whether the second is needed:
   *
   *   - A promoted working draft, against the CURRENT schema. The caller's
   *     own validation ran on its payload only, which for a publish is just
   *     `{ status }`; promotion folds the whole accumulated draft into the live
   *     row, so a draft field the schema has since made stricter (a tightened
   *     `minLength`/`max`/`pattern`/`options`, or an emptied value that is now
   *     required) would otherwise reach the live row unchecked. The draft is
   *     read advisory rather than under the promotion's row lock — validators
   *     are pure of the write connection, but a lock taken here would be a
   *     second one against a small pool — and judged in the SAME merged shape
   *     the in-transaction fold persists (`buildRestorePayload` output with the
   *     caller's fields on top). The fold stays authoritative for the write;
   *     this only gates it.
   *   - A publish that promotes no draft puts the STORED row live, with the
   *     caller's fields on top: a first publication, a republish after an
   *     unpublish, or every language at once. Each language is judged as it
   *     goes live, as the promotion judges its draft.
   *
   * One implementation for the write, which throws on what this returns, and
   * for a release's readiness, which reports it.
   */
  private async goingLiveIssues(
    args: GoingLiveArgs
  ): Promise<ValidationIssue[]> {
    let promotesDraft = false;
    // The document the promotion puts live, whose component and relationship
    // values every language then goes live with.
    let promoted: Record<string, unknown> | undefined;
    if (args.promoteRestoreCtx !== null) {
      const advisoryDraft = await args.drafts.findWorkingDraft(
        {
          scopeKind: "collection",
          scopeSlug: args.collectionName,
          entryId: args.entryId,
        },
        args.draftLocaleKey
      );
      if (advisoryDraft) {
        promotesDraft = true;
        promoted = this.promotedDocumentOf(
          args,
          buildRestorePayload(
            advisoryDraft.snapshot,
            args.fields as unknown as FieldConfig[],
            args.promoteRestoreCtx
          ).payload
        );
        // Completed for this judgement alone, in the write's language, ahead
        // of the write's lock as the draft itself is read; the write
        // completes and judges it again once it holds the lock. `promoted`
        // stays as the change left it: the languages judged below each read
        // the relations it does not name as stored in that language, which a
        // value completed in this one would otherwise stand in for.
        const issues = await this.promotedDraftIssues(
          args,
          await this.withEveryRelationKey(args, promoted, undefined)
        );
        if (issues.length > 0) return issues;
      }
    }
    if (
      !args.collectionHasStatus ||
      args.transitionNextStatus !== "published" ||
      (promotesDraft && !args.sweepAllLocales)
    ) {
      return [];
    }
    return this.languagesGoLiveIssues({
      collectionName: args.collectionName,
      entryId: args.entryId,
      row: args.existingEntry,
      patch: args.finalData,
      writeLocale: args.localizedUpdate?.writeLocale,
      // The locale split moved the caller's translatable values out of
      // `finalData`; they are part of what goes live in the write locale.
      writeLocaleValues: args.localizedUpdate?.localizedFieldValues ?? {},
      perLocaleStatus: args.localizedUpdate?.hasStatus === true,
      everyLanguage: args.sweepAllLocales,
      // The promotion above judged this language's draft as it goes live.
      writeLocalePromoted: promotesDraft,
      fields: args.fields,
      user: args.user,
      reader: args.reader,
      reads: args.reads,
      relations: {
        tableName: args.tableName,
        manyToManyFields: args.manyToManyFields,
        // The values the write leaves: a promoted change's, which carry the
        // caller's own, or else the caller's.
        componentFieldData:
          promoted === undefined
            ? args.componentFieldData
            : draftComponentValues(
                promoted,
                args.fields as unknown as FieldConfig[]
              ),
        manyToManyData:
          promoted === undefined
            ? args.manyToManyData
            : manyToManyValuesIn(promoted, args.manyToManyFields),
        componentSchemas: args.splitComponentSchemas,
        batch: args.relationsBatch ?? args.reads?.relations,
      },
    });
  }

  /**
   * A promoted document with a key for every component and many-to-many
   * field the collection has now. A pending change saved before such a field
   * was added does not name it, and a promotion leaves what is stored for a
   * field its change does not name; judged in update mode, an absent key is
   * not judged, so a field since made required would go live unchecked. Each
   * absent one takes its stored value, `null` or `[]` where nothing is
   * stored, read only when one is absent: on `tx` under the row lock, else on
   * the pool, in the batch's one read where the document publishes with
   * others. Returns `promoted` itself when no key is absent.
   */
  private async withEveryRelationKey(
    args: Pick<
      GoingLiveArgs,
      | "collectionName"
      | "entryId"
      | "tableName"
      | "locale"
      | "fields"
      | "manyToManyFields"
      | "relationsBatch"
      | "reads"
    >,
    promoted: Record<string, unknown>,
    tx: TransactionContext | undefined
  ): Promise<Record<string, unknown>> {
    const relationFields = [
      ...args.fields.filter(field =>
        isFieldGroupField(field as unknown as FieldConfig)
      ),
      ...args.manyToManyFields,
    ];
    if (relationFields.every(field => promoted[field.name] !== undefined)) {
      return promoted;
    }
    const stored = await this.storedRelationsOf({
      entryId: args.entryId,
      collectionName: args.collectionName,
      fields: args.fields,
      language: args.locale,
      tx,
      relations: {
        tableName: args.tableName,
        manyToManyFields: args.manyToManyFields,
        batch: args.relationsBatch ?? args.reads?.relations,
      },
    });
    // The stored read gives every field a key, its empty value where nothing
    // is stored; `null` stands for one only should a read ever omit it, and
    // reads as missing as the empty value does.
    const complete = { ...promoted };
    for (const field of relationFields) {
      if (complete[field.name] !== undefined) continue;
      complete[field.name] =
        stored.components[field.name] ?? stored.manyToMany[field.name] ?? null;
    }
    return complete;
  }

  /**
   * Refuse, under the row lock, a promotion whose document no longer passes
   * once the relations its pending change does not name are read on `tx`. A
   * promotion leaves what is stored for such a field, and the judgement
   * before the lock read it on the pool, so another writer may have removed
   * a required one since. Nothing is read where the change names them all.
   * The refusal is kept in `refused` and thrown, rolling the write back: the
   * adapter wraps what leaves the transaction, so the caller answers from
   * `refused`.
   */
  private async refuseLockedPromotionRelations(
    tx: TransactionContext,
    args: Pick<
      GoingLiveArgs,
      | "collectionName"
      | "entryId"
      | "tableName"
      | "locale"
      | "fields"
      | "manyToManyFields"
      | "user"
      | "reader"
    >,
    promoted: Record<string, unknown>,
    refused: { refusal?: NextlyError }
  ): Promise<void> {
    const completed = await this.withEveryRelationKey(args, promoted, tx);
    if (completed === promoted) return;
    const issues = await this.promotedDocumentIssues(
      { ...args, tx },
      completed
    );
    if (issues.length === 0) return;
    refused.refusal = NextlyError.validation({ errors: issues });
    throw refused.refusal;
  }

  /**
   * The full document a promotion persists: the draft's input with the
   * caller's payload over it. `shapeWriteParts` has already pulled the
   * caller's component and m2m fields out of `finalData`; folding them back in
   * covers component and m2m fields, not only columns. In the LOGICAL shape
   * the rules read: `finalData` is column-encoded, so a group the caller sent
   * arrives as text, and judged as text it is refused as "must be an object".
   * Parsed by the same function that builds the live row, so the two sides
   * are one representation. With an empty draft input, the caller's own
   * contribution alone.
   */
  private promotedDocumentOf(
    args: Pick<
      GoingLiveArgs,
      | "finalData"
      | "componentFieldData"
      | "manyToManyData"
      | "fields"
      | "manyToManyFields"
      | "splitComponentSchemas"
    >,
    draftInput: Record<string, unknown>
  ): Record<string, unknown> {
    return this.deserializeJsonFieldsForSnapshot(
      this.assemblePromotedDocument(
        draftInput,
        args.finalData,
        args.componentFieldData,
        args.manyToManyData,
        args.fields,
        args.manyToManyFields,
        args.splitComponentSchemas
      ),
      args.fields
    );
  }

  /**
   * What the field rules refuse a release's write of this entry's status
   * with, judged as the write judges its payload: through
   * `applyFieldWriteAccess`, as the release's author. A status the rules
   * remove leaves the every-language write nothing to move, which it
   * refuses; reported as the field the author may not write (code
   * `FORBIDDEN`), or nothing.
   */
  private async lifecyclePatchIssues(
    shared: ReleaseWriteContext,
    args: {
      collectionName: string;
      entryId: string;
      user: UserContext;
      grants: () => Promise<CallerGrants>;
    }
  ): Promise<ValidationIssue[]> {
    const patch = { ...shared.finalData };
    await applyFieldWriteAccess({
      kind: "collection",
      slug: args.collectionName,
      data: patch,
      operation: "update",
      user: args.user,
      overrideAccess: false,
      grants: args.grants,
      id: args.entryId,
    });
    return Object.keys(shared.finalData)
      .filter(field => !(field in patch))
      .map(path => ({
        path,
        code: "FORBIDDEN",
        message:
          "The author may not write this field, which the release's write sets.",
      }));
  }

  /**
   * What the field rules refuse a release's promotion of this entry's working
   * draft with, judged as the release's author would be judged at the write:
   * the promotion against the entry as stored, through
   * {@link judgePromotionAccess}. Its refusal's own issues (code `FORBIDDEN`),
   * or none.
   */
  private async promotionAccessIssues(
    shared: ReleaseWriteContext,
    args: {
      collectionName: string;
      /** The entry's id as stored, read from its row. */
      entryId: string;
      snapshot: unknown;
      restoreCtx: RestoreSchemaContext;
      /** The entry as stored, which the rules compare the promotion with. */
      live: Record<string, unknown>;
      user: UserContext;
      /** The scope an API key arrived with, judged on its own grants. */
      authenticatedScope?: AuthenticatedScope;
      grants: () => Promise<CallerGrants>;
    }
  ): Promise<ValidationIssue[]> {
    const draftInput = buildRestorePayload(
      args.snapshot,
      shared.fields as unknown as FieldConfig[],
      args.restoreCtx
    ).payload;
    return refusalIssues(async () => {
      await this.judgePromotionAccess({
        before: this.promotedDocumentOf(shared, draftInput),
        live: args.live,
        callerSupplied: this.promotedDocumentOf(shared, {}),
        // The draft with nothing of the write's laid over it, judged as the
        // publish judges it, so the release is refused for what its run
        // would refuse.
        pending: this.promotedDocumentOf(
          {
            ...shared,
            finalData: {},
            componentFieldData: {},
            manyToManyData: {},
          },
          draftInput
        ),
        collectionName: args.collectionName,
        storedId: args.entryId,
        user: args.user,
        authenticatedScope: args.authenticatedScope,
        overrideAccess: false,
        grants: args.grants,
        componentSchemas: shared.splitComponentSchemas,
        fields: shared.fields,
        locale: shared.draftLocaleKey ?? shared.locale ?? null,
      });
      return [];
    });
  }

  /**
   * Whether the field rules refuse `user` the promotion of this entry's
   * working draft, judged as its publish judges them: the snapshot against the
   * entry as stored, in the language the draft is kept for, through
   * {@link promotionAccessIssues}.
   *
   * A read asks it before showing a pending change to a caller who may publish
   * the entry and not update it, so the change is shown only where that caller
   * could put it live: a value a field rule keeps them from writing is not
   * theirs to see before it is published. `true` where the entry or its
   * promotion cannot be judged.
   */
  async workingDraftPromotionRefused(params: {
    collectionName: string;
    entryId: string;
    /** The working draft the read would show, as stored. */
    snapshot: unknown;
    /** The slot it is kept under, as the read keyed it. */
    draftLocale: string | null;
    /** The language read, whose translations the stored entry is judged with. */
    locale: string | undefined;
    user: UserContext;
    authenticatedScope?: AuthenticatedScope;
  }): Promise<boolean> {
    // Judged in the status write's language, whatever the read that asks it
    // involves: a field rule told every language could refuse a promotion
    // the write allows, or allow one it refuses.
    return withRuleLanguage(
      writeLanguagesFor(this.localization, params.locale),
      () => this.judgeWorkingDraftPromotion(params)
    );
  }

  /** {@link workingDraftPromotionRefused}, in the language it is asked in. */
  private async judgeWorkingDraftPromotion(
    params: Parameters<
      CollectionMutationService["workingDraftPromotionRefused"]
    >[0]
  ): Promise<boolean> {
    // No rule a promotion asks could refuse it.
    if (!this.promotionRulesCanAsk(params.collectionName)) return false;
    const collection = await this.releaseCollection(params.collectionName);
    if (collection === null) return true;
    const base = await this.releaseWriteContext(
      collection,
      params.collectionName,
      "published"
    );
    if (base.promoteRestoreCtx === null) return true;
    // The status write of the language read, not the release's write of every
    // language: its draft, and the stored values it is compared with.
    const localizedUpdate = await this.splitLocalizedWriteData(
      params.collectionName,
      base.finalData,
      params.locale,
      false
    );
    const shared: ReleaseWriteContext = {
      ...base,
      locale: params.locale,
      draftLocaleKey: params.draftLocale,
      localizedUpdate,
    };
    const row = await this.storedEntry(params.collectionName, params.entryId);
    if (row === undefined) return true;
    const entryId = String(row.id);
    const live = (
      await this.storedDocumentsOf({
        collectionName: params.collectionName,
        rows: new Map([[entryId, row]]),
        tableName: collectionTableName(collection, params.collectionName),
        fields: shared.fields,
        manyToManyFields: shared.manyToManyFields,
        locale: localizedUpdate?.writeLocale,
        reads: await this.goingLiveReadsOf(params.collectionName, [entryId]),
      })
    ).get(entryId);
    if (live === undefined) return true;
    const refused = await this.promotionAccessIssues(shared, {
      collectionName: params.collectionName,
      entryId,
      snapshot: params.snapshot,
      restoreCtx: base.promoteRestoreCtx,
      live,
      user: params.user,
      authenticatedScope: params.authenticatedScope,
      grants: await resolvedCallerGrants(
        params.user,
        params.authenticatedScope
      ),
    });
    return refused.length > 0;
  }

  /** The violations of the document a promoted working draft would write. */
  private async promotedDraftIssues(
    args: GoingLiveArgs,
    merged: Record<string, unknown>
  ): Promise<ValidationIssue[]> {
    return this.promotedDocumentIssues(
      {
        ...args,
        companion: args.reads?.companion,
        batch: args.relationsBatch ?? args.reads?.relations,
        tx: undefined,
      },
      merged
    );
  }

  /**
   * The violations of a promoted document, judged on `tx` where the judgement
   * runs under the row lock, else on the pool.
   *
   * Judged as ASSEMBLED, with nothing removed. A field this publisher may not
   * write is not a schema violation: the gate that judges permission refuses a
   * promotion that changes one, under the row lock where it can compare
   * against what is live. Filtering here would validate a document that is
   * never written either way, and report a denied required field as missing
   * rather than as forbidden.
   */
  private async promotedDocumentIssues(
    args: Pick<
      GoingLiveArgs,
      "collectionName" | "entryId" | "locale" | "fields" | "user" | "reader"
    > & {
      /** The companion already resolved for a batch; read when absent. */
      companion?: CompanionSchema | null;
      /** The batch the document goes live with, which reads definitions once. */
      batch?: GoingLiveRelationsBatch;
      tx: TransactionContext | undefined;
    },
    merged: Record<string, unknown>
  ): Promise<ValidationIssue[]> {
    return this.entryIssues({
      data: merged,
      fields: args.fields,
      collectionName: args.collectionName,
      mode: "update",
      user: args.user,
      reader: args.reader,
      readLocale: args.locale,
      assembledFromStorage: true,
      localeCtx: await this.publishLanguageContext({
        collectionName: args.collectionName,
        locale: args.locale,
        fields: args.fields,
        ...(args.tx === undefined ? {} : { tx: args.tx }),
        companion: args.companion,
      }),
      id: args.entryId,
      goesLive: true,
      ...(args.batch === undefined ? {} : { batch: args.batch }),
      ...(args.tx === undefined ? {} : { tx: args.tx }),
    });
  }

  /**
   * What {@link assertLanguagesGoLiveValid} refuses a publish with, without
   * refusing it: the violations of the first language going live that has
   * any, or none.
   */
  private async languagesGoLiveIssues(
    args: LanguagesGoLiveArgs
  ): Promise<ValidationIssue[]> {
    // A language whose promotion was judged as it goes live is not judged
    // again as stored: what is stored is not what goes live there.
    const languages = [
      ...new Set([
        ...(await this.languagesGoingLive(args)),
        ...(args.alsoGoingLive ?? []),
      ]),
    ].filter(
      locale =>
        !(args.writeLocalePromoted && locale === args.writeLocale) &&
        !(locale !== undefined && args.promotedLocales?.has(locale)) &&
        movesLanguage(
          args.parts,
          locale ?? this.localization?.defaultLocale ?? ""
        )
    );
    const collected: ValidationIssue[] = [];
    for (const locale of languages) {
      const issues = await this.entryIssues({
        data: await this.storedDocumentGoingLive({
          row: args.row,
          patch:
            locale === args.writeLocale
              ? { ...args.patch, ...args.writeLocaleValues }
              : args.patch,
          fields: args.fields,
          collectionName: args.collectionName,
          entryId: args.entryId,
          locale,
          tx: args.tx,
          reads: args.reads,
          relations: args.relations,
        }),
        fields: args.fields,
        collectionName: args.collectionName,
        mode: "update",
        user: args.user,
        reader: args.reader,
        readLocale: locale,
        goesLive: true,
        batch: args.relations.batch,
        assembledFromStorage: true,
        localeCtx: await this.publishLanguageContext({
          collectionName: args.collectionName,
          locale,
          fields: args.fields,
          ...(args.tx === undefined ? {} : { tx: args.tx }),
          companion: args.reads?.companion,
        }),
        id: args.entryId,
        ...(args.tx === undefined ? {} : { tx: args.tx }),
      });
      // The first language at fault, as a publish is refused on it: the
      // languages after it are not judged. A publish of chosen parts judges
      // every chosen language instead, each issue naming its language.
      if (issues.length > 0 && args.parts === undefined) return issues;
      const named = locale ?? this.localization?.defaultLocale;
      collected.push(
        ...issues.map(issue =>
          named === undefined ? issue : { ...issue, locale: named }
        )
      );
    }
    return collected;
  }

  /**
   * The languages a publish of every language puts live, each to be asked
   * about: those its statuses name, a main row going live with no translation
   * of its own being the default language's, those a pending change a write
   * to every language promotes goes live in, and every configured language
   * where the collection reaches a localized field group. Read on `tx` where
   * one is given, and on the pool otherwise.
   */
  private async languagesToPublish(args: {
    collectionName: string;
    entryId: string;
    row: Record<string, unknown>;
    /** The collection's fields, for whether it reaches a localized field group. */
    fields: readonly { type: string; name?: string }[];
    /**
     * The collection, where the write promotes the working draft kept in its
     * own slot, as a write to every language does.
     */
    promotesDraftOf?: unknown;
    /**
     * The collection, where the write promotes every language's pending
     * change, as publishing every language does.
     */
    promotesEveryDraftOf?: unknown;
    /** The parts a publish of chosen parts moves; absent, every language. */
    parts?: LifecycleParts;
    tx?: TransactionContext;
  }): Promise<string[]> {
    const defaultLocale = this.localization?.defaultLocale;
    const goingLive = (
      await this.languagesGoingLive({
        collectionName: args.collectionName,
        entryId: args.entryId,
        row: args.row,
        writeLocale: undefined,
        perLocaleStatus: false,
        everyLanguage: true,
        ...(args.tx === undefined ? {} : { tx: args.tx }),
      })
    )
      .map(locale => locale ?? defaultLocale)
      .filter((locale): locale is string => typeof locale === "string");
    goingLive.push(...(await this.languagesPromoted(args)));
    // A publish of chosen languages puts only those live, so only those are asked about.
    return languagesToAsk([...new Set(goingLive)], {
      configured: this.localization?.locales.map(locale => locale.code) ?? [],
      reachesLocalizedFieldGroup: await this.reachesLocalizedFieldGroup(
        args.fields,
        args.tx
      ),
    }).filter(locale => movesLanguage(args.parts, locale));
  }

  /**
   * The languages a pending change a write to every language promotes goes
   * live in, as stored: where the collection is localized, keeps drafts and
   * holds a working draft in that write's own slot, every configured
   * language. The change can carry shared values, which every language's
   * document shows, so a language already live is changed by it as surely as
   * the draft's own. A draft the schema has since made ineligible is not
   * promoted, and is asked about all the same: asking about more languages can
   * only refuse. Read on `tx` where one is given.
   *
   * A publish of every language promotes the change kept in EVERY slot, so
   * each one counts, as a Single's publish counts them: a change kept under no
   * language (the shared values) as the default language's.
   */
  private async languagesPromoted(args: {
    collectionName: string;
    entryId: string;
    promotesDraftOf?: unknown;
    promotesEveryDraftOf?: unknown;
    tx?: TransactionContext;
  }): Promise<string[]> {
    const configured =
      this.localization?.locales.map(language => language.code) ?? [];
    const every = args.promotesEveryDraftOf;
    if (every !== undefined) {
      if (!this.keepsWorkingDrafts(every)) return [];
      const held = await new VersionsRepository(
        args.tx ?? this.adapter
      ).listWorkingDraftLocales({
        scopeKind: "collection",
        scopeSlug: args.collectionName,
        entryId: args.entryId,
      });
      const defaultLocale = this.localization?.defaultLocale;
      return [
        ...new Set(
          held.flatMap(locale =>
            languagesPromotedChangeReaches(locale ?? defaultLocale, configured)
          )
        ),
      ];
    }
    const collection = args.promotesDraftOf;
    if (collection === undefined || !this.keepsWorkingDrafts(collection)) {
      return [];
    }
    const locale = this.wildcardDraftLocale(collection);
    if (locale === null) return [];
    const repo = new VersionsRepository(args.tx ?? this.adapter);
    const ref = {
      scopeKind: "collection" as const,
      scopeSlug: args.collectionName,
      entryId: args.entryId,
    };
    // Under per-language storage the promote takes the shared draft with this
    // slot's own, so a document whose only change is shared holds one too.
    const holds = draftsKeptByPart()
      ? holdsPendingChange(await findPartDrafts(repo, ref, locale))
      : (await repo.findWorkingDraft(ref, locale)) !== undefined;
    return languagesPromotedChangeReaches(
      holds ? locale : undefined,
      configured
    );
  }

  /**
   * Whether a publish of every language is refused in any of `languages`:
   * `ask` (the publish permission and rule) asked once for each, each time
   * told that language and all of them, so a rule that answers by language
   * answers for each. Asked before the transaction, never on its connection:
   * a rule is the app's own code and may read the database, which on a held
   * connection waits for one the transaction keeps. The first refusal, or
   * `undefined`; the languages refused go to the server log only. With no
   * language going live, `ask` is asked once, in the operation's languages.
   */
  private async refusedInEachLanguage(args: {
    collectionName: string;
    entryId: string;
    languages: readonly string[];
    ask: () => Promise<CollectionServiceResult | null>;
  }): Promise<CollectionServiceResult | undefined> {
    const denied = await askEachLanguage(args.languages, args.ask);
    if (!denied) return undefined;
    this.logger.warn("Publish refused in some languages", {
      collectionName: args.collectionName,
      entryId: args.entryId,
      refusedLanguages: denied.refused,
    });
    return denied.refusal;
  }

  /**
   * The conflict refusing a publish whose languages going live, re-read under
   * the lock, include one the rule was not asked about before it; `undefined`
   * where none is, and where nothing was asked per language (an unpublish).
   * Reads only: no rule runs on the transaction.
   */
  private async languagesChangedUnderLock(
    args: Parameters<CollectionMutationService["languagesToPublish"]>[0] & {
      asked: readonly string[] | undefined;
      tx: TransactionContext;
    }
  ): Promise<NextlyError | undefined> {
    if (args.asked === undefined) return undefined;
    const unasked = unaskedLanguages(
      args.asked,
      await this.languagesToPublish(args)
    );
    return unasked.length > 0 ? languagesChangedConflict(unasked) : undefined;
  }

  /**
   * The lifecycle permission and rule for publishing or unpublishing every
   * language, asked before the transaction: a publish once for each language
   * it puts live, those languages kept for the lock to compare with; an
   * unpublish once, in every language.
   */
  private async askBeforeLifecycle(
    args: Omit<
      Parameters<CollectionMutationService["languagesToPublish"]>[0],
      "tx"
    > & {
      publishes: boolean;
      ask: () => Promise<CollectionServiceResult | null>;
    }
  ): Promise<{
    denied: CollectionServiceResult | null | undefined;
    askedLanguages?: string[];
  }> {
    if (!args.publishes) return { denied: await args.ask() };
    const askedLanguages = await this.languagesToPublish(args);
    return {
      denied: await this.refusedInEachLanguage({
        collectionName: args.collectionName,
        entryId: args.entryId,
        languages: askedLanguages,
        ask: args.ask,
      }),
      askedLanguages,
    };
  }

  /**
   * Whether `fields` reach a field group whose definition is localized, at any
   * depth, read on `tx` where one is given. None without the field-group
   * service, which a boot without field groups does not register.
   */
  private reachesLocalizedFieldGroup(
    fields: readonly { type: string; name?: string }[],
    tx?: TransactionContext
  ): Promise<boolean> {
    const service = this.fieldGroupDataService;
    if (!service) return Promise.resolve(false);
    return reachesLocalizedFieldGroup(fields, slug =>
      service.getComponentDefinition(slug, tx?.getDrizzle())
    );
  }

  /**
   * Which languages a publish moves from not live to live, as the stored
   * statuses say. A language keeping its own status answers from its companion
   * row, where a language with no row starts as a draft; otherwise the
   * document's one status answers for it.
   */
  private async languagesGoingLive(args: {
    collectionName: string;
    entryId: string;
    row: Record<string, unknown>;
    writeLocale: string | undefined;
    perLocaleStatus: boolean;
    everyLanguage: boolean;
    tx?: TransactionContext;
    reads?: GoingLiveReads;
  }): Promise<(string | undefined)[]> {
    const statuses =
      args.perLocaleStatus || args.everyLanguage
        ? args.reads !== undefined
          ? await args.reads.languageStatuses(args.entryId)
          : await this.storedLanguageStatuses(
              args.collectionName,
              args.entryId,
              args.tx
            )
        : null;
    if (args.everyLanguage && statuses !== null && statuses.size > 0) {
      return languagesGoingLiveFrom({
        statuses,
        configured: this.localization?.locales.map(locale => locale.code) ?? [],
        defaultLocale: this.localization?.defaultLocale,
        mainPublished: args.row.status === "published",
      });
    }
    const live =
      args.perLocaleStatus && args.writeLocale !== undefined
        ? statuses?.get(args.writeLocale) === "published"
        : args.row.status === "published";
    return live ? [] : [args.writeLocale];
  }

  /**
   * Each stored translation's own status, keyed by locale, or `null` where the
   * collection keeps no companion to read it from.
   */
  private async storedLanguageStatuses(
    collectionName: string,
    entryId: string,
    tx?: TransactionContext
  ): Promise<Map<string, string | null> | null> {
    const companion = await this.fileManager.loadCompanionSchema(
      collectionName,
      tx?.getDrizzle()
    );
    if (!companion) return null;
    return readCompanionLocaleStatusAll(
      (tx?.getDrizzle() ?? this.db) as Parameters<
        typeof readCompanionLocaleStatusAll
      >[0],
      companion.table,
      entryId,
      cachedCompanionReadiness(this.adapter, companion.companionTableName)
    );
  }

  /**
   * The top-level paths of an assembled going-live document that this write's
   * caller did not name: what goes live under them is the row's own content,
   * which the whole-number floor leaves to the row, as the gate judged the
   * document before this write. The caller's own keys — the patch's, the
   * component and relation values lifted out of it, the write locale's split
   * values — are absent, so a value under one is judged like any write's.
   */
  private rowOwnedPathsOf(
    document: Record<string, unknown>,
    callerNamed: ReadonlySet<string>
  ): Set<string> {
    return new Set(Object.keys(document).filter(key => !callerNamed.has(key)));
  }

  /**
   * The document a publish puts live when no working draft is promoted into
   * it: the stored row, the write locale's translations, and the caller's
   * fields on top, in the logical shape the validator reads.
   *
   * A status-only publish carries just `{ status }`, so validating the patch
   * alone judges nothing that goes live. What goes live is the row as stored,
   * and a value stored while the document was a draft was judged as a draft:
   * a rule that depends on the lifecycle — a field type that composes against
   * the published library, say — has never judged it as published.
   *
   * The status is set to the one being written, because a per-locale status
   * write carries it in the companion rather than the patch. Its components
   * and junction many-to-many ids are read as stored, in this language, with
   * the caller's own over them: they do not sit on the row, and update mode
   * skips an absent key, so a required one missing from storage would go live
   * unjudged. Each has a key, `null` or `[]` where nothing is stored. Read in
   * the batch's one read where the document publishes with others. Password
   * values are left out, since a stored one is a hash and the caller's was
   * judged before it was hashed.
   */
  private async storedDocumentGoingLive(args: {
    row: Record<string, unknown>;
    patch: Record<string, unknown>;
    fields: FieldDefinition[];
    collectionName: string;
    entryId: string;
    /** The write locale, whose translations sit beside the row. */
    locale: string | undefined;
    /** The transaction the write runs on; absent, the judgement reads the pool. */
    tx: TransactionContext | undefined;
    reads?: GoingLiveReads;
    relations: GoingLiveRelationArgs;
  }): Promise<Record<string, unknown>> {
    const connection = args.tx ?? {
      getDrizzle: <T = unknown>() => this.db as T,
    };
    const translations =
      args.locale === undefined
        ? {}
        : args.reads !== undefined
          ? await args.reads.translations(args.entryId, args.locale)
          : await this.readCompanionLocalizedValues(
              connection,
              args.collectionName,
              args.entryId,
              args.locale
            );
    const document = this.deserializeJsonFieldsForSnapshot(
      {
        ...convertTimestampsToCamelCase({ ...args.row }),
        ...translations,
        ...args.patch,
        status: "published",
      },
      args.fields
    );
    stripPasswordFieldValues(
      document,
      args.fields,
      await this.passwordReach(args.fields, connection.getDrizzle())
    );
    const stored = await this.storedRelationsOf({
      entryId: args.entryId,
      collectionName: args.collectionName,
      fields: args.fields,
      language: args.locale,
      tx: args.tx,
      relations: args.relations,
    });
    return {
      ...document,
      ...relationsGoingLive({
        stored,
        fields: args.fields,
        componentSchemas: args.relations.componentSchemas,
        components: args.relations.componentFieldData,
        manyToMany: args.relations.manyToManyData,
      }),
    };
  }

  /**
   * One document's components and many-to-many ids as stored, its components
   * in `language`. Components read alike in every language unless one reaches
   * a localized field group, so only then is each language read on its own.
   *
   * On `tx`, read for this document alone. A transaction judges the row it has
   * just locked, and a batch's other rows are not locked yet: relations read
   * for them now could be changed and committed by another writer before the
   * batch reaches them, which would then be judged on what is no longer
   * stored. Off a transaction, from its batch's one read where it publishes
   * with others, on the pool, where a component table not yet created reads
   * as empty; the pool's executor is never passed as a transaction's.
   */
  private async storedRelationsOf(args: {
    entryId: string;
    collectionName: string;
    fields: FieldDefinition[];
    language: string | undefined;
    tx: TransactionContext | undefined;
    relations: Pick<
      GoingLiveRelationArgs,
      "tableName" | "manyToManyFields" | "batch"
    >;
  }): Promise<StoredRelations> {
    const executor = args.tx?.getDrizzle();
    const read = {
      collectionName: args.collectionName,
      parentTable: args.relations.tableName,
      fields: args.fields,
      manyToManyFields: args.relations.manyToManyFields,
      executor,
      fieldGroups: this.fieldGroupDataService,
      relationships: this.relationshipService,
    };
    const load: StoredRelationsLoad = {
      components: (entryIds, language) =>
        readStoredComponents({ ...read, entryIds, language }),
      manyToMany: entryIds => readStoredManyToMany({ ...read, entryIds }),
    };
    const service = this.fieldGroupDataService;
    const byLanguage =
      service !== undefined &&
      (await reachesLocalizedFieldGroup(args.fields, slug =>
        service.getComponentDefinition(slug, executor)
      ));
    const batch = relationsBatchFor({
      entryId: args.entryId,
      onTransaction: args.tx !== undefined,
      shared: args.relations.batch,
    });
    return batch.read(
      args.entryId,
      byLanguage ? args.language : undefined,
      load
    );
  }

  /**
   * Read the entry's component subtrees + many-to-many id arrays for a version
   * snapshot, using the WRITE TRANSACTION's connection (read-your-writes, #226)
   * so the components and junction rows just written in the same transaction are
   * visible on every dialect. The read path returns the full read shape — ids
   * populated, JSON parsed, password fields stripped — and an empty relationship
   * reads as `[]`, so the snapshot matches a normal read with no in-memory
   * overlay and cannot leak component password hashes. A read failure fails the
   * capture (the whole transaction rolls back) rather than persisting a
   * knowingly-incomplete snapshot the caller cannot tell is incomplete.
   */
  /**
   * The write locale's translatable values as the companion row currently holds
   * them, with no locale fallback so the caller sees exactly this locale.
   *
   * The main row never stores translatable values, so a snapshot built from it
   * alone omits every localized field. Reading through the transaction handle
   * makes the result reflect whatever the caller has already written in this
   * transaction (nothing, before the companion upsert; the new values after it).
   * Undefined values are skipped so an untranslated field is not written as
   * `undefined` over the main-row value.
   */
  private async readCompanionLocalizedValues(
    tx: { getDrizzle<T = unknown>(): T },
    collectionName: string,
    entryId: string,
    locale: string
  ): Promise<Record<string, unknown>> {
    // Bound to the transaction connection so the companion metadata read does not
    // re-enter the pool from inside the caller's transaction.
    const companion = await this.fileManager.loadCompanionSchema(
      collectionName,
      tx.getDrizzle()
    );
    if (!companion) return {};
    const byEntry = await this.companionValuesOf(
      tx.getDrizzle(),
      companion,
      [entryId],
      locale
    );
    return byEntry.get(entryId) ?? {};
  }

  /**
   * Each entry's translatable values in one language as its companion row
   * holds them, with no fallback, keyed by entry id: one query for them all.
   * Inside a caller's transaction the remembered readiness verdict is read and
   * never resolved: resolving would query, and a query against a missing
   * relation aborts the whole transaction on PostgreSQL. The write path
   * resolves it before opening one.
   */
  private async companionValuesOf(
    executor: unknown,
    companion: CompanionSchema,
    entryIds: readonly string[],
    locale: string
  ): Promise<Map<string, Record<string, unknown>>> {
    const byLocale = await this.companionValuesByLanguageOf(
      executor,
      companion,
      entryIds,
      [locale]
    );
    return byLocale.get(locale) ?? new Map();
  }

  /**
   * {@link companionValuesOf} for several languages at once, keyed by language
   * and then by entry id: one query for every language, each language's
   * values exactly what a read of that language alone returns.
   */
  private async companionValuesByLanguageOf(
    executor: unknown,
    companion: CompanionSchema,
    entryIds: readonly string[],
    locales: readonly string[]
  ): Promise<Map<string, Map<string, Record<string, unknown>>>> {
    const byLanguage = [...new Set(locales)].map(locale => ({
      locale,
      rows: entryIds.map((id): Record<string, unknown> => ({ id })),
    }));
    await populateCompanionFieldsByLanguage({
      db: executor as Parameters<
        typeof populateCompanionFieldsByLanguage
      >[0]["db"],
      companionTable: companion.table,
      localizedFields: companion.localizedFields,
      byLanguage: byLanguage.map(language => ({
        rows: language.rows,
        localeChain: [language.locale],
      })),
      readiness: cachedCompanionReadiness(
        this.adapter,
        companion.companionTableName
      ),
    });
    return new Map(
      byLanguage.map(language => [
        language.locale,
        new Map(
          language.rows.map(row => {
            const values: Record<string, unknown> = {};
            for (const field of companion.localizedFields) {
              const value = row[field.name];
              if (value !== undefined) values[field.name] = value;
            }
            return [String(row.id), values];
          })
        ),
      ])
    );
  }

  /**
   * Every distinct slug value across a localized collection's locales for one
   * entry. A localized `slug` field can differ per locale, so a publish-all or a
   * delete must bust each locale's URL, not just the default one. Returns [] for
   * a non-localized collection, one whose `slug` is not localized, or one with no
   * configured locales. Bound to the caller's transaction connection so the read
   * does not re-enter the pool from inside the transaction.
   *
   * Never throws: this feeds cache invalidation, not the write itself. On the
   * publish path it runs post-commit, so a thrown error would wrongly report a
   * committed publish as failed; on the delete path it must not abort a delete.
   * A read failure degrades to [] (the collection/id tags — and, since reads are
   * id-tagged, every locale's page — still bust) and is logged rather than
   * silently dropped.
   */
  /**
   * Resolve a collection's companion readiness on the pooled connection.
   *
   * Warming only — it judges nothing. Its value is the verdict it leaves behind for the
   * in-transaction reads that follow, which cannot resolve one themselves.
   */
  private async warmCompanionReadiness(collectionName: string): Promise<void> {
    const companion =
      await this.fileManager.loadCompanionSchema(collectionName);
    if (!companion) return;
    await resolveCompanionReadiness(this.adapter, {
      companionTableName: companion.companionTableName,
      mainTableName: companion.companionTableName.replace(/_locales$/, ""),
      localizedColumns: companion.localizedFields.map(f => f.column),
    });
  }

  /**
   * Resolve, on the pooled connection, every companion verdict a write for this collection needs:
   * the collection's own, and one for each field-group type its schema can hold.
   *
   * Public because the only place this can run is somewhere the caller controls. A method that
   * receives a transaction cannot do it for itself: resolving issues a query, a query against a
   * missing relation aborts the whole transaction on PostgreSQL, and a pooled probe taken while a
   * transaction is open waits for a connection that transaction will not release until it ends.
   * So it has to happen before the transaction opens.
   *
   * Skipping it is exactly what makes it worth calling. Nothing throws — an unresolved verdict
   * reads as unusable, so the write commits normally while its durable version snapshot and its
   * outbound event quietly omit every localized component value. That omission surfaces from a
   * consumer of the event, long after the snapshot has become the historical record and stopped
   * being reconstructable.
   *
   * Read-only and idempotent: safe to call more than once, and for a collection that is not
   * localized at all.
   */
  async warmLocalizedReadiness(collectionName: string): Promise<void> {
    await this.warmCompanionReadiness(collectionName);
    if (!this.fieldGroupDataService) return;
    const collection =
      await this.collectionService.getCollection(collectionName);
    const fields =
      ((
        (collection as Record<string, unknown>).schemaDefinition as
          | Record<string, unknown>
          | undefined
      )?.fields as FieldDefinition[]) ||
      ((collection as Record<string, unknown>).fields as FieldDefinition[]) ||
      [];
    await this.fieldGroupDataService.assertLocalizedFieldGroupsWritable({
      fields: fields as unknown as FieldConfig[],
      // Nothing is being written, so nothing is judged: this call is here purely for the verdicts
      // it leaves behind.
      data: {},
      locale: undefined,
    });
  }

  /**
   * Remove a document's pending working-draft sidecar under the same parent-row
   * lock a draft save takes.
   *
   * A status-less save upserts the working draft while holding the parent row's
   * lock (see the working-draft branch of updateEntry). Discarding has to take
   * the same lock: without it, a save that commits between a discard's
   * authorization checks and its delete would have its brand-new draft removed,
   * and both requests would report success, silently losing that edit. Running
   * the delete inside a transaction that locks the parent row serializes it with
   * those saves. The lock is a no-op where row locking is unavailable (SQLite,
   * which already serializes writers).
   *
   * Authorization is the caller's concern: the discard handler establishes read
   * and update on the document before this runs. Deleting when no working draft
   * exists is a no-op, not an error.
   */
  async discardWorkingDraft(params: {
    collectionName: string;
    entryId: string;
    /**
     * Which language's pending change to discard. Discarding is one language's
     * concern: a document can hold a pending change in several at once, and
     * removing them all would throw away work in languages the author never
     * opened. Ignored for an unlocalized document, which has one.
     */
    locale?: string | null;
    /** Who discarded it, for the document's history. */
    actor?: RequestActor;
    user?: UserContext;
    /**
     * Ask the update `user` was authorized for again under the lock, so a
     * change since the caller judged it cannot move the entry out of an
     * update rule's filter and still have its pending change removed. Set by
     * a caller that authorized the discard as `user`'s update; without it,
     * authorization stays the caller's concern.
     */
    updateUnderLock?: { authenticatedScope?: AuthenticatedScope };
    /**
     * The version the pending change was read at (`_rev`) and the overwrite
     * choice (`_overwrite`): discarding a colleague's newer change from an
     * old view would lose it, so a discard is judged as a save of it is.
     */
    version?: Readonly<Record<string, unknown>>;
    /**
     * Told the version the discard left the document at, read on its
     * transaction and spelled for `locale`: for a caller that answers with
     * the document, so the version it hands back is the one this discard
     * produced. Used only once the discard has resolved, so a discard that
     * rolls back hands out none. Not called when there was no draft to
     * discard.
     */
    onVersion?: (version: string | undefined) => void;
  }): Promise<number> {
    // Refused first when the collection is removed from code, before any hook
    // or read of the entry, so a refused write changes nothing.
    await refuseWriteIfRemovedFromCode("collection", params.collectionName);
    const collection = await this.collectionService.getCollection(
      params.collectionName
    );
    const tableName = collectionTableName(collection, params.collectionName);
    const judging = await this.pendingChangeJudging(params, collection);
    // Set by a refusal inside the transaction, answered once it rolls back.
    const staleWrite: StaleWriteHolder = {};
    // The drafts it removed, counted by the delete made under the lock.
    return this.adapter
      .transaction(async tx => {
        // Serialize with concurrent draft-save upserts, which lock this same parent
        // row before writing the sidecar.
        await tx.lockRow(tableName, params.entryId);
        if (params.updateUnderLock) {
          // Route authorization already ran, so only the coarse re-check is
          // skipped; the document's own rules and their filter are asked here.
          const denied = await this.refusalOfWriteInTransaction(
            tx,
            {
              collectionName: params.collectionName,
              operation: "update",
              entryId: params.entryId,
              user: params.user,
              overrideAccess: false,
              routeAuthorized: true,
              authenticatedScope: params.updateUnderLock.authenticatedScope,
              executor: tx.getDrizzle(),
            },
            [],
            params.locale ?? undefined
          );
          if (denied) throw errorFromServiceEnvelope(denied);
        }
        const draftLocale = workingDraftLocale({
          documentLocalized:
            (collection as { localized?: boolean }).localized === true,
          requestLocale: params.locale ?? null,
          defaultLocale: this.localization?.defaultLocale ?? null,
        });
        const discardedRef = {
          scopeKind: "collection" as const,
          scopeSlug: params.collectionName,
          entryId: params.entryId,
        };
        const { removed, judged: before } = await removePendingChangeJudged(
          tx,
          { ref: discardedRef, locale: draftLocale },
          judging.check,
          () => this.refuseIfPendingChangeMoved(tx, judging, staleWrite),
          { main: undefined, language: undefined }
        );
        // The author's unsaved work recorded in the discarded language goes
        // with it, so the editor no longer offers to restore what they threw
        // away. Their work recorded in another language stays.
        // Only where a pending change was removed: a discard that found none
        // threw nothing away, and the point is then the only copy of the work.
        if (removed > 0) {
          await forgetRecoveryPointIn(tx, {
            ref: discardedRef,
            author: params.user?.id,
            slot: draftLocale,
            documentLocalized:
              (collection as { localized?: boolean }).localized === true,
            defaultLocale: this.localization?.defaultLocale ?? null,
          });
        }
        // In the document's history only when there was a draft to discard.
        if (removed > 0) {
          // A reader of the pending change now sees the live entry, so the
          // version they hold no longer describes what they would read.
          await bumpDocumentRevision(
            tx,
            tableName,
            { id: params.entryId },
            actorForWrite(params.actor, params.user)
          );
          // Discarded over a change since the read, by choice: recorded.
          await this.recordOverwriteIfAsked(
            tx,
            judging.check,
            {
              collection: params.collectionName,
              id: params.entryId,
              actor: params.actor,
              user: params.user,
            },
            { ...before, locale: judging.locale }
          );
          if (params.onVersion) {
            params.onVersion(
              await documentVersionOn(tx, {
                dialect: this.dialect,
                table: tableName,
                id: params.entryId,
                languagesTable: await this.translationTableOnTx(
                  tx,
                  collection,
                  tableName
                ),
                localization: this.localization,
                locale: params.locale ?? undefined,
              })
            );
          }
          await this.recordHistoryEvent(
            tx,
            params.collectionName,
            params.entryId,
            {
              kind: "draftDiscarded",
              actor: actorForWrite(params.actor, params.user),
              personName: params.user?.name ?? null,
              ...(draftLocale ? { parts: { locales: [draftLocale] } } : {}),
            }
          );
          // The discarded part has nothing unpublished left to review: its
          // review closes with the draft, in this transaction.
          await closeReviewOnDiscard(
            tx,
            { adapter: this.adapter },
            {
              document: discardedRef,
              part: draftLocale,
              actor: actorForWrite(params.actor, params.user),
              personName: params.user?.name ?? null,
            }
          );
        }
        return removed;
      })
      .catch(async (error: unknown) => {
        // Out of date: answered after the rollback, from the entry as it is now.
        const refused = await this.refusalAfterRollback(
          { params, check: judging.check, holder: staleWrite },
          undefined
        );
        if (refused) throw errorFromServiceEnvelope(refused);
        // A discard the database is not migrated for answers as such. Its
        // transaction rolls back whole, so a failure never follows a kept write.
        throw await asNotMigrated(
          error,
          // No caller trust to judge: a discard takes no `overrideAccess`, so it
          // is told the collection alone.
          collectionRowNotMigrated(params.collectionName, collection)
        );
      });
  }

  /**
   * Bring a language's pending change up to date with the shared values
   * someone else published after it began: each out-of-date shared field the
   * caller may write takes its live value, saved as a save of the change. Its
   * base moves to the live version only when every out-of-date field was
   * taken; a protected field left behind stays out of date for someone who may
   * write it. A shared value the change edited that nobody else published
   * keeps the change's value.
   *
   * Applies the document's update rules and its field rules: this writes the
   * pending change. The fields it names are those the caller may read.
   *
   * @experimental
   */
  async takeLiveSharedValues(params: {
    collectionName: string;
    entryId: string;
    /** Which language's pending change; the default when none is named. */
    locale?: string | null;
    /** Who took them, for the change's history. */
    actor?: RequestActor;
    user?: UserContext;
    overrideAccess?: boolean;
    routeAuthorized?: boolean;
    authenticatedScope?: AuthenticatedScope;
    /**
     * The version the pending change was read at (`_rev`) and the overwrite
     * choice (`_overwrite`): taking the live values saves the change, so it is
     * judged as a save of it is.
     */
    version?: Readonly<Record<string, unknown>>;
  }): Promise<CollectionServiceResult<TakenLiveValues>> {
    // Refused first when the collection is removed from code, before any hook
    // or read of the entry, so a refused write changes nothing.
    await refuseWriteIfRemovedFromCode("collection", params.collectionName);
    // Set by a refusal inside the transaction, answered once it rolls back.
    const staleWrite: StaleWriteHolder = {};
    let judging: PendingChangeJudging | undefined;
    try {
      // An update of this entry: a rule that answers a filter allows it only
      // where the filter matches the entry as it is stored, in the language
      // whose pending change it writes.
      const accessDenied = await this.refusalOfStoredUpdate<TakenLiveValues>(
        {
          collectionName: params.collectionName,
          operation: "update",
          entryId: params.entryId,
          user: params.overrideAccess ? undefined : params.user,
          overrideAccess: params.overrideAccess,
          routeAuthorized: params.routeAuthorized,
          authenticatedScope: params.authenticatedScope,
        },
        params.locale ?? undefined
      );
      if (accessDenied) return accessDenied;
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      // Without languages every field is the document's own: nothing comes
      // from another language to take, and a take would only overwrite the
      // editor's pending edits.
      if ((collection as { localized?: boolean }).localized !== true) {
        throw NextlyError.conflict({
          reason: "state",
          message:
            "This collection has no languages, so there are no shared values from another language to take.",
          logContext: {
            reason: "take-live-unlocalized",
            collection: params.collectionName,
          },
        });
      }
      // Resolved before the transaction: they take a pooled connection.
      const grants = await this.resolvedGrants(
        params.user,
        params.authenticatedScope
      );
      judging = await this.pendingChangeJudging(params, collection);
      const judged = judging;
      const took = await this.adapter.transaction(tx =>
        this.takeLiveInTx(tx, collection, params, grants, {
          judging: judged,
          holder: staleWrite,
        })
      );
      if (!took) {
        throw NextlyError.notFound({
          message: "This language has no pending change.",
          logContext: {
            reason: "take-live-no-pending-change",
            collection: params.collectionName,
            entryId: params.entryId,
          },
        });
      }
      const reader = {
        kind: "collection" as const,
        slug: params.collectionName,
        user: params.user,
        overrideAccess: params.overrideAccess && !params.routeAuthorized,
        authenticatedScope: params.authenticatedScope,
        grants,
      };
      return {
        success: true,
        statusCode: 200,
        message: "The pending change now holds the live shared values.",
        data: await takenLiveValues(reader, took),
      };
    } catch (error: unknown) {
      // Out of date: answered after the rollback, from the entry as it is now.
      const refused = await this.refusalAfterRollback(
        {
          params,
          check: judging?.check ?? { kind: "unjudged" },
          holder: staleWrite,
        },
        undefined
      );
      if (refused) return refused as CollectionServiceResult<TakenLiveValues>;
      return errorToServiceResult(
        // A write the database is not migrated for answers as such.
        await asNotMigrated(
          error,
          collectionNotMigrated(this.collectionService, params.collectionName, {
            trusted: fieldTrustOf(params),
          })
        ),
        { defaultMessage: "Failed to take the live values" },
        this.dialect
      );
    }
  }

  /**
   * The body of {@link takeLiveSharedValues}, in its transaction: null when
   * the language has no pending change.
   */
  private async takeLiveInTx(
    tx: TransactionContext,
    collection: Awaited<ReturnType<DynamicCollectionService["getCollection"]>>,
    params: Parameters<CollectionMutationService["takeLiveSharedValues"]>[0],
    grants: () => Promise<CallerGrants>,
    version: { judging: PendingChangeJudging; holder: StaleWriteHolder }
  ): Promise<{
    taken: string[];
    remaining: string[];
    live: Record<string, unknown>;
    byHand: ReadonlySet<string>;
  } | null> {
    const fields = collectionFields(collection);
    const tableName = collectionTableName(collection, params.collectionName);
    const schema = await this.fileManager.loadDynamicSchema(
      params.collectionName
    );
    const ref = {
      scopeKind: "collection" as const,
      scopeSlug: params.collectionName,
      entryId: params.entryId,
    };
    const draftLocale = workingDraftLocale({
      documentLocalized:
        (collection as { localized?: boolean }).localized === true,
      requestLocale: params.locale ?? null,
      defaultLocale: this.localization?.defaultLocale ?? null,
    });
    // The lock every save and publish of this document takes, so the live
    // values read here are the ones the next publish compares with.
    await tx.lockRow(tableName, params.entryId);
    // The update asked again on the locked row, so a change since it was
    // judged above cannot move the entry out of a filter and still have its
    // pending change written.
    const deniedUnderLock = await this.refusalOfWriteInTransaction(
      tx,
      {
        collectionName: params.collectionName,
        operation: "update",
        entryId: params.entryId,
        user: params.overrideAccess ? undefined : params.user,
        overrideAccess: params.overrideAccess,
        routeAuthorized: params.routeAuthorized,
        authenticatedScope: params.authenticatedScope,
        executor: tx.getDrizzle(),
      },
      [],
      params.locale ?? undefined
    );
    if (deniedUnderLock) throw errorFromServiceEnvelope(deniedUnderLock);
    const pending = await new VersionsRepository(tx).findWorkingDraft(
      ref,
      draftLocale
    );
    const [row] = await tx
      .getDrizzle<typeof this.db>()
      .select()
      .from(schema)
      .where(eq(schema.id, params.entryId))
      .limit(1);
    if (!pending || !row) return null;
    // Judged under the lock, once there is a pending change to rewrite and
    // before it is written: with none, the answer is the one it always was.
    const before = await this.refuseIfPendingChangeMoved(
      tx,
      version.judging,
      version.holder
    );
    const { live, shared, views, byHand } = await this.liveSharedDocument(tx, {
      collectionName: params.collectionName,
      entryId: params.entryId,
      tableName,
      fields,
      main: this.deserializeJsonFieldsForSnapshot(
        convertTimestampsToCamelCase({ ...(row as Record<string, unknown>) }),
        fields
      ),
      locale: draftLocale,
    });
    const took = await takeLiveSharedValuesInto(tx, this.versionCapture, {
      ref,
      locale: draftLocale,
      shared,
      live,
      views,
      pending: snapshotRecord(pending.snapshot),
      createdBy: params.user?.id ?? null,
      maxPerDoc: (collection as { versions?: ResolvedVersionsConfig | null })
        .versions?.maxPerDoc,
      // Only what this caller may write, whole: a field rule that refuses
      // them a value, at any depth, refuses them taking its live one too.
      // Nor a translated component's shared sub-fields, which are left to the
      // editor to copy by hand.
      mayTake: (stale, change) =>
        wholeWritableFields(
          stale.filter(name => !byHand.has(name)),
          live,
          change,
          data =>
            applyFieldWriteAccess({
              kind: "collection",
              slug: params.collectionName,
              data,
              operation: "update",
              user: params.user,
              authenticatedScope: params.authenticatedScope,
              overrideAccess: params.overrideAccess,
              id: String((row as { id: unknown }).id),
              grants,
            })
        ),
    });
    // A save of the pending change, in its history like any other.
    // What a reader of the pending change sees moved, so its version moves.
    if (took.taken.length > 0) {
      await bumpDocumentRevision(
        tx,
        tableName,
        { id: params.entryId },
        actorForWrite(params.actor, params.user)
      );
      // Saved over a change since the read, by choice: recorded with it.
      await this.recordOverwriteIfAsked(
        tx,
        version.judging.check,
        {
          collection: params.collectionName,
          id: params.entryId,
          actor: params.actor,
          user: params.user,
        },
        { ...before, locale: version.judging.locale }
      );
    }
    await this.recordSaveHistory(tx, params.collectionName, params.entryId, {
      actor: actorForWrite(params.actor, params.user),
      personName: params.user?.name ?? null,
      locale: draftLocale,
      toState: "draft",
      versionNo: took.versionNo,
    });
    return { taken: took.taken, remaining: took.remaining, live, byHand };
  }

  private async readCompanionSlugsAllLocales(
    db: CompanionReadDb,
    collectionName: string,
    entryId: string
  ): Promise<string[]> {
    try {
      const companion = await this.fileManager.loadCompanionSchema(
        collectionName,
        db
      );
      if (!companion) return [];
      // Only meaningful when `slug` itself is a translatable (companion) field.
      const slugField = companion.localizedFields.filter(
        f => f.name === "slug"
      );
      if (slugField.length === 0) return [];

      const locales = this.localization?.locales.map(l => l.code) ?? [];
      if (locales.length === 0) return [];

      const row: Record<string, unknown> = { id: entryId };
      // Project to the slug column only, so an unrelated translatable column
      // that has not been migrated yet (or has drifted) cannot make the
      // companion read fail and suppress the slug tags.
      await populateCompanionFieldsAllLocales({
        db,
        companionTable: companion.table,
        localizedFields: slugField,
        rows: [row],
        locales,
        readiness: cachedCompanionReadiness(
          this.adapter,
          companion.companionTableName
        ),
      });

      // row.slug is a `{ [locale]: slug | null }` map; collect the distinct
      // non-blank values so each locale's URL tag busts once.
      const byLocale = row.slug;
      const slugs = new Set<string>();
      if (byLocale && typeof byLocale === "object") {
        for (const value of Object.values(
          byLocale as Record<string, unknown>
        )) {
          if (typeof value === "string" && value.trim().length > 0) {
            slugs.add(value);
          }
        }
      }
      return [...slugs];
    } catch (error) {
      this.logger.warn(
        "Failed to read companion slugs for cache revalidation; localized slug tags may not be busted (collection/id tags still are)",
        { collectionName, entryId, error }
      );
      return [];
    }
  }

  /**
   * The write locale's committed per-locale `_status`, or null when its
   * companion row has none. Through the shared typed reader on the write
   * transaction's Drizzle handle, so it sees the transaction's own writes and
   * is ordered behind the main-row lock taken before it.
   */
  private readLocaleStatus(
    tx: TransactionContext,
    localizedUpdate: {
      companionTable: unknown;
      companionTableName: string;
      writeLocale: string;
    },
    entryId: string
  ): Promise<string | null> {
    return readCompanionLocaleStatus(
      tx.getDrizzle<Parameters<typeof readCompanionLocaleStatus>[0]>(),
      localizedUpdate.companionTable,
      entryId,
      localizedUpdate.writeLocale,
      cachedCompanionReadiness(this.adapter, localizedUpdate.companionTableName)
    );
  }

  /**
   * Whether this document is already reachable by the public, ignoring what the current write is
   * about to do to one locale.
   *
   * The marker records a document's FIRST publication, and a localized document can be public
   * through its main row or through any one of its translations. A write that publishes a single
   * locale therefore cannot tell, from its own transition alone, whether the document is becoming
   * public or already was — and the rows where that matters are the upgraded ones, whose marker is
   * null because the history was never recorded rather than because they were never public.
   *
   * Reads through the transaction's Drizzle handle via the same companion scan the publish path
   * uses, so there is one way to ask a companion for its per-locale statuses.
   *
   * `exceptLocale` is the locale this write is changing: its committed status is the "before" of
   * the transition being judged, so counting it here would make every publish look like a
   * republish.
   */
  private async isDocumentAlreadyPublic(
    tx: TransactionContext,
    collectionName: string,
    entryId: string,
    mainRowStatus: string | null | undefined,
    exceptLocale: string | undefined
  ): Promise<boolean> {
    if (mainRowStatus === "published") return true;

    const companion = await this.fileManager.loadCompanionSchema(
      collectionName,
      tx.getDrizzle()
    );
    if (!companion) return false;

    const statusesByLocale = await readCompanionLocaleStatusAll(
      tx.getDrizzle<Parameters<typeof readCompanionLocaleStatusAll>[0]>(),
      companion.table,
      entryId,
      cachedCompanionReadiness(this.adapter, companion.companionTableName)
    );
    for (const [locale, status] of statusesByLocale) {
      if (locale !== exceptLocale && status === "published") return true;
    }
    return false;
  }

  /**
   * Assemble the document a draft promotion actually persists: the draft with the
   * caller's scalars overlaid, the caller's single-component patches merged onto
   * the draft's components (a patch wins per sub-field, recursing into nested
   * single components; a dynamic zone, a repeatable component, and a many-to-many
   * set are replaced whole). `shapeWriteParts` extracts component and m2m fields
   * out of the caller payload before promotion, so field-level write access and
   * validation would otherwise judge the draft's OLD copy of those fields while
   * the caller's copy is folded back in and persisted. Building the full document
   * here lets the access and validation passes see the real final values, at every
   * depth, for column, component, and many-to-many fields alike.
   */
  private assemblePromotedDocument(
    draftInput: Record<string, unknown>,
    callerScalars: Record<string, unknown>,
    callerComponentData: Record<string, unknown>,
    callerManyToManyData: Record<string, string[]>,
    fields: FieldDefinition[],
    manyToManyFields: FieldDefinition[],
    componentSchemas: ComponentSchemas | null
  ): Record<string, unknown> {
    // Read the draft's own component and m2m values straight off the draft
    // document, NOT through `shapeWriteParts` — that serializes groups/json to
    // strings and would hide a nested field from the access and validation passes
    // that run on the returned document. These only seed the merges below; the
    // merged values overwrite the same keys in the returned document.
    const draftComponents: Record<string, unknown> = {};
    for (const field of fields) {
      if (!isFieldGroupField(field)) continue;
      const name = (field as { name?: unknown }).name;
      if (typeof name === "string" && name in draftInput) {
        draftComponents[name] = draftInput[name];
      }
    }
    const draftManyToMany: Record<string, string[]> = {};
    for (const field of manyToManyFields) {
      if (!(field.name in draftInput)) continue;
      const value = draftInput[field.name];
      draftManyToMany[field.name] = Array.isArray(value)
        ? (value as string[])
        : value == null
          ? []
          : [value as string];
    }
    // Caller scalars win over the draft; the caller's single-component patches
    // merge onto the draft's components (a patch wins per sub-field); the caller's
    // m2m replaces the draft's.
    const mergedComponents = mergeComponentPatches(
      draftComponents,
      callerComponentData,
      fields as unknown as FieldConfig[],
      componentSchemas
    );
    const mergedManyToMany = {
      ...draftManyToMany,
      ...callerManyToManyData,
    };
    return {
      ...draftInput,
      ...callerScalars,
      ...mergedComponents,
      ...mergedManyToMany,
    };
  }

  /**
   * Shape a working-draft snapshot into the read document the response and hooks
   * see, the same way the read overlay does: prune it to the current schema
   * (dropping a field a later change removed and the single-component type markers
   * the persisted snapshot keeps for promotion), copy back the immutable id and
   * timestamp columns `buildRestorePayload` holds out, and rehydrate JSON date
   * strings to Date at every depth. Used for the newly accumulated draft and for
   * the prior draft the afterUpdate hooks compare against.
   */
  private shapeDraftForResponse(
    rawDraft: Record<string, unknown>,
    fields: FieldConfig[],
    componentSchemas: ComponentSchemas | null,
    collectionHasStatus: boolean,
    isPluginCollection: boolean
  ): Record<string, unknown> {
    const { payload } = buildRestorePayload(rawDraft, fields, {
      hasStatus: collectionHasStatus,
      hasSlug: !isPluginCollection || fields.some(f => f.name === "slug"),
      hasTitle: !isPluginCollection || fields.some(f => f.name === "title"),
      componentSchemas: componentSchemas ?? undefined,
      documentLocalized: false,
      localeUnknown: false,
    });
    // Every system timestamp spelling, taken from the shared list rather than named here: a list
    // written out by hand carries only the columns that existed when it was written, so the
    // first-publication marker was absent from a working-draft save's response document while an
    // ordinary read of the same entry returned it.
    for (const key of ["id", ...SYSTEM_TIMESTAMP_KEYS]) {
      if (key in rawDraft) payload[key] = rawDraft[key];
    }
    rehydrateSystemTimestamps(payload);
    rehydrateSnapshotDates(payload, fields, componentSchemas);
    return payload;
  }

  /**
   * The document parts a version records, with component types tagged.
   *
   * A separate shape from what the outbox carries: the same parts feed both,
   * and the marker belongs only to the snapshot.
   */
  private async snapshotPartsFor(
    parts: {
      parentRow: Record<string, unknown>;
      components: Record<string, unknown>;
      manyToMany: Record<string, string[]>;
    },
    fields: FieldDefinition[],
    tx: { getDrizzle<T = unknown>(): T }
  ) {
    const schema = fields as unknown as FieldConfig[];

    // A component embedded in another component is tagged too, which needs the
    // inner component's own schema. The data service already exposes that
    // lookup; resolving the whole set once keeps the walk itself synchronous.
    //
    // Read on the transaction's own connection. The registry lookup would
    // otherwise take a second pooled connection while this write transaction
    // still holds one, which stalls against a small pool.
    const componentFields = this.fieldGroupDataService
      ? await resolveComponentFieldMap(schema, slug =>
          this.fieldGroupDataService!.getComponentFields(slug, tx.getDrizzle())
        )
      : new Map<string, FieldConfig[]>();
    const resolve = (slug: string) => componentFields.get(slug);

    const components = tagComponentTypes(parts.components, schema, resolve);
    // A working draft stores the caller's RAW component input (the component
    // saver that hashes nested passwords is skipped for a draft edit), so a
    // password field inside a component would otherwise land in the snapshot in
    // plaintext and leak on a trusted draft read. The normal capture path reads
    // components back through the query layer, which already strips them, so
    // this is a no-op there. Runs after tagging so a dynamic zone's per-instance
    // `_componentType` resolves each row's own schema.
    this.stripComponentPasswordsInPlace(components, schema, componentFields);

    return {
      ...parts,
      components,
      // A component declared inside a group or repeater rides in that
      // container's JSON on the parent row rather than appearing as its own
      // key, so it has to be reached through the row.
      parentRow: tagNestedComponentTypes(
        parts.parentRow,
        schema,
        resolve
      ) as Record<string, unknown>,
    };
  }

  /**
   * Delete password-field values from the field-group instances of a
   * snapshot's component map, at every depth: through the field groups they
   * reference, by their own type where a dynamic zone's row names it, and
   * through those held inline in their containers. One walk with every other
   * password handler (`stripPasswordFieldValues`), so it cannot miss a place
   * the hash reaches. An instance whose fields are not known is dropped rather
   * than stored un-inspected. Mutates in place: on every path that reaches
   * here the component data has already been saved (promote) or will never be
   * saved (draft edit), so stripping the snapshot copy cannot affect a live
   * write.
   */
  private stripComponentPasswordsInPlace(
    components: Record<string, unknown>,
    schema: FieldConfig[],
    componentFields: Map<string, FieldConfig[]>
  ): void {
    stripPasswordFieldValues(components, schema, {
      fieldsOf: slug => componentFields.get(slug),
      direct: true,
    });
  }

  private async buildFullSnapshotRelations(
    tx: { getDrizzle<T = unknown>(): T },
    entryId: string,
    collectionName: string,
    parentTable: string,
    fields: FieldDefinition[],
    manyToManyFields: FieldDefinition[],
    locale?: string
  ): Promise<{
    components: Record<string, unknown>;
    manyToMany: Record<string, string[]>;
  }> {
    const { componentsByLocale, manyToMany } =
      await this.buildFullSnapshotRelationsByLocale(
        tx,
        entryId,
        collectionName,
        parentTable,
        fields,
        manyToManyFields,
        [locale]
      );
    return { components: componentsByLocale.get(locale) ?? {}, manyToMany };
  }

  /**
   * {@link buildFullSnapshotRelations} for several languages at once: each
   * component table is read once for them all, and the many-to-many values,
   * which every language shares, once. For a reader holding the row's lock,
   * so its reads do not multiply with the languages.
   */
  private async buildFullSnapshotRelationsByLocale(
    tx: { getDrizzle<T = unknown>(): T },
    entryId: string,
    collectionName: string,
    parentTable: string,
    fields: FieldDefinition[],
    manyToManyFields: FieldDefinition[],
    locales: readonly (string | undefined)[],
    /** Each language read exactly as stored, a removed one included. */
    exactLanguage = false
  ): Promise<{
    componentsByLocale: Map<string | undefined, Record<string, unknown>>;
    manyToMany: Record<string, string[]>;
  }> {
    const componentsByLocale = await readComponentSubtreesByLocale({
      fieldGroupDataService: this.fieldGroupDataService,
      tx: tx as TransactionContext,
      entryId,
      // Resolved parent table (custom `dbName` collections do not match
      // getTableName(slug)) so the read targets the right comp_ tables.
      parentTable,
      fieldConfigs: fields as unknown as FieldConfig[],
      // The write's locale, so a localized component is read back in the same
      // language it was just written in. Without it the read falls back to the
      // default component locale and the snapshot records values this write
      // never touched.
      locales,
      exactLanguage,
      reason: "version-snapshot-component-read",
      logContext: { collection: collectionName, entryId },
      onReadFailure: (err: unknown) =>
        // A version that looks complete but silently dropped a component is
        // worse than a failed, retriable write.
        this.logger.error(
          "Version snapshot: failed to read components; failing the write instead of capturing an incomplete snapshot",
          {
            collection: collectionName,
            entryId,
            error: err instanceof Error ? err.message : String(err),
          }
        ),
    });

    const manyToMany: Record<string, string[]> = {};
    const txExecutor = tx.getDrizzle<RelationshipDbExecutor>();
    for (const field of manyToManyFields) {
      try {
        // Read only the ids, straight from the junction on the write
        // transaction: a target created earlier in the same transaction is
        // invisible to a pooled target-row fetch (and would stall a
        // single-connection pool), so the snapshot must not depend on
        // materializing the target rows.
        manyToMany[field.name] =
          await this.relationshipService.fetchManyToManyTargetIds(
            collectionName,
            entryId,
            field,
            txExecutor
          );
      } catch (err) {
        // Same reasoning as the component read above.
        this.logger.error(
          "Version snapshot: failed to read many-to-many relations; failing the write instead of capturing an incomplete snapshot",
          {
            collection: collectionName,
            entryId,
            field: field.name,
            error: err instanceof Error ? err.message : String(err),
          }
        );
        throw NextlyError.internal({
          cause: err instanceof Error ? err : undefined,
          logContext: {
            reason: "version-snapshot-m2m-read",
            collection: collectionName,
            entryId,
            field: field.name,
          },
        });
      }
    }

    return { componentsByLocale, manyToMany };
  }

  /**
   * Serialize hasMany relationship arrays to JSON strings before insert/update.
   *
   * Code-first `relationship({ hasMany: true })` fields are stored as a JSON
   * column on the parent table (see runtime-schema-generator's `case "json"`).
   * SQLite uses a plain `text` column for JSON, so the caller must stringify;
   * PostgreSQL `jsonb` and MySQL `json` accept either a JS array or a string.
   * Unconditional stringification keeps all three dialects on the same path.
   *
   * Mutates `finalData` in place. Idempotent: arrays become strings; existing
   * strings (e.g. when the caller pre-serialized) are not double-encoded.
   */
  /**
   * Put every JSON-backed value (rich text, blocks, array, group, json) into
   * the form its column stores, in place.
   *
   * Its own method because more than one write path needs it and they must not
   * each decide which field types count: a path that serializes only some of
   * them hands the driver an object for a text-backed column, and SQLite
   * rejects the bind outright rather than coercing it. The localized split in
   * particular copies these values into the companion payload, so anything
   * unserialized here fails at the companion write instead of the main one,
   * where the cause is much harder to read.
   */
  /**
   * Everything a CREATE does to its payload between the last hook and the
   * write, and the three things it takes OUT of it.
   *
   * One implementation for the interactive create and the batch worker, which
   * ran the same eleven steps in the same order in two places. That is the
   * shape a step goes missing from: the JSON conversion was present in one and
   * absent in the other for exactly as long as the two lists were maintained
   * by hand, and a localized rich-text value reached its column unconverted as
   * a result.
   *
   * The three values come back rather than staying on `finalData` because none
   * of them has a column on the parent row — many-to-many links live in a
   * junction table and field groups in their own `comp_` tables — so leaving
   * any of them in place fails the insert.
   *
   * Generic in the field type so callers keep theirs: they go on to read
   * relationship properties off the returned list.
   */
  private async prepareCreateWritePayload<
    T extends {
      type: string;
      name: string;
      options?: { relationType?: string };
    },
  >(
    finalData: Record<string, unknown>,
    fields: T[],
    /** The write's transaction-bound executor, when it holds a connection. */
    executor?: unknown
  ): Promise<{
    manyToManyFields: T[];
    manyToManyData: Record<string, string[]>;
    componentFieldData: Record<string, unknown>;
  }> {
    // At every depth, through the field groups held inline in a container:
    // their passwords are stored in that container's value.
    const reach = await this.passwordReach(fields, executor);
    await hashPasswordFieldValues(finalData, fields, reach);

    // AFTER every mutating hook has run. A field-level
    // beforeValidate/beforeChange hook can (re)introduce an own
    // `status: undefined`, which names no status change but would otherwise be
    // sanitized to SQL NULL on the raw-parameter path — silently unpublishing
    // a published row, or nulling a create's draft default — without passing
    // the publish/unpublish gate. The last status-touching step before the
    // transition classification and the write, so the payload and the gate
    // agree even when a hook set the undefined.
    stripUndefinedStatus(finalData);

    // Before the many-to-many extraction and the JSON conversion, and walking
    // containers too: a reference left populated inside a group or repeater is
    // serialized into the row as JSON and never read back as a reference.
    normalizeRelationshipFields(finalData, fields as unknown as FieldConfig[]);
    normalizeUploadFields(
      finalData,
      fields as unknown as Parameters<typeof normalizeUploadFields>[1]
    );

    // Every repeater row gets its saved id, as `shapeWriteParts` gives an
    // update's: a create has nothing stored, so a row sent without one gets a
    // fresh id, and one sent twice keeps it only the first time. Before the
    // field groups placed on the entry go to their own tables, whose write
    // gives their rows ids.
    assignRepeaterRowIds(finalData, undefined, fields, reach);

    // Only a UI-built many-to-many routes through a junction table. Code-first
    // `hasMany: true` is a JSON array on the parent column, and is converted
    // with the other JSON values instead.
    const manyToManyFields = fields.filter(
      f => f.type === "relationship" && f.options?.relationType === "manyToMany"
    );
    const manyToManyData: Record<string, string[]> = {};
    for (const field of manyToManyFields) {
      if (finalData[field.name]) {
        manyToManyData[field.name] = Array.isArray(finalData[field.name])
          ? (finalData[field.name] as string[])
          : [finalData[field.name] as string];
        delete finalData[field.name];
      }
    }

    const componentFieldData = this.extractComponentFieldData(
      finalData,
      fields as unknown as Parameters<typeof this.extractComponentFieldData>[1]
    );
    return { manyToManyFields, manyToManyData, componentFieldData };
  }

  private serializeJsonFieldValues(
    data: Record<string, unknown>,
    // `hasMany`/`relationTo` are what tell a relationship that stores an array
    // apart from one that stores a single id, which decides whether its value
    // is JSON-backed at all.
    fields: {
      type: string;
      name: string;
      hasMany?: boolean;
      relationTo?: unknown;
    }[]
  ): void {
    for (const field of fields) {
      if (isJsonFieldType(field.type, field) && data[field.name] != null) {
        data[field.name] = toJsonColumnValue(data[field.name]);
      }
    }
  }

  private serializeHasManyRelationships(
    finalData: Record<string, unknown>,
    fields: { type: string; name: string; hasMany?: boolean }[]
  ): void {
    for (const field of fields) {
      if (
        isRelationshipField(field.type) &&
        field.hasMany &&
        Array.isArray(finalData[field.name])
      ) {
        finalData[field.name] = JSON.stringify(finalData[field.name]);
      }
    }
  }

  /**
   * Redact a persisted entry before it is returned to the client. Drops
   * write-only password hashes and any field the caller may write but not
   * read (`access.read`). The query path already applies both, so every
   * mutation response must run the same redaction or a create/update could
   * echo back a value the reader is denied — the write and read rules are
   * independent, so a field can be writable yet read-denied.
   *
   * `overrideAccess` normally skips read redaction (a trusted server-context
   * caller asked for the full document). The REST dispatcher, however, sets
   * `overrideAccess` only to skip the collection-level re-check after route
   * auth — it is NOT a trusted read context, so `routeAuthorized` forces the
   * response to still be redacted to what the authenticated user may read,
   * matching the query path for the same caller.
   */
  private async redactResponseFields(
    entry: Record<string, unknown>,
    fields: FieldDefinition[],
    params: {
      user?: Record<string, unknown>;
      overrideAccess?: boolean;
      routeAuthorized?: boolean;
      /** A scoped API key's own grants, which its rules are judged by. */
      authenticatedScope?: AuthenticatedScope;
    },
    slug: string,
    /**
     * The physical table the entry was written to. Separate from `slug`
     * because a `dbName` collection's table is not `dc_<slug>`, and the
     * hidden columns contributed to it are keyed by the physical name.
     */
    tableName: string,
    /**
     * The transaction-bound executor when the response is redacted while the
     * write still holds its connection, so the rules' lookups read on it
     * rather than wait on the pool for the connection it holds.
     */
    executor?: unknown
  ): Promise<void> {
    // Deserialize JSON-stored containers (group/repeater/json/chips/hasMany)
    // before redaction so the read-access walker descends into them — SQLite
    // returns these as JSON strings, and a read-denied field nested in a
    // still-serialized container would otherwise be echoed. The single
    // create/update paths already deserialize upstream; this makes the
    // transaction/bulk variants safe too (a second pass is a no-op).
    for (const field of fields) {
      if (
        isJsonFieldType(field.type, field) &&
        typeof entry[field.name] === "string" &&
        entry[field.name]
      ) {
        try {
          entry[field.name] = JSON.parse(entry[field.name] as string);
        } catch {
          // If parsing fails, keep the raw string.
        }
      }
    }
    stripPasswordFieldValues(
      entry,
      fields,
      await this.passwordReach(fields, executor)
    );
    // Strip the system owner column so a mutation response (e.g. an admin or
    // role-based updater) does not echo the row creator's user id. Owner-only
    // access reads it from SQL, never from the returned row.
    stripServerOnlyColumns(entry, tableName);
    const trusted = params.overrideAccess && !params.routeAuthorized;
    // One resolver for both passes: one authority, and one lookup, shared by
    // every item a bulk write redacts inside its transaction. A key's grants
    // travel on its scope and are read from nowhere, so they are not shared.
    const userId = typeof params.user?.id === "string" ? params.user.id : "";
    const makeGrants = () =>
      this.callerGrants(params.user, params.authenticatedScope, executor);
    const grants =
      params.authenticatedScope?.actorType === "apiKey"
        ? makeGrants()
        : sharedPerTransaction(executor, `grants:${userId}`, makeGrants);
    await applyFieldReadAccess({
      kind: "collection",
      slug,
      entry,
      user: params.user,
      overrideAccess: trusted,
      grants,
    });
    // The fields inside the field groups the entry holds, by their own rules,
    // as a read of the document would judge them: a response never echoes a
    // field-group value the writer may not read.
    // The schemas are resolved once per transaction for each collection.
    const service = this.fieldGroupDataService;
    if (!trusted) {
      const fieldGroupPass = await sharedPerTransaction(
        executor,
        `fieldGroupReadPass:${slug}`,
        () =>
          liveFieldGroupReadPass(
            fields as FieldConfig[],
            service && {
              getComponentFields: componentSlug =>
                service.getComponentFields(componentSlug, executor),
            }
          )
      );
      await fieldGroupPass?.(entry, {
        user: params.user,
        authenticatedScope: params.authenticatedScope,
        grants,
      });
    }
  }

  /**
   * Read the metadata every write path needs: the collection config, its
   * resolved field list, its stored (UI-configured) hooks, and its table name.
   *
   * The field list is read from `schemaDefinition.fields` and falls back to
   * `fields`, in that order, because a code-first collection and one built in
   * the UI carry it in different places.
   *
   * Pass `executor` when the caller owns a transaction, so this read is bound
   * to that transaction's connection rather than re-entering the pool from
   * inside it — which can stall against a small pool.
   */
  private async readCollectionWriteMeta(
    collectionName: string,
    executor?: Parameters<DynamicCollectionService["getCollection"]>[1]
  ): Promise<{
    collection: unknown;
    fields: FieldDefinition[];
    storedHooks: ReturnType<CollectionHookService["getStoredHooks"]>;
    tableName: string;
  }> {
    const collection = await this.collectionService.getCollection(
      collectionName,
      executor
    );
    const fields =
      ((
        (collection as Record<string, unknown>).schemaDefinition as
          | Record<string, unknown>
          | undefined
      )?.fields as FieldDefinition[]) ||
      ((collection as Record<string, unknown>).fields as FieldDefinition[]) ||
      [];
    return {
      collection,
      fields,
      storedHooks: this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      ),
      tableName: collectionTableName(collection, collectionName),
    };
  }

  /**
   * Wrapper around checkFieldUniqueness that matches the QueryDatabaseParams
   * signature expected by CollectionHookService.buildPrebuiltHookContext.
   */
  private readonly queryDatabaseFn = async (
    params: QueryDatabaseParams
  ): Promise<boolean> => {
    return this.checkFieldUniqueness(
      params.collection,
      params.field,
      params.value,
      params.caseInsensitive || false,
      params.excludeId,
      params.executor
    );
  };

  // ============================================================
  // Field Uniqueness Check
  // ============================================================

  /**
   * Check if a field value already exists in a collection.
   *
   * Used by stored hooks for uniqueness validation. Can optionally exclude a specific document
   * (useful for update operations where we want to exclude the current document).
   *
   * @param collectionName - Name of the collection to query
   * @param field - Field name to check for uniqueness
   * @param value - Value to check for duplicates
   * @param caseInsensitive - Whether to perform case-insensitive comparison
   * @param excludeId - Optional document ID to exclude from the check (for updates)
   * @returns Promise<boolean> - true if a duplicate exists, false otherwise
   */
  async checkFieldUniqueness(
    collectionName: string,
    field: string,
    value: unknown,
    caseInsensitive: boolean = false,
    excludeId?: string,
    // Optional transaction-bound executor so the uniqueness read runs on the
    // caller's transaction connection (a stored unique-validation hook firing
    // inside a caller-owned transaction) instead of the pool; defaults to it.
    executor?: unknown
  ): Promise<boolean> {
    try {
      // Load the schema for this collection
      // Forward the executor so an uncached runtime-schema load (UI collection)
      // stays on the caller's transaction connection rather than the pool.
      const schema = await this.fileManager.loadDynamicSchema(
        collectionName,
        executor
      );

      // Check if the field exists in the schema
      if (!schema[field]) {
        this.logger.warn(
          `Field ${field} does not exist in collection ${collectionName}`
        );
        return false;
      }

      // Build the query. Runs on the caller's transaction connection when an
      // executor is supplied so this read does not re-enter the pool from inside
      // the transaction; falls back to the pooled connection otherwise.
      const db = executor ?? this.db;
      let query = db.select().from(schema);

      // Build the WHERE condition
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle SQL condition accumulator
      const conditions: any[] = [];

      // Add field value condition (case-sensitive or case-insensitive)
      if (caseInsensitive && typeof value === "string") {
        // Use ILIKE for PostgreSQL, LIKE for others (MySQL/SQLite are case-insensitive by default)
        const dialect = this.adapter?.dialect || "postgresql";
        if (dialect === "postgresql") {
          conditions.push(ilike(schema[field], value));
        } else {
          conditions.push(like(schema[field], value));
        }
      } else {
        // Case-sensitive comparison
        conditions.push(eq(schema[field], value));
      }

      // Exclude the current document ID if provided (for update operations)
      if (excludeId && schema.id) {
        conditions.push(ne(schema.id, excludeId));
      }

      // Apply all conditions
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      // Limit to 1 result since we only need to know if any match exists
      query = query.limit(1);

      // Execute the query
      const results = await query;

      // Return true if any matching document exists
      return results.length > 0;
    } catch (error: unknown) {
      this.logger.error(
        `Error checking field uniqueness for ${field} in ${collectionName}`,
        {
          error: error instanceof Error ? error.message : String(error),
          field,
          collectionName,
        }
      );
      // On error, return false to allow the operation to proceed
      // The actual validation error will be caught elsewhere
      return false;
    }
  }

  // ============================================================
  // Public CRUD Methods
  // ============================================================

  /**
   * Fill the auto-injected `slug` and `title` columns on a create payload.
   *
   * defineCollection injects a required, unique `slug` and a NOT NULL `title`
   * into every collection. When the caller omits them we derive them here: the
   * slug from the title (or name, or a unique fallback token), the title from
   * the name or the slug.
   *
   * A GENERATED slug is deduped so a repeated title auto-increments (`hello`,
   * `hello-2`, …) — the WordPress/Ghost convention. An EXPLICITLY provided slug
   * is only sanitized and kept as-is: the caller asserted a canonical value, so
   * a collision surfaces as the normal unique-constraint conflict rather than a
   * silent rename. `isSlugTaken` is supplied by the caller so the uniqueness
   * check runs on the correct executor — the shared connection for a plain
   * create, or the enclosing transaction (which sees its own pending rows) for
   * a transactional create. Runs before field-level write access so a caller
   * denied `title`/`slug` write does not have them reintroduced. Mutates
   * `finalData`.
   */
  private async applyGeneratedSlugAndTitle(
    finalData: Record<string, unknown>,
    isSlugTaken: (slug: string) => Promise<boolean>,
    collectionName: string
  ): Promise<void> {
    const provided =
      typeof finalData.slug === "string" && finalData.slug.trim() !== "";
    if (provided) {
      // Explicit slug: sanitize only, never dedupe — respect the caller's value.
      // Not refused here: this runs before field write access, and a caller
      // whose slug write is denied must not be told what was wrong with it.
      // A path that cannot be stored is kept as given and refused by
      // `reSanitizeSlug`, after access.
      const sanitized = this.slugAsStored(
        collectionName,
        finalData.slug as string,
        false
      );
      // generateSlug strips everything outside [\w-], so an explicit slug of
      // only non-ASCII/punctuation (e.g. "你好") sanitizes to empty. Treat that
      // as unset and derive a valid, unique slug instead of persisting "".
      finalData.slug =
        sanitized !== ""
          ? sanitized
          : await this.deriveSlug(finalData, isSlugTaken);
    } else {
      finalData.slug = await this.deriveSlug(finalData, isSlugTaken);
    }

    // The `title` column is NOT NULL: fall back to the name, then the slug.
    if (typeof finalData.title !== "string" || finalData.title.trim() === "") {
      const nameValue = finalData.name;
      finalData.title =
        typeof nameValue === "string" && nameValue.trim()
          ? nameValue.trim()
          : finalData.slug;
    }
  }

  /**
   * Derive a unique slug from the title (or name), falling back to a
   * collision-proof token. `generateSlug` strips everything outside [\w-], so a
   * CJK/emoji/punctuation-only title (or a missing one) yields an empty base;
   * the `entry-<ts>-<rand>` fallback keeps the required, unique `slug` column
   * populated instead of failing required-field validation.
   */
  private async deriveSlug(
    finalData: Record<string, unknown>,
    isSlugTaken: (slug: string) => Promise<boolean>
  ): Promise<string> {
    const titleValue = finalData.title ?? finalData.name ?? "";
    const derived =
      typeof titleValue === "string" && titleValue.trim()
        ? generateSlug(titleValue)
        : "";
    const baseSlug =
      derived !== ""
        ? derived
        : `entry-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    return this.dedupeSlug(baseSlug, isSlugTaken);
  }

  /**
   * Re-sanitize `slug` after field-level beforeValidate hooks run. Those hooks
   * execute after slug generation, so a hook that sets `slug` (for example from
   * the title) could introduce an unsanitized value that would otherwise be
   * validated and stored verbatim. Normalizing here keeps the stored slug
   * URL-safe; it is idempotent for an already-clean slug. When the hook value
   * sanitizes to empty (a CJK/emoji/punctuation-only string), it derives a
   * valid slug from the title just like `applyGeneratedSlugAndTitle` does for
   * an explicit slug that sanitizes away, rather than leaving the un-sanitized
   * value to be stored verbatim.
   */
  private async reSanitizeSlug(
    finalData: Record<string, unknown>,
    isSlugTaken: (slug: string) => Promise<boolean>,
    collectionName: string
  ): Promise<void> {
    // Respect an ABSENT slug. Field-level write access deletes the key when it
    // denies the write, so `undefined` means "stripped by access" (or never
    // set): leave it so access control holds and required validation applies —
    // deriving would smuggle a slug back past access. Slug generation for a
    // create with no user-supplied slug already ran in applyGeneratedSlugAndTitle
    // (before write access), so a legitimately-absent-here slug is intentional.
    if (finalData.slug === undefined) return;
    // The field is PRESENT (a user provided it and passed access, or a hook set
    // it). Normalize a string; a non-string or empty/non-URL-safe value (e.g.
    // "你好", "   ", null) sanitizes to "" and is derived from the title rather
    // than persisting an invalid slug — required validation permits empty
    // strings, so it would not catch it, and this mirrors the empty fallback in
    // applyGeneratedSlugAndTitle.
    const current = finalData.slug;
    const sanitized =
      typeof current === "string"
        ? this.slugAsStored(collectionName, current, true)
        : "";
    finalData.slug =
      sanitized !== ""
        ? sanitized
        : await this.deriveSlug(finalData, isSlugTaken);
  }

  /**
   * `raw` as `collectionName` stores a slug: one segment, normalised by
   * {@link generateSlug}, or, where the collection's `db.slugPaths` is on, a
   * path of several, each normalised alike ({@link normalizeSlugPath}). A
   * path that cannot be stored is refused as a validation error on `slug`
   * when `refuse` is set, in words an author can act on, and is otherwise
   * returned as given for a later pass to refuse.
   */
  private slugAsStored(
    collectionName: string,
    raw: string,
    refuse: boolean
  ): string {
    if (collectionDbOptions(collectionName).slugPaths !== true) {
      return generateSlug(raw);
    }
    const read = normalizeSlugPath(raw);
    if ("slug" in read) return read.slug;
    if (!refuse) return raw;
    throw NextlyError.validation({
      errors: [{ path: "slug", code: "INVALID_FORMAT", message: read.problem }],
    });
  }

  /**
   * Return a slug that is free, appending `-2`, `-3`, … until `isSlugTaken`
   * reports it available. Bounded so a pathological data set can't spin
   * forever; the final fallback appends a timestamp that is effectively
   * collision-proof. The unique constraint on the column remains the ultimate
   * guard against a concurrent race between the check and the insert.
   */
  private async dedupeSlug(
    baseSlug: string,
    isSlugTaken: (slug: string) => Promise<boolean>
  ): Promise<string> {
    let candidate = baseSlug;
    for (let suffix = 2; suffix <= 51; suffix++) {
      if (!(await isSlugTaken(candidate))) return candidate;
      candidate = `${baseSlug}-${suffix}`;
    }
    // Check the last generated candidate (`baseSlug-51`) before the fallback.
    if (!(await isSlugTaken(candidate))) return candidate;
    return `${baseSlug}-${Date.now()}`;
  }

  /**
   * Create a new entry.
   * Applies collection-level access control and hooks.
   *
   * Security checks are applied in order:
   * 1. Collection-level access (the RBAC gate)
   *
   * @param params - Collection name and optional user context
   * @param body - Entry data to create
   * @returns Created entry or error
   */
  async createEntry(
    params: {
      collectionName: string;
      user?: UserContext;
      /**
       * Who performed the write, recorded on the outbox event. Set by the
       * transport; absent for internal writes, which record as `system`.
       */
      actor?: RequestActor;
      overrideAccess?: boolean;
      /**
       * Which collections a trusted read may reach as relationships are expanded.
       * Absent means every populated target inherits the caller's trust. Only ever
       * narrows. See {@link RelatedRowReadContext.trusted}.
       */
      trusted?: TrustBound;
      /** Write locale (i18n M5): translatable values are stored for this language. */
      locale?: string;
      // Set by the REST dispatcher: route-level authorization already ran, so
      // the collection re-check is skipped, but the response is still redacted
      // to what this user may read (this is not a trusted-server read).
      routeAuthorized?: boolean;
      context?: Record<string, unknown>;
      /** The HTTP request behind this operation, when one produced it. */
      request?: Request;
      // The caller's authenticated scope. For a scoped API-key REST create the
      // publish transition gate (a create-as-published) judges the key's OWN
      // grants — the route only authorized `create` against the key's scope.
      authenticatedScope?: AuthenticatedScope;
    },
    body: Record<string, unknown>,
    depth?: number
  ): Promise<CollectionServiceResult> {
    // Refused first when the collection is removed from code, before any hook
    // or read of the entry, so a refused write changes nothing.
    await refuseWriteIfRemovedFromCode("collection", params.collectionName);
    // A version sent with the body is the server's to decide; see updateEntry.
    body = withoutDocumentVersionKeys(body);
    // Set once the outbox event is appended (below), so the catch can report a
    // committed-but-hook-failed write as `eventRecorded` even when `success` is
    // false. Declared out here so both the success and catch returns see it.
    let eventRecorded = false;
    // Set once the insert transaction commits, independent of whether the write
    // recorded an event or produced a revalidation intent — the durable-write
    // signal the retention pass keys off, so a create that opts out of BOTH still
    // triggers write-path cleanup.
    let committedWrite = false;
    // Computed alongside the event so a committed-but-hook-failed write (which
    // returns from the catch) still flushes its revalidation, matching how
    // `eventRecorded` is carried.
    let revalidationIntent: RevalidationIntent | undefined;
    try {
      // reject an unknown write locale before doing anything else.
      const badLocale = this.rejectInvalidWriteLocale(params.locale);
      if (badLocale) return badLocale;

      const accessUser = params.overrideAccess ? undefined : params.user;

      // 1. Check collection-level access FIRST
      const accessDenied = await this.accessService.checkCollectionAccess({
        collectionName: params.collectionName,
        operation: "create",
        user: accessUser,
        overrideAccess: params.overrideAccess,
        routeAuthorized: params.routeAuthorized,
        // A scoped API key is judged on its own grants here too, so the session
        // super-admin bypass does not apply to it on the create gate.
        authenticatedScope: params.authenticatedScope,
      });
      if (accessDenied) {
        return accessDenied;
      }

      // Get collection metadata to identify relation fields and hooks
      // Note: For create operations, we use the adapter directly with the table name,
      // so we don't need the Drizzle schema. The fields metadata from the collection
      // is sufficient for data processing (JSON serialization, date conversion, etc.)
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const { fields, storedHooks, tableName, sharedContext, requestFacts } =
        this.operationSetup(collection, params);

      // Execute beforeOperation hooks FIRST (before operation-specific hooks)
      // Can modify operation arguments or throw to abort
      // Declared defaults are seeded before the first hook phase, so every hook
      // — beforeOperation included — sees the values the entry will hold, and a
      // hook that removes a defaulted field is not overridden by a later pass
      // re-adding it. Seeded onto a copy so the caller's own object is not
      // mutated. Everything after this point (generation, write access,
      // validation, the insert) therefore works from complete data; generation
      // still fills only the identity fields left unresolved, and running ahead
      // of write access matches generation, so a field the caller may not
      // create is not reintroduced.
      const seededBody: Record<string, unknown> = { ...body };
      // One resolver for both write-access passes over this record, so the
      // caller's roles and permissions are read once and both judge with one
      // authority.
      const writeGrants = this.callerGrants(
        params.user,
        params.authenticatedScope
      );
      // What a function default is allowed to READ, which is not the same as
      // what this write is allowed to STORE.
      //
      // A function default receives the data built so far, and that data still
      // holds every value the caller sent, including one a field rule denies
      // them. Left alone, a default could read the forbidden value and carry it
      // into a field the caller IS allowed to write: the denied field would be
      // stripped below and its value persisted anyway, one column across.
      //
      // So the rules are applied to a COPY, and the copy is what the functions
      // read. Applying them to the record itself would be wrong in the other
      // direction: a rule may depend on a sibling the caller omitted BECAUSE it
      // has a default (`data.kind === "public"` where `kind` defaults to
      // `public`), and judging that rule before the defaults exist denies it.
      // Deleting the value then would lose it for good, since the pass that
      // decides correctly runs after the defaults and has nothing left to keep.
      // A DEEP copy. The rules delete a denied value in place, and a shallow
      // copy shares every nested group, repeater row and component with the
      // record: the deletion would land on the record too, which is the data
      // loss this whole arrangement exists to avoid, one level down.
      const readableByDefaults = detachData(seededBody);
      const fieldFunctions = getFieldFunctions(
        "collection",
        params.collectionName
      );
      await this.applyCreateFieldRules(params, readableByDefaults, writeGrants);
      // The view is defaulted BEFORE it is judged a second time, and both
      // halves matter.
      //
      // Defaulted, because a rule may depend on a sibling the caller omitted
      // because it has a default, and a view judged without it hides a value
      // the caller may in fact write.
      //
      // Judged again, because a default of its own is a value like any other:
      // a field the caller may not write still takes its declared default
      // here, and left in the view a later function default would read it and
      // carry it into a field they CAN write. The pass below removes the field
      // it came from and keeps the copy, so the rule is defeated one column
      // across.
      //
      // These fill the view only. The record is filled from it afterwards, so
      // a default the rules removed here is one the record's own pass will not
      // put back.
      applyFieldDefaults(readableByDefaults, fields, fieldFunctions);
      await this.applyCreateFieldRules(params, readableByDefaults, writeGrants);
      // The stored fields carry constant defaults; a function default exists
      // only in the live config, which the registry captured at boot.
      applyFieldDefaults(
        seededBody,
        fields,
        fieldFunctions,
        readableByDefaults
      );

      const beforeOpArgs =
        await this.hookService.hookRegistry.executeBeforeOperation({
          collection: params.collectionName,
          operation: "create",
          args: { data: seededBody },
          user: params.user
            ? { id: params.user.id, email: params.user.email }
            : undefined,
          context: sharedContext,
          req: requestFacts,
        });

      // Use modified data if returned by beforeOperation. A hook returning its
      // own object owns what is in it, defaults included — they are not
      // re-applied here, or a hook could never drop one.
      const currentData =
        (beforeOpArgs as BeforeOperationArgs)?.data ?? seededBody;

      // Execute beforeCreate hooks (code-registered)
      // Hooks run before validation and can modify the incoming data
      const beforeContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "create" as const,
        data: currentData,
        user: params.user,
        context: sharedContext,
        req: requestFacts,
      });

      const modifiedData = await this.hookService.hookRegistry.execute(
        "beforeCreate",
        beforeContext
      );
      const dataAfterCodeHooks = (modifiedData ?? currentData) as Record<
        string,
        unknown
      >;

      // Execute stored beforeCreate hooks (UI-configured)
      // Runs after code hooks, can further modify data
      const storedBeforeResult =
        await this.hookService.storedHookExecutor.execute(
          "beforeCreate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext({
            collection: params.collectionName,
            operation: "create",
            data: dataAfterCodeHooks,
            queryDatabase: this.queryDatabaseFn,
            user: params.user,
            sharedContext,
            req: requestFacts,
          })
        );
      const finalData = (storedBeforeResult.data ??
        dataAfterCodeHooks) as Record<string, unknown>;

      // Password fields store bcrypt hashes, never the submitted value.
      // Runs after hooks (so hooks see the plaintext they may validate
      // against) and before any serialization touches the column value.
      // Enforce the schema's declared rules on the server. Every writer
      // (admin, REST, Direct API, bulk, forms) funnels through this path,
      // so this is where required/min/max/pattern/options are guaranteed;
      // runs on the post-hook data and before hashing so password rules
      // see the plaintext length, not the hash's.
      // Generate the auto-injected `slug`/`title` BEFORE field-level write
      // access and validation. defineCollection injects a required, unique
      // `slug` and a NOT NULL `title`; deriving them here (slug from title,
      // deduped for uniqueness) lets `create({ data: { title } })` succeed
      // without a manual slug. Running before write access means a field the
      // caller may not create is not reintroduced; the uniqueness check uses
      // the shared connection (a plain, non-transactional create).
      const isSlugTaken = (slug: string) =>
        this.checkFieldUniqueness(params.collectionName, "slug", slug);
      await this.applyGeneratedSlugAndTitle(
        finalData,
        isSlugTaken,
        params.collectionName
      );

      // Field-level access: fields the caller may not create are stripped
      // silently (Payload parity); overrideAccess bypasses.
      await this.applyCreateFieldRules(params, finalData, writeGrants);
      // The field groups this entry stores inline, inside its groups and
      // repeaters, by their own rules: no field-group save reaches them.
      await this.judgeInlineFieldGroups({
        data: finalData,
        fields,
        params,
        grants: writeGrants,
      });

      // Field-level beforeValidate hooks transform values ahead of the
      // validation gate (functions resolved via the field-level registry).
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "beforeValidate",
        data: finalData,
        operation: "create",
        user: params.user,
      });

      // A beforeValidate hook can set `slug` after generation ran; re-sanitize
      // so the validated and stored value stays URL-safe.
      await this.reSanitizeSlug(finalData, isSlugTaken, params.collectionName);

      {
        // i18n M5b: `required` on a localized field is enforced only for the default-locale write;
        // other locales fall back, so the canonical validator gets the localized-field set and
        // whether this write's locale must enforce them.
        const localeCtx = await this.localizedRequiredContext(
          params.collectionName,
          params.locale
        );
        await this.assertEntryValid({
          data: finalData,
          fields,
          collectionName: params.collectionName,
          mode: "create",
          user: params.user,
          reader: params,
          localeCtx,
          ...(params.locale === undefined
            ? {}
            : { writeLocale: params.locale }),
          // No transaction yet, so stored rows are read on the pool: no row
          // of this write exists for a read to miss.
        });
      }

      // Collection-level beforeChange hooks, on data the validation gate has
      // just passed. Paired with the field-level phase below so the two
      // declarations of that name mean the same moment. What the hooks leave
      // behind is judged after the field-level phase — a hook write is a
      // write the gate never saw.
      await this.hookService.runBeforeChange({
        collection: params.collectionName,
        operation: "create",
        data: finalData,
        storedHooks,
        queryDatabase: this.queryDatabaseFn,
        user: params.user,
        sharedContext,
        req: requestFacts,
      });

      // Field-level beforeChange hooks transform the final stored value
      // (runs after validation, before hashing/serialization).
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "beforeChange",
        data: finalData,
        operation: "create",
        user: params.user,
      });

      // The whole-number floor judges what the hooks changed: a fraction a
      // hook produced would reach the integer column and let the database
      // decide, on every verb this gate guards.
      const hookIssues = hookChangedWholeNumberIssues(
        finalData,
        fields,
        "",
        await this.hookWalkComponentResolver(fields)
      );
      if (hookIssues.length > 0) {
        throw NextlyError.validation({ errors: hookIssues });
      }

      // A beforeChange hook runs after validation and can also set `slug`;
      // re-sanitize once more so the stored value stays URL-safe.
      await this.reSanitizeSlug(finalData, isSlugTaken, params.collectionName);

      const { manyToManyFields, manyToManyData, componentFieldData } =
        await this.prepareCreateWritePayload(finalData, fields);

      this.serializeHasManyRelationships(finalData, fields);

      // Normalize relationship data inside repeater/group fields before serialization.
      // The admin panel may send full relationship objects ({id, title, slug, ...})
      // inside repeater rows — strip these down to just IDs to prevent bloated JSON.
      fields.forEach(field => {
        if (
          (field.type === "repeater" || field.type === "group") &&
          finalData[field.name] != null &&
          typeof finalData[field.name] === "object"
        ) {
          const nestedFields = field.fields || [];
          if (
            nestedFields.some(
              f =>
                isRelationshipField(f.type) ||
                f.type === "repeater" ||
                f.type === "group"
            )
          ) {
            if (
              field.type === "repeater" &&
              Array.isArray(finalData[field.name])
            ) {
              finalData[field.name] = (finalData[field.name] as unknown[]).map(
                (row: unknown) =>
                  row && typeof row === "object" && !Array.isArray(row)
                    ? normalizeNestedRelationships(
                        row as Record<string, unknown>,
                        nestedFields
                      )
                    : row
              );
            } else if (
              field.type === "group" &&
              !Array.isArray(finalData[field.name])
            ) {
              finalData[field.name] = normalizeNestedRelationships(
                finalData[field.name] as Record<string, unknown>,
                nestedFields
              );
            }
          }
        }
      });

      this.serializeJsonFieldValues(finalData, fields);

      // Convert date-field strings into `Date` objects so Drizzle can bind
      // them to `timestamp` columns. See `coerceDateFieldsToDate` for the
      // failure mode this guards against.
      coerceDateFieldsToDate(finalData, fields);

      // slug/title are generated before validation (applyGeneratedSlugAndTitle).

      // Final safety pass: ensure upload field values are IDs, not populated objects.
      fields.forEach(field => {
        if (field.type === "upload" && finalData[field.name] != null) {
          const val = finalData[field.name];
          if (typeof val === "object" && val !== null && !Array.isArray(val)) {
            finalData[field.name] =
              "id" in val &&
              typeof (val as Record<string, unknown>).id === "string"
                ? (val as Record<string, unknown>).id
                : null;
          } else if (Array.isArray(val)) {
            finalData[field.name] = val.map((item: unknown) =>
              typeof item === "string"
                ? item
                : typeof item === "object" && item !== null && "id" in item
                  ? (item as Record<string, unknown>).id
                  : item
            );
          }
        }
      });

      // Prepare entry data (excluding many-to-many fields)
      // Convert camelCase field names to snake_case column names for the database.
      // The adapter uses data keys directly as column names in SQL, so they must
      // match the actual database column naming convention (snake_case).
      // Store timestamps as Date objects. Drizzle handles conversion per dialect:
      // - PostgreSQL: timestamp with timezone
      // - MySQL: datetime
      // - SQLite: integer (unix timestamp via mode:"timestamp")
      // Using Date objects (not ISO strings) because SQLite's integer mode
      // calls .getTime() which fails on strings.

      const now = new Date();
      const rawEntryData = {
        // The collection's own id decision: which generator, and whether a
        // client-supplied id is accepted at all. Read BEFORE the strip below,
        // which removes `id` along with every other client-supplied system
        // column — that strip is what made `allowIdOnCreate` unexpressible.
        id: resolveEntryId(
          collectionDbOptions(params.collectionName),
          finalData.id
        ),
        // Strip client-supplied system columns (id / timestamps / created_by,
        // both snake and camel) so the generated id, stamped owner, and
        // timestamps below are authoritative — a stray `createdBy` alias can't
        // survive to overwrite the owner stamp. Columns a schema hook
        // contributed to this table go too: their contributor writes them.
        ...stripImmutableSystemFields(
          finalData,
          "collection",
          tableName,
          fields
        ),
        created_at: now,
        updated_at: now,
        // Stamp the row owner with the creating user's id, so a consumer can
        // tell who made the row. Null for system/seed creates (no user context).
        created_by: params.user?.id ?? null,
      };
      const entryData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rawEntryData)) {
        entryData[toSnakeCase(key)] = value;
      }
      // Who created it is the document's first changer, at the moment it was
      // created; its counter starts at the column default, 1.
      Object.assign(
        entryData,
        changerColumns(actorForWrite(params.actor, params.user)),
        { _changed_at: now }
      );

      // A create has no prior status, so landing on published IS a first publication. Read from
      // the post-hook `finalData`: a hook that derives `status: "published"`, or a status the
      // caller could not write itself, must stamp the value actually stored. Taken before the
      // locale split, which strips `status` from a non-default-locale main payload.
      const createStamp = resolveFirstPublishedStamp({
        hasStatus: (collection as { status?: boolean }).status === true,
        previousStatus: null,
        nextStatus: finalData.status,
        existingMarker: null,
        now,
      });
      if (createStamp) {
        entryData.first_published_at = createStamp;
      }

      // Authorize the published state this create will persist, judged on the
      // post-hook `finalData` rather than the raw body: a beforeCreate/stored
      // hook that derives `status: "published"`, or a status field the caller
      // may not write (stripped by field-write-access above), must be gated on
      // the value actually stored. A create has no prior status, so landing
      // directly on published is a publish and needs `publish-<slug>` on top of
      // create. Read before the locale split below removes `status` from the
      // non-default-locale main payload.
      const createTransitionDenied = await this.checkStatusTransitionAccess({
        collectionName: params.collectionName,
        collectionHasStatus:
          (collection as { status?: boolean }).status === true,
        previousStatus: null,
        nextStatus: finalData.status,
        accessUser,
        overrideAccess: params.overrideAccess,
        authenticatedScope: params.authenticatedScope,
      });
      if (createTransitionDenied) {
        return createTransitionDenied;
      }

      // i18n M5: for a localized collection, pull translatable columns out of the main insert
      // (the migrated main table no longer has them) so they can be written to the companion
      // row for the write's locale, inside the same transaction. `null` = not localized /
      // companion not migrated yet (localized cols stay on main — dev path, unchanged).
      const localizedWrite = await this.splitLocalizedWriteData(
        params.collectionName,
        entryData,
        params.locale,
        true
      );

      // Wrap entry insert and component data save in a transaction so that
      // a component save failure rolls back the entry — no partial state.
      // Resolved versioning config persisted on the collection (or null when
      // unversioned); read once so the in-tx capture below can skip cheaply.
      const versionsConfig = (collection as Record<string, unknown>)
        .versions as ResolvedVersionsConfig | null | undefined;

      // Resolved BEFORE the transaction opens. Expansion reads component
      // definitions from the registry on the pooled connection, and doing that
      // inside the transaction would hold this write's connection while waiting
      // for a second one. It depends only on static field config, so nothing is
      // gained by deferring it. Skipped entirely when the collection opted out.
      const webhookFields = await this.webhookFieldTreeIfRecording(
        params.collectionName,
        fields
      );

      const entry: Record<string, unknown> = {};
      // Whether the outbox event was actually appended (false when the
      // collection opted out of recording), so the post-commit fast drain is
      // scheduled only for a write that recorded something.
      let recorded = false;
      let createdVersion: string | undefined;
      // Verify every localized field group in this payload can actually be written
      // BEFORE the transaction opens. Inside it the probes would borrow a second
      // connection and deadlock a single-connection pool, and a NextlyError raised in
      // the callback is reclassified by the adapter into an opaque database error —
      // so the actionable 409 would never reach the caller.
      await this.fieldGroupDataService?.assertLocalizedFieldGroupsWritable({
        fields: fields as unknown as FieldConfig[],
        data: componentFieldData,
        locale: params.locale,
      });
      // The in-transaction handlers, asked once for this write.
      const inTransactionHandlers = this.inTransactionHandlersFor(
        params.collectionName
      );
      // Read committed when a handler runs; see `writeTransactionOptions`.
      const transactionOptions = this.writeTransactionOptions(
        inTransactionHandlers
      );
      await this.adapter.transaction(async tx => {
        const rawEntry = await tx.insert<unknown>(tableName, entryData, {
          returning: "*",
        });

        // Convert snake_case keys from DB response back to camelCase field names
        // so hooks and the API response use the original field names. The
        // per-document columns are no field and are never handed on: the
        // version is published as `_rev` below.
        for (const [key, value] of Object.entries(
          withoutDocumentVersionKeys(rawEntry as Record<string, unknown>)
        )) {
          entry[toCamelCase(key)] = value;
        }

        // i18n M5: write the translatable values to the companion `_locales` row for the
        // write's locale (same transaction → rolls back with the main insert).
        if (localizedWrite) {
          await this.insertCompanionRow(
            tx,
            localizedWrite,
            entry.id,
            actorForWrite(params.actor, params.user)
          );
          // The localized values were split out of the main insert, so the
          // returned main row lacks them. Merge them back (camelCase keys) so
          // afterCreate hooks, events, and the response include them. `_status`
          // is a companion-only column, not an entry field.
          for (const [column, value] of Object.entries(
            localizedWrite.companionData
          )) {
            if (column === "_status") continue;
            entry[toCamelCase(column)] = value;
          }
        }

        // The version this create produced, read on its own transaction.
        createdVersion = await documentVersionOn(tx, {
          dialect: this.dialect,
          table: tableName,
          id: String(entry.id),
          languagesTable: translationTableOf(localizedWrite),
          localization: this.localization,
          locale: params.locale,
        });

        // Save component field data to separate comp_{slug} tables
        if (
          this.fieldGroupDataService &&
          Object.keys(componentFieldData).length > 0
        ) {
          await this.fieldGroupDataService.saveComponentDataInTransaction(tx, {
            parentId: entry.id as string,
            parentTable: tableName,
            fields: fields as unknown as FieldConfig[],
            data: componentFieldData,
            // i18n: thread the write locale so an embedded localized component writes
            // translatable fields to its companion within the same transaction.
            locale: params.locale,
            // A component instance is validated by its own pass inside the field-group
            // service, so the request has to travel with it for a field rule nested in
            // a field group to see the same `user` a top-level field rule sees.
            req: params.user ? { user: params.user } : {},
            // Who the write is made as, for each instance's own field rules: the
            // caller and trust the entry's own fields are judged with.
            access: this.fieldGroupAccess(params),
            // The entry's write, so a field inside an instance that reads the
            // library judges it on this transaction as the entry's own fields.
            write: this.validationWrite(
              params.collectionName,
              entry.id as string,
              tx,
              params.locale,
              // The payload as sent, with what the write lifted out of it put back.
              this.writtenPayload(
                finalData,
                [manyToManyData, componentFieldData],
                localizedWrite
              )
            ),
          });
        }

        // Write many-to-many junction rows inside the transaction so a junction
        // failure rolls back the entry (atomic write). The tx-scoped Drizzle
        // handle binds the junction writes to this transaction's connection.
        const txExecutor = tx.getDrizzle<RelationshipDbExecutor>();
        for (const field of manyToManyFields) {
          const relatedIds = manyToManyData[field.name];
          if (relatedIds && relatedIds.length > 0) {
            await this.relationshipService.insertManyToManyRelations(
              params.collectionName,
              entry.id as string,
              field,
              relatedIds,
              txExecutor
            );
          }
        }

        // Assemble the read-shape document once, unconditionally: the webhook
        // outbox records every write, and a version snapshot reuses the same
        // assembly when the collection opts into versioning. Runs after
        // components + m2m so the reads below see them (read-your-writes).
        //
        // Snapshot the parent from the RAW insert row (field-name keys) — not
        // the camelCased `entry` used for the response — so user fields whose
        // names contain underscores keep their configured keys; convert only
        // the timestamp columns to match a normal read. Merge this locale's
        // translatable values (split out of the main insert), parse JSON-backed
        // fields, and strip password hashes + the owner column (created_by) so
        // neither ever enters durable history or an outbound payload.
        const createCompanionStatus = localizedWrite?.companionData?._status;
        const snapshotParent = convertTimestampsToCamelCase(
          this.deserializeJsonFieldsForSnapshot(
            {
              ...(rawEntry as Record<string, unknown>),
              ...localizedWrite?.localizedFieldValues,
              // Creating in a non-default locale with an explicit status moves
              // that status to the companion row and strips it from the main
              // insert, so the raw row carries the column default. Overlay the
              // committed value, or a publish is recorded as a draft create.
              ...(typeof createCompanionStatus === "string"
                ? { status: createCompanionStatus }
                : {}),
            },
            fields
          )
        );
        this.redactSnapshotRow(
          snapshotParent,
          fields,
          tableName,
          await this.passwordReach(fields, tx.getDrizzle())
        );
        // Components + m2m are read from the transaction: the write above just
        // persisted them, and an empty relationship reads as [] — so the
        // document is complete and read-shaped with no in-memory overlay. These
        // reads are the costly part, so they happen exactly once and both
        // consumers below compose their document from the same parts.
        const { components: snapshotComponents, manyToMany: snapshotM2M } =
          await this.buildFullSnapshotRelations(
            tx,
            entry.id as string,
            params.collectionName,
            tableName,
            fields,
            manyToManyFields,
            // The RESOLVED write locale, not the raw request param: a localized
            // write with no `?locale` still writes the default locale, and the
            // parent's translatable values are read for that resolved locale.
            // Passing the raw param would read components under different rules
            // than the rest of the same document.
            localizedWrite?.writeLocale ?? params.locale
          );
        const documentParts = {
          parentRow: snapshotParent,
          components: snapshotComponents,
          manyToMany: snapshotM2M,
        };

        // Record a durable version snapshot atomically with the write when the
        // collection opts into versioning. Its number goes with the history
        // event below.
        let createdVersionNo: number | null = null;
        if (versionsConfig?.enabled) {
          const captured = await captureInTx(tx, this.versionCapture, {
            lifecycle: hasLifecycle(collection),
            ref: {
              scopeKind: "collection",
              scopeSlug: params.collectionName,
              entryId: entry.id as string,
            },
            // A localized create with an explicit status moves it to the
            // companion, leaving the main row on its table default. The snapshot
            // records the companion value, so the version must be indexed with
            // the same one or history reports a draft whose own document says
            // published.
            contentStatus:
              typeof createCompanionStatus === "string"
                ? createCompanionStatus
                : (entry as { status?: unknown }).status,
            // Tagged for the snapshot alone: `documentParts` is also what the
            // outbox event below carries, and that payload is read shape.
            parts: await this.snapshotPartsFor(documentParts, fields, tx),
            createdBy: params.user?.id ?? null,
            // Set only when localized values were actually routed, for the
            // same reason the update path is careful about it.
            // Set when locale-specific state was actually captured. A
            // collection whose translatable content lives only in embedded
            // components routes nothing through `localizedWrite`, yet the
            // components above were read as this locale — so without counting
            // them the version would be unlabelled and unrestorable.
            locale:
              localizedWrite?.writeLocale ??
              (Object.keys(snapshotComponents ?? {}).length > 0
                ? this.componentSnapshotLocale(params.locale)
                : null),
            maxPerDoc: versionsConfig.maxPerDoc,
          });
          createdVersionNo = captured.versionNo;
        }

        // Which media items the new entry uses, from what the create stored:
        // its row, its translation and its field groups are all written above.
        await this.recordEntryMediaUsage(tx, {
          collectionName: params.collectionName,
          entryId: entry.id as string,
          tableName,
          fields,
        });

        // The document's first history event, in the create's transaction.
        await this.recordHistoryEvent(
          tx,
          params.collectionName,
          entry.id as string,
          {
            kind: "created",
            actor: actorForWrite(params.actor, params.user),
            personName: params.user?.name ?? null,
            ...(localizedWrite
              ? { parts: { locales: [localizedWrite.writeLocale] } }
              : {}),
            toState:
              typeof createCompanionStatus === "string"
                ? createCompanionStatus
                : (((entry as { status?: unknown }).status as
                    | string
                    | undefined) ?? null),
            versionNo: createdVersionNo,
          }
        );

        // Append the outbox event in the same transaction, so it commits with
        // the entry and is never recorded for a write that later rolls back.
        const createdDocument = assembleDocument(documentParts);
        recorded = await recordMutationEvent(tx, {
          type: "entry.created",
          resource: {
            kind: "entry",
            collection: params.collectionName,
            id: entry.id as string,
            // The resolved write locale, so a receiver can tell which
            // translation this document represents. Absent unless the
            // collection actually stores per-locale values.
            ...(localizedWrite ? { locale: localizedWrite.writeLocale } : {}),
          },
          data: createdDocument,
          previous: null,
          fields: webhookFields,
          actor: actorForWrite(params.actor, params.user),
        });

        // A collection may replace its (here suppressed) `entry.created` with a
        // curated, metadata-only event (see recordCuratedCreateEvent). Fold the
        // result into `recorded` so the post-commit fast drain still fires when
        // only the curated event was recorded.
        const curatedRecorded = await this.recordCuratedCreateEvent(
          tx,
          params.collectionName,
          entry.id as string,
          createdDocument,
          actorForWrite(params.actor, params.user),
          fields,
          localizedWrite ? localizedWrite.writeLocale : undefined
        );
        recorded = recorded || curatedRecorded;
        // A create landing directly on `published` is a publish lifecycle event
        // too (D69). Recorded in the SAME transaction, so it commits with the row
        // and inherits the recording opt-out. `statusEventsFor` emits only
        // `entry.published` here (no `status_changed` — nothing to change from).
        //
        // Gated on the collection's Draft/Published LIFECYCLE flag: a collection
        // without it may still define an ordinary user field named `status`, and
        // an ordinary `"published"` value there is business data, not a publish.
        //
        // A localized create moves the requested status to the companion, leaving
        // the main row on its table default, so the write-locale's companion
        // `_status` is the real transition target (same value the version capture
        // above indexes); tag the event with that write locale.
        const collectionHasStatusLifecycle =
          (collection as { status?: boolean }).status === true;
        if (collectionHasStatusLifecycle) {
          const createdToStatus =
            typeof createCompanionStatus === "string"
              ? createCompanionStatus
              : ((entry as { status?: unknown }).status as string | undefined);
          const createdStatusRecorded = await this.recordStatusEvents(tx, {
            collection: params.collectionName,
            id: entry.id as string,
            ...(localizedWrite ? { locale: localizedWrite.writeLocale } : {}),
            from: null,
            to: createdToStatus,
            isCreate: true,
            data: createdDocument,
            previous: null,
            fields: webhookFields,
            actor: actorForWrite(params.actor, params.user),
          });
          recorded = recorded || createdStatusRecorded;
          // A create straight onto published is a publish in history too.
          await this.recordTransitionHistory(
            tx,
            params.collectionName,
            entry.id as string,
            {
              actor: actorForWrite(params.actor, params.user),
              personName: params.user?.name ?? null,
              isCreate: true,
              versionNo: createdVersionNo,
            },
            [
              {
                locale: localizedWrite?.writeLocale,
                from: null,
                to: createdToStatus,
              },
            ]
          );
        }

        // Last in the transaction: the entry, its field groups, version,
        // history and outbox event are all written, so a handler sees them
        // and what it writes commits or rolls back with them.
        await this.runInTransactionPhase(tx, inTransactionHandlers, {
          collection: params.collectionName,
          operation: "create",
          id: entry.id as string,
          data: createdDocument,
          user: params.user,
          context: sharedContext,
        });
      }, transactionOptions);
      // Set only after the transaction resolves (this line is skipped if it
      // rejected), so a commit failure never flags a durable event that isn't
      // there; from here a post-commit hook failure must not hide the delivery.
      // False when the collection opted out — nothing was recorded to drain.
      eventRecorded = recorded;
      // The row is durable regardless of the opt-out flags above.
      committedWrite = true;

      // The tags this create invalidates: derived from the collection, the new
      // id, and the new slug (plus the write locale), so a tagged read of the
      // collection listing or this entry refreshes. Flushed post-commit.
      revalidationIntent = buildEntryRevalidationIntent(
        params.collectionName,
        readRevalidateConfig(collection),
        {
          id: entry.id as string,
          slug: readStringField(entry, "slug"),
          locale: localizedWrite?.writeLocale,
        }
      );

      // The after-hooks and events describe a durable row. Inside an enclosing
      // SQLite transaction they wait for its commit and never run for a row it
      // rolls back; see `afterCommitOver` for what they are handed.
      await this.afterCommitOver(entry, async committed => {
        // Post-commit reaction event (D8/D51), first: it announces the commit,
        // so no after-hook comes between the two. Its listeners get detached
        // copies, so neither side can change what the other is handed.
        emitCollectionEvent(
          "created",
          params.collectionName,
          committed,
          params.user
        );

        // Execute afterCreate hooks (code-registered)
        // Hooks run after database insert completes (for side effects)
        const afterContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "create" as const,
          data: committed,
          user: params.user,
          context: sharedContext, // Pass shared context from beforeCreate
          req: requestFacts,
        });

        await this.hookService.hookRegistry.execute(
          "afterCreate",
          afterContext
        );

        // Execute stored afterCreate hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "afterCreate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext({
            collection: params.collectionName,
            operation: "create",
            data: committed,
            queryDatabase: this.queryDatabaseFn,
            user: params.user,
            sharedContext,
            req: requestFacts,
          })
        );

        // D69: a document created directly as `published` is a publish event too.
        // (No statusChanged on create — there is no prior status to transition from.)
        const createdStatus = (committed as { status?: unknown }).status;
        if (createdStatus === "published") {
          this.transitionStatus({
            collection: params.collectionName,
            id: (committed as { id?: unknown }).id,
            data: { ...committed },
            user: params.user,
            previousStatus: null,
            status: "published",
            emitStatusChanged: false,
          });
        }
      });

      // Deserialize JSON fields (richtext, blocks, array, group, json) for response
      fields.forEach(field => {
        if (
          isJsonFieldType(field.type, field) &&
          entry[field.name] &&
          typeof entry[field.name] === "string"
        ) {
          try {
            entry[field.name] = JSON.parse(entry[field.name] as string);
          } catch {
            // If parsing fails, keep as string
          }
        }
      });

      // Field-level afterChange hooks observe the PERSISTED values — run
      // before response expansion so hooks see stored IDs, not the
      // populated relationship objects the response returns.
      await this.afterCommitOver(entry, committed =>
        runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "afterChange",
          data: committed,
          operation: "create",
          user: params.user,
        })
      );

      // Expand relationships in response if depth is specified
      let responseEntry = entry;
      if (depth !== undefined && depth > 0) {
        try {
          responseEntry = await this.relationshipService.expandRelationships(
            entry,
            params.collectionName,
            fields,
            {
              depth,
              // Related rows carry the TARGET collection's own field rules, and
              // the response redaction below runs against THIS collection's
              // schema, so it cannot reach inside a populated row. A writer
              // supplied a relationship id, not the related row's protected
              // columns, so a mutation response is a read of that row and is
              // judged the same way a GET would judge it.
              enforceFieldAccess: true,
              user: params.user,
              overrideAccess: params.overrideAccess,
              // A mutation response is a READ of the related rows, so it is
              // bounded exactly as a GET would be. Without this the item a
              // write returns expands every target fully trusted, which is the
              // same exposure through a different verb.
              trusted: params.trusted,
              authenticatedScope: params.authenticatedScope,
              // The language just written, so a target collection whose read
              // rule filters on one of its own localized fields is judged in
              // the same language the response reports.
              locale: this.localization
                ? resolveRequestedLocale(this.localization, params.locale)
                : undefined,
              // A trusted write sees the row it just wrote regardless of
              // lifecycle; an untrusted one gets the published default, the
              // same answer its own GET would give.
              status:
                params.overrideAccess === true && !narrows(params.trusted)
                  ? "all"
                  : undefined,
            }
          );
        } catch (expansionError) {
          // If expansion fails, return the entry without expanded relationships
          this.logger.warn(
            "Failed to expand relationships in createEntry response",
            { error: expansionError }
          );
        }
      }

      // Redact the response: drop write-only password hashes and any field
      // the caller may write but not read (parity with the query path).
      await this.redactResponseFields(
        responseEntry,
        fields,
        {
          user: params.user,
          overrideAccess: params.overrideAccess,
          routeAuthorized: params.routeAuthorized,
          authenticatedScope: params.authenticatedScope,
        },
        params.collectionName,
        tableName
      );

      setDocumentVersion(responseEntry, createdVersion);

      return {
        success: true,
        statusCode: 201,
        message: "Entry created successfully",
        data: responseEntry,
        eventRecorded,
        revalidationIntent,
        committed: committedWrite,
      };
    } catch (error: unknown) {
      // A translation table dropped after its `ready` verdict was remembered,
      // answered as the update answers it: only for a create that did not
      // commit.
      const companionGone = await this.companionGoneResult(
        {
          collectionName: params.collectionName,
          locale: params.locale,
          committed: committedWrite,
          defaultMessage: "Failed to create entry",
        },
        error
      );
      if (companionGone) return companionGone;
      // Legacy per-kind override messages ("Duplicate value: ...",
      // "Missing required field", etc.) are dropped: the new mapping uses
      // the §13.8-compliant generic strings from fromDatabaseError so the
      // wire never reveals which constraint or column failed. The original
      // DbError is preserved on the NextlyError as `cause` for log lines.
      // Pass dialect explicitly so the helper can normalise raw driver errors.
      return {
        ...errorToServiceResult(
          // A write the database is not migrated for answers as such.
          await asNotMigrated(
            error,
            collectionNotMigrated(
              this.collectionService,
              params.collectionName,
              { trusted: fieldTrustOf(params) }
            ),
            { written: committedWrite }
          ),
          { defaultMessage: "Failed to create entry" },
          this.dialect
        ),
        eventRecorded,
        revalidationIntent,
        committed: committedWrite,
      };
    }
  }

  /**
   * Update an existing entry.
   * Applies collection-level access control and hooks.
   *
   * Security checks are applied in order:
   * 1. Collection-level access (the RBAC gate)
   *
   * @param params - Collection name, entry ID, and optional user context
   * @param body - Update data
   * @returns Updated entry or error
   */
  /**
   * Set the per-locale lifecycle status on a document's companion rows.
   *
   * ## Why the locale is a SELECTOR
   *
   * "Which locales does this transition reach?" is ONE question, and a method
   * per scope answers it once per verb. `publishAllLocales` stated this UPDATE
   * for publishing; an `unpublishAllLocales` would have stated the same UPDATE
   * again for withdrawing, and a third lifecycle verb a third time — the shape
   * AGENTS.md names as one question with several implementations. Taking the
   * locale as `"*"` or a single locale collapses them: a new verb picks a status
   * and a scope and writes no SQL of its own. Strapi's document service settled
   * on the same shape (`publish`/`unpublish` with `locale: '*'`) after shipping
   * the per-scope form first.
   *
   * ## Why Drizzle
   *
   * This replaces an interpolated statement that hand-rolled identifier quoting
   * and placeholders per dialect — `isMysql ? backtick : quote`, `postgresql ?
   * $n : "?"` — which AGENTS.md:273 forbids in product code. Writing the
   * withdrawal direction the same way would have been a second opportunity to
   * get MySQL's quoting wrong, in the path where being wrong leaves content
   * readable after a takedown reported success.
   *
   * Writes ONLY `_status`. `_status` is a structural column, so no `_updated_at`
   * stamp belongs here: that column answers "when was this language last
   * WRITTEN", and a lifecycle transition writes no language. Stamping it would
   * move the source past every target and report the whole site as needing
   * review for an action that changed not one word.
   */
  /**
   * Move every stored translation's lifecycle, and report which ones moved.
   *
   * The prior statuses are read INSIDE the caller's transaction and before the
   * write, because "which languages did this actually change" cannot be
   * recovered afterwards — once the sweep lands, a language that was already at
   * the target status is indistinguishable from one this write moved. The
   * answer is what the caller needs to emit one event per real transition
   * rather than one per row it happened to touch.
   *
   * Returns the prior status of each language the sweep genuinely moved.
   */
  private async sweepCompanionLifecycle(
    tx: TransactionContext,
    args: {
      collectionName: string;
      companionTableName: string;
      entryId: string;
      status: string;
      savedBy: RequestActor;
    }
  ): Promise<Map<string, string | null>> {
    const companion = await this.fileManager.loadCompanionSchema(
      args.collectionName,
      tx.getDrizzle()
    );
    const priorStatuses = companion
      ? await readCompanionLocaleStatusAll(
          tx.getDrizzle<Parameters<typeof readCompanionLocaleStatusAll>[0]>(),
          companion.table,
          args.entryId,
          cachedCompanionReadiness(this.adapter, args.companionTableName)
        )
      : new Map<string, string | null>();

    await this.writeCompanionStatus(tx, {
      companionTableName: args.companionTableName,
      parentId: args.entryId,
      status: args.status,
      locale: EVERY_LOCALE,
      savedBy: args.savedBy,
    });

    const moved = new Map<string, string | null>();
    for (const [locale, prior] of priorStatuses) {
      if (prior !== args.status) moved.set(locale, prior);
    }
    return moved;
  }

  /**
   * One lifecycle event per language a wildcard write moved.
   *
   * Without this a scheduled German publish produces no `locale`-tagged event,
   * so webhook-driven indexing and workflow listeners never learn the
   * translation went live and go stale while the release reports success. The
   * write locale is excluded because the ordinary path has already emitted it.
   *
   * Each event carries THAT language's own values rather than the main row's:
   * a payload tagged `locale: de` holding English text is worse than no
   * payload, because a consumer cannot tell it is wrong.
   *
   * Per locale rather than one document event, which is what a reader arriving
   * from Strapi expects — its document service fires lifecycle hooks once per
   * locale for exactly this operation, and Payload carries an open defect for
   * firing only on the active one.
   */
  private async recordSweptLocaleStatusEvents(
    tx: TransactionContext,
    args: {
      collectionName: string;
      entryId: string;
      moved: Map<string, string | null>;
      status: string;
      skipLocale: string | undefined;
      document: Record<string, unknown>;
      fields: readonly SensitiveFieldSource[];
      actor: RequestActor | null;
    }
  ): Promise<{
    recorded: boolean;
    transitions: {
      locale: string;
      from: string | null;
      data: Record<string, unknown>;
    }[];
  }> {
    // A locale the app no longer configures still has rows, and an event tagged
    // with one that normal reads and writes reject would mislead a
    // locale-routed consumer.
    const configured = new Set(
      this.localization?.locales.map(l => l.code) ?? []
    );
    let recorded = false;
    const transitions: {
      locale: string;
      from: string | null;
      data: Record<string, unknown>;
    }[] = [];
    for (const [locale, prior] of args.moved) {
      if (locale === args.skipLocale) continue;
      if (configured.size > 0 && !configured.has(locale)) continue;
      const localeValues = await this.readCompanionLocalizedValues(
        tx,
        args.collectionName,
        args.entryId,
        locale
      );
      const localeDocument = {
        ...args.document,
        ...localeValues,
        status: args.status,
      };
      // BOTH sides built from this language, with the prior status overlaid.
      //
      // Passing the write locale's pre-image would describe a German transition
      // with English fields and the English prior status: the envelope would say
      // `from: draft` while `previous.status` read `published`, so a consumer
      // diffing the two computes changed fields that never changed. A sweep
      // moves status only, so this language's values are the same on both sides
      // and the status is the whole of the difference.
      const localePrevious = {
        ...localeDocument,
        status: prior,
      };
      const did = await this.recordStatusEvents(tx, {
        collection: args.collectionName,
        id: args.entryId,
        locale,
        from: prior,
        to: args.status,
        isCreate: false,
        data: localeDocument,
        previous: localePrevious,
        fields: args.fields,
        actor: args.actor,
      });
      recorded = recorded || did;
      // Carried out so the post-commit replay reaches in-process workflow
      // subscribers with THIS language's document, without reading it twice.
      transitions.push({ locale, from: prior, data: localeDocument });
    }
    return { recorded, transitions };
  }

  private async writeCompanionStatus(
    tx: TransactionContext,
    args: {
      companionTableName: string;
      parentId: string;
      status: string;
      /** {@link EVERY_LOCALE}, or one locale code. */
      locale: string;
      /** Who made the save: each translation row moved is a save of it. */
      savedBy: RequestActor;
    }
  ): Promise<void> {
    const conditions: WhereCondition[] = [
      { column: COMPANION_PARENT_COLUMN, op: "=", value: args.parentId },
    ];
    if (args.locale !== EVERY_LOCALE) {
      conditions.push({
        column: COMPANION_LOCALE_COLUMN,
        op: "=",
        value: args.locale,
      });
    }
    await tx.update(
      args.companionTableName,
      {
        [COMPANION_STATUS_COLUMN]: args.status,
        ...translationRevisionBumpColumns(args.savedBy, this.dialect),
      },
      { and: conditions }
    );
  }

  /**
   * The one entry an update acts on, and the caller's update gate for it: the
   * entry with its schema, or the answer to return instead, when the entry is
   * not found or the caller may not update it. Shared by the update and the
   * publish of every language, which ask both the same way.
   */
  private async entryToUpdate(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    overrideAccess?: boolean;
    routeAuthorized?: boolean;
    authenticatedScope?: AuthenticatedScope;
    /**
     * The gate the write is judged by: `update`, or, for a write that changes
     * only the status of an entry with a lifecycle, the `publish` or
     * `unpublish` its status names, asked whether or not the status moves.
     * `null` asks none here, for a caller that asks its own lifecycle gate.
     */
    gate: "update" | "publish" | "unpublish" | null;
  }) {
    const accessUser = params.overrideAccess ? undefined : params.user;
    const schema = await this.fileManager.loadDynamicSchema(
      params.collectionName
    );
    const [existingEntry] = await this.db
      .select()
      .from(schema)
      .where(eq(schema.id, params.entryId))
      .limit(1);
    if (!existingEntry) {
      const answer: CollectionServiceResult = {
        success: false,
        statusCode: 404,
        message: "Entry not found",
        data: null,
      };
      return { answer };
    }
    if (params.gate === null) return { accessUser, schema, existingEntry };
    const gateParams = {
      collectionName: params.collectionName,
      operation: params.gate,
      entryId: params.entryId,
      user: accessUser,
      overrideAccess: params.overrideAccess,
      // The route attests only an update it ran itself.
      routeAuthorized: params.gate === "update" && params.routeAuthorized,
      // A scoped API key is judged on its own grants here too, so the session
      // super-admin bypass does not apply to it on the update gate.
      authenticatedScope: params.authenticatedScope,
    };
    // A rule that answers a filter allows only the entries it matches, so the
    // gate hands the filter back for the write to match its entry against.
    const gateAccess =
      await this.accessService.checkCollectionWrite(gateParams);
    if (gateAccess.denied) return { answer: gateAccess.denied };
    return { accessUser, schema, existingEntry, gateAccess, gateParams };
  }

  /**
   * The refusal for a caller who certainly lacks the lifecycle grant
   * ({@link holdsGrant}), worded by the full gate, or `null` to go on: asked
   * before the work only a publish or an unpublish needs, its rule being asked
   * once the languages going live are known.
   */
  private async lifecycleGrantRefusal(
    action: "publish" | "unpublish",
    params: {
      collectionName: string;
      entryId: string;
      overrideAccess?: boolean;
      authenticatedScope?: AuthenticatedScope;
    },
    user: UserContext | undefined
  ): Promise<CollectionServiceResult | null> {
    const held = await holdsGrant({
      action,
      slug: params.collectionName,
      user,
      overrideAccess: params.overrideAccess,
      authenticatedScope: params.authenticatedScope,
    });
    if (held) return null;
    return this.accessService.checkCollectionAccess({
      collectionName: params.collectionName,
      operation: action,
      entryId: params.entryId,
      user,
      overrideAccess: params.overrideAccess,
      routeAuthorized: false,
      authenticatedScope: params.authenticatedScope,
    });
  }

  /**
   * Each language's document as stored, read on a publish of every language's
   * transaction in the shape a publish of that language alone reports it
   * (`storedDocumentOnTx`), keyed by the language asked: what the publish
   * tells each language it was before, and is after, and what a promotion of
   * its pending change is judged against. One read for every language, so
   * the reads made under the row's lock do not multiply with the languages.
   *
   * A language is read as a write of it would be: the default one for a
   * pending change kept under no language (`null`), and a language the app no
   * longer configures under its own name rather than the default it would
   * resolve to, whose row would then be read as that language's.
   */
  private async languageDocumentsOnTx(
    tx: TransactionContext,
    args: {
      /** The main row, as this transaction reads it. */
      row: Record<string, unknown>;
      collectionName: string;
      entryId: string;
      tableName: string;
      fields: FieldDefinition[];
      manyToManyFields: FieldDefinition[];
      locales: readonly (string | null)[];
    }
  ): Promise<Map<string | null, Record<string, unknown>>> {
    const locales = [...new Set(args.locales)];
    if (locales.length === 0) return new Map();
    try {
      // The companion every language shares, from one split at the default
      // language; each language named is then read under its own name.
      const localizedUpdate = await this.splitLocalizedWriteData(
        args.collectionName,
        {},
        undefined,
        false,
        tx.getDrizzle()
      );
      const stored = await this.storedDocumentsOnTx(tx, {
        row: args.row,
        collectionName: args.collectionName,
        entryId: args.entryId,
        tableName: args.tableName,
        fields: args.fields,
        manyToManyFields: args.manyToManyFields,
        localizedUpdate,
        locales: locales.map(locale => locale ?? undefined),
        // A pending change kept for a language the app no longer configures
        // is judged and told against that language's own components, not
        // the default's it would otherwise resolve to.
        exactLanguage: true,
      });
      return new Map(locales.map((locale, i) => [locale, stored[i].document]));
    } catch (err) {
      // These values feed durable language-tagged events and the promotion's
      // field rules, so a failed read aborts the publish. A raw driver error
      // is normalized to the canonical internal error, so its message, which
      // can carry schema or connection details, does not reach the caller.
      if (NextlyError.is(err)) throw err;
      throw NextlyError.internal({
        cause: err instanceof Error ? err : undefined,
        logContext: {
          reason: "publish-all-locale-values-read",
          collection: args.collectionName,
          locales,
        },
      });
    }
  }

  /**
   * The caller's payload for one language's main row, split as a publish of
   * that language alone splits it: the translated values, and for any
   * language but the default the status, moved out of a copy.
   */
  private async languagePayloadOnTx(
    tx: TransactionContext,
    args: {
      collectionName: string;
      /** The language, or `null` for a pending change kept under none. */
      locale: string | null;
      payload: Record<string, unknown>;
    }
  ): Promise<Record<string, unknown>> {
    const finalData = { ...args.payload };
    await this.splitLocalizedWriteData(
      args.collectionName,
      finalData,
      args.locale ?? undefined,
      false,
      tx.getDrizzle()
    );
    return finalData;
  }

  /**
   * One language's pending change as a publish of every language writes it,
   * judged under the row lock before anything is written, as a publish of
   * that language alone (`updateEntry`) judges it: the document it leaves
   * validated as it goes live, then folded into the caller's payload for
   * that language by `foldWorkingDraft`, under the caller's field rules told
   * that language, as a read showing the change asks them
   * (`workingDraftPromotionRefused`). A change kept for a language the app no
   * longer configures is told every language rather than the default it
   * would resolve to, so a rule that answers by language cannot judge it as
   * a write of the default language (`writeAsNamedLanguagesFor`). Refused by
   * throwing.
   */
  private pendingChangePromotion(
    tx: TransactionContext,
    args: {
      /** The change, carrying the one shared state the publish leaves. */
      change: PendingChange;
      context: ReleaseWriteContext;
      restoreContext: RestoreSchemaContext;
      collection: unknown;
      collectionName: string;
      entryId: string;
      /** The entry's id as stored, which the rules are told. */
      storedId: string;
      tableName: string;
      /** The language's document as stored, read on this transaction. */
      live: Record<string, unknown>;
      /** The caller's payload for the main row, as the language's split leaves it. */
      finalData: Record<string, unknown>;
      companion: CompanionSchema | null;
      caller: AllLocalesLifecycleParams;
      /** Resolved before the transaction opened; see `setLifecycleAllLocales`. */
      grants?: () => Promise<CallerGrants>;
      updatedAt: Date;
    }
  ): Promise<PendingPromotion> {
    const { change, context, companion } = args;
    const locale = change.locale ?? undefined;
    return withRuleLanguage(
      writeAsNamedLanguagesFor(this.localization, locale),
      async () => {
        // The caller's payload for this language, a copy for each pass that
        // reads it, so no pass sees another's.
        const parts = () => ({
          finalData: { ...args.finalData },
          componentFieldData: { ...context.componentFieldData },
          manyToManyData: { ...context.manyToManyData },
        });
        // The document the change leaves, as `updateEntry` assembles it: the
        // change's restored input with the caller's payload over it.
        const merged = this.promotedDocumentOf(
          {
            fields: context.fields,
            manyToManyFields: context.manyToManyFields,
            splitComponentSchemas: context.splitComponentSchemas,
            ...parts(),
          },
          buildRestorePayload(
            change.snapshot,
            context.fields as unknown as FieldConfig[],
            args.restoreContext
          ).payload
        );
        // Judged as it goes live, on this transaction under the row lock,
        // with each relation the change does not name at its value as stored
        // now: the promotion leaves that value, and another writer may have
        // removed a required one since the publish was asked.
        const issues = await this.promotedDocumentIssues(
          {
            collectionName: args.collectionName,
            entryId: args.entryId,
            locale,
            user: args.caller.user,
            // Told only the issues on fields the caller may read.
            reader: args.caller,
            fields: context.fields,
            tx,
          },
          await this.withEveryRelationKey(
            {
              collectionName: args.collectionName,
              entryId: args.entryId,
              tableName: args.tableName,
              locale,
              fields: context.fields,
              manyToManyFields: context.manyToManyFields,
            },
            merged,
            tx
          )
        );
        if (issues.length > 0) {
          throw NextlyError.validation({ errors: issues });
        }
        const folded = await this.foldWorkingDraft(tx, {
          snapshot: change.snapshot,
          ...parts(),
          live: args.live,
          collection: args.collection,
          collectionName: args.collectionName,
          storedId: args.storedId,
          fields: context.fields,
          manyToManyFields: context.manyToManyFields,
          componentSchemas: context.splitComponentSchemas,
          restoreContext: args.restoreContext,
          draftLocale: change.locale,
          requestLocale: locale,
          user: args.caller.user,
          authenticatedScope: args.caller.authenticatedScope,
          overrideAccess: args.caller.overrideAccess,
          grants: args.grants,
        });
        const columns: Record<string, unknown> = {};
        for (const [key, value] of Object.entries({
          ...stripImmutableSystemFields(
            folded.finalData,
            "collection",
            args.tableName,
            context.fields
          ),
          updatedAt: args.updatedAt,
        })) {
          columns[toSnakeCase(key)] = value;
        }
        const translation = keptToLanguage(
          folded.localizedUpdate,
          change.locale
        );
        // Whether the language already HAS a row decides what the promotion
        // may do with it, read before anything is written.
        const rowExists =
          translation !== null && companion !== null
            ? await companionRowExists(
                tx.getDrizzle<Parameters<typeof companionRowExists>[0]>(),
                companion.table,
                args.entryId,
                translation.writeLocale,
                cachedCompanionReadiness(
                  this.adapter,
                  companion.companionTableName
                )
              )
            : false;
        return {
          locale: change.locale,
          columns,
          translation:
            translation !== null &&
            upsertsTranslation({
              localizedUpdate: translation,
              everyLanguage: true,
              promoted: true,
              rowExists,
            })
              ? translation
              : null,
          componentFieldData: folded.componentFieldData,
          manyToManyData: folded.manyToManyData,
          // The promoted document with what the write lifted out of it put
          // back, as a publish of this language alone hands it on.
          payload: this.writtenPayload(
            folded.finalData,
            [folded.manyToManyData, folded.componentFieldData],
            folded.localizedUpdate
          ),
          carriesContent: folded.carriesContent,
        };
      }
    );
  }

  /**
   * What a change of every language's status does before its transaction
   * opens, in the order it does it: the refusals that end it first (no entry,
   * the lifecycle grant, a translations table that is not there, nothing to
   * change), the lifecycle rule asked in each language it puts live, and what
   * the transaction then reads only a verdict of. One implementation for the
   * change and for a preview of a publish, so the preview is refused, and
   * reads, exactly what the publish would.
   */
  private async lifecycleAllLocalesPreconditions(
    direction: LifecycleDirection,
    params: AllLocalesLifecycleParams
  ) {
    // An answer that ends the change before its transaction opens.
    const answered = (answer: CollectionServiceResult) => ({ answer });
    const toUpdate = await this.entryToUpdate({ ...params, gate: null });
    if (toUpdate.answer) return answered(toUpdate.answer);
    const { accessUser, schema, existingEntry } = toUpdate;

    // The draft/published lifecycle flag on the collection config, NOT the
    // mere presence of a `status` column: a collection that defines an
    // ordinary user field named `status` has the column but no lifecycle, so
    // it is not publishable and must not demand the publish permission here.
    // Resolved through the collection so a custom tableName/dbName override is
    // honored below, matching every other mutation.
    const publishCollection = await this.collectionService.getCollection(
      params.collectionName
    );
    const hasMainStatus =
      (publishCollection as { status?: boolean }).status === true;
    // A collection with a lifecycle is asked the lifecycle grant here, before
    // any work only that change needs; its rule below, once the languages
    // going live are known.
    const grantRefused = hasMainStatus
      ? await this.lifecycleGrantRefusal(
          direction.accessAction,
          params,
          accessUser
        )
      : null;
    if (grantRefused) return answered(grantRefused);
    const companion = await this.fileManager.loadCompanionSchema(
      params.collectionName
    );
    const companionReady =
      !!companion &&
      (await isCompanionReady(this.adapter, companion.companionTableName));
    const companionPublishable =
      !!companion &&
      companion.hasStatus &&
      // Only `ready` matters: a companion that is not there has no per-locale publish
      // lifecycle, and why it is not there changes nothing about that.
      companionReady;
    // A localized collection whose translations table isn't there has nowhere
    // to put any language but the default, so publishing every language is
    // refused, with the remedy, as a write of one other language is.
    const otherLanguages =
      this.localization?.locales.some(
        locale => locale.code !== this.localization?.defaultLocale
      ) ?? false;
    if (
      direction.nextStatus === "published" &&
      companion &&
      !companionReady &&
      otherLanguages
    ) {
      return answered(
        errorToServiceResult(
          NextlyError.conflict({
            reason: "state",
            message: companionNotReadyMessage("collection"),
            logContext: {
              cause: "localized-write-without-companion",
              collection: params.collectionName,
              companionTable: companion.companionTableName,
            },
          }),
          { defaultMessage: "Failed to publish all languages" },
          this.dialect
        )
      );
    }

    if (!hasMainStatus && !companionPublishable) {
      // Nothing to publish — the collection has no status concept. Returned
      // before the publish permission check so a collection with no lifecycle
      // does not demand `publish-<slug>` for a call that changes nothing; the
      // caller's update gate decides whether they are told so, as a Single's
      // does, so a caller with no grant learns nothing about the entry.
      const updateDenied = await this.accessService.checkCollectionAccess({
        collectionName: params.collectionName,
        operation: "update",
        entryId: params.entryId,
        user: accessUser,
        overrideAccess: params.overrideAccess,
        routeAuthorized: false,
        authenticatedScope: params.authenticatedScope,
      });
      if (updateDenied) return answered(updateDenied);
      return answered({
        success: true,
        statusCode: 200,
        message: direction.nothingToDoMessage,
        data: { id: params.entryId },
      });
    }

    // This method exists to publish every locale, so it is unconditionally a
    // publish and needs the publish permission — checked
    // directly rather than via a transition, since it publishes companion
    // locales even when the main row is already published. Runs only once
    // there is actually something publishable.

    // The lifecycle permission and rule for this direction, asked before any
    // readiness below is resolved, so a caller who may not publish is refused
    // before any work only a publish needs. Never route-authorized: a route
    // attests no lifecycle gate. A scoped API key is judged on its own
    // `<action>-<slug>` grant. The languages going live read this
    // collection's own translations, whose readiness is resolved above.
    // Each filter the lifecycle's rule answered, in the language it was
    // asked in: a publish's in each language going live, an unpublish's
    // once, matched in the default language. The entry is matched against
    // each now, again under the row lock, and once it is written.
    const lifecycleChecks: FilteredWriteCheck[] = [];
    const lifecycleDenied = () =>
      this.refusalOfLifecycleInLanguage(lifecycleChecks, schema, {
        collectionName: params.collectionName,
        operation: direction.accessAction,
        entryId: params.entryId,
        user: accessUser,
        overrideAccess: params.overrideAccess,
        routeAuthorized: false,
        authenticatedScope: params.authenticatedScope,
      });
    const fields = ((publishCollection as { fields?: unknown }).fields ??
      []) as FieldDefinition[];
    const publishes = direction.nextStatus === "published";
    // A publish puts every language's pending change live, so a change kept
    // in any language's slot counts among the languages it is asked about.
    // An unpublish promotes nothing.
    const promotes = publishes
      ? { promotesEveryDraftOf: publishCollection }
      : {};
    // Asked here, before the transaction and off its connection: a rule is
    // the app's own code and may read the database. The lock re-reads what
    // goes live, and asks nothing.
    const { denied: deniedBeforePublish, askedLanguages } =
      await this.askBeforeLifecycle({
        publishes,
        collectionName: params.collectionName,
        entryId: params.entryId,
        row: existingEntry as Record<string, unknown>,
        fields,
        ...promotes,
        parts: params.parts,
        ask: lifecycleDenied,
      });
    if (deniedBeforePublish) return answered(deniedBeforePublish);

    // Readiness for this collection AND for every field-group type it can hold, resolved on the
    // pool before the transaction opens. The snapshot built inside it reads all of them, and
    // there it can only READ a verdict — resolving issues a query, and a query against a missing
    // relation aborts the whole transaction on PostgreSQL. A publish is a plausible first act on
    // a fresh worker, and an unresolved verdict reads as unusable, so every translated value
    // would be missing from the durable event.
    await this.warmCompanionReadiness(params.collectionName);
    await this.fieldGroupDataService?.assertLocalizedFieldGroupsWritable({
      fields: (publishCollection as { fields?: FieldConfig[] }).fields ?? [],
      // Nothing is being written, so nothing is judged: this call is here purely for the
      // verdicts it leaves behind.
      data: {},
      locale: undefined,
    });

    // How a publish promotes the pending changes, resolved before the
    // transaction, as a publish of one language resolves it: the payload
    // each language's change is folded into, and how a change is restored
    // onto the live row, which reads the component registry on the pool.
    // Null where nothing can be promoted: an unpublish, a collection with no
    // lifecycle or that keeps no working drafts, or one whose schema the
    // split no longer covers.
    const promotionContext =
      publishes && hasMainStatus && this.keepsWorkingDrafts(publishCollection)
        ? await this.releaseWriteContext(
            publishCollection,
            params.collectionName,
            "published"
          )
        : null;
    const promotion =
      promotionContext?.promoteRestoreCtx != null
        ? {
            context: promotionContext,
            restoreContext: promotionContext.promoteRestoreCtx,
            // The caller's grants, resolved HERE, before the transaction
            // opens, for the reason `updateEntry` gives: the promotion's
            // gate runs under the row lock, and a resolver first asked from
            // there queries the pooled connection the transaction holds.
            // Only where a rule could ask.
            grants:
              params.overrideAccess !== true &&
              this.promotionRulesCanAsk(params.collectionName)
                ? await this.resolvedGrants(
                    params.user,
                    params.authenticatedScope
                  )
                : undefined,
          }
        : null;
    const documentLocalized =
      (publishCollection as { localized?: boolean }).localized === true;
    const draftRef: VersionRef = {
      scopeKind: "collection",
      scopeSlug: params.collectionName,
      entryId: params.entryId,
    };
    return {
      ready: {
        schema,
        existingEntry,
        publishCollection,
        hasMainStatus,
        companion,
        companionPublishable,
        companionReady,
        lifecycleChecks,
        fields,
        publishes,
        promotes,
        askedLanguages,
        promotion,
        documentLocalized,
        draftRef,
      },
    };
  }

  /**
   * The hooks an update runs before anything is validated, in order:
   * `beforeOperation` (which may replace the data), then the code-registered
   * and the stored (admin-configured) `beforeUpdate` hooks, each handed the
   * data the one before it left. Returns the data they leave; a hook that
   * throws refuses the update. One implementation for an update and for a
   * move of every language's status, so the two run the same hooks in the
   * same order.
   */
  private async beforeUpdateHooks(args: {
    collectionName: string;
    entryId: string;
    body: Record<string, unknown>;
    /** The entry as stored, which `beforeUpdate` compares against. */
    existingEntry: Record<string, unknown>;
    user?: UserContext;
    storedHooks: ReturnType<CollectionHookService["getStoredHooks"]>;
    sharedContext: Record<string, unknown>;
    requestFacts: ReturnType<typeof resolveRequestFacts>;
  }): Promise<Record<string, unknown>> {
    // Can modify the operation's arguments (id, data) or throw to abort.
    const beforeOpArgs =
      await this.hookService.hookRegistry.executeBeforeOperation({
        collection: args.collectionName,
        operation: "update",
        args: { id: args.entryId, data: args.body },
        user: args.user
          ? { id: args.user.id, email: args.user.email }
          : undefined,
        context: args.sharedContext,
        req: args.requestFacts,
      });
    const currentData =
      (beforeOpArgs as BeforeOperationArgs)?.data ?? args.body;
    const fromCode = await this.hookService.hookRegistry.execute(
      "beforeUpdate",
      this.hookService.buildHookContext({
        collection: args.collectionName,
        operation: "update" as const,
        data: currentData,
        originalData: args.existingEntry,
        user: args.user,
        context: args.sharedContext,
        req: args.requestFacts,
      })
    );
    const afterCodeHooks = (fromCode ?? currentData) as Record<string, unknown>;
    // The stored hooks run after the code-registered ones, on what they left.
    const fromStored = await this.hookService.storedHookExecutor.execute(
      "beforeUpdate",
      args.storedHooks,
      this.hookService.buildPrebuiltHookContext({
        collection: args.collectionName,
        operation: "update",
        data: afterCodeHooks,
        queryDatabase: this.queryDatabaseFn,
        user: args.user,
        sharedContext: args.sharedContext,
        req: args.requestFacts,
      })
    );
    return (fromStored.data ?? afterCodeHooks) as Record<string, unknown>;
  }

  /**
   * The hooks a status change of one language (`updateEntry` with a body of
   * `status` alone) runs before it writes, run once for a move of every
   * language: `beforeOperation`, the code and stored `beforeUpdate`, the
   * fields' `beforeValidate`, the code and stored `beforeChange`, then the
   * fields' `beforeChange`, in that order, each handed `{ status }` against
   * the entry as stored. A hook that throws refuses the move before its
   * transaction opens, so nothing changes in any language, and the refusal
   * leaves the service as the same hook's refusal of one language does.
   *
   * Run outside the transaction, as `updateEntry` runs them: the transaction
   * retries its closure on a version conflict, and a hook's effects outside
   * this process could not be withdrawn by that retry's rollback.
   *
   * The move writes each language's status and nothing else, so what a hook
   * makes of `data` is not written. A hook that takes `status` away or names
   * another one is answered as a conflict rather than ignored: the write
   * would otherwise report a move the hook had decided against.
   */
  private async lifecycleBeforeHooks(
    direction: LifecycleDirection,
    args: {
      params: AllLocalesLifecycleParams;
      /** The entry as stored, which a status change's hooks compare against. */
      existingEntry: Record<string, unknown>;
      collection: unknown;
    }
  ): Promise<
    | { answer: CollectionServiceResult }
    | {
        ready: {
          sharedContext: Record<string, unknown>;
          requestFacts: ReturnType<typeof resolveRequestFacts>;
          storedHooks: ReturnType<CollectionHookService["getStoredHooks"]>;
        };
      }
  > {
    const { params, existingEntry } = args;
    const storedHooks = this.hookService.getStoredHooks(
      args.collection as Record<string, unknown>
    );
    // One context for every hook of the move, before and after it, as an
    // update shares one between its phases.
    const sharedContext: Record<string, unknown> = { ...params.context };
    const requestFacts = resolveRequestFacts(params.request);
    const body: Record<string, unknown> = { status: direction.nextStatus };

    const data = await this.beforeUpdateHooks({
      collectionName: params.collectionName,
      entryId: params.entryId,
      body,
      existingEntry,
      user: params.user,
      storedHooks,
      sharedContext,
      requestFacts,
    });
    await runFieldHooks({
      kind: "collection",
      slug: params.collectionName,
      phase: "beforeValidate",
      data,
      operation: "update",
      user: params.user,
    });
    const storedStatus = await this.hookStoredStatus(
      params.collectionName,
      params.entryId,
      existingEntry,
      EVERY_LOCALE
    );
    await this.hookService.runBeforeChange({
      collection: params.collectionName,
      operation: "update",
      data,
      originalData: existingEntry,
      ...(storedStatus === undefined ? {} : { storedStatus }),
      storedHooks,
      queryDatabase: this.queryDatabaseFn,
      user: params.user,
      sharedContext,
      req: requestFacts,
    });
    await runFieldHooks({
      kind: "collection",
      slug: params.collectionName,
      phase: "beforeChange",
      data,
      operation: "update",
      user: params.user,
    });
    // An own `status: undefined` names no status, as an update reads it.
    stripUndefinedStatus(data);
    if (data.status !== direction.nextStatus) {
      return {
        answer: errorToServiceResult(
          NextlyError.conflict({
            reason: "state",
            message:
              `Moving every language to '${direction.nextStatus}' was ` +
              `refused: after the collection's hooks ran, the write no ` +
              `longer carries that status. Nothing was changed.`,
            logContext: {
              cause: "every-language-lifecycle-status-changed-by-hook",
              collection: params.collectionName,
            },
          }),
          { defaultMessage: "Failed to change every language's status" },
          this.dialect
        ),
      };
    }
    return { ready: { sharedContext, requestFacts, storedHooks } };
  }

  /**
   * Move every language of an entry to `direction`'s status at once: the
   * main `status` and — when the collection has per-locale status — every
   * companion row's `_status`, in a single transaction.
   * For a non-localized / no-status collection it is a plain move of the
   * single row.
   *
   * A publish also puts every language's pending change live, judged as a
   * publish of every language of a Single is, by the shared planner: each
   * change folded and written as a publish of that language alone writes it
   * (`updateEntry`), and each language told what that publish tells it. An
   * unpublish moves the statuses alone.
   */
  private async setLifecycleAllLocales(
    direction: LifecycleDirection,
    params: AllLocalesLifecycleParams
  ): Promise<CollectionServiceResult> {
    // Refused first when the collection is removed from code: publishing or
    // withdrawing every language is a write to the entry like any other.
    await refuseWriteIfRemovedFromCode("collection", params.collectionName);
    // Judged against the version the caller read, when it sent one, as a save
    // is: a publish from an out-of-date view would put live what the publisher
    // never saw. Decided first thing in the `try` below, so a version that is
    // not one is answered as the validation error it is.
    let versionCheck: VersionCheck = { kind: "unjudged" };
    // Set by a refusal inside the transaction, answered once it rolls back.
    const staleWrite: StaleWriteHolder = {};
    // Set when the publish rule, asked inside the transaction once for each
    // language going live, refuses one of them. Declared out here so the
    // catch can read it: the adapter re-wraps the thrown sentinel in a
    // DatabaseError as the transaction rolls back, so `instanceof` no longer
    // identifies it.
    let publishDocDenied: CollectionServiceResult | undefined;
    // The version every language holds after this write, read in its
    // transaction.
    let allLocalesVersion: string | undefined;
    // Set when judging the languages going live refuses the publish inside the
    // transaction, read by the catch for the same reason as the one above.
    let publishRefused: unknown;
    // The shared fields a pending change may not publish, and the live
    // document they were judged against; see `SharedValuesOutOfDateError`.
    // The refusal naming them is built after the transaction, where the
    // caller's field read rules resolve grants on a pooled connection.
    let outOfDateShared: Parameters<RefuseSharedFields>[0] | undefined;
    // The tags this publish invalidates, set before the success return so a
    // publish busts the entry's cached reads. Publishing every locale, so no
    // single locale tag — the locale-less id tag covers them all.
    let revalidationIntent: RevalidationIntent | undefined;
    // Set once the publish's transaction has committed, so a failure after it
    // (the read of the published slugs, say) is reported as a change that was
    // saved rather than one the caller should send again.
    let committedWrite = false;
    try {
      versionCheck = this.lifecycleVersionCheck(params);
      // The caller sends every language's status and nothing else, so this is
      // a publish or an unpublish alone, judged by the lifecycle gate below
      // as a status-only write of one language is, the pending changes it
      // promotes included: no update gate.
      const preconditions = await this.lifecycleAllLocalesPreconditions(
        direction,
        params
      );
      if ("answer" in preconditions) return preconditions.answer;
      const {
        schema,
        existingEntry,
        publishCollection,
        hasMainStatus,
        companion,
        companionPublishable,
        companionReady,
        lifecycleChecks,
        fields,
        publishes,
        promotes,
        askedLanguages,
        promotion,
        documentLocalized,
        draftRef,
      } = preconditions.ready;
      // Every language this moves is judged, so the version must name each
      // one: a read of one language cannot say whether another changed since.
      // Asked only once there is something to move, and before any work.
      const languagesTable = translationTableOf(
        companion,
        companionPublishable
      );
      const judgedLocales = this.everyLanguageJudged(
        versionCheck,
        languagesTable,
        params.parts
      );

      // The hooks a status change of one language runs, run once for the
      // move of every language: after the caller is known to be allowed to
      // make it, and before anything is written, so a plugin's guard refuses
      // this as it refuses that. A refusal thrown here is answered by the
      // catch below with the hook's own status and message.
      const hooks = await this.lifecycleBeforeHooks(direction, {
        params,
        existingEntry: existingEntry as Record<string, unknown>,
        collection: publishCollection,
      });
      if ("answer" in hooks) return hooks.answer;
      const { sharedContext, requestFacts, storedHooks } = hooks.ready;

      // `publishCollection` (loaded above for the lifecycle flag) also resolves a
      // custom tableName/dbName override, matching every other mutation;
      // getTableName would hardcode the default dc_<slug> and target the wrong
      // table for a renamed collection.
      const tableName = collectionTableName(
        publishCollection,
        params.collectionName
      );

      // Resolved versioning config + field set for the in-transaction capture.
      const versionsConfig = (publishCollection as Record<string, unknown>)
        .versions as ResolvedVersionsConfig | null | undefined;
      const manyToManyFields = fields.filter(
        f =>
          f.type === "relationship" && f.options?.relationType === "manyToMany"
      );
      const previousStatusRaw = (existingEntry as { status?: unknown }).status;
      const previousStatus =
        typeof previousStatusRaw === "string" ? previousStatusRaw : null;

      // The parent row for both the snapshot and the status-change event is
      // re-read inside the transaction once this publish has written it (not
      // the pre-transaction `existingEntry`), mirroring updateEntry: a conflict
      // retry re-runs this closure, and any concurrent write committed before
      // the tx began is then reflected, so neither the recorded snapshot nor
      // the emitted event payload exposes a stale pre-image of the non-status
      // columns, and a pending change the publish promoted is in both. The
      // closure sets it; it is read once after commit for the event.
      let publishedParentRow: Record<string, unknown> | undefined;
      // Set inside the transaction when the publish records its outbox events, so
      // the caller can flush the drain after IT commits.
      let eventRecorded = false;
      // Set inside the transaction when the row is gone by the time the lock is
      // taken (deleted between the pre-transaction read and the lock), so the
      // publish records nothing and the caller answers not-found rather than
      // reporting a publish of content that no longer exists.
      let entryVanished = false;
      // The main row's status read UNDER the transaction lock, so the publish
      // transition is judged against the committed value this publish overwrites
      // rather than the stale pre-transaction read. The closure sets it; the
      // post-commit transition event reads it. Defaults to the pre-read value so
      // a companion-only (no main status) publish still has a sane fallback.
      let lockedPreviousStatus = previousStatus;
      // The first-publication marker this publish committed, or undefined when it recorded none.
      // Reset per attempt by the closure, so a retry after a concurrent winner does not reuse a
      // stale value.
      let publishFirstPublishedAt: Date | undefined;
      // The per-locale publish transitions recorded to the outbox inside the
      // transaction, replayed to the in-process workflow subscribers after it
      // commits — the durable event and the reaction event must not diverge on
      // which locales published. The closure rebuilds it each attempt.
      // Each language whose pending change this publish put live, as the
      // publish left it and as it stood before, for the update hooks run once
      // the publish is durable. The closure rebuilds it each attempt.
      let promotedForHooks: {
        data: Record<string, unknown>;
        originalData: Record<string, unknown> | null;
      }[] = [];
      let perLocaleTransitions: {
        locale: string;
        from: string | null;
        data: Record<string, unknown>;
      }[] = [];
      // The version this publish recorded, for its history event.
      let publishVersionNo: number | null = null;
      // Whether the default locale's companion row transitions to published, so
      // the post-commit workflow replay suppresses the untagged main transition
      // (the default's locale-tagged replay stands in for it). Set in the tx.
      let defaultCompanionTransitions = false;
      // What a publish did to each configured language, judged under the lock
      // before anything was written, for the result. Set in the tx.
      let publishLanguages: LanguageOutcome[] = [];
      // The slugs the entry was reachable at before a promotion rewrote them,
      // so their cached reads are busted too. Set in the tx, and only where a
      // pending change was promoted.
      let slugsBefore: { slug?: string; localized: string[] } | undefined;
      // Each language's slug as committed before the transaction opens, read
      // on the pool where a promotion could rewrite one. The read reports a
      // failure as no slugs rather than throwing, and a failed statement
      // inside the transaction would abort it on PostgreSQL, so it never runs
      // there. Read this early it can only bust more: a slug that changes
      // before the lock is still a URL the entry was reachable at.
      const localizedSlugsBefore = promotion
        ? await this.readCompanionSlugsAllLocales(
            this.db,
            params.collectionName,
            params.entryId
          )
        : [];
      // Read the fresh post-publish parent whenever the collection captures
      // versions or carries a status: the pre-transaction `previousStatus` can
      // be stale (a concurrent writer may commit between it and the lock), so a
      // transition detected only under the lock still needs the committed row
      // for its event payload rather than falling back to the stale pre-read.
      // An in-transaction handler is handed the entry as this publish leaves
      // it, so it needs that row too.
      // The in-transaction handlers, asked once for this write: a retried
      // attempt runs the same set.
      const inTransactionHandlers = this.inTransactionHandlersFor(
        params.collectionName
      );
      const needsFreshParent =
        !!versionsConfig?.enabled ||
        hasMainStatus ||
        inTransactionHandlers.length > 0;
      // Retry the whole publish+capture transaction on a version_no allocation
      // race, mirroring updateEntry.
      // Read committed when a handler runs; see `writeTransactionOptions`.
      const transactionOptions = this.writeTransactionOptions(
        inTransactionHandlers,
        versionConflictRetries()
      );
      // The entry's own status once the move is done: the direction's where the shared part moves,
      // else the one the row held under the lock, which a move of chosen languages leaves as it is.
      const entryStatusAfter = () =>
        movesShared(params.parts)
          ? direction.nextStatus
          : (lockedPreviousStatus ?? direction.nextStatus);
      await this.adapter.transaction(async tx => {
        // Lock the main row up front. One read serves three needs: it is the
        // liveness check (a row deleted between the pre-transaction read and
        // this lock is gone here, so the publish writes and records nothing);
        // it carries the committed status the publish transition is judged
        // against; and it is the document a deferred publish rule re-checks.
        // Reset per attempt because the conflict retry re-runs this closure:
        // nothing a lost attempt judged, wrote or recorded carries into this
        // one.
        entryVanished = false;
        lockedPreviousStatus = previousStatus;
        publishFirstPublishedAt = undefined;
        perLocaleTransitions = [];
        promotedForHooks = [];
        defaultCompanionTransitions = false;
        publishedParentRow = undefined;
        eventRecorded = false;
        publishVersionNo = null;
        publishLanguages = [];
        slugsBefore = undefined;
        outOfDateShared = undefined;
        const lockedRow = await tx.selectOne<Record<string, unknown>>(
          tableName,
          { where: this.whereEq("id", params.entryId), forUpdate: true }
        );
        if (!lockedRow) {
          // Nothing to publish — record nothing and roll back an empty tx.
          entryVanished = true;
          return;
        }
        const lockedStatusRaw = (lockedRow as { status?: unknown }).status;
        lockedPreviousStatus =
          typeof lockedStatusRaw === "string" ? lockedStatusRaw : null;

        // The committed pre-publish row in the main-table schema shape, read on
        // the TRANSACTION connection (never the pool: the transaction already
        // holds a connection, and a pooled read would wait on itself against a
        // one-connection pool and deadlock). This is the concurrency-correct
        // event pre-image. Read after the lock, so on a retry it reflects the
        // concurrent winner just like the pre-read did.
        const [lockedSchemaRow] = (await tx
          .getDrizzle<typeof this.db>()
          .select()
          .from(schema)
          .where(eq(schema.id, params.entryId))
          .limit(1)) as (Record<string, unknown> | undefined)[];
        const preImageRow = lockedSchemaRow ?? existingEntry;

        // Each locale's committed per-locale status BEFORE anything below
        // writes, so a real draft->published transition can be told from a
        // locale that was already live. Read under the lock and inside the
        // retry so it reflects the state this publish actually overwrites;
        // what goes live, each language's outcome and the events all read it.
        const priorCompanionStatuses = await this.priorCompanionStatusesOnTx(
          tx,
          {
            companion: companionPublishable ? companion : null,
            collectionName: params.collectionName,
            entryId: params.entryId,
          }
        );

        // Taking the shared part down while a language not chosen stays live would leave that
        // language shown without it. Judged here, under the lock, on the statuses this write
        // overwrites: a language published since the request was judged refuses it too.
        if (params.parts !== undefined && params.parts.shared && !publishes) {
          const chosen = params.parts.locales;
          const stillLive = [...priorCompanionStatuses]
            .filter(
              ([locale, status]) =>
                status === "published" && !chosen.has(locale)
            )
            .map(([locale]) => locale);
          if (stillLive.length > 0) {
            const refusal = NextlyError.conflict({
              reason: "state",
              message:
                `The shared part stays live while ${stillLive.join(", ")} ` +
                `${stillLive.length === 1 ? "is" : "are"} published: unpublish ` +
                `${stillLive.length === 1 ? "it" : "them"} too, or keep the shared part. ` +
                `Nothing was changed.`,
              logContext: {
                cause: "shared-part-under-live-languages",
                collection: params.collectionName,
                stillLive,
              },
            });
            publishRefused = refusal;
            throw refusal;
          }
        }

        // Every language's pending change, in the order their languages
        // last saved, read under the lock: a change saved after the rule was
        // asked either landed before this read, and is promoted, or waits
        // for this publish to commit. A change kept for a language the app
        // no longer configures is promoted and consumed too, as a Single's
        // publish does, so none is left to resurface.
        // A publish of chosen parts promotes only theirs: each chosen language's change, and the
        // shared part's own (kept under no language) only when the shared part moves.
        const pending = promotion
          ? (await pendingChangesInSaveOrder(tx, draftRef)).filter(change =>
              change.locale === null
                ? movesShared(params.parts)
                : movesLanguage(params.parts, change.locale)
            )
          : [];

        // What goes live, re-read on the row this transaction locked and
        // before anything is written. A language the rule was not asked
        // about refuses the publish as a conflict, so nothing goes live.
        const languagesChanged = await this.languagesChangedUnderLock({
          collectionName: params.collectionName,
          entryId: params.entryId,
          row: preImageRow,
          fields,
          ...promotes,
          parts: params.parts,
          tx,
          asked: askedLanguages,
        });
        if (languagesChanged) {
          publishRefused = languagesChanged;
          throw languagesChanged;
        }

        // Each filter the lifecycle's rule answered, matched again on the row
        // as it is locked, so a change since it was judged above moves
        // nothing. Before anything about the entry is judged, so a caller
        // who may not move it is refused as that, never told what in it is
        // invalid or out of date.
        const outsideUnderLock = await this.refusalOutsideWriteFilters(
          tx,
          schema,
          params.entryId,
          lifecycleChecks
        );
        if (outsideUnderLock) {
          publishDocDenied = outsideUnderLock;
          throw new StatusTransitionDeniedError();
        }

        // Judged under the lock, once the caller is known to still be
        // allowed to move the entry and before anything is written: the
        // entry's own row, then every language it moves. A refusal throws,
        // rolling back whatever this transaction would have moved.
        const mainBefore = await refuseIfMainMoved(
          tx,
          this.dialect,
          versionCheck,
          {
            table: tableName,
            id: params.entryId,
            languages: languagesJudged(languagesTable, judgedLocales),
          },
          staleWrite
        );
        const languagesBefore = judgedLanguageStates(mainBefore, judgedLocales);

        // One instant for everything this attempt writes.
        const publishNow = new Date();
        const configuredLocales = new Set(
          this.localization?.locales.map(l => l.code) ?? []
        );
        const defaultLocale = this.localization?.defaultLocale;
        // Each language's pending change as the write lands it, judged
        // before anything is written.
        const promotions: PendingPromotion[] = [];
        // The languages this publish tells (`languagesTold`). Every pending
        // change is promoted or the publish is refused, so the languages
        // promoted are those holding one.
        const promotedLocales = new Set(
          pending.flatMap(change =>
            change.locale === null ? [] : [change.locale]
          )
        );
        // Only the chosen languages are told, where a publish chooses some.
        const told = publishes
          ? languagesTold({
              configured: configuredLocales,
              defaultLocale: defaultLocale ?? "",
              prior: priorCompanionStatuses,
              promoted: promotedLocales,
              mainStatus: lockedRow.status,
            }).filter(language => movesLanguage(params.parts, language.locale))
          : [];
        // Each told language, and each pending change's, as stored before
        // anything is written, in one read for them all, once the shared
        // values refuse nothing: what a change's promotion is judged
        // against, and what the events report as `previous`. The promotion
        // rewrites the translation rows, the shared values and the
        // component tables they would otherwise be read from afterwards.
        let storedBefore = new Map<string | null, Record<string, unknown>>();
        const readStoredBefore = async () => {
          storedBefore = await this.languageDocumentsOnTx(tx, {
            row: preImageRow,
            collectionName: params.collectionName,
            entryId: params.entryId,
            tableName,
            fields,
            manyToManyFields,
            locales: [
              ...pending.map(change => change.locale),
              ...told.map(language => language.locale),
            ],
          });
        };

        if (publishes) {
          // Everything that goes live, judged on the row this transaction
          // locked and before anything is written, all or nothing: the
          // promotion applies every language's change to one main row and
          // consumes them together, so publishing some and refusing others
          // would leave the caller no way to say what happened. Each
          // refusal is kept, since the adapter re-wraps whatever leaves the
          // transaction.
          try {
            // A pending change behind live, or shared edits that can't be
            // combined or ordered, refuse the publish naming the fields,
            // through the one verdict a Single's publish reaches. Judged
            // against the shared values as they are live, read at no
            // language: a change's own translated values are its own, and
            // the fields every language shares are the same in each.
            const changes =
              promotion && pending.length > 0 && documentLocalized
                ? await sharedStateForPublish(
                    tx,
                    draftRef,
                    pending,
                    await this.liveSharedDocument(tx, {
                      collectionName: params.collectionName,
                      entryId: params.entryId,
                      tableName,
                      fields,
                      main: this.deserializeJsonFieldsForSnapshot(
                        convertTimestampsToCamelCase({ ...preImageRow }),
                        fields
                      ),
                      locale: null,
                    }),
                    refused => {
                      outOfDateShared = refused;
                      return Promise.resolve(new SharedValuesOutOfDateError());
                    }
                  )
                : pending;
            await readStoredBefore();
            promotions.push(
              ...(await this.promotionsJudgedOnTx(tx, {
                changes,
                pending,
                promotion,
                collection: publishCollection,
                collectionName: params.collectionName,
                entryId: params.entryId,
                storedId: String(existingEntry.id),
                tableName,
                storedBefore,
                companion,
                companionPublishable,
                hasMainStatus,
                caller: params,
                row: preImageRow,
                mainStatus: lockedRow.status,
                prior: priorCompanionStatuses,
                fields,
                manyToManyFields,
                updatedAt: publishNow,
              }))
            );
          } catch (refusal) {
            publishRefused = refusal;
            throw refusal;
          }

          // What the publish does to each configured language, judged from
          // the stored rows before anything is written, as a preview of it
          // judges it. Nothing pending is out of date by now: the shared
          // values were judged above.
          publishLanguages =
            companion && companionPublishable && this.localization
              ? await storedLanguageOutcomes(tx, {
                  companion,
                  localization: this.localization,
                  entryId: params.entryId,
                  pending,
                  prior: priorCompanionStatuses,
                  mainStatus: lockedRow.status,
                  outOfDate: new Map(),
                }).then(outcomes =>
                  outcomes.filter(outcome =>
                    movesLanguage(params.parts, outcome.locale)
                  )
                )
              : [];
        }

        // What an in-transaction handler is handed as the entry before this
        // publish: the default language's whole read-shape document (its
        // components, relations and translated values), read before anything
        // is written, and only when the write took a handler.
        const phaseBefore =
          inTransactionHandlers.length > 0
            ? (
                await this.languageDocumentsOnTx(tx, {
                  row: preImageRow,
                  collectionName: params.collectionName,
                  entryId: params.entryId,
                  tableName,
                  fields,
                  manyToManyFields,
                  locales: [null],
                })
              ).get(null)
            : undefined;

        // Where a promotion can rewrite a slug, the ones the entry was
        // reachable at until now: the main row's as locked, and each
        // language's as read before the transaction.
        if (promotions.length > 0) {
          slugsBefore = {
            slug: readStringField(preImageRow, "slug"),
            localized: localizedSlugsBefore,
          };
        }

        // The marker this publish records, if any, decided before anything
        // is written. Decided from the row read under the lock above, so an
        // already-published row records nothing — which matters most for
        // rows published before this column existed, whose marker is null
        // precisely because their history was never captured. Dating those
        // today would report a publication that never happened.
        //
        // Publish-all can find a document in a mixed state: a draft main row
        // alongside a translation that has been live since before this
        // column existed. The main row's own transition then reads as a
        // first publication when the document was already reachable, so the
        // same document-level question is asked here, of the translations as
        // stored before a promotion writes any. No locale is excluded — this
        // write publishes all of them, so any already-published one predates
        // it. Only a PUBLICATION can establish first publication. A
        // withdrawal leaves the marker untouched: it records when the
        // document first became reachable, which taking it down does not
        // change, and re-dating or clearing it would make a later republish
        // report a first publication that had already happened years
        // earlier. `firstPublishedStamp` stays undefined for a withdrawal,
        // and every use of it is already a conditional spread.
        if (
          hasMainStatus &&
          direction.stampsFirstPublished &&
          movesShared(params.parts)
        ) {
          const lockedMarker = (
            lockedRow as { first_published_at?: unknown } | undefined
          )?.first_published_at;
          const alreadyPublicBeforeThisWrite =
            lockedMarker == null
              ? await this.isDocumentAlreadyPublic(
                  tx,
                  params.collectionName,
                  params.entryId,
                  lockedPreviousStatus,
                  undefined
                )
              : false;
          publishFirstPublishedAt = resolveFirstPublishedStamp({
            hasStatus: true,
            previousStatus: alreadyPublicBeforeThisWrite
              ? "published"
              : lockedPreviousStatus,
            nextStatus: "published",
            existingMarker: lockedMarker,
            now: publishNow,
          });
        }

        // Every language's pending change goes live, each written as a
        // publish of that language alone writes it, then consumed. Without
        // this the statuses would all say published while the content each
        // author was holding stayed unapplied. Its field groups are saved
        // under the caller's field rules told the languages it was judged
        // in: that language, or every one for a language the app no longer
        // configures.
        const translated = new Set<string>();
        for (const promoted of promotions) {
          await withRuleLanguage(
            writeAsNamedLanguagesFor(
              this.localization,
              promoted.locale ?? undefined
            ),
            async () => {
              await this.writeRowAndTranslation(tx, {
                tableName,
                entryId: params.entryId,
                columns: promoted.columns,
                translation: promoted.translation,
                savedBy: actorForWrite(params.actor, params.user),
              });
              await this.writeRelations(tx, {
                collectionName: params.collectionName,
                entryId: params.entryId,
                tableName,
                fields: promotion?.context.fields ?? fields,
                manyToManyFields:
                  promotion?.context.manyToManyFields ?? manyToManyFields,
                componentFieldData: promoted.componentFieldData,
                componentLocale: promoted.locale ?? undefined,
                manyToManyData: promoted.manyToManyData,
                caller: params,
                // The publish's write in this language, on its transaction.
                write: this.validationWrite(
                  params.collectionName,
                  params.entryId,
                  tx,
                  promoted.locale ?? undefined,
                  promoted.payload
                ),
              });
            }
          );
          if (promoted.translation) {
            translated.add(promoted.translation.writeLocale);
          }
          // The shared draft goes with it only where the shared part moves too.
          await this.consumeWorkingDraft(
            tx,
            draftRef,
            promoted.locale,
            movesShared(params.parts)
          );
        }
        // A pending change the collection can no longer promote — drafts
        // turned off, or a schema the split no longer covers, such as a
        // password field added after the change was held — is consumed
        // with none of its content written, as a publish of one language
        // consumes it. Left in place it would go on shadowing the document
        // just published, and resurface over it if the split were turned
        // back on.
        if (publishes && !promotion) {
          for (const locale of await new VersionsRepository(
            tx
          ).listWorkingDraftLocales(draftRef)) {
            // Only the chosen parts' changes, where a publish chooses some.
            if (
              locale === null
                ? !movesShared(params.parts)
                : !movesLanguage(params.parts, locale)
            ) {
              continue;
            }
            await this.consumeWorkingDraft(
              tx,
              draftRef,
              locale,
              movesShared(params.parts)
            );
          }
        }

        // The entry's own status is the shared part's: written only where the shared part moves.
        if (hasMainStatus && movesShared(params.parts)) {
          // Through the adapter's Drizzle layer rather than an interpolated statement. That
          // also removes the reason the previous version needed a SQL `now()` expression: a
          // `Date` bound as a raw parameter stores wrong against SQLite's integer timestamps,
          // while Drizzle converts it per dialect. After the promotions, so the status and
          // marker this publish decides are the ones the row is left with.
          await tx.update(
            tableName,
            {
              status: direction.nextStatus,
              updated_at: publishNow,
              ...(publishFirstPublishedAt
                ? { first_published_at: publishFirstPublishedAt }
                : {}),
            },
            this.whereEq("id", params.entryId)
          );
        }
        // A move of every language is a save of the document, whether or
        // not its main row keeps a status of its own: changed at the moment
        // the status move above wrote to `updated_at`.
        await bumpDocumentRevision(
          tx,
          tableName,
          { id: params.entryId },
          actorForWrite(params.actor, params.user),
          publishNow
        );
        if (companion && companionPublishable) {
          // Every language's row in one statement, or each chosen language's own.
          for (const locale of params.parts === undefined
            ? [EVERY_LOCALE]
            : [...params.parts.locales]) {
            await this.writeCompanionStatus(tx, {
              companionTableName: companion.companionTableName,
              parentId: params.entryId,
              status: direction.nextStatus,
              locale,
              savedBy: actorForWrite(params.actor, params.user),
            });
          }
        }
        // Every language's version, after the moves above: what a caller
        // of a publish or takedown of every language holds next.
        allLocalesVersion = await documentVersionOn(tx, {
          dialect: this.dialect,
          table: tableName,
          id: params.entryId,
          languagesTable: translationTableOf(companion, companionReady),
          localization: this.localization,
          locale: EVERY_LOCALE,
        });

        if (needsFreshParent) {
          // The committed post-publish parent, read back on the lock this
          // transaction holds (read-your-writes): a promotion writes a
          // pending change's shared values to the row, so the locked row
          // with the status laid over it would still carry the old ones, in
          // the version the publish records and in every event's current
          // state. Undefined only if the row vanished, which the lock above
          // already rules out.
          const [writtenRow] = (await tx
            .getDrizzle<typeof this.db>()
            .select()
            .from(schema)
            .where(eq(schema.id, params.entryId))
            .limit(1)) as (Record<string, unknown> | undefined)[];
          publishedParentRow = writtenRow;

          // Record a version snapshot for the publish: publishing changes the
          // document's status, so history/audit should capture that state.
          // Components + m2m are read from the transaction (read-your-writes).
          // Status/owner/password handling matches the other capture paths. If
          // the row was deleted concurrently, skip — nothing committed to
          // snapshot.
          if (versionsConfig?.enabled && publishedParentRow) {
            const parentRow = convertTimestampsToCamelCase(
              this.deserializeJsonFieldsForSnapshot(
                { ...publishedParentRow },
                fields
              )
            );
            this.redactSnapshotRow(
              parentRow,
              fields,
              tableName,
              await this.passwordReach(fields, tx.getDrizzle())
            );
            const { components: snapshotComponents, manyToMany: snapshotM2M } =
              await this.buildFullSnapshotRelations(
                tx,
                params.entryId,
                params.collectionName,
                tableName,
                fields,
                manyToManyFields
              );
            // Always recorded: a publish of every language that changes only
            // a language's status, which this snapshot does not hold, would
            // otherwise compare equal with the version before.
            const capture = await captureInTx(tx, this.versionCapture, {
              lifecycle: hasLifecycle(publishCollection),
              ref: {
                scopeKind: "collection",
                scopeSlug: params.collectionName,
                entryId: params.entryId,
              },
              contentStatus: entryStatusAfter(),
              // Tagged like every other capture: a snapshot records which
              // component its values came from, whichever path produced it.
              parts: await this.snapshotPartsFor(
                {
                  parentRow,
                  components: snapshotComponents,
                  manyToMany: snapshotM2M,
                },
                fields,
                tx
              ),
              createdBy: params.user?.id ?? null,
              // Left unlabelled deliberately. Publishing spans every locale,
              // and this snapshot is the main row alone — on a migrated
              // collection the localized columns live only in the companion,
              // so it holds no locale's translatable values. Claiming one
              // would tell a restore to write content it never captured.
              locale: null,
              maxPerDoc: versionsConfig.maxPerDoc,
            });
            publishVersionNo = capture.versionNo;
          }
        }

        // Append the base `entry.updated` outbox event for the publish write,
        // then its publish lifecycle event, both on this transaction so they
        // commit with the status write and never survive a rollback. Built from
        // the post-publish document (the row re-read above, or the pre-read
        // row so the event still fires when no fresh read was needed). The
        // publish event is gated on a real main-row transition, matching the
        // post-commit `transitionStatus` below.
        const publishedDocument = this.readShapeEventDocument(
          {
            ...(publishedParentRow ?? preImageRow),
            status: entryStatusAfter(),
          },
          fields,
          tableName,
          await this.passwordReach(fields, tx.getDrizzle())
        );
        // The publish instant this write committed, overlaid AFTER
        // camelCasing as `updateEntry` overlays the `updatedAt` it wrote: a
        // snake-case overlay would be dropped because
        // `convertTimestampsToCamelCase` keeps the existing camelCase value,
        // and a row read without this write (no main lifecycle, or no fresh
        // read) carries the pre-publish `updatedAt`. Without this the event
        // can report the stale timestamp and omit `updatedAt` from
        // changedFields.
        publishedDocument.updatedAt = publishNow;
        // Built from the pre-image read under the lock, so a concurrent write
        // committed between the pre-transaction read and the lock is reflected
        // rather than the stale pre-read (its non-status fields and its own
        // prior status).
        const previousDocument = this.readShapeEventDocument(
          preImageRow as Record<string, unknown>,
          fields,
          tableName,
          await this.passwordReach(fields, tx.getDrizzle())
        );
        const publishEventFields = await this.webhookFieldTreeIfRecording(
          params.collectionName,
          fields,
          tx.getDrizzle()
        );
        const publishActor = actorForWrite(params.actor, params.user);
        // The trail's status before this write, across every language it
        // moves: the main row's and each companion's, read under the lock.
        // Publishing every language puts each one live, so it publishes the
        // entry whenever ANY of them was not, even with the main row already
        // live, when the changed fields name no status at all.
        const priorLanguageStatuses = [
          (preImageRow as { status?: unknown }).status as
            | string
            | null
            | undefined,
          ...priorCompanionStatuses.values(),
        ];
        const statusBeforeEveryLanguage = priorLanguageStatuses.every(
          status => status === "published"
        )
          ? "published"
          : (priorLanguageStatuses.find(status => status !== "published") ??
            null);
        const baseRecorded = await recordMutationEvent(tx, {
          type: "entry.updated",
          resource: {
            kind: "entry",
            collection: params.collectionName,
            id: params.entryId,
          },
          data: publishedDocument,
          previous: previousDocument,
          fields: publishEventFields,
          actor: publishActor,
          publication: {
            statusAfter: entryStatusAfter(),
            statusBefore: statusBeforeEveryLanguage,
            // A promotion leaves a live language published, so whether
            // this publish put pending edits live cannot be read from the
            // statuses.
            promotedPendingEdits: promotions.length > 0,
            requestEdits: promotions.some(p => p.carriesContent),
          },
        });
        eventRecorded = baseRecorded || eventRecorded;
        // The languages whose own translation row moves to `direction`'s
        // status here, each told by a locale-tagged transition below.
        // Decided once, before the untagged event and the tagged ones, so
        // both read one answer: a published translation row a promotion
        // creates counts, and a language with no row after the publish
        // shows the language it falls back to rather than going live.
        const taggedTransitions = new Set(
          publishes
            ? told
                .filter(
                  language =>
                    language.priorStatus !== direction.nextStatus &&
                    (priorCompanionStatuses.has(language.locale) ||
                      translated.has(language.locale))
                )
                .map(language => language.locale)
            : [...priorCompanionStatuses]
                .filter(
                  ([locale, priorLocaleStatus]) =>
                    (configuredLocales.size === 0 ||
                      configuredLocales.has(locale)) &&
                    movesLanguage(params.parts, locale) &&
                    priorLocaleStatus !== direction.nextStatus
                )
                .map(([locale]) => locale)
        );
        // Whether the default locale's own companion row transitions here.
        // When it does, the per-locale events below emit the default
        // locale's transition tagged `locale: <default>` — matching the
        // ordinary localized update path, where a default-locale status
        // that rides the companion is emitted locale-tagged and the untagged
        // main-row event is suppressed (its companion event already encodes
        // the transition). So a consumer routing the default language by its
        // locale still sees the default translation go live, once.
        defaultCompanionTransitions =
          defaultLocale !== undefined && taggedTransitions.has(defaultLocale);
        // The document-wide (main-row) publish transition, WITHOUT a locale
        // tag. Emitted only when a default-companion event does not already
        // encode it (a non-localized collection, or a default locale whose
        // status lives only on the main row) — otherwise the locale-tagged
        // default event below stands in, avoiding a duplicate. Gated on the
        // status read under the lock so a concurrent unpublish/publish is
        // judged correctly.
        if (
          hasMainStatus &&
          movesShared(params.parts) &&
          lockedPreviousStatus !== direction.nextStatus &&
          !defaultCompanionTransitions
        ) {
          const statusRecorded = await this.recordStatusEvents(tx, {
            collection: params.collectionName,
            id: params.entryId,
            from: lockedPreviousStatus,
            to: direction.nextStatus,
            isCreate: false,
            data: publishedDocument,
            previous: previousDocument,
            fields: publishEventFields,
            actor: publishActor,
          });
          eventRecorded = statusRecorded || eventRecorded;
        }
        if (publishes) {
          // Each told language's locale-tagged events, as a publish of that
          // language alone records them: an `entry.updated`, and, where the
          // language goes live with a translation row of its own, its move
          // to published. The bulk flip above moved every companion locale
          // in one statement, but a subscriber watching a single language
          // needs its own events, carrying that language's content as the
          // publish left it and as it stood before. The default locale is
          // included: its companion event replaces the untagged main event
          // suppressed above.
          // Every told language, and every promoted change's own slot, as
          // the publish left it, in one read. An unlocalized collection's
          // change is keyed by no language and tells none, so it is read
          // under its own key rather than found among the told ones.
          const storedAfter = await this.languageDocumentsOnTx(tx, {
            row: publishedParentRow ?? preImageRow,
            collectionName: params.collectionName,
            entryId: params.entryId,
            tableName,
            fields,
            manyToManyFields,
            locales: [
              ...told.map(language => language.locale),
              ...promotions.map(promoted => promoted.locale),
            ],
          });
          // What a publish of each promoted change alone hands its update
          // hooks: its durable document, against how it stood, both read
          // under the change's own key (`storedBefore` holds every pending
          // change's).
          promotedForHooks = promotions.flatMap(promoted => {
            const data = storedAfter.get(promoted.locale);
            return data === undefined
              ? []
              : [
                  {
                    data,
                    originalData: storedBefore.get(promoted.locale) ?? null,
                  },
                ];
          });
          for (const language of told) {
            const data = storedAfter.get(language.locale) ?? {};
            const previous = storedBefore.get(language.locale) ?? null;
            const statusBefore =
              typeof language.priorStatus === "string"
                ? language.priorStatus
                : null;
            const updatedRecorded = await recordMutationEvent(tx, {
              type: "entry.updated",
              resource: {
                kind: "entry",
                collection: params.collectionName,
                id: params.entryId,
                locale: language.locale,
              },
              data,
              previous,
              fields: publishEventFields,
              actor: publishActor,
              publication: {
                statusAfter: direction.nextStatus,
                statusBefore,
                promotedPendingEdits: language.promoted,
                requestEdits: promotions.some(
                  p => p.locale === language.locale && p.carriesContent
                ),
              },
            });
            eventRecorded = updatedRecorded || eventRecorded;
            if (!taggedTransitions.has(language.locale)) continue;
            const localeRecorded = await this.recordStatusEvents(tx, {
              collection: params.collectionName,
              id: params.entryId,
              locale: language.locale,
              from: statusBefore,
              to: direction.nextStatus,
              isCreate: false,
              data,
              previous,
              fields: publishEventFields,
              actor: publishActor,
            });
            eventRecorded = localeRecorded || eventRecorded;
            // Remember the transition so the same locale is replayed to the
            // in-process workflow subscribers post-commit, the way the
            // localized update path does — otherwise
            // `statusTransition`/`published` listeners never observe a
            // companion locale going live.
            perLocaleTransitions.push({
              locale: language.locale,
              from: statusBefore,
              data,
            });
          }
        } else {
          // Per-locale withdrawals. The bulk flip above moved every
          // companion locale in one statement, but a subscriber watching a
          // single language needs its own event — so each companion locale
          // that actually transitioned gets a locale-tagged event, with the
          // locale's own prior `_status` as the transition `from`. The
          // default locale is included: its companion event replaces the
          // untagged main event suppressed above. Only locales the app
          // still configures get an event, for the reason given above.
          for (const [locale, priorLocaleStatus] of priorCompanionStatuses) {
            if (!taggedTransitions.has(locale)) continue;
            // Build this locale's own before/after documents. A withdrawal
            // changes only status, so the locale's translatable values AND
            // its component subtrees are identical on both sides — read them
            // at this locale and assemble them onto the main-row event shape
            // so a `locale`-tagged event carries that language's full
            // content (fields and localized components) and its own prior
            // status, matching the ordinary localized update path. Read on
            // the transaction (read-your-writes).
            let rawLocaleValues: Record<string, unknown>;
            try {
              // These values feed a durable locale-tagged event; a real
              // companion read failure must abort rather than commit an
              // event missing this locale's translated fields.
              rawLocaleValues = await this.readCompanionLocalizedValues(
                tx,
                params.collectionName,
                params.entryId,
                locale
              );
            } catch (err) {
              // Normalize the raw driver error the same way the status scan
              // above does, so a schema/permission failure returns the
              // canonical internal error instead of leaking the driver's
              // message through the service failure result.
              throw NextlyError.internal({
                cause: err instanceof Error ? err : undefined,
                logContext: {
                  reason: "publish-all-locale-values-read",
                  collection: params.collectionName,
                  locale,
                },
              });
            }
            const localeValues = this.deserializeJsonFieldsForSnapshot(
              rawLocaleValues,
              fields
            );
            const { components: localeComponents, manyToMany: localeM2M } =
              await this.buildFullSnapshotRelations(
                tx,
                params.entryId,
                params.collectionName,
                tableName,
                fields,
                manyToManyFields,
                locale
              );
            // Strip parent-level password fields before assembling: a
            // localized group/repeater can carry a nested password hash the
            // overlay reintroduces after `publishedDocument` was already
            // redacted. The durable outbox re-strips while building its
            // envelope, but the in-process `transitionStatus` replay
            // receives this document unchanged, so strip here to protect
            // both paths. Component subtrees are already password-stripped
            // by the snapshot read.
            const localeDataParent = {
              ...publishedDocument,
              ...localeValues,
              status: direction.nextStatus,
            };
            const localeReach = await this.passwordReach(
              fields,
              tx.getDrizzle()
            );
            stripPasswordFieldValues(localeDataParent, fields, localeReach);
            const localePrevParent = {
              ...previousDocument,
              ...localeValues,
              status: priorLocaleStatus,
            };
            stripPasswordFieldValues(localePrevParent, fields, localeReach);
            const localeData = assembleDocument({
              parentRow: localeDataParent,
              components: localeComponents,
              manyToMany: localeM2M,
            });
            const localePrevious = assembleDocument({
              parentRow: localePrevParent,
              components: localeComponents,
              manyToMany: localeM2M,
            });
            const localeRecorded = await this.recordStatusEvents(tx, {
              collection: params.collectionName,
              id: params.entryId,
              locale,
              from: priorLocaleStatus,
              to: direction.nextStatus,
              isCreate: false,
              data: localeData,
              previous: localePrevious,
              fields: publishEventFields,
              actor: publishActor,
            });
            eventRecorded = localeRecorded || eventRecorded;
            // Replayed post-commit, as for a publish above.
            perLocaleTransitions.push({
              locale,
              from: priorLocaleStatus,
              data: localeData,
            });
          }
        }

        // The move may not leave the entry outside a filter that judged it,
        // matched once every language it moved is written.
        const movedOut = await this.refusalMovedOutOfWriteFilters(
          tx,
          schema,
          params.entryId,
          lifecycleChecks
        );
        if (movedOut) {
          publishDocDenied = movedOut;
          throw new StatusTransitionDeniedError();
        }

        // Which media items the entry uses now. A publish that promoted held
        // working drafts wrote their content, in any language, so every
        // language is read again.
        await this.recordEntryMediaUsage(tx, {
          collectionName: params.collectionName,
          entryId: params.entryId,
          tableName,
          fields,
        });

        // An overwrite is recorded whatever the document keeps, in this
        // transaction, so a move that cannot record it is not kept either.
        await this.recordOverwriteIfAsked(
          tx,
          versionCheck,
          {
            collection: params.collectionName,
            id: params.entryId,
            actor: params.actor,
            user: params.user,
          },
          {
            main: mainBefore,
            language: undefined,
            languages: languagesBefore,
            locale: undefined,
          }
        );

        // One history event for the whole publish, naming the languages it
        // moved, rather than one per language as the deliveries above are.
        // A language whose pending change went live is recorded moving from
        // draft to published, as its publish alone records it, though it
        // was published before and after: the move is the change's. So is a
        // main row whose change, kept under no language, went live.
        const localeMoves = new Map(
          perLocaleTransitions.map(t => [t.locale, t.from])
        );
        for (const language of told) {
          if (
            language.promoted &&
            (priorCompanionStatuses.has(language.locale) ||
              translated.has(language.locale))
          ) {
            localeMoves.set(language.locale, "draft");
          }
        }
        await this.recordTransitionHistory(
          tx,
          params.collectionName,
          params.entryId,
          {
            actor: publishActor,
            personName: params.user?.name ?? null,
            versionNo: publishVersionNo,
          },
          [
            // The entry's own move only where the shared part moved: a move of chosen languages
            // alone leaves the entry's status, so its history records none.
            ...(hasMainStatus && movesShared(params.parts)
              ? [
                  {
                    from: promotions.some(p => p.locale === null)
                      ? "draft"
                      : lockedPreviousStatus,
                    to: direction.nextStatus,
                  },
                ]
              : []),
            ...[...localeMoves].map(([locale, from]) => ({
              locale,
              from,
              to: direction.nextStatus,
            })),
          ]
        );

        // Last in the transaction, as on an update: publishing or withdrawing
        // every language is an update of the entry, and is retried as one.
        // The handler is handed the default language's whole read-shape
        // document as the publish left it, against the one read before
        // anything was written; both read only when it took a handler. No
        // hook context is shared on this path, so the handler's is empty.
        const phaseAfter =
          inTransactionHandlers.length > 0
            ? (
                await this.languageDocumentsOnTx(tx, {
                  row: publishedParentRow ?? preImageRow,
                  collectionName: params.collectionName,
                  entryId: params.entryId,
                  tableName,
                  fields,
                  manyToManyFields,
                  locales: [null],
                })
              ).get(null)
            : undefined;
        await this.runInTransactionPhase(tx, inTransactionHandlers, {
          collection: params.collectionName,
          operation: "update",
          id: params.entryId,
          data: phaseAfter,
          originalData: phaseBefore ?? null,
          user: params.user,
          context: {},
        });
      }, transactionOptions);

      // The entry was deleted out from under the publish: nothing was written or
      // recorded, so answer not-found rather than a success for absent content.
      if (entryVanished) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }
      // Saved only once it is durable. Inside an enclosing SQLite transaction
      // the publish is a savepoint that transaction can still roll back, so
      // until it commits a failure below is not a saved change.
      await this.afterCommit(() => {
        committedWrite = true;
      });

      // Once the publish is durable: inside an enclosing SQLite transaction,
      // once that commits, and never for a publish it rolls back.
      await this.afterCommit(async () => {
        // Post-commit status events: publishing is a real status transition, so
        // workflow subscribers on statusTransition/published must see it (this
        // path previously changed status without emitting anything). Skip when the
        // main row was already published (no transition, judged on the status read
        // under the lock), matching updateEntry. Prefer the fresh in-tx row; fall
        // back to the pre-read only if the row vanished mid-publish.
        if (
          hasMainStatus &&
          movesShared(params.parts) &&
          lockedPreviousStatus !== direction.nextStatus &&
          !defaultCompanionTransitions
        ) {
          this.transitionStatus({
            collection: params.collectionName,
            id: params.entryId,
            data: publishedParentRow ?? {
              ...(existingEntry as Record<string, unknown>),
              status: direction.nextStatus,
            },
            user: params.user,
            previousStatus: lockedPreviousStatus,
            status: direction.nextStatus,
            emitStatusChanged: true,
          });
        }
        // Each companion locale that went live, replayed to the in-process
        // workflow subscribers with its own `locale` — mirroring the localized
        // update path — so `statusTransition`/`statusChanged`/`published`
        // listeners observe every published translation, not only the main row.
        for (const transition of perLocaleTransitions) {
          this.transitionStatus({
            collection: params.collectionName,
            id: params.entryId,
            data: transition.data,
            user: params.user,
            previousStatus: transition.from,
            status: direction.nextStatus,
            emitStatusChanged: true,
            locale: transition.locale,
          });
        }

        // emit the post-commit "updated" reaction event so cache
        // revalidation / webhooks fire, matching a single-locale publish. Before
        // the update hooks below, as every write announces its commit: the row
        // is read as the publish committed it. Best-effort: a reaction failure
        // must not fail the already-committed publish.
        try {
          const [updated] = await this.db
            .select()
            .from(schema)
            .where(eq(schema.id, params.entryId))
            .limit(1);
          if (updated) {
            emitCollectionEvent(
              "updated",
              params.collectionName,
              updated as Record<string, unknown>,
              params.user
            );
          }
        } catch {
          // Reaction/event emission is non-critical; the publish already committed.
        }

        // The update hooks this move runs once it is durable: the
        // collection's code-registered and stored `afterUpdate` hooks, then
        // the fields' `afterChange`, sharing the context its before hooks
        // ran with. A publish that put pending changes live runs them for
        // each such language, with its durable document, as a publish of
        // that language alone runs them: it wrote content, not only a
        // status, so an integration that skips the earlier working-draft
        // save sees it here. Any other move runs them once, with the entry
        // as the move left it, as a status change of one language does.
        // Never both: the languages a promotion reported are the write.
        //
        // A move that put nothing live changed the statuses and no field, so
        // the fields' `afterChange` runs only for `status`, as a write runs
        // that phase only for the fields it touched (`updateEntryWrite`): the
        // row it is handed carries every shared field, and a handler that
        // mails or re-indexes on a change would act on an unchanged value.
        // The whole row is still handed over, so a handler that does run can
        // read its siblings.
        const afterRuns: {
          data: Record<string, unknown>;
          originalData: Record<string, unknown> | null;
          touched?: ReadonlySet<string>;
        }[] =
          promotedForHooks.length > 0
            ? promotedForHooks
            : [
                {
                  data: publishedParentRow ?? {
                    ...(existingEntry as Record<string, unknown>),
                    status: direction.nextStatus,
                  },
                  originalData: existingEntry as Record<string, unknown>,
                  touched: new Set(["status"]),
                },
              ];
        for (const run of afterRuns) {
          await this.hookService.hookRegistry.execute(
            "afterUpdate",
            this.hookService.buildHookContext({
              collection: params.collectionName,
              operation: "update" as const,
              data: run.data,
              originalData: run.originalData ?? undefined,
              user: params.user,
              context: sharedContext,
              req: requestFacts,
            })
          );
          await this.hookService.storedHookExecutor.execute(
            "afterUpdate",
            storedHooks,
            this.hookService.buildPrebuiltHookContext({
              collection: params.collectionName,
              operation: "update",
              data: run.data,
              queryDatabase: this.queryDatabaseFn,
              user: params.user,
              sharedContext,
              req: requestFacts,
            })
          );
          await runFieldHooks({
            kind: "collection",
            slug: params.collectionName,
            phase: "afterChange",
            data: run.data,
            operation: "update",
            user: params.user,
            only: run.touched,
          });
        }
      });

      const intentFor = (localizedSlugs?: string[]) =>
        buildEntryRevalidationIntent(
          params.collectionName,
          readRevalidateConfig(publishCollection),
          {
            id: params.entryId,
            // Prefer the committed post-publish row's slug so a concurrent rename
            // that landed after the pre-read still busts the actually-published
            // URL; fall back to the pre-read only when no fresh row was
            // reconstructed.
            slug: readStringField(
              (publishedParentRow ?? existingEntry) as Record<string, unknown>,
              "slug"
            ),
            // The slug the entry was reachable at before a promoted pending
            // change rewrote it, so a read cached under the old URL clears.
            previousSlug: slugsBefore?.slug,
            localizedSlugs,
          }
        );
      // Set before the slug read below, which can fail after the commit. The
      // failure result carries it, so a durable publish or unpublish still busts
      // the entry's id and slug tags, though the caller is told not to retry.
      revalidationIntent = intentFor(slugsBefore?.localized);

      // Publishing all locales makes every locale's slug public at once, so bust
      // each localized slug's tag, read post-commit on the pool, where the
      // committed companion slugs are the ones a promotion left. Each one a
      // promotion replaced is busted with them.
      const publishedLocalizedSlugs = await this.readCompanionSlugsAllLocales(
        this.db,
        params.collectionName,
        params.entryId
      );
      revalidationIntent = intentFor([
        ...new Set([
          ...(slugsBefore?.localized ?? []),
          ...publishedLocalizedSlugs,
        ]),
      ]);

      return {
        success: true,
        statusCode: 200,
        message: direction.successMessage,
        data: withDocumentVersion(
          {
            id: params.entryId,
            status: entryStatusAfter(),
            // What the publish did to each configured language, as its preview
            // says it would.
            ...(publishes ? { languages: publishLanguages } : {}),
          },
          allLocalesVersion
        ),
        eventRecorded,
        revalidationIntent,
      };
    } catch (error) {
      // A refusal found inside the transaction, answered now it has rolled
      // back: out of date, from the entry as it now is so it names the save
      // that came in between; or refused by the under-lock document-rule
      // re-check, the 403 it resolved rather than a 500.
      const refused = await this.refusalAfterRollback(
        { params, check: versionCheck, holder: staleWrite },
        publishDocDenied
      );
      if (refused) {
        return refused;
      }
      // A pending change behind live refuses the publish naming the shared
      // fields, built here, after the transaction: the caller's field read
      // rules resolve grants on a pooled connection.
      const refusal = outOfDateShared
        ? await sharedValuesConflict({
            kind: "collection",
            slug: params.collectionName,
            entryId: params.entryId,
            ...outOfDateShared,
            user: params.user,
            // A routed request runs trusted but still answers to the
            // caller's field read rules.
            overrideAccess: params.overrideAccess && !params.routeAuthorized,
            authenticatedScope: params.authenticatedScope,
          })
        : (publishRefused ?? error);
      // A translation table dropped after its `ready` verdict was remembered
      // fails the publish at its first statement on it: answered, after the
      // rollback, as a write of one language to a table that is not there is
      // answered. Only for a publish that did not commit.
      const companionGone = await this.companionGoneResult(
        {
          collectionName: params.collectionName,
          locale: undefined,
          committed: committedWrite,
          defaultMessage: "Failed to publish all languages",
        },
        refusal
      );
      if (companionGone) return companionGone;
      // A publish the database is not migrated for answers as such.
      const thrown = await asNotMigrated(
        refusal,
        collectionNotMigrated(this.collectionService, params.collectionName, {
          trusted: fieldTrustOf(params),
        }),
        { written: committedWrite }
      );
      return {
        success: false,
        statusCode: 500,
        message:
          thrown instanceof Error
            ? thrown.message
            : "Failed to publish all languages",
        data: null,
        // A typed error keeps its own status and code. Hardcoding 500 reported
        // a hook's refusal or rate limit as a server fault, and left a boundary
        // nothing to rebuild it from.
        ...errorEnvelopeFields(thrown),
        committed: committedWrite,
        // Set only once the publish has committed, so its tags flush whatever
        // failed after it.
        revalidationIntent,
      };
    }
  }

  /**
   * Every stored translation's committed `_status`, read on `tx`, or none
   * where the entry's translations carry no status of their own.
   *
   * The reader already tolerates a translations table that is not there, so
   * anything thrown is a real database failure, normalized to the canonical
   * internal error: the driver's message can carry schema or connection
   * details that must not reach the caller through the service's result.
   */
  private async priorCompanionStatusesOnTx(
    tx: TransactionContext,
    args: {
      /** The translations, where they carry a status; null otherwise. */
      companion: CompanionSchema | null;
      collectionName: string;
      entryId: string;
    }
  ): Promise<Map<string, string | null>> {
    if (!args.companion) return new Map();
    try {
      return await readCompanionLocaleStatusAll(
        tx.getDrizzle<Parameters<typeof readCompanionLocaleStatusAll>[0]>(),
        args.companion.table,
        args.entryId,
        cachedCompanionReadiness(
          this.adapter,
          args.companion.companionTableName
        )
      );
    } catch (err) {
      throw NextlyError.internal({
        cause: err instanceof Error ? err : undefined,
        logContext: {
          reason: "publish-all-companion-status-scan",
          collection: args.collectionName,
        },
      });
    }
  }

  /**
   * Refuses a publish whose shared draft changes a value the caller may not change in a language
   * that shows the shared part. The shared part's values show in every language it is live in, so
   * its field rules are asked in each of them, not only in the language whose change carries it:
   * a rule that refuses a change in Spanish refuses it whichever language the publish chose. Asked
   * of the shared draft's own values alone, so a language's translated values are never judged in
   * another language. Nothing to ask where the caller is trusted or no field rule could ask.
   */
  private async refuseSharedDraftOutsideFieldRules(
    tx: TransactionContext,
    args: Parameters<CollectionMutationService["promotionsJudgedOnTx"]>[1],
    promotion: NonNullable<LifecycleAllLocalesReady["promotion"]>
  ): Promise<void> {
    const sharedDraft = args.pending.find(
      change => change.locale === SHARED_DRAFT_SLOT
    );
    const user = args.caller.user;
    const grants = promotion.grants;
    if (
      sharedDraft === undefined ||
      args.caller.overrideAccess === true ||
      user === undefined ||
      grants === undefined
    ) {
      return;
    }
    // The shared values as they are live, which are the same in every language's document.
    const live =
      args.storedBefore.get(null) ?? [...args.storedBefore.values()][0];
    if (live === undefined) return;
    // Every language that shows the shared part once this publish is done: each one where
    // everything moves, else the chosen ones and those already live.
    const showing = (this.localization?.locales ?? [])
      .map(language => language.code)
      .filter(
        locale =>
          movesLanguage(args.caller.parts, locale) ||
          args.prior.get(locale) === "published"
      );
    const issues: ValidationIssue[] = [];
    for (const locale of showing) {
      const refused = await withRuleLanguage(
        writeLanguagesFor(this.localization, locale),
        () =>
          this.promotionAccessIssues(promotion.context, {
            collectionName: args.collectionName,
            entryId: args.storedId,
            snapshot: sharedDraft.snapshot,
            restoreCtx: promotion.restoreContext,
            live,
            user,
            authenticatedScope: args.caller.authenticatedScope,
            grants,
          })
      );
      issues.push(...refused.map(issue => ({ ...issue, locale })));
    }
    if (issues.length > 0) throw NextlyError.validation({ errors: issues });
  }

  /**
   * The gate a publish of every language passes, judged on `tx` before
   * anything is written: each pending change's promotion
   * (`pendingChangePromotion`), then every language the publish puts live as
   * it is stored, validated as it goes live, as a publish of that language
   * alone validates it. Refused by throwing; the promotions otherwise. One
   * implementation for the publish and for its preview, so the preview
   * reports exactly what the publish would refuse.
   */
  private async promotionsJudgedOnTx(
    tx: TransactionContext,
    args: {
      /** Each pending change, carrying the shared state the publish leaves. */
      changes: readonly PendingChange[];
      /** Each pending change as stored. */
      pending: readonly PendingChange[];
      /** How a change is promoted; null where nothing can be. */
      promotion: LifecycleAllLocalesReady["promotion"];
      collection: unknown;
      collectionName: string;
      entryId: string;
      /** The entry's id as stored, which the rules are told. */
      storedId: string;
      tableName: string;
      /** Each pending change's language as stored, read on `tx`. */
      storedBefore: ReadonlyMap<string | null, Record<string, unknown>>;
      companion: CompanionSchema | null;
      companionPublishable: boolean;
      hasMainStatus: boolean;
      caller: AllLocalesLifecycleParams;
      /** The main row, as this transaction reads it. */
      row: Record<string, unknown>;
      /** The main row's status before the publish. */
      mainStatus: unknown;
      /** Each stored translation's status before the publish. */
      prior: Map<string, string | null>;
      fields: FieldDefinition[];
      /** The collection's many-to-many fields, read as stored as each language goes live. */
      manyToManyFields: FieldDefinition[];
      updatedAt: Date;
    }
  ): Promise<PendingPromotion[]> {
    const { promotion } = args;
    const configuredLocales = new Set(
      this.localization?.locales.map(l => l.code) ?? []
    );
    const defaultLocale = this.localization?.defaultLocale;
    const promotions: PendingPromotion[] = [];
    if (promotion) {
      for (const change of args.changes) {
        const finalData = await this.languagePayloadOnTx(tx, {
          collectionName: args.collectionName,
          locale: change.locale,
          payload: promotion.context.finalData,
        });
        promotions.push(
          await this.pendingChangePromotion(tx, {
            change,
            context: promotion.context,
            restoreContext: promotion.restoreContext,
            collection: args.collection,
            collectionName: args.collectionName,
            entryId: args.entryId,
            storedId: args.storedId,
            tableName: args.tableName,
            live: storedLiveOf(args.storedBefore, change.locale),
            finalData,
            companion: args.companion,
            caller: args.caller,
            grants: promotion.grants,
            updatedAt: args.updatedAt,
          })
        );
      }
      await this.refuseSharedDraftOutsideFieldRules(tx, args, promotion);
    }
    // Every other language this puts live goes live as it is stored, each
    // judged when it was saved as a draft and never as published: validated
    // as each goes live, as a single publish of it would be, through the same
    // step as the single-entry publish, so the two cannot judge one document
    // differently. With a change promoted, every stored translation is
    // judged, since the change can rewrite the shared values beneath a
    // language already live; a language whose change was judged above is not
    // judged again.
    const reads = await this.everyLanguageReadsOnTx(
      tx,
      args.collectionName,
      args.entryId
    );
    // The fields every language shares, whose promoted values land beneath
    // each language judged below.
    const sharedNames = new Set(
      args.fields.flatMap(field =>
        typeof field.name === "string" && field.localized !== true
          ? [field.name]
          : []
      )
    );
    await this.assertLanguagesGoLiveValid({
      parts: args.caller.parts,
      collectionName: args.collectionName,
      entryId: args.entryId,
      // Each language judged as stored is judged over the shared values the
      // publish leaves, not those it replaces: every promotion writes the
      // same shared state, so a language with no change of its own lands as
      // its translation over the promotions' shared fields. Only the main
      // row's own shared fields are taken, by the names the row is read
      // under, so no language's translated values reach another's.
      row: promotions.reduce<Record<string, unknown>>(
        (row, promoted) => ({
          ...row,
          ...Object.fromEntries(
            Object.entries(promoted.payload).filter(
              ([name]) => name in args.row && sharedNames.has(name)
            )
          ),
        }),
        args.row
      ),
      patch: {},
      writeLocale: undefined,
      writeLocaleValues: {},
      perLocaleStatus: false,
      everyLanguage: true,
      // Told only the issues on fields the caller may read.
      reader: args.caller,
      // A change kept under no language is the main row's own.
      writeLocalePromoted: promotions.some(p => p.locale === null),
      ...(promotions.length > 0
        ? {
            promotedLocales: new Set(
              promotions.flatMap(p => (p.locale === null ? [] : [p.locale]))
            ),
            alsoGoingLive: languagesGoingLiveAsStored(
              {
                hasMainStatus: args.hasMainStatus,
                translationsPublishable:
                  !!args.companion && args.companionPublishable,
              },
              args.pending,
              { mainStatus: args.mainStatus, companion: args.prior },
              configuredLocales
            ).flatMap(language => {
              const locale = language.locale ?? defaultLocale;
              return locale === undefined ? [] : [locale];
            }),
          }
        : {}),
      fields: args.fields,
      user: args.caller.user,
      tx,
      // Publishing every language takes no values of its own: each language's
      // components and relationships go live as stored, read once for every
      // language through the locked row's own batch.
      relations: {
        tableName: args.tableName,
        manyToManyFields: args.manyToManyFields,
        componentFieldData: {},
        manyToManyData: {},
        componentSchemas: null,
        batch: reads.relations,
      },
      // Every language's translations read once for the whole judgement.
      reads,
    });
    return promotions;
  }

  /**
   * What publishing every language of an entry would do, language by
   * language, without doing it.
   *
   * Asked as the publish is asked: the same refusals before any read and the
   * same publish permission and rule in each language it would put live
   * (`lifecycleAllLocalesPreconditions`), so a caller who may not publish is
   * not told what a publish would do. Then the same verdict, read on a
   * transaction that writes nothing and takes no lock: the shared values
   * first, and, where they refuse nothing, the promotion's gate
   * (`promotionsJudgedOnTx`). Every refusal is named as the caller may read
   * it.
   */
  async previewPublishAllLocales(
    params: AllLocalesLifecycleParams
  ): Promise<CollectionServiceResult> {
    // Refused first when the collection is removed from code, as the publish
    // it previews is.
    await refuseWriteIfRemovedFromCode("collection", params.collectionName);
    try {
      const preconditions = await this.lifecycleAllLocalesPreconditions(
        PUBLISH_ALL_LOCALES,
        params
      );
      if ("answer" in preconditions) {
        const { data, ...rest } = preconditions.answer;
        // A success here changes nothing: there is nothing to report.
        return data
          ? {
              ...rest,
              data: { id: params.entryId, languages: [], blockers: [] },
            }
          : preconditions.answer;
      }
      const ready = preconditions.ready;
      // Resolved before the transaction, as the publish resolves them: they
      // query the pooled connection. Only where the field read rules name the
      // fields this answer lists: a trusted caller's are named as stored.
      const grants =
        ready.promotion?.grants ??
        (params.overrideAccess && !params.routeAuthorized
          ? undefined
          : await this.resolvedGrants(params.user, params.authenticatedScope));
      const preview = await this.adapter.transaction(tx =>
        this.previewAllLocalesOnTx(tx, ready, params, grants)
      );
      return {
        success: true,
        statusCode: 200,
        message: "What publishing every language does.",
        data: { id: params.entryId, ...preview },
      };
    } catch (error) {
      // Answered as the publish answers it: a translations table found
      // missing, then a database not migrated for the collection, are named
      // as such; anything else keeps its own status.
      const companionGone = await this.companionGoneResult(
        {
          collectionName: params.collectionName,
          locale: undefined,
          committed: false,
          defaultMessage: "Failed to preview publishing all languages",
        },
        error
      );
      if (companionGone) return companionGone;
      const thrown = await asNotMigrated(
        error,
        collectionNotMigrated(this.collectionService, params.collectionName, {
          trusted: fieldTrustOf(params),
        }),
        { written: false }
      );
      return {
        success: false,
        statusCode: 500,
        message:
          thrown instanceof Error
            ? thrown.message
            : "Failed to preview publishing all languages",
        data: null,
        ...errorEnvelopeFields(thrown),
      };
    }
  }

  /**
   * What publishing every language would do, read on one transaction that
   * writes nothing and locks nothing, judged in the order the publish judges
   * it: the planner's verdict on the shared values, then, where that refuses
   * nothing, the promotion's own gate on what the write would leave.
   */
  private async previewAllLocalesOnTx(
    tx: TransactionContext,
    ready: LifecycleAllLocalesReady,
    params: AllLocalesLifecycleParams,
    grants: (() => Promise<CallerGrants>) | undefined
  ): Promise<{ languages: LanguageOutcome[]; blockers: PublishAllBlocker[] }> {
    const {
      schema,
      existingEntry,
      publishCollection,
      hasMainStatus,
      companion,
      companionPublishable,
      fields,
      promotion,
      documentLocalized,
      draftRef,
    } = ready;
    const tableName = collectionTableName(
      publishCollection,
      params.collectionName
    );
    const manyToManyFields = fields.filter(
      f => f.type === "relationship" && f.options?.relationType === "manyToMany"
    );
    // The main row as committed, in the main-table schema shape, read on the
    // transaction and with no lock: the preview changes nothing.
    const [storedRow] = (await tx
      .getDrizzle<typeof this.db>()
      .select()
      .from(schema)
      .where(eq(schema.id, params.entryId))
      .limit(1)) as (Record<string, unknown> | undefined)[];
    const row = storedRow ?? (existingEntry as Record<string, unknown>);
    const prior = await this.priorCompanionStatusesOnTx(tx, {
      companion: companionPublishable ? companion : null,
      collectionName: params.collectionName,
      entryId: params.entryId,
    });
    // Only the chosen parts' changes, as the publish promotes them.
    const pending = promotion
      ? (await pendingChangesInSaveOrder(tx, draftRef)).filter(change =>
          change.locale === null
            ? movesShared(params.parts)
            : movesLanguage(params.parts, change.locale)
        )
      : [];
    const document =
      promotion && pending.length > 0 && documentLocalized
        ? await this.liveSharedDocument(tx, {
            collectionName: params.collectionName,
            entryId: params.entryId,
            tableName,
            fields,
            main: this.deserializeJsonFieldsForSnapshot(
              convertTimestampsToCamelCase({ ...row }),
              fields
            ),
            locale: null,
          })
        : null;
    const reader: FieldNameReader = {
      kind: "collection",
      slug: params.collectionName,
      user: params.user,
      // A routed request runs trusted but still answers to the caller's field
      // read rules.
      overrideAccess: params.overrideAccess && !params.routeAuthorized,
      authenticatedScope: params.authenticatedScope,
      // Resolved before the transaction opened.
      grants,
    };
    const nameIn =
      (live: Record<string, unknown>) => (names: readonly string[]) =>
        readableFieldNames(reader, names, live);
    const verdict = document
      ? await judgeSharedValues(tx, draftRef, pending, document)
      : null;
    const named: NamedVerdict =
      verdict && document
        ? await nameVerdict(verdict, nameIn(document.live))
        : { outOfDate: new Map(), blockers: [] };
    const blockers = [...named.blockers];
    // The gate runs only where the shared values refuse nothing, as in the
    // publish, which refuses on them first.
    if (named.outOfDate.size === 0 && blockers.length === 0) {
      const changes = verdict ? withVerdictState(pending, verdict) : pending;
      const storedBefore = await this.languageDocumentsOnTx(tx, {
        row,
        collectionName: params.collectionName,
        entryId: params.entryId,
        tableName,
        fields,
        manyToManyFields,
        locales: changes.map(change => change.locale),
      });
      try {
        await this.promotionsJudgedOnTx(tx, {
          changes,
          pending,
          promotion,
          collection: publishCollection,
          collectionName: params.collectionName,
          entryId: params.entryId,
          storedId: String(existingEntry.id),
          tableName,
          storedBefore,
          companion,
          companionPublishable,
          hasMainStatus,
          caller: params,
          row,
          mainStatus: row.status,
          prior,
          fields,
          manyToManyFields,
          updatedAt: new Date(),
        });
      } catch (error) {
        // A refusal that names no field is not one the preview can report,
        // so it is thrown as the publish would throw it.
        const issues = promotionIssuesOf(error);
        if (!issues) throw error;
        blockers.push(
          ...(await promotionBlockers(issues, nameIn(document?.live ?? row)))
        );
      }
    }
    return {
      languages:
        companion && companionPublishable && this.localization
          ? await storedLanguageOutcomes(tx, {
              companion,
              localization: this.localization,
              entryId: params.entryId,
              pending,
              prior,
              mainStatus: row.status,
              outOfDate: named.outOfDate,
            }).then(outcomes =>
              outcomes.filter(outcome =>
                movesLanguage(params.parts, outcome.locale)
              )
            )
          : [],
      blockers,
    };
  }

  /**
   * Publish ALL languages of an entry at once, each language's pending
   * change with it. The result reports what the publish
   * did to each configured language (`languages`).
   *
   * The route, the dispatcher and the admin hooks that call this keep working
   * unchanged. Where the work is stated: see {@link LifecycleDirection}.
   */
  async publishAllLocales(
    params: AllLocalesLifecycleParams
  ): Promise<CollectionServiceResult> {
    return this.setLifecycleAllLocales(PUBLISH_ALL_LOCALES, params);
  }

  /**
   * Take ALL languages of an entry down at once.
   *
   * The counterpart the codebase never had. Publishing every language has been
   * reachable from the admin hooks, the dispatcher and the service since i18n
   * M7; withdrawing them had no equivalent at any layer, so a scheduled content
   * release could schedule a takedown that no code path could perform on a
   * localized collection.
   *
   * ## Why this refuses instead of half-performing
   *
   * `_status` can be physically ABSENT from a companion that was localized
   * before Draft/Published was enabled on it. ADD-then-back-fill is not
   * retryable from physical shape alone — if the ADD lands and the back-fill
   * does not, every later run sees the column and concludes the table is in
   * step, leaving published content reading as draft — so the runtime companion
   * reconcile never emits it: `ensureLocalizedCompanions` passes the SAME status
   * on both sides deliberately, "so the builder sees no status change and emits
   * only the column difference — never an ADD or DROP of `_status`".
   *
   * MEASURED, because the obvious remedy is the wrong one: `nextly migrate`
   * does NOT add this column. The only path that does is the Schema Builder's
   * own companion transition, which introspects the physical shape and is
   * reached by saving the collection. A code-first collection in this state has
   * no automated remedy at all, which is why the refusal describes the
   * situation rather than naming one command.
   *
   * The gate the publish path uses cannot see it. `hasStatus` is
   * `metadata.status === true` — the DECLARED shape — and `isCompanionReady`
   * checks that the TABLE exists, not the column. For publishing, being wrong
   * costs a loud failure and nothing is lost. For a takedown, being wrong leaves
   * every translation READABLE while reporting success, which is the one outcome
   * a withdrawal must never produce. So this asks the physical question first.
   *
   * The probe runs BEFORE the transaction opens, deliberately: a failed
   * catalogue query aborts the whole transaction on PostgreSQL, and the error
   * then names an innocent later statement. It also propagates rather than
   * answering `false` — a dropped connection must not be read as "no such
   * column, nothing to sweep", which is precisely the reading that would report
   * a takedown that never happened.
   */
  async unpublishAllLocales(
    params: AllLocalesLifecycleParams
  ): Promise<CollectionServiceResult> {
    // Refused first when the collection is removed from code, before the
    // translation table's shape is read: whatever it holds, the write is refused.
    await refuseWriteIfRemovedFromCode("collection", params.collectionName);
    if (await this.companionLacksStatus(params.collectionName)) {
      return {
        success: false,
        statusCode: 409,
        message:
          `Cannot unpublish every language of '${params.collectionName}': its translation table ` +
          `has no per-language status column, so the translations cannot be taken down. ` +
          `This happens when Draft/Published is enabled on a collection that was already ` +
          `localized. For a Schema Builder collection, saving the collection again applies the ` +
          `change. For a code-first collection the column must be added before this will work. ` +
          `Nothing was changed.`,
        data: null,
      };
    }
    return this.setLifecycleAllLocales(WITHDRAW_ALL_LOCALES, params);
  }

  /**
   * What a publish or unpublish of chosen parts reads before it decides anything, on the pool:
   * the entry as stored (whether its shared part is live, and each stored language's own state and
   * values, never filled from another language) and the caller's refusal for each chosen language
   * and for the shared part, each one asked rather than stopping at the first. A language is asked
   * in that language; the shared part in every language, since every language shows it. The
   * transition asks them again, under the row lock, as it moves the parts.
   *
   * @experimental
   */
  async publishPartsReads(
    params: AllLocalesLifecycleParams,
    ask: {
      action: "publish" | "unpublish";
      /** The languages whose refusal is asked, or every language the site has. */
      locales: readonly string[] | "all";
      shared: boolean;
    }
  ): Promise<
    | { answer: CollectionServiceResult }
    | {
        state: PartsState;
        languageRefusals: Map<string, string>;
        sharedRefusal: string | null;
      }
  > {
    const toUpdate = await this.entryToUpdate({ ...params, gate: null });
    if (toUpdate.answer) return { answer: toUpdate.answer };
    const { accessUser, schema, existingEntry } = toUpdate;
    const collection = (await this.collectionService.getCollection(
      params.collectionName
    )) as {
      localized?: boolean;
      fields?: FieldDefinition[];
    };
    const configured = this.localization?.locales.map(l => l.code) ?? [];
    const defaultLocale = this.localization?.defaultLocale ?? "";
    const companion = await this.fileManager.loadCompanionSchema(
      params.collectionName
    );
    const statuses =
      (await this.storedLanguageStatuses(
        params.collectionName,
        params.entryId
      )) ?? new Map<string, string | null>();
    const values = companion
      ? await this.companionValuesByLanguageOf(
          this.db,
          companion,
          [params.entryId],
          [...statuses.keys()]
        )
      : new Map<string, Map<string, Record<string, unknown>>>();
    const fields = (collection.fields ?? []).flatMap(field =>
      typeof field.name === "string"
        ? [
            {
              name: field.name,
              label: typeof field.label === "string" ? field.label : field.name,
              required: field.required === true,
              unique: (field as { unique?: unknown }).unique === true,
              translatable: isFieldLocalized(
                field as Parameters<typeof isFieldLocalized>[0],
                collection.localized === true
              ),
            },
          ]
        : []
    );
    const languages = new Map(
      [...statuses].map(([locale, status]) => [
        locale,
        {
          live: status === "published",
          values: values.get(locale)?.get(params.entryId) ?? {},
        },
      ])
    );
    // What each language puts live: its stored values with its pending change laid over them,
    // since a publish promotes that change. Only the language's translated fields come from the
    // change; a language with a change and no stored row yet is judged on the change alone.
    const translated = new Set(
      fields.filter(field => field.translatable).map(field => field.name)
    );
    for (const draft of await new VersionsRepository(
      this.adapter
    ).findAllWorkingDrafts({
      scopeKind: "collection",
      scopeSlug: params.collectionName,
      entryId: params.entryId,
    })) {
      if (typeof draft.locale !== "string") continue;
      const stored = languages.get(draft.locale);
      const pending = Object.fromEntries(
        Object.entries(snapshotRecord(draft.snapshot)).filter(([name]) =>
          translated.has(name)
        )
      );
      languages.set(draft.locale, {
        live: stored?.live ?? false,
        values: { ...stored?.values, ...pending },
        ...(draftsKeptByPart()
          ? {}
          : {
              pendingSharedEdits: sharedFieldsEdited(
                fields,
                snapshotRecord(draft.snapshot),
                existingEntry as Record<string, unknown>
              ),
            }),
      });
    }
    const state: PartsState = {
      configured,
      defaultLocale,
      sharedLive:
        (existingEntry as { status?: unknown }).status === "published",
      languages,
      fields,
      requireEveryLanguage: requiresEveryLanguage(params.collectionName),
    };
    // The publish or unpublish permission and rule, as the transition asks it: never
    // route-authorized, since a route attests no lifecycle gate.
    const refusalNow = () =>
      this.refusalOfLifecycleInLanguage([], schema, {
        collectionName: params.collectionName,
        operation: ask.action,
        entryId: params.entryId,
        user: accessUser,
        overrideAccess: params.overrideAccess,
        routeAuthorized: false,
        authenticatedScope: params.authenticatedScope,
      });
    const languageRefusals = new Map<string, string>();
    for (const locale of ask.locales === "all" ? configured : ask.locales) {
      const refused = await withRuleLanguage(
        writeLanguagesFor(this.localization, locale),
        refusalNow
      );
      if (refused) {
        languageRefusals.set(locale, refused.message ?? "Refused.");
      }
    }
    const sharedRefused = ask.shared
      ? await withRuleLanguage(
          writeLanguagesFor(this.localization, EVERY_LOCALE),
          refusalNow
        )
      : null;
    return {
      state,
      languageRefusals,
      sharedRefusal: sharedRefused
        ? (sharedRefused.message ?? "Refused.")
        : null,
    };
  }

  /**
   * Whether the collection declares a per-language lifecycle its translation
   * table physically lacks: `_status` absent from a companion localized before
   * Draft/Published was enabled (see {@link unpublishAllLocales}). Asked of the
   * physical table, never the declared shape, before any transaction opens.
   */
  private async companionLacksStatus(collectionName: string): Promise<boolean> {
    const companion =
      await this.fileManager.loadCompanionSchema(collectionName);
    return (
      companion?.hasStatus === true &&
      (await isCompanionReady(this.adapter, companion.companionTableName)) &&
      !(await companionHasStatusColumn(
        this.adapter,
        companion.companionTableName
      ))
    );
  }

  /**
   * Whether a release's document-wide write of this collection would meet a
   * translation table without its per-language status: the precondition a
   * takedown of every language refuses on, read once for the collection.
   * `false` for a collection that has been deleted, whose members are gone.
   */
  async releaseCompanionLacksStatus(params: {
    collectionName: string;
  }): Promise<boolean> {
    if ((await this.releaseCollection(params.collectionName)) === null) {
      return false;
    }
    return this.companionLacksStatus(params.collectionName);
  }

  /**
   * Whether this user may update the entry, decided without writing anything.
   *
   * The same load-then-check `updateEntry` performs. For callers that write
   * something OTHER than the document and must still be held to its update
   * gate;
   * version history is one. Sharing this path rather than restating the
   * decision elsewhere is what stops the gate drifting from the writer.
   */
  async canUpdateEntry(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    routeAuthorized?: boolean;
    /**
     * The caller's authenticated scope. A scoped API key is judged on its OWN
     * update grant, so the session super-admin bypass does not apply to a
     * super-admin-owned key when this gate authorizes a version-label edit.
     */
    authenticatedScope?: AuthenticatedScope;
    /**
     * The language the caller's write acts in: a filter on a translated field
     * is matched in it, so an autosave in German is held to the German
     * entry. The default language where it names none.
     */
    locale?: string;
  }): Promise<boolean> {
    // Loaded because the hooks below are shown the row as it stands, and a
    // write to a row that is not there is a not-found rather than a refusal.
    const existingEntry = await this.storedEntry(
      params.collectionName,
      params.entryId
    );

    // A document that is not there cannot be updated. Answered as a refusal so
    // the caller treats missing and forbidden identically, rather than letting
    // the difference between them be probed.
    if (!existingEntry) return false;

    const denied = await this.refusalOfStoredUpdate(
      {
        collectionName: params.collectionName,
        operation: "update",
        entryId: params.entryId,
        user: params.user,
        // Never overridden: this exists to APPLY the document's rules, so a
        // caller that could opt out of them would defeat the point.
        overrideAccess: false,
        routeAuthorized: params.routeAuthorized,
        // A scoped API key is judged on its own update grant, so the session
        // super-admin bypass does not apply to a super-admin-owned key here.
        authenticatedScope: params.authenticatedScope,
      },
      params.locale
    );
    return denied === null;
  }

  /**
   * The status a write in `locale` is classified against, as the update's own
   * gate classifies it: where the collection keeps its status per language,
   * the write names that language's companion `_status`, and the gate judges
   * the move from the one committed there; a language with no companion row
   * (the default one, stored on the main row) and every collection without
   * per-language status are judged from the main row's.
   */
  private async storedStatusInLocale(
    collectionName: string,
    entryId: string,
    row: Record<string, unknown>,
    locale: string | undefined
  ): Promise<string | null> {
    const main = typeof row.status === "string" ? row.status : null;
    if (locale === undefined || !this.localization) return main;
    const companion =
      await this.fileManager.loadCompanionSchema(collectionName);
    // As the update gates its read: `_status` exists only on a companion
    // migrated for per-language status, and asking it otherwise fails.
    if (
      !companion?.hasStatus ||
      (await this.companionLacksStatus(collectionName))
    ) {
      return main;
    }
    const inLocale = await readCompanionLocaleStatus(
      this.db as Parameters<typeof readCompanionLocaleStatus>[0],
      companion.table,
      entryId,
      locale,
      cachedCompanionReadiness(this.adapter, companion.companionTableName)
    );
    return inLocale ?? main;
  }

  /**
   * What an update's `beforeChange` hooks are told it moves from
   * (`HookContext.storedStatus`): the status stored in the language the
   * write names, read as {@link storedStatusInLocale} reads it, and for a
   * write to every language `"published"` when any language is. Undefined
   * where the collection keeps one status, on the main row the hooks already
   * hold.
   */
  private async hookStoredStatus(
    collectionName: string,
    entryId: string,
    row: Record<string, unknown>,
    locale: string | undefined
  ): Promise<string | null | undefined> {
    if (locale === undefined || !this.localization) return undefined;
    const companion =
      await this.fileManager.loadCompanionSchema(collectionName);
    if (
      !companion?.hasStatus ||
      (await this.companionLacksStatus(collectionName))
    ) {
      return undefined;
    }
    const main = typeof row.status === "string" ? row.status : null;
    const readiness = cachedCompanionReadiness(
      this.adapter,
      companion.companionTableName
    );
    if (locale !== EVERY_LOCALE) {
      const inLocale = await readCompanionLocaleStatus(
        this.db as Parameters<typeof readCompanionLocaleStatus>[0],
        companion.table,
        entryId,
        locale,
        readiness
      );
      return inLocale ?? main;
    }
    if (main === "published") return main;
    const statuses = await readCompanionLocaleStatusAll(
      this.db as Parameters<typeof readCompanionLocaleStatusAll>[0],
      companion.table,
      entryId,
      readiness
    );
    return [...statuses.values()].includes("published") ? "published" : main;
  }

  /**
   * Whether this user may make a write naming `nextStatus` of the entry,
   * decided without writing: the lifecycle gate an update asks, and only where
   * that update asks it. Core asks a publish or unpublish gate only for a write
   * that moves the row into or out of published, as {@link
   * resolvePublishTransition} classifies it against the stored status, so a
   * write that keeps the row's status asks nothing more than its update gate.
   * A collection with no lifecycle asks none; an entry that is not there
   * answers as a refusal, as {@link canUpdateEntry} does.
   *
   * @experimental
   */
  async canMoveEntryStatus(params: {
    collectionName: string;
    entryId: string;
    nextStatus: string;
    user?: UserContext;
    authenticatedScope?: AuthenticatedScope;
    /** The language the write acts in, which a rule's filter is matched in. */
    locale?: string;
  }): Promise<boolean> {
    const existingEntry = await this.storedEntry(
      params.collectionName,
      params.entryId
    );
    if (!existingEntry) return false;
    const collection = await this.collectionService.getCollection(
      params.collectionName
    );
    // As `resolveTransitionAuthorization` reads it: no lifecycle, no gate.
    if ((collection as { status?: boolean }).status !== true) return true;
    const move = resolvePublishTransition(
      await this.storedStatusInLocale(
        params.collectionName,
        params.entryId,
        existingEntry,
        params.locale
      ),
      params.nextStatus
    );
    if (move === null) return true;
    const denied = await this.refusalOfStoredUpdate(
      {
        collectionName: params.collectionName,
        operation: move,
        entryId: params.entryId,
        user: params.user,
        // Never overridden, and never route-authorized: a route attests
        // update, never publish or unpublish.
        overrideAccess: false,
        routeAuthorized: false,
        authenticatedScope: params.authenticatedScope,
      },
      params.locale
    );
    return denied === null;
  }

  /**
   * The refusal of an update of `params.entryId` as it is stored, or `null`
   * where the caller may make it: the update gate's own refusal, or, where
   * its rule answers a filter, that of an entry the filter does not match, in
   * words where the caller may read it and as a missing entry where it may
   * not. A filter on a translated field is matched in `locale`, the language
   * the update acts in, or in the default where it names none.
   */
  private async refusalOfStoredUpdate<T>(
    params: FilteredWriteCheck["params"],
    locale?: string
  ): Promise<CollectionServiceResult<T> | null> {
    const access = await this.accessService.checkCollectionWrite<T>(params);
    if (access.denied) return access.denied;
    const schema = (await this.fileManager.loadDynamicSchema(
      params.collectionName
    )) as Record<string, SQLWrapper | undefined> & { id: SQLWrapper };
    const match = await this.prepareFilteredWrite(
      params.collectionName,
      params.operation,
      schema,
      access,
      { locale }
    );
    if (!match) return null;
    const judged = await this.judgedAgainstWriteFilter<T>(
      this.db,
      schema,
      String(params.entryId),
      match,
      params
    );
    return judged.refusal;
  }

  /**
   * An entry's document as stored, read on the write's transaction: the main
   * row with its translations and its language's status, its components and
   * its many-to-many values, in the read shape. What a write reports as
   * `previous`, and what a promotion's field rules compare against as live.
   */
  private async storedDocumentOnTx(
    tx: TransactionContext,
    args: {
      row: Record<string, unknown>;
      collectionName: string;
      entryId: string;
      tableName: string;
      fields: FieldDefinition[];
      manyToManyFields: FieldDefinition[];
      localizedUpdate: Awaited<
        ReturnType<CollectionMutationService["splitLocalizedWriteData"]>
      >;
      locale: string | undefined;
    }
  ): Promise<StoredDocument> {
    const { locale, ...rest } = args;
    const [stored] = await this.storedDocumentsOnTx(tx, {
      ...rest,
      locales: [args.localizedUpdate?.writeLocale ?? locale],
    });
    return stored;
  }

  /**
   * {@link storedDocumentOnTx} for several languages at once, in the order
   * asked: each language's translated values and status are read in one
   * statement for them all, each component table once, and the many-to-many
   * values, which every language shares, once. Each language's document is
   * exactly what a read of that language alone returns. For a reader holding
   * the row's lock, so its reads do not multiply with the languages.
   *
   * `localizedUpdate` is the split of a write, whose companion every language
   * shares; a language left undefined is the split's own.
   */
  private async storedDocumentsOnTx(
    tx: TransactionContext,
    args: {
      row: Record<string, unknown>;
      collectionName: string;
      entryId: string;
      tableName: string;
      fields: FieldDefinition[];
      manyToManyFields: FieldDefinition[];
      localizedUpdate: Awaited<
        ReturnType<CollectionMutationService["splitLocalizedWriteData"]>
      >;
      locales: readonly (string | undefined)[];
      /**
       * Each named language's components read exactly as stored, without
       * resolving one the app no longer configures to the default.
       */
      exactLanguage?: boolean;
    }
  ): Promise<StoredDocument[]> {
    const { localizedUpdate } = args;
    // Each language as its companion row is keyed: the split's own where none
    // is named.
    const languages = args.locales.map(locale =>
      localizedUpdate ? (locale ?? localizedUpdate.writeLocale) : locale
    );
    const translated = localizedUpdate
      ? languages.filter((locale): locale is string => locale !== undefined)
      : [];
    // The main row holds no translatable values and, for a per-locale
    // status, no current status either — both live in the companion.
    // Without them `previous` would omit every localized field that
    // `data` carries, so the diff would report untouched translations as
    // changed and lose the old value of the ones that did change.
    const companion =
      translated.length > 0
        ? await this.fileManager.loadCompanionSchema(
            args.collectionName,
            tx.getDrizzle()
          )
        : null;
    const valuesByLanguage = companion
      ? await this.companionValuesByLanguageOf(
          tx.getDrizzle(),
          companion,
          [args.entryId],
          translated
        )
      : new Map<string, Map<string, Record<string, unknown>>>();
    // Each language's committed status, read before the write. Gated on
    // `hasStatus` rather than on the patch carrying a status: a content-
    // only translation update still has to report THIS locale's status,
    // which can differ from the main row (a German draft under a
    // published entry). The gate is what keeps the read safe — companion
    // `_status` exists only on collections migrated for per-locale
    // status, and querying it otherwise fails the whole write.
    const statusByLanguage = new Map<string, string | null>();
    if (localizedUpdate && localizedUpdate.hasStatus) {
      const readiness = cachedCompanionReadiness(
        this.adapter,
        localizedUpdate.companionTableName
      );
      // One language reads its own row, as a write of it always has; several
      // read every translation's status in one statement.
      if (translated.length === 1) {
        statusByLanguage.set(
          translated[0],
          await readCompanionLocaleStatus(
            tx.getDrizzle<Parameters<typeof readCompanionLocaleStatus>[0]>(),
            localizedUpdate.companionTable,
            args.entryId,
            translated[0],
            readiness
          )
        );
      } else if (translated.length > 1) {
        for (const [locale, status] of await readCompanionLocaleStatusAll(
          tx.getDrizzle<Parameters<typeof readCompanionLocaleStatusAll>[0]>(),
          localizedUpdate.companionTable,
          args.entryId,
          readiness
        )) {
          statusByLanguage.set(locale, status);
        }
      }
    }
    const passwordReach = await this.passwordReach(
      args.fields,
      tx.getDrizzle()
    );
    const { componentsByLocale, manyToMany } =
      await this.buildFullSnapshotRelationsByLocale(
        tx,
        args.entryId,
        args.collectionName,
        args.tableName,
        args.fields,
        args.manyToManyFields,
        // The resolved write locale — see the create path.
        languages,
        args.exactLanguage === true
      );
    return languages.map(locale => {
      const localizedValues =
        (locale !== undefined
          ? valuesByLanguage.get(locale)?.get(args.entryId)
          : undefined) ?? {};
      const committedLocaleStatus =
        locale !== undefined ? (statusByLanguage.get(locale) ?? null) : null;
      const parentRow = this.storedParentRow(
        args.row,
        args.fields,
        args.tableName,
        localizedValues,
        committedLocaleStatus,
        passwordReach
      );
      const components = componentsByLocale.get(locale) ?? {};
      return {
        document: assembleDocument({ parentRow, components, manyToMany }),
        committedLocaleStatus,
        localizedValues,
        parentRow,
        components,
        manyToMany,
      };
    });
  }

  /**
   * Fold one language's pending change into a write: the document the
   * promotion persists, judged against the caller's field write access, split
   * into the parts the write stores. One implementation for a publish of one
   * language (`updateEntry`) and a publish of every language, so a pending
   * change goes live the same way whichever publishes it.
   *
   * The snapshot is stored read-shaped, so buildRestorePayload turns it into a
   * safe update input (immutable ids stripped, removed columns and password
   * fields dropped, component subtrees whose schema no longer resolves
   * reported rather than written blind). Shaping that input through the SAME
   * pure pass the caller's input took yields matching column and relation
   * parts, so merging the caller over the draft (caller wins per key,
   * including the published/draft `status`) makes the write persist the
   * promoted content with no separate code path.
   */
  /**
   * What a publish's caller contributes over a pending change: the payload
   * the field gate has already judged, never the raw request, as one logical
   * document. The fold credits the caller with it, and the out-of-date check
   * judges the change with it merged over, so the check and the write agree
   * on what the publish writes.
   */
  private callerContributionOf(args: {
    finalData: Record<string, unknown>;
    componentFieldData: Record<string, unknown>;
    manyToManyData: Record<string, string[]>;
    fields: FieldDefinition[];
    manyToManyFields: FieldDefinition[];
    componentSchemas: ComponentSchemas | null;
  }): Record<string, unknown> {
    return this.deserializeJsonFieldsForSnapshot(
      this.assemblePromotedDocument(
        {},
        args.finalData,
        args.componentFieldData,
        args.manyToManyData,
        args.fields,
        args.manyToManyFields,
        args.componentSchemas
      ),
      args.fields
    );
  }

  private async foldWorkingDraft(
    tx: TransactionContext,
    args: {
      snapshot: unknown;
      /** The caller's shaped payload, after its translated values were split off. */
      finalData: Record<string, unknown>;
      componentFieldData: Record<string, unknown>;
      manyToManyData: Record<string, string[]>;
      /** The document as it stands before the write, read on this transaction. */
      live: Record<string, unknown>;
      collection: unknown;
      collectionName: string;
      storedId: string;
      fields: FieldDefinition[];
      manyToManyFields: FieldDefinition[];
      componentSchemas: ComponentSchemas | null;
      restoreContext: RestoreSchemaContext;
      /** The slot the pending change is kept under. */
      draftLocale: string | null;
      /** The language the write's request names. */
      requestLocale: string | undefined;
      user: UserContext | undefined;
      authenticatedScope?: AuthenticatedScope;
      overrideAccess?: boolean;
      grants?: () => Promise<CallerGrants>;
    }
  ) {
    const {
      fields,
      manyToManyFields,
      componentSchemas,
      finalData,
      componentFieldData,
      manyToManyData,
    } = args;
    const { payload: draftInput } = buildRestorePayload(
      args.snapshot,
      fields as unknown as FieldConfig[],
      args.restoreContext
    );
    // Assemble the full document the promotion persists (the locked draft,
    // the caller's scalars overlaid, the caller's single-component patches
    // merged onto the draft's components, and the caller's m2m), then judge it
    // against the current field-level write access. A rule that depends on a
    // sibling the publish patch supplies (e.g. a field writable only when
    // `approved` is true, where the publish sets it false) is judged on the
    // real final values, at any depth, for column, component, and m2m fields
    // alike. The write parts are re-extracted from the RESOLVED document, so a
    // denied component or m2m value is written at what the row already holds.
    // Logical, for the same reason as the check before the transaction:
    // `finalData` is already column-encoded, and a group left as its string is
    // one leaf to the resolver, so a denied field inside it is never found and
    // an untouched group compares unequal to the parsed live row. The write
    // encodes it again, once.
    const mergedPromoteData = this.deserializeJsonFieldsForSnapshot(
      this.assemblePromotedDocument(
        draftInput,
        finalData,
        componentFieldData,
        manyToManyData,
        fields,
        manyToManyFields,
        componentSchemas
      ),
      fields
    );
    // The caller's own contribution, from the payload the field gate has
    // ALREADY judged, never the raw request. Read from the request, it would
    // credit the publisher with the pending change's edit whenever they echo
    // the same path: the gate drops their value, the merged document still
    // holds the draft's, the resolver treats that edit as theirs and restores
    // live, and the publish consumes the draft. The gate keeps a protected
    // child of a group they sent at its stored value rather than dropping it,
    // so the resolver credits them only with what the rules let them send, and
    // judges the rest as the pending change holds it. Logical, through the
    // same conversion as the document it is compared against.
    const callerContribution = this.callerContributionOf({
      finalData,
      componentFieldData,
      manyToManyData,
      fields,
      manyToManyFields,
      componentSchemas,
    });
    // The locked draft on its own, through the same conversion: the field gate
    // keeps a protected child of a group the caller sent at its LIVE value, so
    // where that group replaced the draft's, only the draft still says what
    // its author changed there.
    const pendingDocument = this.deserializeJsonFieldsForSnapshot(
      this.assemblePromotedDocument(
        draftInput,
        {},
        {},
        {},
        fields,
        manyToManyFields,
        componentSchemas
      ),
      fields
    );
    // One call decides the refusal AND returns what to write, so the document
    // that was judged is the document that lands. A denied field comes back at
    // its LIVE value rather than removed: taking the rules' own output would
    // serialize a partial group over the whole JSON column and clear a
    // protected value nobody touched.
    const promotedDocument = await this.judgePromotionAccess({
      before: mergedPromoteData,
      live: args.live,
      callerSupplied: callerContribution,
      pending: pendingDocument,
      collectionName: args.collectionName,
      storedId: args.storedId,
      user: args.user,
      authenticatedScope: args.authenticatedScope,
      overrideAccess: args.overrideAccess,
      grants: args.grants,
      fields,
      locale: args.draftLocale ?? args.requestLocale ?? null,
      componentSchemas,
    });
    // The document as judged, kept before the parts below rewrite it in
    // place: the split moves its translated values out, so a later judgement
    // of it, such as relations re-read under the lock, needs this copy.
    const judgedDocument = { ...promotedDocument };
    // Repeater rows keep their ids against the document as it stands: the
    // pending change's rows and the caller's already carry theirs, and one
    // without an id keeps a live row's only where it is that row unchanged.
    const draftParts = this.shapeWriteParts(
      promotedDocument,
      fields,
      manyToManyFields,
      args.collection,
      {
        stored: args.live,
        reach: await this.passwordReach(fields, tx.getDrizzle()),
      }
    );
    // Rebuild the companion payload from the promoted document, and do it
    // BEFORE the main-row payload is taken: the split moves a localized field
    // out of the document and into the companion, so taking the main payload
    // first would carry translated values to the main table, which has no
    // column for them.
    //
    // The caller's own split was taken from a patch that carries no content of
    // a pending change, so without this the draft's translated values never
    // reach the language's row at all and the translation publishes unchanged.
    //
    // Bound to this transaction's executor: the companion metadata read would
    // otherwise take a second pooled connection that this open transaction is
    // holding.
    const localizedUpdate = await this.splitLocalizedWriteData(
      args.collectionName,
      promotedDocument,
      args.draftLocale ?? args.requestLocale,
      false,
      tx.getDrizzle()
    );
    // Whether the caller's write moves the document off the draft it promotes:
    // the merged document, before access is judged, against the draft alone
    // assembled by the same pass, so a component patch counts merged and an
    // echo of the draft, a junction's ids in another order, or a system field
    // the write ignores, is no edit.
    const carriesContent = editsOver({
      entity: "collection",
      draft: this.deserializeJsonFieldsForSnapshot(
        this.assemblePromotedDocument(
          draftInput,
          {},
          {},
          {},
          fields,
          manyToManyFields,
          componentSchemas
        ),
        fields
      ),
      promoted: mergedPromoteData,
      views: new Map(manyToManyFields.map(field => [field.name, asIdSet])),
    });
    return {
      finalData: promotedDocument,
      judgedDocument,
      componentFieldData: draftParts.componentFieldData,
      manyToManyData: draftParts.manyToManyData,
      localizedUpdate,
      carriesContent,
    };
  }

  /**
   * Write an entry's main row and, where there is one to write, its
   * language's translation row, on the write's transaction. One
   * implementation for a write of one language and for each language a
   * publish of every language promotes, so a promoted change lands the same
   * way whichever publishes it.
   */
  private async writeRowAndTranslation(
    tx: TransactionContext,
    args: {
      tableName: string;
      entryId: string;
      /**
       * Keyed by SQL column name, as the adapter takes it. A transaction's
       * update is built by the adapter rather than by the query builder,
       * which is what lets this write reach a column the runtime model has
       * already moved to a companion table that does not exist yet (the
       * localization transition window). A key whose value is `undefined` is
       * not written; `null` clears the column.
       */
      columns: Record<string, unknown>;
      /** The translation to upsert, or `null` where none is written. */
      translation: {
        companionTableName: string;
        writeLocale: string;
        companionData: Record<string, unknown>;
      } | null;
      /**
       * Who the write is made as: recorded on the translation row, whose
       * counter the upsert moves with it.
       */
      savedBy: RequestActor;
      /**
       * How the save is judged on the translation it writes, when it is: the
       * row's version is claimed (`refuseIfLanguageMoved`) before anything
       * is written, and a stale save throws, with where to answer from.
       */
      judge?: {
        check: VersionCheck;
        /** The language the save is judged on, if any. */
        locale: string | undefined;
        mainTable: string;
        holder: StaleWriteHolder;
      };
    }
  ): Promise<PartState | undefined> {
    const claim =
      args.translation && args.judge
        ? await refuseIfLanguageMoved(
            tx,
            this.dialect,
            args.judge.check,
            {
              table: args.judge.mainTable,
              id: args.entryId,
              languagesTable: args.translation.companionTableName,
              judged: args.judge.locale,
              written: args.translation.writeLocale,
            },
            args.savedBy,
            args.judge.holder
          )
        : undefined;
    await tx.update(
      args.tableName,
      args.columns,
      this.whereEq("id", args.entryId)
    );
    // The translatable values go to the companion row for the write's
    // language, in the same transaction. Only the provided localized
    // columns are touched.
    if (args.translation) {
      await upsertCompanionRow(
        companionWriteVia(tx, this.dialect),
        args.translation.companionTableName,
        args.entryId,
        args.translation.writeLocale,
        args.translation.companionData,
        undefined,
        { savedBy: args.savedBy, revisionClaimed: claim?.claimed === true }
      );
    }
    // The translation row as it was before this write, read by the claim:
    // for an overwrite, what it replaced.
    return claim?.before;
  }

  /**
   * Write an entry's field-group values and many-to-many relations, on the
   * write's transaction, so a failure in either rolls the write back. One
   * implementation for a write of one language and for each language a
   * publish of every language promotes.
   */
  private async writeRelations(
    tx: TransactionContext,
    args: {
      collectionName: string;
      entryId: string;
      tableName: string;
      fields: FieldDefinition[];
      manyToManyFields: FieldDefinition[];
      componentFieldData: Record<string, unknown>;
      /**
       * The language an embedded localized field group writes its
       * translatable values in, to its own companion.
       */
      componentLocale: string | undefined;
      manyToManyData: Record<string, string[]>;
      /** Who the write is made as, for each instance's own field rules. */
      caller: {
        user?: UserContext;
        overrideAccess?: boolean;
        authenticatedScope?: AuthenticatedScope;
      };
      /**
       * The host write's context, so a field inside an instance that reads
       * the library judges it on this transaction, handed the write's payload.
       */
      write: EntryWriteContext;
    }
  ): Promise<void> {
    // Cloned here, so each attempt of a retried transaction starts from the
    // caller's own values: the save mutates its input in place, hashing
    // password fields and assigning row ids.
    const componentData = structuredClone(args.componentFieldData);
    if (this.fieldGroupDataService && Object.keys(componentData).length > 0) {
      await this.fieldGroupDataService.saveComponentDataInTransaction(tx, {
        parentId: args.entryId,
        parentTable: args.tableName,
        fields: args.fields as unknown as FieldConfig[],
        data: componentData,
        locale: args.componentLocale,
        // A component instance is validated by its own pass inside the
        // field-group service, so the request has to travel with it for a
        // field rule nested in a field group to see the same `user` a
        // top-level field rule sees.
        req: args.caller.user ? { user: args.caller.user } : {},
        // The caller and trust the entry's own fields are judged with.
        access: this.fieldGroupAccess(args.caller),
        write: args.write,
      });
    }

    // Replace each named junction's rows. The tx-scoped Drizzle handle binds
    // the junction writes to this transaction.
    const txExecutor = tx.getDrizzle<RelationshipDbExecutor>();
    for (const field of args.manyToManyFields) {
      const relatedIds = args.manyToManyData[field.name];
      if (relatedIds === undefined) continue;
      await this.relationshipService.deleteManyToManyRelations(
        args.collectionName,
        args.entryId,
        field,
        txExecutor
      );
      if (relatedIds.length > 0) {
        await this.relationshipService.insertManyToManyRelations(
          args.collectionName,
          args.entryId,
          field,
          relatedIds,
          txExecutor
        );
      }
    }
  }

  /**
   * Remove a language's pending change, and free the base it was judged
   * against so retention may let that version go: once its content is live,
   * or once it no longer applies.
   */
  private async consumeWorkingDraft(
    tx: TransactionContext,
    ref: VersionRef,
    locale: string | null,
    /** Whether the shared draft went with it: false for a promote that left it pending. */
    withShared = true
  ): Promise<void> {
    const repo = new VersionsRepository(tx);
    await repo.deleteWorkingDraft(ref, locale);
    await releaseSharedBase(tx, ref, locale);
    // Kept by part, a language's publish carries the shared draft with it
    // (`part-drafts`), so the shared draft goes too.
    if (withShared && draftsKeptByPart() && locale !== SHARED_DRAFT_SLOT) {
      await repo.deleteWorkingDraft(ref, SHARED_DRAFT_SLOT);
    }
  }

  /**
   * The document a promotion may write, judged by the field rules of the
   * person publishing: every field they may write as the promotion has it,
   * every field they may not at its live value — or a refusal naming each
   * field the pending change edits that they may not write (code `FORBIDDEN`).
   *
   * One judgement for the publish, which writes what this returns under its
   * row lock, and for a release's readiness, which reports the refusal ahead
   * of the release's run.
   */
  private judgePromotionAccess(args: {
    before: Record<string, unknown>;
    live: Record<string, unknown>;
    callerSupplied: Record<string, unknown>;
    /** The pending change alone, where `before` lays the caller's payload over it. */
    pending?: Record<string, unknown>;
    collectionName: string;
    /** The entry's id as stored, which the rules are told: never the request's. */
    storedId: string;
    user: UserContext | undefined;
    authenticatedScope?: AuthenticatedScope;
    overrideAccess?: boolean;
    grants?: () => Promise<CallerGrants>;
    fields: FieldDefinition[];
    locale: string | null;
    /** The field groups' schemas the promotion resolved, by slug. */
    componentSchemas: ComponentSchemas | null | undefined;
  }): Promise<Record<string, unknown>> {
    return resolvePromotedDocument({
      before: args.before,
      live: args.live,
      callerSupplied: args.callerSupplied,
      pending: args.pending,
      // The entry's own rules, then every field group's on the instances the
      // document holds: a pending change can carry a field-group edit too, and
      // a denied one is refused or kept at its live value like any other.
      applyRules: async document => {
        await applyFieldWriteAccess({
          kind: "collection",
          slug: args.collectionName,
          data: document,
          operation: "update",
          user: args.user,
          authenticatedScope: args.authenticatedScope,
          overrideAccess: args.overrideAccess,
          grants: args.grants,
          id: args.storedId,
        });
        await applyFieldGroupWriteAccessToDocument({
          document,
          fields: args.fields as unknown as FieldConfig[],
          fieldGroupFields: {
            get: slug => args.componentSchemas?.get(slug)?.fields,
          },
          access: { ...this.fieldGroupAccess(args), grants: args.grants },
          live: args.live,
        });
      },
      // What the schema declares, its field groups' schemas included, so a
      // field named like one of the store's own columns is still judged as the
      // content it is.
      authoredFieldNames: declaredFieldNames(args.fields, field =>
        referencedFieldGroupFields(
          field,
          slug => args.componentSchemas?.get(slug)?.fields
        )
      ),
      slug: args.collectionName,
      locale: args.locale,
    });
  }

  /**
   * A stored main row in the read shape: timestamps camelCased, its language's
   * translations and status over it, JSON parsed, and the fields a snapshot
   * never carries redacted.
   */
  private storedParentRow(
    row: Record<string, unknown>,
    fields: FieldDefinition[],
    tableName: string,
    localizedValues: Record<string, unknown>,
    companionStatus: string | null,
    /** Where the password strip follows field groups held inline. */
    reach: FieldGroupReach
  ): Record<string, unknown> {
    const parent = this.deserializeJsonFieldsForSnapshot(
      {
        ...convertTimestampsToCamelCase({ ...row }),
        ...localizedValues,
        ...(companionStatus !== null ? { status: companionStatus } : {}),
      },
      fields
    );
    this.redactSnapshotRow(parent, fields, tableName, reach);
    return parent;
  }

  /**
   * Many entries' documents as stored, keyed by id, as
   * {@link storedDocumentOnTx} reads one: their components and many-to-many
   * ids by the batch's one read of them, one query per field for them all, as
   * a publish judges them, and the write language's translations by the
   * batch's reads, one query for them all. Read on the pool, writing nothing.
   */
  private async storedDocumentsOf(args: {
    collectionName: string;
    rows: ReadonlyMap<string, Record<string, unknown>>;
    tableName: string;
    fields: FieldDefinition[];
    manyToManyFields: FieldDefinition[];
    /** The write language, whose translations sit beside each row. */
    locale: string | undefined;
    reads: GoingLiveReads;
  }): Promise<Map<string, Record<string, unknown>>> {
    const reach = await this.passwordReach(args.fields);
    const documents = new Map<string, Record<string, unknown>>();
    for (const [id, row] of args.rows) {
      // The default resolution, as the live document is read: no language.
      const { components, manyToMany } = await this.storedRelationsOf({
        entryId: id,
        collectionName: args.collectionName,
        fields: args.fields,
        language: undefined,
        tx: undefined,
        relations: {
          tableName: args.tableName,
          manyToManyFields: args.manyToManyFields,
          batch: args.reads.relations,
        },
      });
      documents.set(
        id,
        assembleDocument({
          parentRow: this.storedParentRow(
            row,
            args.fields,
            args.tableName,
            args.locale === undefined
              ? {}
              : await args.reads.translations(id, args.locale),
            null,
            reach
          ),
          components,
          manyToMany,
        })
      );
    }
    return documents;
  }

  /**
   * The reads a judgement of what goes live makes, for a batch of one
   * collection's entries: the companion resolved once, the language statuses
   * of them all read in one query, and each language's translations in one
   * query the first time that language is asked for.
   */
  private async goingLiveReadsOf(
    collectionName: string,
    entryIds: readonly string[]
  ): Promise<GoingLiveReads> {
    const companion =
      await this.fileManager.loadCompanionSchema(collectionName);
    let statuses: Promise<Map<string, Map<string, string | null>>> | undefined;
    const translations = new Map<
      string,
      Promise<Map<string, Record<string, unknown>>>
    >();
    return {
      companion,
      relations: new GoingLiveRelationsBatch(entryIds),
      languageStatuses: async entryId => {
        if (companion === null) return null;
        statuses ??= readCompanionLocaleStatusAllOf(
          this.db as Parameters<typeof readCompanionLocaleStatusAllOf>[0],
          companion.table,
          entryIds,
          cachedCompanionReadiness(this.adapter, companion.companionTableName)
        );
        return (await statuses).get(entryId) ?? new Map();
      },
      translations: async (entryId, locale) => {
        if (companion === null) return {};
        let byEntry = translations.get(locale);
        if (byEntry === undefined) {
          byEntry = this.companionValuesOf(
            this.db,
            companion,
            entryIds,
            locale
          );
          translations.set(locale, byEntry);
        }
        return (await byEntry).get(entryId) ?? {};
      },
    };
  }

  /**
   * The reads a judgement of what goes live makes for ONE entry, on the
   * transaction that holds its lock: the companion resolved once, its
   * language statuses read once, and every configured language's
   * translations read in one statement the first time any language is asked
   * for, so a publish of every language validates each language it puts live
   * without a read per language. A language the app no longer configures is
   * read alone, when asked.
   */
  private async everyLanguageReadsOnTx(
    tx: TransactionContext,
    collectionName: string,
    entryId: string
  ): Promise<GoingLiveReads> {
    const companion = await this.fileManager.loadCompanionSchema(
      collectionName,
      tx.getDrizzle()
    );
    const configured = this.localization?.locales.map(l => l.code) ?? [];
    let statuses: Promise<Map<string, string | null> | null> | undefined;
    let everyLanguage:
      | Promise<Map<string, Map<string, Record<string, unknown>>>>
      | undefined;
    return {
      companion,
      // The one row this transaction has locked, so its relations cannot
      // change under the judgement, as a batch's other rows could.
      relations: new GoingLiveRelationsBatch([entryId]),
      languageStatuses: () => {
        statuses ??= this.storedLanguageStatuses(collectionName, entryId, tx);
        return statuses;
      },
      translations: async (id, locale) => {
        if (companion === null) return {};
        const read = configured.includes(locale)
          ? (everyLanguage ??= this.companionValuesByLanguageOf(
              tx.getDrizzle(),
              companion,
              [entryId],
              configured
            ))
          : this.companionValuesByLanguageOf(
              tx.getDrizzle(),
              companion,
              [entryId],
              [locale]
            );
        return (await read).get(locale)?.get(id) ?? {};
      },
    };
  }

  /** The stored rows of these entries that are there, keyed by id. */
  private async storedEntries(
    collectionName: string,
    entryIds: readonly string[]
  ): Promise<Map<string, Record<string, unknown>>> {
    return this.readingStored(collectionName, async () => {
      const schema = await this.fileManager.loadDynamicSchema(collectionName);
      const rows = (await this.db
        .select()
        .from(schema)
        .where(inArray(schema.id, [...new Set(entryIds)]))) as Array<
        Record<string, unknown>
      >;
      return new Map(rows.map(row => [String(row.id), row]));
    });
  }

  /** The entry's stored row, or `undefined` when it is not there. */
  private async storedEntry(
    collectionName: string,
    entryId: string
  ): Promise<Record<string, unknown> | undefined> {
    return this.readingStored(collectionName, async () => {
      const schema = await this.fileManager.loadDynamicSchema(collectionName);
      const [row] = await this.db
        .select()
        .from(schema)
        .where(eq(schema.id, entryId))
        .limit(1);
      return row as Record<string, unknown> | undefined;
    });
  }

  /**
   * `read` of stored rows, with a table or column the database has not been
   * migrated for answered as the entry read answers it. These reads serve the
   * update check and the release checks, on the pool and for callers that are
   * not trusted with the schema's physical names, so the answer names the
   * collection and the reason only.
   */
  private async readingStored<T>(
    collectionName: string,
    read: () => Promise<T>
  ): Promise<T> {
    try {
      return await read();
    } catch (error) {
      throw await asNotMigrated(
        error,
        collectionNotMigrated(this.collectionService, collectionName)
      );
    }
  }

  /**
   * Additionally authorize a write that changes a document's published state.
   *
   * Publishing is an ordinary write that sets `status: "published"`, so the
   * `update`/`create` gate a path already ran does not distinguish it. A move
   * into published needs `publish`, a move out of it needs `unpublish`, and
   * both are ON TOP of the write permission for a write that also edits the
   * entry — editing and publishing are separate capabilities. A write that
   * changes only the status asks no write permission, so this gate is the
   * whole of it. A write that is not a transition returns `null` and nothing
   * extra is required.
   *
   * `collectionHasStatus` is the draft/published lifecycle flag
   * (`collection.status === true`), the same signal the read path filters on. It
   * gates this check because a collection WITHOUT the lifecycle can still carry
   * an ordinary user-defined field named `status`: setting that to "published"
   * is a field edit, not a publish, and must not demand `publish-<slug>`.
   *
   * `nextStatus` is the FINAL status the write will persist — read after the
   * before-hooks and field-write-access have run, not the raw request body — so
   * a hook that derives `status: "published"` cannot let a caller publish
   * without the permission. `previousStatus` is the main-row status, or, for a
   * write targeting a non-default locale, that locale's companion `_status`,
   * since a per-locale translation publishes through the companion row and not
   * the main row.
   */
  private async checkStatusTransitionAccess(args: {
    collectionName: string;
    collectionHasStatus: boolean;
    previousStatus: string | null;
    nextStatus: unknown;
    accessUser?: UserContext;
    overrideAccess?: boolean;
    authenticatedScope?: AuthenticatedScope;
  }): Promise<CollectionServiceResult | null> {
    // No draft/published lifecycle → `status` is an ordinary field, not a
    // publish signal, so there is no transition to authorize.
    if (!args.collectionHasStatus) return null;

    const operation = resolvePublishTransition(
      args.previousStatus,
      args.nextStatus
    );
    if (!operation) return null;

    return this.accessService.checkCollectionAccess({
      collectionName: args.collectionName,
      operation,
      user: args.accessUser,
      overrideAccess: args.overrideAccess,
      // NOT route-authorized, even on a REST write. `routeAuthorized` means the
      // route middleware already ran this exact RBAC check — but the route
      // authorizes a document PATCH/create as `update`/`create`, never as
      // `publish`/`unpublish`, so for the transition operation that assertion
      // does not hold. Passing it through would skip the RBAC check for the very
      // permission this gate exists to enforce, letting any caller who may
      // update/create also publish.
      routeAuthorized: false,
      // A scoped API key is judged on its own publish/unpublish grant here, not
      // the key owner's.
      authenticatedScope: args.authenticatedScope,
    });
  }

  /**
   * Resolve the caller's publish AND unpublish authorization on the pooled
   * connection, BEFORE a write transaction opens, so the transaction/batch write
   * paths can enforce a transition against the row-locked status without reading
   * permission storage inside the transaction (see {@link TransitionAuthorization}).
   *
   * Both ops are resolved because a batch is heterogeneous — one row may publish
   * while another unpublishes — and the per-row op is only known under the lock.
   * No-ops (returns all-allowed) for a trusted write or a collection with no
   * draft/published lifecycle.
   */
  async resolveTransitionAuthorization(args: {
    collectionName: string;
    /**
     * The one entry the write changes, where it changes one, so a caller who
     * may not read it is answered as if it were missing. A create or a
     * batch resolved ahead names no one existing entry.
     */
    entryId?: string;
    accessUser?: UserContext;
    overrideAccess?: boolean;
    authenticatedScope?: AuthenticatedScope;
    // A transaction-bound Drizzle executor (`tx.getDrizzle()`), supplied when a
    // caller-owned-tx path resolves the transition authorization from INSIDE its
    // own transaction. The metadata and RBAC reads below then run on that
    // transaction's connection instead of taking a second pooled one, which can
    // stall against a small pool. Omitted (pooled connection) when a path
    // pre-resolves before opening its transaction, which is the common case.
    executor?: unknown;
    /**
     * A move the caller judges itself, with the filter its rule may answer,
     * which is not asked here: it is left `null` for the caller to fill.
     */
    askedByCaller?: "publish" | "unpublish";
  }): Promise<TransitionAuthorization> {
    if (args.overrideAccess) {
      return { publishDenied: null, unpublishDenied: null };
    }
    const collection = await this.collectionService.getCollection(
      args.collectionName,
      args.executor
    );
    if ((collection as { status?: boolean }).status !== true) {
      return { publishDenied: null, unpublishDenied: null };
    }
    // Resolve both concurrently; each is judged on the caller's own grant (a
    // scoped API key on its scope), never route-authorized — the route attested
    // update/create, never publish/unpublish.
    const asked = (operation: "publish" | "unpublish") =>
      operation === args.askedByCaller
        ? Promise.resolve(null)
        : this.accessService.checkCollectionAccess({
            collectionName: args.collectionName,
            operation,
            entryId: args.entryId,
            user: args.accessUser,
            overrideAccess: args.overrideAccess,
            routeAuthorized: false,
            authenticatedScope: args.authenticatedScope,
            executor: args.executor,
          });
    const [publishDenied, unpublishDenied] = await Promise.all([
      asked("publish"),
      asked("unpublish"),
    ]);
    return { publishDenied, unpublishDenied };
  }

  /**
   * Enforce a pre-resolved {@link TransitionAuthorization} against the status read
   * UNDER the row lock, inside a caller-provided transaction. For an update it
   * locks the row (the write below takes the same lock anyway) and re-reads the
   * committed status, so a concurrent writer that changed the published state
   * between the pre-transaction read and this lock is accounted for; classifying
   * against that locked status, it returns the matching 403 if the transition is
   * denied, or `null` when the write is allowed. A create has no prior row, so
   * only a publish is possible and no lock/read is taken.
   *
   * Called immediately before the INSERT/UPDATE, so returning a denial leaves
   * nothing written for this row — no rollback needed.
   */
  private async enforceTransitionUnderLock(
    tx: TransactionContext,
    args: {
      tableName: string;
      entryId?: string;
      nextStatus: unknown;
      isCreate: boolean;
      auth: TransitionAuthorization;
      /** The row a create will persist. A create has no prior row to lock. */
      createDocument?: Record<string, unknown>;
    }
  ): Promise<CollectionServiceResult | null> {
    // No status named in the write: no transition, nothing to enforce.
    if (args.nextStatus === undefined) return null;
    let lockedStatus: string | null = null;
    let lockedRow: Record<string, unknown> | null = null;
    if (!args.isCreate && args.entryId) {
      // Read the committed row UNDER a row lock, in the SAME query that takes the
      // lock (`forUpdate`). A separate plain read would, on MySQL's
      // repeatable-read isolation, return this transaction's snapshot —
      // established by the caller's earlier pre-lock fetch of the row — and so
      // miss a concurrent writer's publish/unpublish committed since, leaving the
      // TOCTOU window open on MySQL. A `FOR UPDATE` read always sees the latest
      // committed row; SQLite skips the lock (BEGIN IMMEDIATE already serializes
      // its writers) and its committed read is already current.
      lockedRow = await tx.selectOne<Record<string, unknown>>(args.tableName, {
        where: this.whereEq("id", args.entryId),
        forUpdate: true,
      });
      if (!lockedRow) {
        // The row was found by the caller's pre-lock read but is gone under the
        // lock: a concurrent transaction deleted it in that window. There is no
        // prior state to transition, so the update targets a missing row —
        // return not-found rather than classifying the absent status as a
        // `null -> published` publish (which would wrongly demand a publish grant
        // for a row that no longer exists, or let the write silently no-op).
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }
      lockedStatus = (lockedRow.status as string | undefined) ?? null;
    }
    return this.denyIfTransitionUngranted(
      lockedStatus,
      args.nextStatus,
      args.auth
    );
  }

  /**
   * The denial a status move earns, or `null` when it needs no grant.
   *
   * A write can move the published state in more than one place — the main row's
   * `status`, and, on a localized collection, the write locale's companion
   * `_status` — and each has to be judged against the status THAT place
   * currently holds. One implementation answers for both: asking the question
   * twice would let the two readings drift, and a gate that drifts toward
   * permissive is a gate that stops gating.
   *
   * Permission is pre-resolved and read here without a query, so a caller
   * lacking publish-<slug> / unpublish-<slug> is denied regardless of ownership.
   * That is the whole decision: there is no document-dependent rule to judge
   * against the row-locked document, so a transition is admitted or refused on
   * the caller's grant alone.
   */
  private denyIfTransitionUngranted(
    currentStatus: string | null,
    nextStatus: unknown,
    auth: TransitionAuthorization
  ): CollectionServiceResult | null {
    const op = resolvePublishTransition(currentStatus, nextStatus);
    if (!op) return null;
    return op === "publish" ? auth.publishDenied : auth.unpublishDenied;
  }

  /**
   * Whether this write should hold its edit as a working draft, and the
   * component schemas the decision needed.
   *
   * One implementation of the question for every write path. Asked separately
   * in each of them, the three answers could drift, and a surface that answered
   * "no" where the others answered "yes" would publish an edit nobody published
   * — which is the shape of the defect this exists to prevent.
   */
  private async resolveWorkingDraftHold(args: {
    collection: unknown;
    fields: FieldDefinition[];
    /** The status this write names, if any. */
    namedStatus: unknown;
    /** The committed status of the row being written. */
    liveStatus: unknown;
    /**
     * The locale this write is for. Omitted by a surface that has no locale
     * concept, which is what makes such a surface decline to hold a localized
     * document's edit rather than key it under the wrong slot.
     */
    requestLocale?: string | null;
    /** The caller's transaction, whose connection the schemas are read on. */
    executor?: unknown;
  }): Promise<{
    hold: boolean;
    componentSchemas: ComponentSchemas | null;
    draftLocale: string | null;
  }> {
    const collectionHasStatus =
      (args.collection as { status?: boolean }).status === true;
    const versionsConfig = (args.collection as Record<string, unknown>)
      .versions as ResolvedVersionsConfig | null | undefined;
    const documentLocalized =
      (args.collection as { localized?: boolean }).localized === true;
    // Resolved only once the cheap disqualifiers pass, so a collection the
    // split can never take never pays for a registry read.
    const componentSchemas =
      collectionHasStatus &&
      versionsConfig?.drafts?.enabled === true &&
      !hasPasswordField(args.fields)
        ? await resolveComponentSchemas(
            args.fields as unknown as FieldConfig[],
            args.executor
          )
        : null;
    const { hold, draftLocale } = resolveDraftHold({
      collectionHasStatus,
      draftsVersioningEnabled: versionsConfig?.drafts?.enabled === true,
      documentLocalized,
      fields: args.fields as unknown as FieldConfig[],
      componentSchemas,
      namedStatus: args.namedStatus,
      liveStatus: args.liveStatus,
      requestLocale: args.requestLocale,
      defaultLocale: this.localization?.defaultLocale ?? null,
    });
    return { hold, componentSchemas, draftLocale };
  }

  /** The live document a held save leaves in place, at a draft's shape. */
  private async liveDocumentOf(
    tx: TransactionContext,
    ctx: WorkingDraftWriteContext
  ): Promise<Record<string, unknown>> {
    return assembleDocument(
      await this.snapshotPartsFor(
        {
          parentRow: ctx.liveParentRow,
          components: ctx.snapshotComponents ?? {},
          manyToMany: ctx.snapshotM2M ?? {},
        },
        ctx.fields,
        tx
      )
    );
  }

  /**
   * The update filter a held edit changes a field of, if any. Judged against
   * the live document, not the draft it replaces: an edit held before may
   * already carry a change this save would put on.
   */
  private async heldEditRefusedBy(
    tx: TransactionContext,
    ctx: WorkingDraftWriteContext,
    heldBefore: boolean,
    draftDocument: Record<string, unknown>,
    replaces: Record<string, unknown>
  ): Promise<FilteredWriteCheck | undefined> {
    if (!ctx.updateFilters?.length) return undefined;
    const live = heldBefore ? await this.liveDocumentOf(tx, ctx) : replaces;
    return ctx.updateFilters.find(check =>
      changesFieldFilterNames(check.filter, draftDocument, live, ctx.fields)
    );
  }

  /**
   * The document a working draft should now hold, after this save.
   *
   * Accumulates onto the draft already stored rather than re-deriving from the
   * live row: a second status-less save of different fields would otherwise
   * rebuild from live content and silently revert the first pending edit.
   */
  private async buildAccumulatedDraft(
    tx: TransactionContext,
    ctx: WorkingDraftWriteContext,
    existingDraft: { snapshot: unknown } | undefined
  ): Promise<{
    /** The working draft after this save. */
    draftDocument: Record<string, unknown>;
    /** What it replaces: the previous draft, or the live document. */
    replaces: Record<string, unknown>;
  }> {
    const {
      componentFieldData,
      fields,
      manyToManyData,
      parentRow,
      snapshotComponents,
      snapshotM2M,
      splitComponentSchemas,
      updatePayload,
    } = ctx;
    const draftParts = await this.snapshotPartsFor(
      {
        parentRow,
        components: {
          ...snapshotComponents,
          ...componentFieldData,
        },
        manyToMany: { ...snapshotM2M, ...manyToManyData },
      },
      fields,
      tx
    );
    const patchedDocument = assembleDocument(draftParts);
    // This document is built from the live parent + relations with
    // only the CURRENT patch overlaid. Accumulate it onto an existing
    // working draft rather than the live row: a second status-less
    // save of different fields would otherwise re-derive from live and
    // revert the first pending edit. Read the draft under the row lock
    // (already held above) and, when one exists, overlay only the
    // fields this patch touched onto it, at the assembled read shape.
    // Reused after the transaction as the response/hook document,
    // since the live row the re-fetch returns is the unchanged
    // published content.
    // base below rather than replacing it.
    const touched = new Set<string>([
      ...Object.keys(updatePayload),
      ...Object.keys(componentFieldData),
      ...Object.keys(manyToManyData),
      // Kept by part, a translatable edit is a change of its own language's
      // draft, so it is laid over that draft as the other edits are.
      ...(draftsKeptByPart() ? (ctx.translatedKeys ?? []) : []),
    ]);
    const patchFields = Object.fromEntries(
      Object.entries(patchedDocument).filter(([key]) => touched.has(key))
    );
    // Accumulate onto the existing working draft, or onto the live
    // document on the first save. The live base is assembled through
    // the same snapshot shaping so its components carry the type markers
    // promotion needs, and merging (not replacing) keeps a live single
    // component's other sub-fields when the patch only changed some.
    const draftBase = existingDraft
      ? (existingDraft.snapshot as Record<string, unknown>)
      : assembleDocument(
          await this.snapshotPartsFor(
            {
              parentRow,
              components: snapshotComponents ?? {},
              manyToMany: snapshotM2M ?? {},
            },
            fields,
            tx
          )
        );
    // A single (non-repeatable) component holds an object of sub-fields,
    // and a patch-shaped save carries only the ones it changed. Merge
    // the patch's component objects onto the base recursively (into
    // nested single components) rather than overwriting them, so
    // disjoint sub-field edits coalesce at any depth. A dynamic zone, a
    // repeatable component, and a scalar are replaced whole.
    const draftDocument = mergeComponentPatches(
      draftBase,
      patchFields,
      fields as unknown as FieldConfig[],
      splitComponentSchemas
    );
    const replaces = existingDraft
      ? draftBase
      : await this.liveDocumentOf(tx, ctx);
    return { draftDocument, replaces };
  }

  /**
   * A language's change records its base when it begins: the version whose
   * shared values are the live ones it began from. A later save keeps it, so
   * saving again never makes an old shared value current. Only a collection
   * with languages has values another language shares.
   *
   * @param begins Whether this save begins the change: no working draft held
   *   for its language yet.
   */
  private async recordBaseOfNewChange(
    tx: TransactionContext,
    args: {
      begins: boolean;
      collection: unknown;
      collectionName: string;
      entryId: string;
      fields: FieldDefinition[];
      main: Record<string, unknown>;
      ref: VersionRef;
      locale: string | null;
    }
  ): Promise<void> {
    if (
      !args.begins ||
      (args.collection as { localized?: boolean }).localized !== true
    ) {
      return;
    }
    // A held save has written nothing live, so the live document read here
    // is the one the change began from.
    const { live, shared, views } = await this.liveSharedDocument(tx, {
      collectionName: args.collectionName,
      entryId: args.entryId,
      tableName: collectionTableName(args.collection, args.collectionName),
      fields: args.fields,
      main: args.main,
      locale: args.locale,
    });
    await recordSharedBase(tx, {
      ref: args.ref,
      locale: args.locale,
      shared,
      live,
      views,
    });
  }

  /**
   * The refusal of a held edit its update filter refused, answered as a write
   * that moved the entry out of the filter is; none where nothing refused it.
   */
  private async heldEditRefusal(
    draftWrite: WorkingDraftWriteResult
  ): Promise<CollectionServiceResult | undefined> {
    if (!draftWrite.refusedBy) return undefined;
    return this.accessService.refusalOutsideFilter(
      draftWrite.refusedBy.params,
      draftWrite.refusedBy.reads,
      true
    );
  }

  /**
   * The held component values in `draftDocument`, judged as the publish would
   * judge them: merged into the draft, since a save carries only the
   * sub-fields it changed, and without the type tags the draft holds, which no
   * ordinary write shows a validator. Judged by the pass the component write
   * runs, so a value the publish would refuse is refused now, with the same
   * issues, before any draft or version is recorded.
   */
  private async validateHeldComponents(
    tx: TransactionContext,
    ctx: WorkingDraftWriteContext,
    draftDocument: Record<string, unknown>
  ): Promise<void> {
    const { collection, draftLocale, fields, params, splitComponentSchemas } =
      ctx;
    const heldComponentNames = Object.keys(ctx.componentFieldData ?? {});
    if (!this.fieldGroupDataService || heldComponentNames.length === 0) return;
    // The language the held instances are judged in: the draft's key, or,
    // for a document with no languages, the one the request named. Instance
    // rows and the library they read are kept per language whether or not
    // the host is, so the request's language is the one an ordinary update
    // and the draft's snapshot use; without it they read the default. An
    // empty one is no language, as the write's own locale check reads it.
    const judgedIn = draftLocale ?? (params.locale || undefined);
    await this.fieldGroupDataService.validateComponentDataInTransaction(tx, {
      parentId: params.entryId,
      parentTable: collectionTableName(collection, params.collectionName),
      fields: fields as unknown as FieldConfig[],
      data: stripSingleComponentTags(
        Object.fromEntries(
          heldComponentNames.map(name => [name, draftDocument[name]])
        ),
        fields as unknown as FieldConfig[],
        componentSlug => splitComponentSchemas?.get(componentSlug)?.fields
      ),
      // The language this held write is keyed under: the request's, or the
      // companion's write locale when the patch touched localized columns.
      locale: judgedIn,
      req: params.user ? { user: params.user } : {},
      // Who the write is made as, for each instance's own field rules: the
      // caller and trust the entry's own fields are judged with.
      access: this.fieldGroupAccess(params),
      // The held write, on its transaction and in its language, so a field
      // inside an instance that reads the library, as a blocks field does to
      // judge its composition, judges it now. Without it that field judges
      // nothing, and a held value past the composition rules is saved, to be
      // refused only when someone publishes it. Its payload is the patch as
      // sent, as an ordinary update hands it: a status it did not send stays
      // absent, which a field judging by status reads as no publish.
      write: this.validationWrite(
        params.collectionName,
        params.entryId,
        tx,
        judgedIn,
        this.writtenPayload(
          sentFields(ctx.updatePayload),
          [ctx.manyToManyData, ctx.componentFieldData],
          null
        )
      ),
    });
  }

  /**
   * The held field-group values in `draftDocument`, judged by their own rules
   * before anything is recorded, in place, each denied one kept at what the
   * draft replaces: no save judges a held instance, and a later publisher
   * allowed to write a value would otherwise promote one its author was not.
   */
  private async judgeHeldFieldGroups(
    tx: TransactionContext,
    ctx: WorkingDraftWriteContext,
    draftDocument: Record<string, unknown>,
    replaces: Record<string, unknown>
  ): Promise<void> {
    const { params, splitComponentSchemas } = ctx;
    const access = {
      ...this.fieldGroupAccess(params),
      // Still inside the write's transaction.
      grants: this.callerGrants(
        params.user,
        params.authenticatedScope,
        tx.getDrizzle()
      ),
    };
    await keepDeniedFieldGroupsInDraft({
      draft: draftDocument,
      replaces,
      // The field groups the save wrote, and the containers it wrote whole,
      // which can hold field groups inline.
      names: [
        ...Object.keys(ctx.componentFieldData ?? {}),
        ...Object.keys(ctx.updatePayload),
      ],
      fields: ctx.fields as unknown as FieldConfig[],
      fieldGroupFields: {
        get: slug => splitComponentSchemas?.get(slug)?.fields,
      },
      access,
      // What a stored instance holds in each language, read on the write's
      // own transaction: a held draft writes no translation, so another
      // language's values are the live rows'.
      storedIn: this.storedFieldGroupsInLanguages({
        stored: { id: params.entryId },
        tableName: collectionTableName(ctx.collection, params.collectionName),
        fields: ctx.fields,
        access,
        executor: tx.getDrizzle(),
      }),
    });
  }

  /**
   * Store the pending edit as this document's working draft, on the caller's
   * transaction.
   *
   * Lifted out of the update path so every write surface can reach it. The
   * split had one call site, which is why a status-less update through the
   * transaction-owning and batch surfaces wrote the live row instead of holding
   * the edit.
   *
   * Takes what it needs rather than resolving it: each caller arrives here
   * having already read the parent row, its relations and the resolved schemas
   * on its own transaction, and reading them again would issue a second query
   * on that connection and could observe a row other than the one the caller is
   * about to write.
   */
  private async storeWorkingDraftInTx(
    tx: TransactionContext,
    ctx: WorkingDraftWriteContext
  ): Promise<WorkingDraftWriteResult> {
    const {
      collection,
      collectionHasStatus,
      draftLocale,
      fields,
      params,
      splitComponentSchemas,
    } = ctx;
    let priorWorkingDraftDocument: Record<string, unknown> | undefined;

    const draftRepo = new VersionsRepository(tx);
    const draftRef = {
      scopeKind: "collection" as const,
      scopeSlug: params.collectionName,
      entryId: params.entryId,
    };
    // Under per-language storage the pending change is kept by part: the
    // shared draft and this language's, read here as the one document they
    // describe over the live one, so the save accumulates onto both as it
    // would onto a single draft, and is split back into them when stored.
    const byPart = draftsKeptByPart() && draftLocale !== SHARED_DRAFT_SLOT;
    const parts = byPart
      ? await findPartDrafts(draftRepo, draftRef, draftLocale)
      : undefined;
    const existingDraft = parts
      ? holdsPendingChange(parts)
        ? {
            snapshot: combinedDraft(await this.liveDocumentOf(tx, ctx), parts),
          }
        : undefined
      : await draftRepo.findWorkingDraft(draftRef, draftLocale);
    // The fields this save actually touched, at the assembled read
    // shape. `patchedDocument` overlaid the current patch onto the live
    // relations and REPLACED a single component whole, so a partial
    // patch is captured here (touched keys only) and merged onto the
    const { draftDocument, replaces } = await this.buildAccumulatedDraft(
      tx,
      ctx,
      existingDraft
    );
    // A held edit may not change a field an update filter that judged it
    // names, or the entry could leave the filter once the edit is put live.
    const refusedBy = await this.heldEditRefusedBy(
      tx,
      ctx,
      existingDraft !== undefined,
      draftDocument,
      replaces
    );
    if (refusedBy) return { refusedBy };
    await this.judgeHeldFieldGroups(tx, ctx, draftDocument, replaces);
    await this.validateHeldComponents(tx, ctx, draftDocument);
    // The response and hooks see the draft as an ordinary read, so
    // shape the accumulated snapshot through the current schema the
    // same way the read overlay does. The persisted `draftDocument`
    // below keeps its markers for promotion.
    const responseDeclaredFields = fields as unknown as FieldConfig[];
    const draftIsPluginCollection =
      (collection as { admin?: { isPlugin?: boolean } }).admin?.isPlugin ===
      true;
    const workingDraftDocument = this.shapeDraftForResponse(
      draftDocument,
      responseDeclaredFields,
      splitComponentSchemas ?? null,
      collectionHasStatus,
      draftIsPluginCollection
    );
    // The afterUpdate/afterChange hooks compare against the document
    // BEFORE this save: the published row on the first draft save, but
    // the prior working draft on a later one, so a hook diffing old and
    // new does not see an earlier save's edits as changing again. Shape
    // it the same way so the comparison is like-for-like.
    if (existingDraft) {
      priorWorkingDraftDocument = this.shapeDraftForResponse(
        existingDraft.snapshot as Record<string, unknown>,
        responseDeclaredFields,
        splitComponentSchemas ?? null,
        collectionHasStatus,
        draftIsPluginCollection
      );
    }
    // Recorded before the save's own capture, whose retention pass then keeps
    // it.
    await this.recordBaseOfNewChange(tx, {
      // Kept by part, the change begins when its language's draft does: that
      // draft keeps a copy of a translated component's shared parts, judged
      // against this base when it is published.
      begins: parts ? parts.language === undefined : !existingDraft,
      collection,
      collectionName: params.collectionName,
      entryId: params.entryId,
      fields,
      main: ctx.liveParentRow,
      ref: draftRef,
      locale: draftLocale,
    });
    // The draft, and the save as a version of its own, in this transaction.
    // A save that changes nothing against what it replaces records no version.
    const versionsConfig = (collection as Record<string, unknown>).versions as
      | ResolvedVersionsConfig
      | null
      | undefined;
    // Kept by part: the keys this save set, and which part each belongs to,
    // read once for the store that splits the document and the history that
    // judges every language's review.
    const byParts =
      parts && draftLocale !== SHARED_DRAFT_SLOT
        ? {
            parts,
            // The language whose draft this save writes beside the shared
            // one: never the shared slot here, so the store is handed a code.
            locale: draftLocale,
            touched: new Set([
              ...Object.keys(ctx.updatePayload),
              ...Object.keys(ctx.componentFieldData),
              ...Object.keys(ctx.manyToManyData),
              ...(ctx.translatedKeys ?? []),
            ]),
            keys: await partKeysOf(fields),
          }
        : undefined;
    const { versionNo } = await storeDraftSave(tx, this.versionCapture, {
      ref: draftRef,
      // The key the read overlay, the promote and the discard look under,
      // from `workingDraftLocale`.
      locale: draftLocale,
      // The version is keyed the same way, except where the document has no
      // languages and the snapshot carries a component: that was read in the
      // language the write named, and is recorded under it as every other
      // save is.
      versionLocale:
        draftLocale ??
        ((fields as unknown as FieldConfig[]).some(
          field => isFieldGroupField(field) && draftDocument[field.name] != null
        )
          ? this.componentSnapshotLocale(params.locale)
          : null),
      snapshot: draftDocument,
      replaces,
      createdBy: params.user?.id ?? null,
      sourceVersionNo: params.sourceVersionNo ?? null,
      maxPerDoc: versionsConfig?.maxPerDoc,
      ...(byParts
        ? {
            storeWorkingDraft: async (repo: VersionsRepository) =>
              storePartDrafts(repo, {
                ref: draftRef,
                locale: byParts.locale,
                document: draftDocument,
                touched: byParts.touched,
                keys: byParts.keys,
                existing: byParts.parts,
                createdBy: params.user?.id ?? null,
              }),
          }
        : {}),
    });
    // A held edit is a change to the document another editor must not
    // overwrite unseen, though the live row's content is untouched: only its
    // counter and last changer move, and `updated_at` stays the live one's.
    await bumpDocumentRevision(
      tx,
      ctx.tableName,
      { id: params.entryId },
      actorForWrite(params.actor, params.user)
    );
    // Both update paths hold a draft through here, so the save's history
    // event is recorded here once.
    await this.recordSaveHistory(
      tx,
      params.collectionName,
      params.entryId,
      {
        actor: actorForWrite(params.actor, params.user),
        personName: params.user?.name ?? null,
        locale: draftLocale,
        toState: "draft",
        versionNo,
        sourceVersionNo: params.sourceVersionNo ?? null,
      },
      // A change to the shared draft goes live with any language's publish,
      // so every language's review is judged on the shared values it holds.
      byParts
        ? translatedWhenSharedChanged(byParts.touched, byParts.keys)
        : null
    );

    return { workingDraftDocument, priorWorkingDraftDocument };
  }

  /**
   * An item's language judged inside a transaction it shares (see
   * `judgeLanguageRow`): its refusal as a result, never thrown, since the
   * transaction goes on with the rest of a batch. A version from a read of
   * another language is a validation error.
   */
  private async judgeLanguageInTransaction(
    tx: TransactionContext,
    params: UpdateEntryWriteParams,
    check: VersionCheck,
    entryId: string,
    row: { table: string; languagesTable: string; written: string }
  ): Promise<
    | Awaited<ReturnType<typeof judgeLanguageRow>>
    | CollectionServiceResult<unknown>
  > {
    let judged: string | undefined;
    try {
      judged = judgedLanguage(givenOf(check), row.written);
    } catch (error) {
      return errorToServiceResult(
        error,
        { defaultMessage: "Failed to update entry" },
        this.dialect
      );
    }
    const result = await judgeLanguageRow(
      tx,
      this.dialect,
      check,
      { ...row, id: entryId, judged },
      actorForWrite(params.actor, params.user)
    );
    if (!result.stale || check.kind !== "judge") return result;
    return this.staleVersionAnswerInTransaction(
      tx,
      params,
      entryId,
      check.given,
      {
        table: row.table,
        languages: { table: row.languagesTable, locales: [row.written] },
      }
    );
  }

  /**
   * The refusal of an item found out of date inside a transaction it shares,
   * read on that transaction: a pooled read would wait behind it on SQLite.
   * So who changed it and when are told to a trusted caller alone, unnamed,
   * since the read gate and the people lookup both read on the pool.
   */
  private async staleVersionAnswerInTransaction(
    tx: TransactionContext,
    params: UpdateEntryWriteParams,
    entryId: string,
    given: DecodedVersion,
    at: StaleWrite
  ): Promise<CollectionServiceResult<unknown>> {
    const refusal = await staleVersionErrorFor(tx, {
      dialect: this.dialect,
      scopeKind: "collection",
      slug: params.collectionName,
      id: entryId,
      given,
      at,
      inSharedTransaction: true,
      reader: {
        user: params.user,
        trusted: params.overrideAccess === true && !params.routeAuthorized,
        authenticatedScope: params.authenticatedScope,
      },
    });
    return errorToServiceResult(
      refusal,
      { defaultMessage: "Failed to update entry" },
      this.dialect
    );
  }

  /**
   * Every language a write over all of them is judged on: those a read of
   * every language names, the same list its version is spelled from, narrowed
   * to the languages `parts` chooses when the write moves only some. A read of
   * the chosen languages names those, and an edit of another language since
   * changes nothing the write moves. None where the entry keeps no translation
   * table.
   */
  private everyLanguageJudged(
    check: VersionCheck,
    languagesTable: string | null,
    parts?: LifecycleParts
  ): readonly string[] | undefined {
    const given = givenOf(check);
    const locales = versionLanguagesFor({
      localized: languagesTable !== null,
      localization: this.localization,
      locale: EVERY_LOCALE,
    })?.filter(locale => movesLanguage(parts, locale));
    if (given === undefined || !locales || locales.length === 0) {
      return undefined;
    }
    assertVersionNamesEvery(given, locales);
    return locales;
  }

  /**
   * How a rewrite of one language's pending change is judged (taking the live
   * values into it, or discarding it): from the version its request carries,
   * on the entry's own row and the pending change's language. Decided before
   * the transaction, so a version that names another language is refused as
   * the validation error it is before anything is read under the lock.
   *
   * @throws The validation error of a version that is not one, or that
   *   names no version of the pending change's language.
   */
  private async pendingChangeJudging(
    params: {
      collectionName: string;
      entryId: string;
      locale?: string | null;
      version?: Readonly<Record<string, unknown>>;
    },
    collection: Awaited<ReturnType<DynamicCollectionService["getCollection"]>>
  ): Promise<PendingChangeJudging> {
    const check = this.versionCheckOf(params, { ...params.version });
    if ("success" in check) throw errorFromServiceEnvelope(check);
    const companion = await this.fileManager.loadCompanionSchema(
      params.collectionName
    );
    const languagesTable = translationTableOf(
      companion,
      !!companion &&
        (await isCompanionReady(this.adapter, companion.companionTableName))
    );
    const draftLocale = workingDraftLocale({
      documentLocalized:
        (collection as { localized?: boolean }).localized === true,
      requestLocale: params.locale ?? null,
      defaultLocale: this.localization?.defaultLocale ?? null,
    });
    return {
      check,
      table: collectionTableName(collection, params.collectionName),
      id: params.entryId,
      languagesTable,
      locale: judgedLanguage(
        givenOf(check),
        languagesTable === null ? undefined : (draftLocale ?? undefined)
      ),
    };
  }

  /**
   * Judge a rewrite of a pending change under the entry's lock, before it
   * writes: the entry's own row, which every save of the change moves, and
   * the change's language, read as the save of it would be. Throws when out
   * of date, rolling the rewrite back; returns the rows as they stood, for an
   * overwrite's record of whom it replaced.
   */
  private async refuseIfPendingChangeMoved(
    tx: TransactionContext,
    judging: PendingChangeJudging,
    holder: StaleWriteHolder
  ): Promise<{
    main: DocumentRevisionState | undefined;
    language: PartState | undefined;
  }> {
    const locales = judging.locale === undefined ? undefined : [judging.locale];
    const main = await refuseIfMainMoved(
      tx,
      this.dialect,
      judging.check,
      {
        table: judging.table,
        id: judging.id,
        languages: languagesJudged(judging.languagesTable, locales),
      },
      holder
    );
    return { main, language: judgedLanguageStates(main, locales)?.[0] };
  }

  /**
   * How a move of every language's status is judged, from the version its
   * request data carries (`versionCheckOf`).
   *
   * @throws The validation error of a version that is not one.
   */
  private lifecycleVersionCheck(
    params: AllLocalesLifecycleParams
  ): VersionCheck {
    const check = this.versionCheckOf(params, { ...params.data });
    if ("success" in check) throw errorFromServiceEnvelope(check);
    return check;
  }

  /**
   * The answer to a write refused inside its own transaction, once that has
   * rolled back: out of date (the refusal read from the entry as it now is),
   * else `otherwise`, a refusal the transaction kept for its catch.
   */
  private async refusalAfterRollback(
    stale: {
      params: Parameters<CollectionMutationService["staleVersionAnswer"]>[0];
      check: VersionCheck;
      holder: StaleWriteHolder;
    },
    otherwise: CollectionServiceResult | undefined
  ): Promise<CollectionServiceResult | undefined> {
    const { params, check, holder } = stale;
    if (!holder.at || check.kind !== "judge") return otherwise;
    return this.staleVersionAnswer(params, check.given, holder.at);
  }

  /**
   * How an update is judged, decided from its body before the version in it
   * is dropped: a release run's own write is exempt, and nothing a caller
   * sends can make a write one. A version that is not one is answered as the
   * validation error it is.
   */
  private versionCheckOf(
    target: { collectionName: string; entryId: string },
    body: Record<string, unknown>
  ): VersionCheck | CollectionServiceResult {
    try {
      return versionCheckFor(body, {
        exempt: releaseRunExemptFor({
          scopeKind: "collection",
          scopeSlug: target.collectionName,
          entryId: target.entryId,
        }),
      });
    } catch (error) {
      return errorToServiceResult(
        error,
        { defaultMessage: "Failed to update entry" },
        this.dialect
      );
    }
  }

  /**
   * The refusal of a save whose version is below the one the entry already
   * holds, before any hook runs: a counter only goes up, so such a version is
   * certainly out of date. Null otherwise, for the row lock to decide.
   */
  private async certainlyStaleAnswer(
    params: Parameters<CollectionMutationService["staleVersionAnswer"]>[0] & {
      locale?: string;
    },
    check: VersionCheck,
    table: string,
    /** A sweep of every language, judged on each of them. */
    sweep: boolean
  ): Promise<CollectionServiceResult | null> {
    if (check.kind !== "judge") return null;
    // The languages the save is judged on: compared here as the main row is,
    // and named in the answer so it can be sent back with the same save.
    // Read before any hook has split the body, so taken from the request:
    // every language for a sweep, else the one it names or the default.
    const companion = await this.readyCompanionOf(params.collectionName);
    const requested = this.localization
      ? resolveRequestedLocale(this.localization, params.locale)
      : undefined;
    const locales =
      companion && this.localization && requested !== undefined
        ? sweep
          ? this.localization.locales.map(l => l.code)
          : [requested]
        : [];
    const unjudgeable = await this.unjudgeableVersionAnswer(
      params,
      check.given,
      {
        ready: companion !== null,
        requested,
        locales,
        sweep,
      }
    );
    if (unjudgeable) return unjudgeable;
    const at: StaleWrite =
      companion && locales.length > 0
        ? { table, languages: { table: companion.companionTableName, locales } }
        : { table };
    const stale = await certainlyStale(poolRevisionReader(this.adapter), {
      dialect: this.dialect,
      table,
      id: params.entryId,
      given: check.given,
      languages: at.languages,
    });
    return stale ? this.staleVersionAnswer(params, check.given, at) : null;
  }

  /**
   * The refusal of a version that can't be judged, before any hook runs, as
   * the validation error it is: one from a read of another language, one for
   * a sweep that does not name every language, or, before the translation
   * table is ready, one for a save in another language than the default,
   * which has nowhere to go and whose read named no language. Null for a
   * version that can be judged.
   */
  private async unjudgeableVersionAnswer(
    params: { collectionName: string },
    given: DecodedVersion,
    args: {
      /** Whether the translation table is ready. */
      ready: boolean;
      /** The save's language, as the request names it. */
      requested: string | undefined;
      /** The languages it is judged on, where the table is ready. */
      locales: readonly string[];
      sweep: boolean;
    }
  ): Promise<CollectionServiceResult | null> {
    const notReadyLanguage =
      !args.ready &&
      !args.sweep &&
      args.requested !== undefined &&
      args.requested !== this.localization?.defaultLocale &&
      (await this.fileManager.loadCompanionSchema(params.collectionName)) !==
        null;
    try {
      if (notReadyLanguage) judgedLanguage(given, args.requested);
      else if (args.sweep) assertVersionNamesEvery(given, args.locales);
      else if (args.locales.length > 0) judgedLanguage(given, args.locales[0]);
      return null;
    } catch (error) {
      return errorToServiceResult(
        error,
        { defaultMessage: "Failed to update entry" },
        this.dialect
      );
    }
  }

  /**
   * The refusal of an update made from an out-of-date version, read from the
   * entry as it is now, on the pool. Who changed it last and when are told
   * only to a caller who may read the entry, as a read of it would decide.
   */
  private async staleVersionAnswer(
    params: {
      collectionName: string;
      entryId: string;
      user?: UserContext;
      overrideAccess?: boolean;
      routeAuthorized?: boolean;
      authenticatedScope?: AuthenticatedScope;
      request?: Request;
      context?: Record<string, unknown>;
    },
    given: DecodedVersion,
    at: StaleWrite
  ): Promise<CollectionServiceResult> {
    const refusal = await staleVersionErrorFor(
      poolRevisionReader(this.adapter),
      {
        dialect: this.dialect,
        scopeKind: "collection",
        slug: params.collectionName,
        id: params.entryId,
        given,
        at,
        reader: {
          user: params.user,
          trusted: params.overrideAccess === true && !params.routeAuthorized,
          authenticatedScope: params.authenticatedScope,
          hookInputs: { request: params.request, context: params.context },
        },
      }
    );
    return errorToServiceResult(
      refusal,
      { defaultMessage: "Failed to update entry" },
      this.dialect
    );
  }

  async updateEntry(
    // Named `rawParams` because the body must not read it: the wildcard locale
    // is resolved away into `params` at the top of the method. See there.
    rawParams: {
      collectionName: string;
      entryId: string;
      user?: UserContext;
      /**
       * Who performed the write, recorded on the outbox event. Set by the
       * transport; absent for internal writes, which record as `system`.
       */
      actor?: RequestActor;
      overrideAccess?: boolean;
      /**
       * Which collections a trusted read may reach as relationships are expanded.
       * Absent means every populated target inherits the caller's trust. Only ever
       * narrows. See {@link RelatedRowReadContext.trusted}.
       */
      trusted?: TrustBound;
      /** Write locale (i18n M5): translatable values are updated for this language only. */
      locale?: string;
      // Set by the REST dispatcher: route-level authorization already ran, so
      // the collection re-check is skipped, but the response is still redacted
      // to what this user may read (this is not a trusted-server read).
      routeAuthorized?: boolean;
      context?: Record<string, unknown>;
      /** The HTTP request behind this operation, when one produced it. */
      request?: Request;
      /**
       * Set when this write restores an earlier version, recording which one on
       * the version it captures. Lineage cannot be inferred afterwards: a
       * restore is an ordinary write that happens to reproduce an earlier state.
       */
      sourceVersionNo?: number;
      /**
       * Set when this write restores a recorded save of a working draft: its
       * content was never live, so on a published document it must be held as
       * the working draft. Where the document can no longer hold one, the
       * write is refused rather than applied to the live row.
       */
      requireHeldDraft?: boolean;
      // The caller's authenticated scope. For a scoped API-key REST write the
      // publish/unpublish transition gate judges the key's OWN grants, since the
      // route only authorized `update` against the key's scope.
      authenticatedScope?: AuthenticatedScope;
      /**
       * The batch this write's components and relationships are read in where
       * it publishes, when a bulk write runs it with others: one read for them
       * all rather than one per document.
       *
       * @internal
       */
      goingLiveBatch?: GoingLiveRelationsBatch;
    },
    body: Record<string, unknown>,
    depth?: number
  ): Promise<CollectionServiceResult> {
    // Refused first when the collection is removed from code, before any hook
    // or read of the entry, so a refused write changes nothing.
    await refuseWriteIfRemovedFromCode("collection", rawParams.collectionName);
    // {@link EVERY_LOCALE} is a SWEEP INSTRUCTION, not a write locale, and the
    // body of this method must never see it as one. Resolved here, once, so the
    // fourteen places below that read `params.locale` keep receiving a real
    // locale or nothing — a wildcard threaded through them would reach
    // `resolveRequestedLocale`, the version capture and the event payloads as if
    // it named a language.
    //
    // Document-wide is exactly what the wildcard means, so it degrades to the
    // unlocalized write (`locale: undefined`): the main row's `status` moves and
    // is NOT stripped the way a non-default locale's write strips it. The only
    // thing the wildcard adds is the companion sweep at the write itself.
    // Read once, as plain data: a caller's object may compute a key on each
    // read, and the gate a write asks and the write itself must read the same
    // body.
    // Judged against the version the caller read, when it sent one: decided
    // here, before the version is dropped below. A release run's own write is
    // exempt, and nothing a caller sends can make a write one.
    const versionCheck = this.versionCheckOf(rawParams, body);
    if ("success" in versionCheck) return versionCheck;
    // The version a client sends back with what it read is the server's to
    // decide, so it is dropped before any hook or gate reads the body.
    body = withoutDocumentVersionKeys({ ...body });
    const sweepAllLocales = rawParams.locale === EVERY_LOCALE;
    const params = sweepAllLocales
      ? { ...rawParams, locale: undefined }
      : rawParams;

    // The wildcard moves a LIFECYCLE and nothing else.
    //
    // Strapi's document service admits `"*"` on publish/unpublish/delete/
    // discardDraft and deliberately withholds it from `update`, because "write
    // these values into every language" is a different and far more destructive
    // operation than "move this document's lifecycle across every language" —
    // the first would copy one language's prose over all the others. Nextly has
    // one door for both, so the distinction has to be enforced here rather than
    // by having two doors.
    //
    // Refused rather than narrowed to the status: silently ignoring the other
    // fields would report success for a write that did not happen.
    if (sweepAllLocales) {
      const named = Object.keys(body);
      const statusOnly = named.length === 1 && named[0] === "status";
      // The VALUE has to be one the lifecycle can hold, not merely the right
      // key. A caller sending `{ status: false }` otherwise passes this guard,
      // and the write then splits: a dialect coerces the value into the main
      // row while `splitLocalizedWriteData` omits `_status`, so the companion
      // sweep — which requires a string — skips every translation. That is the
      // partial move this whole change exists to prevent, arriving through the
      // door meant to stop it.
      if (statusOnly && !isLifecycleStatus(body.status)) {
        return {
          success: false,
          statusCode: 400,
          message:
            `locale '${EVERY_LOCALE}' moves a publication status, so 'status' ` +
            `must be one of ${LIFECYCLE_STATUSES.join(", ")}. Received: ` +
            `${JSON.stringify(body.status)}.`,
          data: null,
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
          data: null,
        };
      }
    }

    // Set once the outbox event is appended (below); lets the catch report a
    // committed-but-hook-failed update as `eventRecorded` even when `success` is
    // false. Declared out here so both the success and catch returns see it.
    let eventRecorded = false;
    // Set once the update transaction commits, independent of the recording and
    // revalidation opt-outs — the durable-write signal the retention pass keys
    // off, so an update that opts out of BOTH still triggers write-path cleanup.
    let committedWrite = false;
    // The revalidation intent, and the pre-write slug it needs for old-path
    // busting. `previousSlug` is captured inside the transaction (where the
    // assembled previous document is in scope) and read out here so the intent,
    // computed post-commit, can bust the stale slug tag after a rename.
    let revalidationIntent: RevalidationIntent | undefined;
    // The version this save produced, read inside its own transaction: the
    // re-read after the commit below can already see a later save's.
    let writtenVersion: string | undefined;
    let previousSlug: string | undefined;
    // Set when the in-transaction transition check refuses the write. Declared
    // out here (not in `try`) so the catch can read it: the adapter wraps a
    // thrown error in a DatabaseError (see VersionConflictError), so `instanceof`
    // no longer identifies the sentinel after the throw, but this result stays
    // correct regardless of how the error is wrapped.
    let transitionDeniedResult: CollectionServiceResult | undefined;
    // Rolls the transaction back with `refusal`, where there is one, for the
    // catch to return.
    const refuseWith = (
      refusal: CollectionServiceResult | null | undefined
    ): void => {
      if (!refusal) return;
      transitionDeniedResult = refusal;
      throw new StatusTransitionDeniedError();
    };
    // The shared fields a pending change may not publish, and the live
    // document they were judged against; see `SharedValuesOutOfDateError`.
    let outOfDateShared:
      | { fields: string[]; live: Record<string, unknown> }
      | undefined;
    // A write refused under the row lock: a promotion, for what its stored
    // relations hold once locked, or a conditional write, for a value no
    // longer the one its writer read; read after the transaction, as above.
    const lockedPromotion: { refusal?: NextlyError } = {};
    // Set when the version the caller gave is found out of date inside the
    // transaction: where to read the current one once it has rolled back.
    const staleWrite: StaleWriteHolder = {};
    // Which languages a wildcard sweep actually moved, and what each moved FROM.
    // Captured at the write because it is unrecoverable afterwards, and read at
    // the event step so each real transition is reported once.
    let sweptLocaleTransitions: Map<string, string | null> | undefined;
    // The same languages, carried past the commit so in-process workflow
    // subscribers observe each published translation and not only the main row.
    let sweptLocaleReplays: {
      locale: string;
      from: string | null;
      data: Record<string, unknown>;
    }[] = [];
    try {
      // reject an unknown write locale before doing anything else.
      const badLocale = this.rejectInvalidWriteLocale(params.locale);
      if (badLocale) return badLocale;

      // Fetch the existing entry first (needed for access control and hooks),
      // then:
      //
      // 1. Check collection-level access FIRST (with document for owner checks)
      //
      // This verdict is NOT atomic with the write it guards, and that is a known
      // property rather than an oversight. The transaction opens several hundred
      // lines below, after schema loads, hook dispatch and relationship
      // resolution, so a change to this document's ownership or to the
      // collection's access rules in between leaves the write proceeding on a
      // verdict that has stopped being true. Exploiting it requires an actor who
      // held legitimate access moments earlier.
      //
      // Two facts about closing it, and no remedy: a remedy stated here would
      // have to name a path, and every path this method could take differs from
      // it in ways the next two paragraphs make concrete.
      //
      // The evaluator can already read inside a transaction:
      // `checkCollectionAccess` takes a transaction-bound `executor` so its RBAC
      // and metadata reads run on that connection. So the missing piece is not
      // the evaluator.
      //
      // And a transaction alone would not close the window anyway. Locking the
      // content row leaves the role, permission and collection-metadata rows the
      // verdict also depends on unlocked, and the transaction is not
      // serializable, so a grant revoked concurrently still races.
      //
      // `updateEntryInTransaction` is NOT the path to delegate to: it accepts
      // none of `locale`, `context`, `sourceVersionNo` or `authenticatedScope`,
      // and it performs neither the localized companion writes nor the
      // working-draft promotion this method owns.
      //
      // One rule for anyone editing this method: do NOT move validation,
      // relationship resolution or hook dispatch ahead of this check to shorten
      // the gap. Authorization is a precondition, so work placed before it runs
      // for callers about to be refused, and hooks reach outside this process.
      // `collection-mutation.test.ts` holds that ordering for hooks, with an
      // authorized positive control so it cannot pass by nothing dispatching.
      //
      // Moving such work INTO the transaction is not the general answer either,
      // and this method is already evidence: component-registry and
      // webhook-field resolution are deliberately resolved outside it, and
      // `assertLocalizedFieldGroupsWritable` warms its verdicts beforehand
      // because resolving inside would issue a query that aborts the whole
      // transaction on PostgreSQL. Work that uses a pooled helper stays where
      // it is. Accepting an executor is necessary for work to move but not
      // sufficient: the transaction is retried on a version conflict
      // (`versionConflictRetries`), which re-runs its closure up to three attempts, so only work whose
      // repetition is harmless belongs there. Database writes qualify, because
      // a rolled-back attempt leaves nothing behind. Hook dispatch does not,
      // whatever its signature accepts: `CollectionHookService.runBeforeChange`
      // takes an executor and still runs handlers that reach outside this
      // process, so a retried attempt re-fires effects no rollback can
      // withdraw. External dispatch stays outside the retrying closure.
      //
      // A rule that must be judged against the row as locked belongs in the
      // under-lock re-check the publish path already uses, not here.
      // A write that changes only the status of an entry with a lifecycle is a
      // publish or an unpublish alone, judged by the gate its status names in
      // place of update. Any other field it names is an edit, which needs
      // update whatever its value. The lifecycle is read only for such a body.
      const gate = await writeGateFor(
        body,
        "collection",
        async () =>
          (
            (await this.collectionService.getCollection(
              params.collectionName
            )) as { status?: boolean }
          ).status === true
      );
      const statusOnly = gate !== "update";
      // Handed on as the status alone: the system columns a status-only body
      // may also name are never stored, and no hook is handed a value sent by
      // a caller judged without update.
      if (statusOnly) body = { status: body.status };
      // A write to every language that publishes is judged as publishing
      // every language is, once in each language it puts live (asked below,
      // before any hook runs), not once in all of them together: a rule
      // answering by language would otherwise refuse over a language that does
      // not go live.
      const publishesEveryLanguage = sweepAllLocales && gate === "publish";
      const toUpdate = await this.entryToUpdate({
        ...params,
        gate: publishesEveryLanguage ? null : gate,
      });
      if (toUpdate.answer) return toUpdate.answer;
      const { accessUser, schema, existingEntry } = toUpdate;
      // Each filter that judged this write, with what it was asked as: the
      // entry is matched against each before any hook runs, again under the
      // row lock, and once more after the write, which may not move the entry
      // out of any of them.
      const writeFilters: FilteredWriteCheck[] = [];
      if (toUpdate.gateAccess && toUpdate.gateParams) {
        const refused = await this.addWriteFilter(writeFilters, {
          schema,
          access: toUpdate.gateAccess,
          params: toUpdate.gateParams,
          locale: params.locale,
        });
        if (refused) return refused;
      }
      // Its grant is asked here, before any work only a publish needs; its
      // rule below, in each language, once the languages going live are known.
      const grantRefused = publishesEveryLanguage
        ? await this.lifecycleGrantRefusal("publish", params, accessUser)
        : null;
      if (grantRefused) return grantRefused;

      // The row as stored, apart from `existingEntry`: the read shape built
      // from it below withholds its passwords in place, and a container held
      // as a JSON value shares its objects, so their stored hashes are read
      // from this copy.
      const storedRow = detachData(existingEntry as Record<string, unknown>);

      // Get collection metadata to identify relation fields and hooks
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const fields = collectionFields(collection);
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      // Asked BEFORE any hook runs. This request is invalid by definition,
      // and a hook may have external side effects — a webhook, a mail, a write
      // into another system — that the 400 below cannot take back. A
      // precondition reached after the side effects have happened is a report
      // rather than a gate.
      //
      // The wildcard moves a LIFECYCLE, so a collection that has none has
      // nothing for it to move, and the write must not proceed as an ordinary
      // one. This is the flag on the config, not the presence of a `status`
      // COLUMN: a collection carrying an ordinary user field called `status` has
      // the column and no lifecycle, and letting the wildcard through there
      // would write that field on the default locale — a field write, which is
      // exactly what the wildcard contract refuses.
      //
      // Refused rather than answered as a no-op success. A no-op would let a
      // scheduled release report itself applied having moved nothing, which is
      // the failure mode this whole change exists to remove.
      if (
        sweepAllLocales &&
        (collection as { status?: boolean }).status !== true
      ) {
        return {
          success: false,
          statusCode: 400,
          message:
            `Collection '${params.collectionName}' has no draft/published ` +
            `lifecycle, so locale '${EVERY_LOCALE}' has no publication status ` +
            `to move across its languages.`,
          data: null,
        };
      }

      // The languages a write to every language that publishes was asked
      // about before any hook ran (see the gate above), read before the rule
      // is asked: the row lock compares them with what goes live.
      let askedBeforeHooks: string[] | undefined;
      if (publishesEveryLanguage && !params.overrideAccess) {
        askedBeforeHooks = await this.languagesToPublish({
          collectionName: params.collectionName,
          entryId: params.entryId,
          row: existingEntry as Record<string, unknown>,
          fields,
          promotesDraftOf: collection,
        });
        const refusal = await this.refusedInEachLanguage({
          collectionName: params.collectionName,
          entryId: params.entryId,
          languages: askedBeforeHooks,
          ask: () =>
            this.refusalOfLifecycleInLanguage(writeFilters, schema, {
              collectionName: params.collectionName,
              operation: "publish",
              entryId: params.entryId,
              user: accessUser,
              overrideAccess: params.overrideAccess,
              routeAuthorized: false,
              authenticatedScope: params.authenticatedScope,
            }),
        });
        if (refusal) return refusal;
      }

      const tableName = collectionTableName(collection, params.collectionName);
      // A conditional write naming a key no update stores is refused here: its
      // access has been judged, so a caller who may not update is refused
      // alike whatever it names, and no hook has run.
      refuseUnstoredKeys(
        params.context,
        {
          kind: "collection",
          slug: params.collectionName,
          id: params.entryId,
        },
        { tableName, fields }
      );

      // A version below the one the entry already held when it was read is
      // certainly out of date, since a counter only goes up: refused here,
      // before any hook runs. Any other is judged under the row lock.
      const certainlyStale = await this.certainlyStaleAnswer(
        params,
        versionCheck,
        tableName,
        sweepAllLocales
      );
      if (certainlyStale) return certainlyStale;

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = { ...params.context };
      // Resolved once for the whole operation, so every hook phase is told the
      // same thing about the caller and none of them re-reads a header.
      const requestFacts = resolveRequestFacts(params.request);

      // `beforeOperation`, then the code and stored `beforeUpdate` hooks: the
      // hooks before validation, which can modify the incoming data.
      let finalData = await this.beforeUpdateHooks({
        collectionName: params.collectionName,
        entryId: params.entryId,
        body,
        existingEntry,
        user: params.user,
        storedHooks,
        sharedContext,
        requestFacts,
      });

      // Password fields store bcrypt hashes, never the submitted value.
      // Runs after hooks (so hooks see the plaintext they may validate
      // against) and before any serialization touches the column value.
      // Enforce the schema's declared rules on the server. Every writer
      // (admin, REST, Direct API, bulk, forms) funnels through this path,
      // so this is where required/min/max/pattern/options are guaranteed;
      // runs on the post-hook data and before hashing so password rules
      // see the plaintext length, not the hash's.
      // Field-level access: fields the caller may not update are stripped
      // silently (Payload parity); overrideAccess bypasses. The document id
      // is passed so owner/record-aware access rules can evaluate.
      // With the field groups this entry stores inline, by their own rules,
      // and every denied value inside a container kept as the row holds it.
      // For a conditional write made whole, what this pass takes out or keeps
      // is recorded, and refuses it once every hook has run.
      const storedForAccess = await this.storedForCarryForward({
        row: existingEntry as Record<string, unknown>,
        fields,
        tableName,
        collectionName: params.collectionName,
        entryId: params.entryId,
        locale: params.locale,
        overrideAccess: params.overrideAccess,
      });
      const { storedPaths, storedValues } = await fieldAccessPass(
        params.context,
        {
          kind: "collection",
          slug: params.collectionName,
          id: params.entryId,
        },
        finalData,
        () =>
          this.keepDeniedFieldsAtStored({
            data: finalData,
            storedId: String(existingEntry.id),
            collectionName: params.collectionName,
            stored: storedForAccess,
            tableName,
            fields,
            params,
          })
      );

      // Field-level beforeValidate hooks transform values ahead of the
      // validation gate (functions resolved via the field-level registry).
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "beforeValidate",
        data: finalData,
        operation: "update",
        user: params.user,
      });

      {
        // i18n M5b: on update only fields present in the patch are checked (required cannot be
        // blanked). `required` on a localized field is enforced only for the default-locale write;
        // other locales fall back, so the canonical validator gets the localized-field context.
        const localeCtx = await this.localizedRequiredContext(
          params.collectionName,
          params.locale
        );
        await this.assertEntryValid({
          data: finalData,
          fields,
          collectionName: params.collectionName,
          mode: "update",
          user: params.user,
          reader: params,
          localeCtx,
          ...(params.locale === undefined
            ? {}
            : { writeLocale: params.locale }),
          id: params.entryId,
          storedProvenancePaths: storedPaths,
        });
      }

      // Collection-level beforeChange hooks, on data the validation gate has
      // just passed. Paired with the field-level phase below so the two
      // declarations of that name mean the same moment. What the hooks leave
      // behind is judged after the field-level phase — a hook write is a
      // write the gate never saw.
      const storedStatus = await this.hookStoredStatus(
        params.collectionName,
        params.entryId,
        existingEntry as Record<string, unknown>,
        params.locale
      );
      await this.hookService.runBeforeChange({
        collection: params.collectionName,
        operation: "update",
        data: finalData,
        originalData: existingEntry,
        ...(storedStatus === undefined ? {} : { storedStatus }),
        storedHooks,
        queryDatabase: this.queryDatabaseFn,
        user: params.user,
        sharedContext,
        req: requestFacts,
      });

      // Field-level beforeChange hooks transform the final stored value
      // (runs after validation, before hashing/serialization).
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "beforeChange",
        data: finalData,
        operation: "update",
        user: params.user,
      });
      // Every hook has run: a conditional write made whole is judged here, on
      // what is about to be persisted, before it is shaped and written.
      await refuseUnlessWhole(
        params.context,
        {
          kind: "collection",
          slug: params.collectionName,
          id: params.entryId,
        },
        finalData
      );

      // The whole-number floor judges what the hooks changed: a fraction a
      // hook produced would reach the integer column and let the database
      // decide, on every verb this gate guards. Paths the restore kept from
      // the row for a denied rule are the row's own, not judged.
      const hookIssues = hookChangedWholeNumberIssues(
        finalData,
        fields,
        "",
        await this.hookWalkComponentResolver(fields),
        storedPaths,
        // A hook can reach what the restore kept; a value it changed there
        // is judged, while the row's own content stays the row's.
        storedValues
      );
      if (hookIssues.length > 0) {
        throw NextlyError.validation({ errors: hookIssues });
      }

      // A password the update leaves out of a container keeps its stored hash.
      // The same stored value is what its repeater rows keep their ids
      // against, in `shapeWriteParts` below.
      const reach = await this.passwordReach(fields);
      const storedContainers = await this.storedContainersForWrite({
        row: storedRow,
        fields,
        reach,
        collectionName: params.collectionName,
        entryId: String(existingEntry.id),
        locale: params.locale,
      });
      await hashPasswordFieldValues(
        finalData,
        fields,
        reach,
        carryStoredPasswords(finalData, storedContainers, fields, reach)
      );

      // Strip an explicit `status: undefined` AFTER every mutating hook has run.
      // A field-level beforeValidate/beforeChange hook can (re)introduce an own
      // `status: undefined`, which names no status change but would otherwise be
      // sanitized to SQL NULL on the raw-parameter path — silently unpublishing a
      // published row, or nulling a create's draft default — without passing the
      // publish/unpublish gate. Placed here, the last status-touching step before
      // the transition classification and the write, so the write payload and the
      // gate agree even when a hook set the undefined.
      stripUndefinedStatus(finalData);

      // A status-only write was judged by its publish or unpublish gate in
      // place of update. A hook that made it an edit, naming a field or
      // dropping the status, asks update now, before anything is written, as
      // the same edit sent by the caller would have been.
      // Its rule's filter limits the edit as an edit's own: the entry is
      // matched against it now, and again under the lock and after the write.
      if (statusOnly && !isStatusOnlyWrite(finalData, "collection")) {
        const editParams: FilteredWriteCheck["params"] = {
          collectionName: params.collectionName,
          operation: "update",
          entryId: params.entryId,
          user: accessUser,
          overrideAccess: params.overrideAccess,
          // The route admitted a status change, not this edit.
          routeAuthorized: false,
          authenticatedScope: params.authenticatedScope,
        };
        const access =
          await this.accessService.checkCollectionWrite(editParams);
        const editDenied =
          access.denied ??
          (await this.addWriteFilter(writeFilters, {
            schema,
            access,
            params: editParams,
            locale: params.locale,
          }));
        if (editDenied) return editDenied;
      }

      // Many-to-many field defs drive both the extraction inside shapeWriteParts
      // and the junction rewrite later in this transaction, so they are resolved
      // once here and reused rather than recomputed.
      const manyToManyFields = fields.filter(
        f =>
          f.type === "relationship" &&
          // Only UI-built manyToMany routes through a junction table. Code-first
          // `hasMany: true` is stored as a JSON array on the parent column and is
          // serialized in the same shaping pass.
          f.options?.relationType === "manyToMany"
      );

      // Shape the post-hook input into the row payload (mutating finalData) plus
      // the component and many-to-many pieces that persist outside the main row.
      // `let` because a publish that promotes an accumulated working draft
      // rebinds these to the merged draft+payload shape below.
      let { manyToManyData, componentFieldData } = this.shapeWriteParts(
        finalData,
        fields,
        manyToManyFields,
        collection,
        { stored: storedContainers, reach }
      );

      // Update main entry
      // Use Date object (not .toISOString() string) because Drizzle's timestamp()
      // column without mode:'string' expects Date objects and calls .toISOString()
      // internally during serialization. Passing a string causes
      // "value.toISOString is not a function".

      // Phase 4 follow-up (post-merge): when updateEntry hits a SQLite
      // "Too few parameter values were provided" error, this debug log
      // is the only way to see what finalData looks like at the bind
      // boundary. Set DEBUG_ENTRY_UPDATE=1 to enable. Logs keys and
      // value types only (never values) so user data never leaks to
      // operator logs even with the flag on.
      // eslint-disable-next-line turbo/no-undeclared-env-vars
      if (process.env.DEBUG_ENTRY_UPDATE === "1") {
        const keyTypes = Object.fromEntries(
          Object.entries(finalData).map(([k, v]) => [
            k,
            v === null
              ? "null"
              : v === undefined
                ? "undefined"
                : Array.isArray(v)
                  ? `array(len=${v.length})`
                  : typeof v === "object"
                    ? `object(keys=${Object.keys(v).length})`
                    : typeof v,
          ])
        );
        this.logger.info("[updateEntry debug]", {
          detail: JSON.stringify({
            collectionName: params.collectionName,
            entryId: params.entryId,
            finalDataKeys: Object.keys(finalData),
            finalDataKeyTypes: keyTypes,
            schemaColumns: Object.keys(schema as unknown as object),
          }),
        });
      }

      // i18n M5/M6: pull translatable values out of the main update (finalData uses camelCase field
      // keys) so they update the companion `_locales` row for the write's locale instead. `null` =
      // not localized / companion not migrated yet (values stay on main — dev path, unchanged).
      // The status this write intends to persist, captured before the locale
      // split below removes it from `finalData` for a non-default-locale write
      // (it moves into the companion `_status`). Post-hook value, not the raw
      // body — see the create path.
      const intendedStatus = finalData.status;

      // A wildcard that no longer carries a status after hooks has nothing to
      // move, and must say so rather than commit an ordinary write.
      //
      // A `beforeChange` hook can remove `status` from the patch. The write then
      // succeeds having moved nothing: no transition fires, so the sweep is
      // skipped, and every language keeps the status it had. The release that
      // asked for this reads the main row afterwards, finds the default language
      // already at the target, and records itself applied — reporting a
      // document-wide move that never happened, in the one direction nobody
      // re-checks.
      //
      // Refused HERE rather than detected afterwards, because this is where the
      // knowledge is: the verification step reads one language and cannot see
      // the others, so no check it performs could tell the two cases apart.
      if (sweepAllLocales && !isLifecycleStatus(intendedStatus)) {
        return {
          success: false,
          statusCode: 409,
          message:
            `locale '${EVERY_LOCALE}' was asked to move this document's ` +
            `publication status, but after hooks the write carries no status ` +
            `to move. A hook that clears 'status' turns a document-wide ` +
            `lifecycle change into a write that silently does nothing.`,
          data: null,
        };
      }

      let localizedUpdate = await this.splitLocalizedWriteData(
        params.collectionName,
        finalData,
        params.locale,
        false
      );
      // A translated save is judged on its own language too, so the version
      // must name it; one from a read of another language is refused here,
      // before anything is written.
      const judgedLocale = judgedLanguage(
        givenOf(versionCheck),
        localizedUpdate?.writeLocale
      );
      // The languages a refusal's current version names: the one the save is
      // judged on, or for a sweep of every language, each of them, all of
      // which a sweep's version names and all of which it is judged on.
      const sweepCompanion =
        // An overwrite reads them too, to say whose change it replaced. Only
        // where the translation table is ready, as a read names languages
        // only then.
        sweepAllLocales && versionCheck.kind !== "unjudged"
          ? await this.readyCompanionOf(params.collectionName)
          : null;
      const judgedLanguages = sweepCompanion
        ? {
            table: sweepCompanion.companionTableName,
            locales: this.localization?.locales.map(l => l.code) ?? [],
          }
        : localizedUpdate && judgedLocale
          ? {
              table: localizedUpdate.companionTableName,
              locales: [judgedLocale],
            }
          : undefined;

      // Whether this write targets a non-default locale's companion `_status`
      // (which the in-transaction check below reads under the lock) rather than
      // the main row. A trusted write skips the transition gate entirely.
      const isNonDefaultLocaleStatusWrite =
        !params.overrideAccess &&
        localizedUpdate?.hasStatus === true &&
        localizedUpdate.writeLocale !== this.localization?.defaultLocale;
      // The status this write will persist: for a non-default locale it is the
      // companion `_status` the split produced (a string only when one was
      // provided), otherwise the main-row status.
      const transitionNextStatus = isNonDefaultLocaleStatusWrite
        ? localizedUpdate?.companionData._status
        : intendedStatus;
      // Resolve the one publish permission this write could require — keyed on
      // the status it will persist — BEFORE the transaction opens, so the RBAC
      // read stays off this transaction's connection. The decision is cached and
      // enforced against the ROW-LOCKED status inside the transaction (below), so
      // a concurrent writer that changed the published state between the
      // pre-transaction read and the lock cannot slip a transition past the gate.
      // No guard is needed for a trusted write, a collection with no lifecycle,
      // or a write that names no status at all (`undefined` = leave it
      // untouched). Any other explicitly-provided value IS a write to the
      // status column — including a non-string one that a dialect coerces into
      // the text column — so the guard must cover it too: `"published"` is the
      // only value that can publish, and every other provided value can only
      // move a published row OUT of published (an unpublish). Requiring a string
      // here would let `status: 0`/`false` slip an unpublish past the gate.
      const collectionHasStatus =
        (collection as { status?: boolean }).status === true;
      // The guard carries the pre-resolved PERMISSION denial, judged off this
      // transaction's connection so the under-lock step runs no rule. A write
      // to every language that publishes carries the languages it asked about
      // too, which the lock compares with the languages going live.
      let transitionGuard: {
        op: "publish" | "unpublish";
        permissionDenied: CollectionServiceResult | null;
        askedLanguages?: readonly string[];
      } | null = null;
      if (
        collectionHasStatus &&
        !params.overrideAccess &&
        transitionNextStatus !== undefined
      ) {
        const transitionOp =
          transitionNextStatus === "published" ? "publish" : "unpublish";
        if (sweepAllLocales && transitionOp === "publish") {
          // A write to every language that publishes asks the publish rule
          // once for each language it puts live, each time told that language
          // and all of them, as publishing every language does: a rule that
          // answers by language answers for each, and any refusal refuses the
          // write. Asked here, off the transaction's connection; the row lock
          // (below) re-reads what goes live, so a translation drafted after
          // this read cannot go live unasked. Asked before any hook ran where
          // the write was sent as one, else here, where a hook made it one.
          const askedLanguages =
            askedBeforeHooks ??
            (await this.languagesToPublish({
              collectionName: params.collectionName,
              entryId: params.entryId,
              row: existingEntry as Record<string, unknown>,
              fields,
              promotesDraftOf: collection,
            }));
          transitionGuard = {
            op: transitionOp,
            permissionDenied:
              askedBeforeHooks === undefined
                ? ((await this.refusedInEachLanguage({
                    collectionName: params.collectionName,
                    entryId: params.entryId,
                    languages: askedLanguages,
                    // Each language's rule may answer a filter, matched in it.
                    // Never route-authorized: a route authorizes the write as
                    // an update, never as a publish. A scoped key is judged on
                    // its own grant.
                    ask: () =>
                      this.refusalOfLifecycleInLanguage(writeFilters, schema, {
                        collectionName: params.collectionName,
                        operation: transitionOp,
                        entryId: params.entryId,
                        user: accessUser,
                        overrideAccess: params.overrideAccess,
                        routeAuthorized: false,
                        authenticatedScope: params.authenticatedScope,
                      }),
                  })) ?? null)
                : null,
            askedLanguages,
          };
        } else if (transitionOp !== gate) {
          // An edit that also moves the status: the transition's own gate,
          // whose filter the entry is matched against as the edit's is. A
          // write changing the status alone was judged by that gate already.
          const transitionParams: FilteredWriteCheck["params"] = {
            collectionName: params.collectionName,
            operation: transitionOp,
            entryId: params.entryId,
            user: accessUser,
            overrideAccess: params.overrideAccess,
            routeAuthorized: false,
            authenticatedScope: params.authenticatedScope,
          };
          const access =
            await this.accessService.checkCollectionWrite(transitionParams);
          const permissionDenied =
            access.denied ??
            (await this.addWriteFilter(writeFilters, {
              schema,
              access,
              params: transitionParams,
              locale: params.locale,
            }));
          if (permissionDenied) {
            transitionGuard = {
              op: transitionOp,
              permissionDenied,
            };
          }
        }
      }

      // Wrap main update and component data save in a transaction so that
      // a component save failure rolls back the entry update — no partial state.
      // Resolved versioning config persisted on the collection (or null when
      // unversioned); read once so the in-tx capture below can skip cheaply.
      const versionsConfig = (collection as Record<string, unknown>)
        .versions as ResolvedVersionsConfig | null | undefined;

      // The draft/published split: an update to a PUBLISHED document that
      // names no status is non-destructive on a split-enabled collection — it is
      // stored as the working draft, leaving the live row untouched, and a
      // publish later promotes that draft to the live row. Requires the
      // draft/publish lifecycle (`status`) and drafts-enabled versioning, and is
      // scoped to non-localized collections: a localized document keeps
      // draft/published state per locale, so coalescing per-locale drafts and
      // aligning the working-draft locale key with the read overlay needs its own
      // design and is handled separately.
      const documentLocalized =
        (collection as { localized?: boolean }).localized === true;
      // The one key this document's working draft is stored, read, promoted and
      // discarded under, in this method. Derived once: the store and the read
      // disagreeing is a silent loss, because a draft written under one key is
      // simply never found under another and no error is raised anywhere.
      const draftLocaleKey = workingDraftLocale({
        documentLocalized,
        requestLocale: params.locale ?? null,
        defaultLocale: this.localization?.defaultLocale ?? null,
      });
      // The component schemas reachable from this collection, resolved once off
      // the transaction (registry reads on the pooled connection, the same reason
      // as `webhookFields` below) and reused by the promote path. Skipped when a
      // disqualifier already known without the registry rules the split out: a
      // localized document or a top-level password field. Component resolution can
      // fail on a transient registry error, so an ordinary live write on such a
      // collection must not acquire that dependency for a split it can never take.
      const splitComponentSchemas =
        collectionHasStatus &&
        versionsConfig?.drafts?.enabled === true &&
        !hasPasswordField(fields)
          ? await resolveComponentSchemas(fields as unknown as FieldConfig[])
          : null;
      // Eligibility is decided by the shared predicate so the admin's
      // `draftsEnabled` flag (surfaced on the schema read) can never disagree
      // with whether a status-less update here actually stores a working draft.
      // A localized document or component, an unresolved component, or a
      // reachable password field all rule it out — a localized component would
      // misfile a promoted draft into the wrong companion, an unresolved one
      // drops its subtree on promote, and a password cannot ride a draft
      // snapshot. See isDraftSplitEligible.
      const splitEnabled = isDraftSplitEligible({
        collectionHasStatus,
        draftsVersioningEnabled: versionsConfig?.drafts?.enabled === true,
        fields: fields as unknown as FieldConfig[],
        componentSchemas: splitComponentSchemas,
      });
      // No status named ⇒ neither the main row nor the write-locale companion
      // `_status` is being set (matches the transition guard's own build gate at
      // `transitionNextStatus !== undefined`).
      const namesNoStatus = transitionNextStatus === undefined;

      // Resolved BEFORE the transaction opens, for the reason given on the
      // create path: expansion reads the component registry on the pooled
      // connection. Hoisting it also keeps a conflict retry from re-running the
      // same registry reads on every attempt. Skipped when the collection opted out.
      const webhookFields = await this.webhookFieldTreeIfRecording(
        params.collectionName,
        fields
      );

      // Promote-on-publish: a publish or unpublish on a split collection
      // must apply the whole accumulated working draft to the live row, not only
      // the dirty fields the caller sent (the admin Publish sends just the fields
      // touched this session). The component schemas the draft snapshot is
      // filtered against are read from the registry here, off the transaction —
      // the same pooled-connection reason as `webhookFields` — and the restore
      // context records which system columns the live row actually has. Both are
      // unused unless a draft is found under the row lock below. `promotePossible`
      // is the publish/unpublish counterpart of the status-less draft edit: the
      // two are disjoint on `namesNoStatus`.
      // A restore write (a `sourceVersionNo` is set) names the restored version's
      // status and so is not status-less, but it is not a publish of the pending
      // draft either: folding the draft would fill fields the historical snapshot
      // omits with unrelated pending edits and then delete the draft. Apply the
      // restore payload directly and leave any working draft in place.
      const isRestoreWrite =
        params.sourceVersionNo !== undefined && params.sourceVersionNo !== null;
      const promotePossible = splitEnabled && !namesNoStatus && !isRestoreWrite;
      // The caller's grants, resolved HERE, before the write transaction opens.
      //
      // The promotion gate runs under the row lock, on the draft that
      // transaction holds, because a check that runs before the write can
      // always disagree with the write. A grants resolver first asked from in
      // there issues its queries on the pooled connection the transaction is
      // holding, and on a small pool waits for a connection it can never get:
      // the publish hangs rather than fails. Awaited, not merely constructed,
      // since the resolver is lazy and building it early is not resolving it.
      //
      // Only where a promotion could happen AND a rule could ask. A trusted
      // write returns from `applyFieldWriteAccess` on `overrideAccess` before
      // it looks at grants, and so does a collection with no `access.update`
      // rule on any field at any depth: grants are consulted for that rule
      // alone, so a collection whose registered functions are validators,
      // defaults, hooks or READ rules never reaches a lookup. Without this
      // every publish, unpublish and republish on a draft-enabled collection
      // would pay for the roles and permissions queries to answer a question
      // nothing asks. Both tests are map reads.
      const promoteRulesCouldRun =
        promotePossible &&
        params.overrideAccess !== true &&
        this.promotionRulesCanAsk(params.collectionName);
      const promoteGrants = promoteRulesCouldRun
        ? await this.resolvedGrants(params.user, params.authenticatedScope)
        : undefined;
      const promoteRestoreCtx = promotePossible
        ? promoteRestoreContext({
            collection,
            fields,
            collectionHasStatus,
            splitComponentSchemas,
            documentLocalized,
          })
        : null;

      // What goes live is judged before the transaction opens: a promoted
      // working draft against the CURRENT schema, and otherwise each language
      // as it goes live. See `goingLiveIssues`.
      const goingLive = await this.goingLiveIssues({
        collectionName: params.collectionName,
        entryId: params.entryId,
        tableName,
        relationsBatch: params.goingLiveBatch,
        locale: params.locale,
        user: params.user,
        reader: params,
        fields,
        finalData,
        componentFieldData,
        manyToManyData,
        manyToManyFields,
        splitComponentSchemas,
        promoteRestoreCtx,
        draftLocaleKey,
        collectionHasStatus,
        transitionNextStatus,
        sweepAllLocales,
        existingEntry: existingEntry as Record<string, unknown>,
        localizedUpdate,
        drafts: new VersionsRepository(this.adapter),
      });
      if (goingLive.length > 0) {
        throw NextlyError.validation({ errors: goingLive });
      }

      // Retry the whole content+capture transaction on a version_no allocation
      // race (concurrent updates to the same doc); the re-run re-reads the max.
      // The content UPDATE is a deterministic SET, so re-applying it is safe.
      // Committed pre-update status, refreshed each attempt: under a retry a
      // concurrent winner may have changed the status, so the D69 status event
      // below must report that as `previousStatus`, not the stale pre-tx value.
      let committedPreviousStatus: string | null | undefined;
      // The write locale's committed companion `_status` before this write, used
      // by the per-locale status event below. Re-read inside each attempt (like
      // committedPreviousStatus) so a retry reports the true prior state.
      let localizedPreviousStatus: string | null = null;
      // Reset at the start of each attempt and read back only after the retry
      // resolves, so a rolled-back attempt (a version conflict) or a commit
      // failure never flags a durable event that isn't there.
      let recorded = false;
      // Set when this update was stored as a working draft (see the split below).
      // The live row is left untouched, so the row re-fetched after the
      // transaction is the OLD published content; the response, afterUpdate/
      // afterChange hooks, and the reaction event must use this pending document
      // instead, and the public revalidation and reaction event are skipped
      // because the live document a visitor sees did not change.
      let workingDraftDocument: Record<string, unknown> | undefined;
      // The prior working draft (shaped like a read), set only when a later
      // status-less save accumulates onto an existing draft, so the afterUpdate
      // hooks diff against it rather than the unchanged published row.
      let priorWorkingDraftDocument: Record<string, unknown> | undefined;
      // Verify every localized field group in this payload can actually be written
      // BEFORE the transaction opens. Inside it the probes would borrow a second
      // connection and deadlock a single-connection pool, and a NextlyError raised in
      // the callback is reclassified by the adapter into an opaque database error —
      // so the actionable 409 would never reach the caller.
      await this.fieldGroupDataService?.assertLocalizedFieldGroupsWritable({
        fields: fields as unknown as FieldConfig[],
        data: componentFieldData,
        locale: params.locale,
      });
      // The version-conflict retry re-runs the closure on a version_no conflict,
      // and the promote fold inside it rebinds these payloads (and sets the
      // pending-draft document). Capture the caller's own shaped input so each
      // attempt starts from it rather than from a prior attempt's merged draft.
      const baseFinalData = { ...finalData };
      const baseManyToManyData = { ...manyToManyData };
      const baseComponentFieldData = { ...componentFieldData };
      // The caller's own translated values, which the promote fold replaces
      // with the merged draft's. Never written in place, only rebound, so the
      // reference is the caller's split for every attempt.
      const baseLocalizedUpdate = localizedUpdate;
      // The in-transaction handlers, asked once for this write: a
      // retried attempt runs the same set.
      const inTransactionHandlers = this.inTransactionHandlersFor(
        params.collectionName
      );
      // Read committed when a handler runs; see `writeTransactionOptions`.
      const transactionOptions = this.writeTransactionOptions(
        inTransactionHandlers,
        versionConflictRetries()
      );
      await this.adapter.transaction(async tx => {
        recorded = false;
        // Reset the payloads the promote fold rebinds, so a retried attempt
        // re-decides the split from the caller's input; and clear the pending
        // draft document, so a stale one from a promoted attempt cannot suppress
        // the outbox/reaction events or the revalidation intent of a committed
        // live write on the retry.
        finalData = { ...baseFinalData };
        manyToManyData = { ...baseManyToManyData };
        componentFieldData = { ...baseComponentFieldData };
        // A retry that no longer finds the pending change writes the
        // caller's translated values, not the ones a lost attempt promoted.
        localizedUpdate = baseLocalizedUpdate;
        workingDraftDocument = undefined;
        // `let` because promote-on-publish rebinds it from the merged
        // draft+payload after the working draft is folded in below. Annotated
        // rather than inferred: the literal's own shape would refuse the
        // first-publish stamp appended before the UPDATE is assembled.
        let updatePayload: Record<string, unknown> = {
          ...stripImmutableSystemFields(
            finalData,
            "collection",
            tableName,
            fields
          ),
          updatedAt: new Date(),
        };

        // This locale's committed status before the write, reused by both the
        // prior document and the post-write overlay so the two stay symmetric.
        let committedLocaleStatus: string | null = null;
        // Set once the row-locked prior state is read below — true
        // when this update should be stored as the working draft.
        let storeAsWorkingDraft = false;

        // Take the row lock the UPDATE below needs anyway, before reading the
        // prior state. Without it two concurrent updates to the same entry
        // interleave: this transaction reads the old row, the other commits,
        // then this UPDATE applies on top — so the post-write document carries
        // the other writer's fields while `previous` predates them, and the
        // diff attributes their change to this event. Acquiring the lock a few
        // statements early costs little, since the UPDATE takes the same lock
        // and holds it until commit either way.
        //
        // The adapter owns the dialect specifics and no-ops where row locking
        // does not exist.
        await tx.lockRow(tableName, params.entryId);
        // The main row's version, read under the lock as it is now: a save
        // committed since the caller read leaves it out of date. Kept for an
        // overwrite, whose history names whom it replaced from this read.
        const mainBefore = await refuseIfMainMoved(
          tx,
          this.dialect,
          versionCheck,
          {
            table: tableName,
            id: params.entryId,
            languages: judgedLanguages,
          },
          staleWrite
        );
        // The save's language row as it stood before this save wrote it,
        // for an overwrite's history; set where the row is written below.
        let languageBefore: PartState | undefined;

        // Read the committed state before this attempt's UPDATE. Nothing read
        // after the write can serve as prior state: the UPDATE below, the
        // companion upsert, and the many-to-many rewrite have all run by then.
        // Read through the transaction handle rather than the pool-backed
        // `this.db`: on Postgres and MySQL those are different connections, so
        // a pooled read could observe a concurrent commit that this
        // transaction will not, and report prior state the write never saw.
        const [preUpdateRow] = await tx
          .getDrizzle<typeof this.db>()
          .select()
          .from(schema)
          .where(eq(schema.id, params.entryId))
          .limit(1);
        // Each filter that judged the write, matched again on the row as it
        // is locked, so a write that moved the entry out of one since it was
        // judged above changes nothing.
        refuseWith(
          await this.refusalOutsideWriteFilters(
            tx,
            schema,
            params.entryId,
            writeFilters
          )
        );
        // A conditional write is judged here, under the lock and after the
        // access it owes, against the value as committed now; a refused one
        // writes nothing.
        await holdStoredExpectation(
          params.context,
          {
            kind: "collection",
            slug: params.collectionName,
            id: params.entryId,
          },
          { tx, localization: this.localization, locale: params.locale },
          lockedPromotion
        );

        // The status event uses the true prior value even after a conflict
        // retry. Only recorded for versioned collections (the only ones that
        // can retry), matching the status semantics the rest of this path
        // expects.
        if (versionsConfig?.enabled) {
          committedPreviousStatus = (
            preUpdateRow as { status?: unknown } | undefined
          )?.status as string | null | undefined;
        }

        // The prior document the outbox event reports as `previous`, read in
        // the same shape as the post-write document so the changed-field diff
        // compares like with like. Relations are read here, before they are
        // rewritten, so a component or m2m edit is visible in the diff.
        let previousDocument: Record<string, unknown> | null = null;
        // Run once the write is known not to be held: a held restore replaces
        // the working draft, whose undo point the draft save records.
        let captureBeforeRestore: (() => Promise<void>) | undefined;
        if (preUpdateRow) {
          const stored = await this.storedDocumentOnTx(tx, {
            row: preUpdateRow as Record<string, unknown>,
            collectionName: params.collectionName,
            entryId: params.entryId,
            tableName,
            fields,
            manyToManyFields,
            localizedUpdate,
            locale: params.locale,
          });
          previousDocument = stored.document;
          committedLocaleStatus = stored.committedLocaleStatus;
          const {
            localizedValues: previousLocalizedValues,
            parentRow: previousParent,
            components: previousComponents,
            manyToMany: previousM2M,
          } = stored;
          const previousCompanionStatus = committedLocaleStatus;

          // On a restore, snapshot the document as it is NOW, before the
          // restore overwrites it: content written while versioning was off
          // lives in no version, so without this a restore would destroy it.
          // Captured here — before the write, in this same transaction — so it
          // takes the number just below the restore's own capture, which the
          // retention pass already protects as "the content the restore
          // replaced". Passed no `maxPerDoc`, so it never runs retention itself
          // (that would trim with none of the restore protections, e.g.
          // dropping the version being restored FROM); the restore's own
          // capture below trims once, with those protections.
          if (params.sourceVersionNo != null && versionsConfig?.enabled) {
            captureBeforeRestore = async () => {
              const previousHoldsLocaleState =
                Object.keys(previousLocalizedValues).length > 0 ||
                Object.keys(previousComponents ?? {}).length > 0 ||
                previousCompanionStatus !== null;
              // For a per-locale restore into a locale whose companion row is
              // absent (a locale disabled then re-enabled), the prior per-locale
              // state is draft — an absent per-locale row starts as draft — not
              // the main row's status. Recording the main row's "published" here
              // would make undoing the restore recreate and PUBLISH an empty
              // translation instead of returning the locale to its prior
              // absent/draft state. Scoped to this snapshot, so the `previous`
              // event above is unaffected.
              const perLocaleAbsentRestore =
                !!localizedUpdate?.hasStatus &&
                localizedUpdate.writeLocale !==
                  this.localization?.defaultLocale &&
                previousCompanionStatus === null;
              const preRestoreParent = perLocaleAbsentRestore
                ? { ...previousParent, status: "draft" }
                : previousParent;
              await captureInTx(tx, this.versionCapture, {
                // An update: a save that changes nothing records nothing.
                onlyIfChanged: true,
                lifecycle: hasLifecycle(collection),
                ref: {
                  scopeKind: "collection",
                  scopeSlug: params.collectionName,
                  entryId: params.entryId,
                },
                contentStatus: (preRestoreParent as { status?: unknown })
                  .status,
                parts: await this.snapshotPartsFor(
                  {
                    parentRow: preRestoreParent,
                    components: previousComponents,
                    manyToMany: previousM2M,
                  },
                  fields,
                  tx
                ),
                createdBy: params.user?.id ?? null,
                // Labelled with a locale only when the prior state actually held
                // locale-specific values — see the post-write capture below.
                locale: previousHoldsLocaleState
                  ? (localizedUpdate?.writeLocale ??
                    this.componentSnapshotLocale(params.locale))
                  : null,
                label: "Before restore",
              });
            };
          }
        }

        // Decide the draft edit from the ROW-LOCKED prior status —
        // the main row, or the write locale's companion `_status` — the same
        // locked reads the transition guard uses, so the decision is
        // TOCTOU-safe (a concurrent publish/unpublish committed before the
        // lock is seen). A never-published (`draft`) or per-locale-absent
        // (`null`) document fails the test and edits in place.
        const draftLiveStatus = isNonDefaultLocaleStatusWrite
          ? committedLocaleStatus
          : (((preUpdateRow as { status?: unknown } | undefined)?.status as
              | string
              | undefined) ?? null);
        // The one hold rule, shared with the transaction and batch surfaces.
        // Eligibility is passed in rather than recomputed: it was resolved
        // off the transaction because it reads the component registry, and
        // the promote path below needs it too.
        storeAsWorkingDraft = resolveDraftHold({
          collectionHasStatus,
          draftsVersioningEnabled: versionsConfig?.drafts?.enabled === true,
          documentLocalized,
          fields: fields as unknown as FieldConfig[],
          componentSchemas: splitComponentSchemas,
          namedStatus: namesNoStatus ? undefined : transitionNextStatus,
          liveStatus: draftLiveStatus,
          requestLocale: params.locale ?? null,
          defaultLocale: this.localization?.defaultLocale ?? null,
        }).hold;

        // A recorded draft save restored onto a published document must stay
        // pending. A document that can no longer hold a draft would take it
        // on its live row and publish it, so the restore is refused instead.
        if (
          params.requireHeldDraft === true &&
          !storeAsWorkingDraft &&
          draftLiveStatus === "published"
        ) {
          throw NextlyError.conflict({
            reason: "state",
            message:
              "This version is a saved draft, and this document can no longer hold a draft, so restoring it would publish it. Turn drafts back on for this collection, or restore a published version.",
            logContext: {
              reason: "restore-saved-draft-unholdable",
              collection: params.collectionName,
              entryId: params.entryId,
              sourceVersionNo: params.sourceVersionNo,
            },
          });
        }
        // A restore that writes the live row snapshots it first; a held one
        // records the draft it replaces instead.
        if (!storeAsWorkingDraft) await captureBeforeRestore?.();

        // TOCTOU-safe authorization: classify the transition against the
        // status just read UNDER THE ROW LOCK (`preUpdateRow` /
        // `committedLocaleStatus`), not the pre-transaction read, and enforce
        // the permission resolved before the transaction. A concurrent writer
        // that changed the published state between the pre-transaction read
        // and this lock is therefore accounted for. Runs before the UPDATE, so
        // throwing rolls the transaction back with nothing written.
        if (transitionGuard) {
          // A write can move the published state in two places, and the guard
          // must fire if EITHER makes the transition it denies:
          //   - the MAIN row `status` (a non-localized or default-locale write;
          //     a non-default-locale write leaves it untouched — its status was
          //     stripped from the main payload), and
          //   - the write locale's companion `_status` (any localized write that
          //     provides a status, INCLUDING the default locale, whose status
          //     lands on the companion row too).
          // Checking only the main row would let a default-locale write publish
          // a still-draft companion `_status` while the main row is already
          // published (a state reachable after a reconcile that added the
          // companion `_status` as draft under a published entry).
          const lockedMainStatus =
            ((preUpdateRow as { status?: unknown } | undefined)?.status as
              | string
              | undefined) ?? null;
          const mainNextStatus = isNonDefaultLocaleStatusWrite
            ? undefined
            : intendedStatus;
          const companionNextStatus = localizedUpdate?.companionData
            ?._status as string | undefined;
          const firesOnMainRow =
            mainNextStatus !== undefined &&
            resolvePublishTransition(lockedMainStatus, mainNextStatus) ===
              transitionGuard.op;
          const firesOnCompanion =
            companionNextStatus !== undefined &&
            resolvePublishTransition(
              committedLocaleStatus,
              companionNextStatus
            ) === transitionGuard.op;
          // The sweep moves companion rows NEITHER test above can see, so a
          // wildcard write must be judged as the lifecycle move it is,
          // unconditionally. Both tests ask whether THIS write transitions the
          // main row or the write locale's companion; with the main row and the
          // default translation already at the target status, both answer no
          // while the sweep still takes every other language there. A caller
          // holding `update` but not `unpublish` could then take a published
          // German translation down through a gate that never fired.
          //
          // This is the same reasoning the all-locales lifecycle states for
          // itself: it is unconditionally a publish (or an unpublish) and asks
          // for that permission directly rather than inferring one from a
          // transition, because it moves locales the main row says nothing about.
          if (firesOnMainRow || firesOnCompanion || sweepAllLocales) {
            // Permission first (pre-resolved, no DB read): a caller lacking
            // publish-<slug>/unpublish-<slug> is denied regardless of the row.
            if (transitionGuard.permissionDenied) {
              transitionDeniedResult = transitionGuard.permissionDenied;
              throw new StatusTransitionDeniedError();
            }
            // What goes live, re-read on the locked row: a language the
            // rule was not asked about refuses the write as a conflict.
            // Only where the lock found a row: one deleted since the write
            // was authorized puts no language live, and the write that
            // follows matches nothing and is answered as a missing
            // document. The row that is gone is never read for this, and
            // the pre-transaction copy is never stood in for it: judging a
            // document that no longer exists would answer a refusal where
            // the caller should be told it is not there.
            const { askedLanguages } = transitionGuard;
            if (askedLanguages !== undefined && preUpdateRow) {
              const changed = await this.languagesChangedUnderLock({
                collectionName: params.collectionName,
                entryId: params.entryId,
                row: preUpdateRow as Record<string, unknown>,
                fields,
                promotesDraftOf: collection,
                tx,
                asked: askedLanguages,
              });
              if (changed) {
                transitionDeniedResult = {
                  success: false,
                  statusCode: 500,
                  message: changed.message,
                  data: null,
                  ...errorEnvelopeFields(changed),
                };
                throw new StatusTransitionDeniedError();
              }
            }
            // The permission above is the whole decision: no rule judges the
            // row, so the row-locked document cannot change the answer.
          }
        }

        // After the lifecycle permission and rule above, so a caller who may
        // not publish or unpublish is refused before it learns which
        // languages hold unreleased work.
        //
        // A wildcard must not decide the fate of work somebody saved and has
        // not released yet (`languagesHoldingWorkingDrafts` says why) — asked
        // UNDER THE LOCK, because the answer changes: a draft save serialises
        // on this same parent lock, so a check that ran earlier can be
        // overtaken by a save that commits first, and the release would then
        // proceed over work it never saw. The refusal travels out on the
        // same out-of-band result the transition gate uses, since the adapter
        // re-wraps a thrown sentinel before the catch can identify it.
        if (sweepAllLocales && this.keepsWorkingDrafts(collection)) {
          const heldBy = this.heldLanguages(
            collection,
            (
              await new VersionsRepository(tx).findAllWorkingDrafts({
                scopeKind: "collection",
                scopeSlug: params.collectionName,
                entryId: params.entryId,
              })
            ).map(draft => draft.locale)
          );
          if (heldBy.length > 0) {
            transitionDeniedResult = {
              success: false,
              statusCode: 409,
              message:
                `This document has unpublished changes in ${heldBy.join(", ")}. ` +
                `Publish or discard them first, or publish each language on ` +
                `its own — locale '${EVERY_LOCALE}' moves every language's ` +
                `status and will not decide what happens to work that has ` +
                `not been released.`,
              data: null,
            };
            throw new StatusTransitionDeniedError();
          }
        }

        // Promote-on-publish: with the row lock held and the publish
        // authorized above, fold any accumulated working draft into this write
        // so the live row receives the draft's whole content with the caller's
        // fields overlaid. The admin Publish sends only the fields dirtied this
        // session, so without this a publish drops edits made in earlier ones.
        // Fetched here, under the lock, so a concurrent draft edit is
        // serialized: it either lands before this read (and is promoted) or
        // after this transaction commits (against the now-published row). The
        // draft is deleted in the same transaction below, so promote is atomic:
        // any failure rolls back the live write and leaves the draft intact.
        let promotedDraft = false;
        // Kept by part, only a promote that publishes carries the shared
        // draft: an unpublish puts nothing live, so the shared changes stay
        // pending for every language still published.
        const promotesShared = intendedStatus === "published";
        // Whether the request that promoted also carried content of its own,
        // which no earlier save recorded: the trail reads that publish as a
        // save too.
        let promotionCarriesContent = false;
        if (promotePossible && promoteRestoreCtx) {
          const promoteRef = {
            scopeKind: "collection" as const,
            scopeSlug: params.collectionName,
            entryId: params.entryId,
          };
          const promoteRepo = new VersionsRepository(tx);
          // Under the same key the read overlay and the store use. Kept by
          // part, the change is this language's draft with the shared draft
          // when it publishes: a language's publish carries the shared
          // changes with it, and a fold writes no more than the keys they hold.
          const promoteParts =
            draftsKeptByPart() && draftLocaleKey !== SHARED_DRAFT_SLOT
              ? partsPromoted(
                  await findPartDrafts(promoteRepo, promoteRef, draftLocaleKey),
                  promotesShared
                )
              : undefined;
          const workingDraft = promoteParts
            ? holdsPendingChange(promoteParts)
              ? { snapshot: combinedDraft({}, promoteParts) }
              : undefined
            : await promoteRepo.findWorkingDraft(promoteRef, draftLocaleKey);
          if (workingDraft) {
            // Promoting a working draft publishes (or unpublishes) its pending
            // content, so it needs the same permission as a status transition
            // even when the main-row status does not change: a
            // published -> published re-publish is a no-op for the transition
            // guard above, yet folding the draft still pushes pending content
            // live. Enforce the pre-resolved guard here against the row-locked
            // document. For a real transition the guard already fired and
            // passed above, so this is a no-op re-check; for the no-op
            // re-publish it is the only place the publish permission is
            // enforced.
            if (transitionGuard) {
              if (transitionGuard.permissionDenied) {
                transitionDeniedResult = transitionGuard.permissionDenied;
                throw new StatusTransitionDeniedError();
              }
              // No per-row rule to enforce here; the permission above is the
              // only gate a promotion has to pass.
            }
            // A shared value someone else published since the change began
            // would be put back by this write, so the publish is refused,
            // naming it. Judged on the shared fields the change carries
            // (`sharedFieldsJudged`): every one, or kept by part, the
            // language's copy of a translated component's shared parts.
            if (documentLocalized) {
              const { live, shared, views, byHand } =
                await this.liveSharedDocument(tx, {
                  collectionName: params.collectionName,
                  entryId: params.entryId,
                  tableName,
                  fields,
                  main: this.deserializeJsonFieldsForSnapshot(
                    convertTimestampsToCamelCase({
                      ...(preUpdateRow as Record<string, unknown>),
                    }),
                    fields
                  ),
                  locale: draftLocaleKey,
                });
              const stale = await outOfDateSharedFields(tx, {
                ref: {
                  scopeKind: "collection",
                  scopeSlug: params.collectionName,
                  entryId: params.entryId,
                },
                locale: draftLocaleKey,
                shared: sharedFieldsJudged(shared, byHand),
                live,
                // Judged as the publish writes it: the stored change with
                // the caller's gated contribution merged over it. A request
                // that retypes the live value of a field the change is
                // behind on writes nothing behind live, so it goes through
                // in one step.
                pending: {
                  ...snapshotRecord(workingDraft.snapshot),
                  ...this.callerContributionOf({
                    finalData,
                    componentFieldData,
                    manyToManyData,
                    fields,
                    manyToManyFields,
                    componentSchemas: splitComponentSchemas,
                  }),
                },
                views,
              });
              if (stale.length > 0) {
                outOfDateShared = { fields: stale, live };
                throw new SharedValuesOutOfDateError();
              }
            }
            // Fold the pending change into this write, judged against the
            // caller's field write access, as every publish folds one.
            const folded = await this.foldWorkingDraft(tx, {
              snapshot: workingDraft.snapshot,
              finalData,
              componentFieldData,
              manyToManyData,
              live: previousDocument ?? {},
              collection,
              collectionName: params.collectionName,
              storedId: String(existingEntry.id),
              fields,
              manyToManyFields,
              componentSchemas: splitComponentSchemas,
              restoreContext: promoteRestoreCtx,
              draftLocale: draftLocaleKey,
              requestLocale: params.locale,
              user: params.user,
              authenticatedScope: params.authenticatedScope,
              overrideAccess: params.overrideAccess,
              grants: promoteGrants,
            });
            // A relation the pending change does not name was judged at its
            // stored value before the lock; judged again under it, as
            // another writer may have removed it since.
            await this.refuseLockedPromotionRelations(
              tx,
              {
                collectionName: params.collectionName,
                entryId: params.entryId,
                tableName,
                locale: params.locale,
                fields,
                manyToManyFields,
                user: params.user,
                reader: params,
              },
              folded.judgedDocument,
              lockedPromotion
            );
            finalData = folded.finalData;
            componentFieldData = folded.componentFieldData;
            manyToManyData = folded.manyToManyData;
            localizedUpdate = folded.localizedUpdate;
            updatePayload = {
              ...stripImmutableSystemFields(
                finalData,
                "collection",
                tableName,
                fields
              ),
              updatedAt: updatePayload.updatedAt,
            };
            promotedDraft = true;
            promotionCarriesContent = folded.carriesContent;
          }
        }

        // A row becoming public for the first time records when, once and for good.
        //
        // `status` says what a document IS; nothing said what it HAS BEEN, so an unpublish
        // erased every trace it was ever live while the links, feeds and search results it
        // accumulated stayed exactly where they were. Anything asking "was this address ever
        // public" — slug stability, redirect capture — needs a fact that survives that round
        // trip.
        //
        // Written under the same row lock and in the same statement as the rest of the update,
        // so it cannot disagree with the status it accompanies. Only when the locked row has
        // none: this dates the FIRST publication, and a later republish must not move it.
        //
        // The marker is a property of the DOCUMENT, not of the main row's status column. It
        // answers "has this ever been public in any language", which is what the slug freeze
        // and redirect capture need for an address shared across locales. So a write that
        // publishes only a non-default translation still establishes it: that language is
        // reachable at the shared address, and leaving the marker null until some later
        // default-locale action would record a date after the document was already public.
        //
        // Which transition to read therefore depends on where this write's status lands. A
        // non-default-locale write has its status stripped from the main payload and carried on
        // the companion instead, so the main row's status would show no move at all.
        // Asked for ANY write that could record a first publication, not only a per-locale one.
        // A default-locale or non-localized publish can equally be the second way a document
        // goes public: its main row may be a draft while a translation has been live since
        // before this column existed. Restricting the question to the per-locale branch left
        // exactly that case stamping today's date over an unknown history.
        //
        // The branch flag is not a proxy for "this write touches a locale", either — it is
        // forced false for a trusted write, while the localized split still moves the status
        // onto the companion. Keying the question on it would skip every server-side write.
        //
        // Still gated on a stamp being possible at all, which for any one document happens at
        // most once ever, since every later write is stopped by the marker already being set.
        // The ordinary publish pays nothing for the read.
        const intendedPublish =
          isNonDefaultLocaleStatusWrite ||
          localizedUpdate?.companionData?._status !== undefined
            ? localizedUpdate?.companionData?._status === "published"
            : intendedStatus === "published";
        const couldRecordFirstPublication =
          collectionHasStatus &&
          intendedPublish &&
          (preUpdateRow as { first_published_at?: unknown } | undefined)
            ?.first_published_at == null;
        const documentAlreadyPublic = couldRecordFirstPublication
          ? await this.isDocumentAlreadyPublic(
              tx,
              params.collectionName,
              params.entryId,
              ((preUpdateRow as { status?: unknown } | undefined)?.status as
                | string
                | undefined) ?? null,
              localizedUpdate?.writeLocale
            )
          : false;

        const publicationTransition = selectPublicationTransition({
          documentAlreadyPublic,
          writesStatusToCompanion: isNonDefaultLocaleStatusWrite,
          mainPreviousStatus:
            ((preUpdateRow as { status?: unknown } | undefined)?.status as
              | string
              | undefined) ?? null,
          mainNextStatus: intendedStatus,
          companionPreviousStatus: committedLocaleStatus,
          companionNextStatus: localizedUpdate?.companionData?._status,
        });
        const updateStamp = resolveFirstPublishedStamp({
          hasStatus: collectionHasStatus,
          previousStatus: publicationTransition.previousStatus,
          nextStatus: publicationTransition.nextStatus,
          existingMarker: (
            preUpdateRow as { first_published_at?: unknown } | undefined
          )?.first_published_at,
          now: new Date(),
        });
        if (updateStamp) {
          updatePayload.firstPublishedAt = updateStamp;
        }

        // Keyed by SQL column name, as the adapter takes it; see
        // `writeRowAndTranslation`.
        const columns: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(updatePayload)) {
          columns[toSnakeCase(key)] = value;
        }
        // The document's own counter moves when this save changes anything
        // the main row's version covers: a shared column, the lifecycle, a
        // component or a relation. A save of translated fields alone moves
        // only that language's row, so a reader of another language keeps
        // the version it holds.
        Object.assign(
          columns,
          mainRowBump(
            { updatePayload, componentFieldData, manyToManyData },
            actorForWrite(params.actor, params.user),
            updateTimeOf(updatePayload.updatedAt)
          )
        );

        // Capture the committed per-locale `_status` BEFORE the upsert so the
        // post-commit event can report the real prior value. Only when the
        // write actually changes this locale's status (companion `_status` is
        // present only when `status` was explicitly in the patch).
        if (
          !storeAsWorkingDraft &&
          localizedUpdate &&
          typeof localizedUpdate.companionData._status === "string"
        ) {
          localizedPreviousStatus = await this.readLocaleStatus(
            tx,
            localizedUpdate,
            params.entryId
          );
        }

        // Whether the promoted locale already HAS a row decides what the
        // promotion is allowed to do with it. Read before the upsert, because
        // the upsert is what would change the answer.
        const promotedLocaleCompanion =
          sweepAllLocales && promotedDraft && localizedUpdate
            ? await this.fileManager.loadCompanionSchema(
                params.collectionName,
                tx.getDrizzle()
              )
            : null;
        const promotedLocaleRowExists =
          promotedLocaleCompanion && localizedUpdate
            ? await companionRowExists(
                tx.getDrizzle<Parameters<typeof companionRowExists>[0]>(),
                promotedLocaleCompanion.table,
                params.entryId,
                localizedUpdate.writeLocale,
                cachedCompanionReadiness(
                  this.adapter,
                  promotedLocaleCompanion.companionTableName
                )
              )
            : false;

        // Skip the live-row UPDATE for a draft edit — the pending change is
        // stored as the working draft below, not written to the row. The
        // write locale's translation is upserted with it where
        // `upsertsTranslation` says so: a wildcard only for the values of
        // the draft it promotes.
        if (!storeAsWorkingDraft) {
          languageBefore = await this.writeRowAndTranslation(tx, {
            tableName,
            entryId: params.entryId,
            columns,
            savedBy: actorForWrite(params.actor, params.user),
            // The language's version, judged by the save's first write of
            // its row: a refusal rolls the whole save back.
            judge: {
              check: versionCheck,
              locale: judgedLocale,
              mainTable: tableName,
              holder: staleWrite,
            },
            translation:
              localizedUpdate &&
              upsertsTranslation({
                localizedUpdate,
                everyLanguage: sweepAllLocales,
                promoted: promotedDraft,
                rowExists: promotedLocaleRowExists,
              })
                ? localizedUpdate
                : null,
          });
        }

        // {@link EVERY_LOCALE}: carry the lifecycle to the languages the write
        // above did not name.
        //
        // The upsert reaches ONE companion row — the write locale's. That is
        // the whole of the defect this sweep closes: a document-wide takedown
        // moved the main row and the default language and left every other
        // translation live, so a site went on serving German content the
        // editor had unpublished.
        //
        // In the SAME transaction as the main-row write, so a reader never
        // observes the document half-moved. An UPDATE across every row rather
        // than an upsert per language: a language with no companion row has no
        // translation, and inventing one to mark it published would create the
        // very row whose absence means "not translated".
        //
        // Runs after the upsert so the write locale's row exists first and the
        // sweep finds it — it then rewrites that row with the value it already
        // holds, which is why this is safe to run unconditionally rather than
        // excluding the write locale.
        if (
          sweepAllLocales &&
          !storeAsWorkingDraft &&
          localizedUpdate &&
          localizedUpdate.hasStatus &&
          typeof localizedUpdate.companionData._status === "string"
        ) {
          sweptLocaleTransitions = await this.sweepCompanionLifecycle(tx, {
            collectionName: params.collectionName,
            companionTableName: localizedUpdate.companionTableName,
            entryId: params.entryId,
            status: localizedUpdate.companionData._status,
            savedBy: actorForWrite(params.actor, params.user),
          });
        }

        // Component field data to its comp_{slug} tables and the
        // many-to-many junction rows, inside the transaction so a failure in
        // either rolls back the update (atomic write). A held edit writes
        // neither; its values are judged with the working draft they are
        // merged into (see storeWorkingDraftInTx). The write locale is
        // threaded through, so an embedded localized component writes its
        // translatable fields to its companion.
        if (!storeAsWorkingDraft) {
          await this.writeRelations(tx, {
            collectionName: params.collectionName,
            entryId: params.entryId,
            tableName,
            fields,
            manyToManyFields,
            componentFieldData,
            componentLocale: params.locale,
            manyToManyData,
            caller: params,
            // The entry's write, so a field inside an instance that reads
            // the library judges it on this transaction.
            write: this.validationWrite(
              params.collectionName,
              params.entryId,
              tx,
              params.locale,
              // The payload as sent, with what the write lifted out of it put back.
              this.writtenPayload(
                finalData,
                [manyToManyData, componentFieldData],
                localizedUpdate
              )
            ),
          });
        }

        // The write may not move the entry out of a filter that judged it:
        // matched against each once the row, its companions and its
        // relations are written, and rolled back where it left one. The
        // caller could see the entry, which was inside the filter, so the
        // refusal is in words.
        refuseWith(
          await this.refusalMovedOutOfWriteFilters(
            tx,
            schema,
            params.entryId,
            writeFilters
          )
        );

        // What the in-transaction phase is handed: the document this attempt
        // leaves, set below once the row is re-read. Undefined when the row
        // is gone: then nothing was written, and the phase is not run.
        let writtenDocument: Record<string, unknown> | undefined;

        // Capture a version snapshot of the post-update document atomically
        // with the write when the collection opts into versioning. The parent
        // is re-read fresh here (not the pre-transaction `existingEntry`) so a
        // conflict retry — which re-runs this closure — picks up a concurrent
        // winner's committed columns instead of recording a stale pre-image;
        // the current row is then overlaid with this write's changed values,
        // this locale's translatable values, JSON-backed fields are parsed to
        // the read shape, and password hashes are stripped. Components and m2m
        // are completed from current state so a scalar-only edit does not drop
        // existing relations. Status prefers the new value, else the prior one.
        {
          // Read on the transaction handle. Every update reaches this block
          // now that the assembly serves the outbox as well as versioning, and
          // a pooled read here would take a second connection while this
          // transaction still holds its own — enough to stall against a small
          // pool — besides being unable to see this transaction's own UPDATE.
          const freshRows = await tx
            .getDrizzle<typeof this.db>()
            .select()
            .from(schema)
            .where(eq(schema.id, params.entryId))
            .limit(1);
          // If the row is gone (deleted between the pre-read and this tx), the
          // UPDATE affected nothing and the method returns 404 below — do NOT
          // record a version for a write that did not commit. (No stale
          // fall-back to the pre-transaction existingEntry.)
          const currentRow = freshRows[0] as
            | Record<string, unknown>
            | undefined;
          if (currentRow) {
            // Match the read shape: keep user field keys (field.name, which may
            // contain underscores like `meta_title`) exactly, converting only
            // the timestamp columns — camel-casing every key would rewrite
            // those fields and diverge from a normal read.
            // The row as it stands AFTER this write (the UPDATE above has
            // already run); named for what it is, so it is never mistaken for
            // prior state — `previousDocument` above holds that.
            const currentParent = convertTimestampsToCamelCase({
              ...currentRow,
            });
            // Overlay `updatePayload` (not raw `finalData`): it carries the
            // `updatedAt` the write commits and has immutable system keys
            // (id/createdAt/createdBy) stripped, so the snapshot records the new
            // timestamp and cannot persist forged system values — `preImage`
            // keeps the real committed system columns.
            const companionStatus = localizedUpdate?.companionData?._status;
            // What this locale's status IS after the write: the value the
            // patch set, else the one already committed for the locale, else
            // the column default — a locale being translated for the first
            // time has no companion row, so the upsert creates one and
            // `_status` lands on its DEFAULT. Without this the document would
            // report the main row's status, telling receivers a brand-new
            // translation is published when the row just written is a draft.
            // The upsert below runs only when there are companion columns to
            // write, so an update touching shared fields alone leaves the
            // locale with no row at all. Claiming the default then would
            // invent a draft the write never committed and report a status
            // change against the main row.
            const writesCompanionRow =
              !!localizedUpdate &&
              Object.keys(localizedUpdate.companionData).length > 0;
            const effectiveLocaleStatus = resolveEffectiveLocaleStatus({
              hasStatus: localizedUpdate?.hasStatus === true,
              writesCompanionRow,
              requestedStatus: companionStatus,
              committedStatus: committedLocaleStatus,
            });
            // A partial translatable update only carries the *changed*
            // localized values in `localizedFieldValues`; the write locale's
            // other companion fields (set by a prior write, untouched here)
            // would otherwise be dropped from the snapshot, since the main
            // `preImage` never holds translatable values. Read the full
            // localized field set for the write locale from the companion,
            // tx-visibly (read-your-writes, #226) so the just-upserted row is
            // included, with no locale fallback so the snapshot records
            // exactly this locale. The just-written values still overlay on
            // top. Undefined companion values are skipped so an untranslated
            // field is not written as `undefined` over the main value.
            const priorLocalizedValues = localizedUpdate
              ? await this.readCompanionLocalizedValues(
                  tx,
                  params.collectionName,
                  params.entryId,
                  localizedUpdate.writeLocale
                )
              : {};
            const parentRow = this.deserializeJsonFieldsForSnapshot(
              {
                ...currentParent,
                ...updatePayload,
                ...priorLocalizedValues,
                ...localizedUpdate?.localizedFieldValues,
                // Per-locale status lives in the companion, so the main row's
                // `status` is not this locale's. Overlay the value this write
                // committed, or — for a content-only update that carried no
                // status — the one already stored for the locale, so the
                // document never reports another locale's state.
                ...(typeof effectiveLocaleStatus === "string"
                  ? { status: effectiveLocaleStatus }
                  : {}),
              },
              fields
            );
            stripPasswordFieldValues(
              parentRow,
              fields,
              await this.passwordReach(fields, tx.getDrizzle())
            );
            // Strip the system owner column (created_by) — see create path.
            stripServerOnlyColumns(parentRow, tableName);
            const { components: snapshotComponents, manyToMany: snapshotM2M } =
              await this.buildFullSnapshotRelations(
                tx,
                params.entryId,
                params.collectionName,
                tableName,
                fields,
                manyToManyFields,
                // The resolved write locale — see the create path.
                localizedUpdate?.writeLocale ?? params.locale
              );
            const documentParts = {
              parentRow,
              components: snapshotComponents,
              manyToMany: snapshotM2M,
            };

            // Whether anything in this snapshot is specific to the write
            // locale: values read back from its companion row, values this
            // write put there, or its own status.
            const capturedLocaleState =
              Object.keys(priorLocalizedValues).length > 0 ||
              Object.keys(localizedUpdate?.localizedFieldValues ?? {}).length >
                0 ||
              typeof effectiveLocaleStatus === "string" ||
              // Components were read as the write locale just above, so a
              // translation edit touching only embedded component content is
              // locale-specific too — the singles path counts it the same way.
              Object.keys(snapshotComponents ?? {}).length > 0;

            // Which media items the entry uses now, from what this update
            // stored; a held working draft's media count once it is
            // published.
            await this.recordEntryMediaUsage(tx, {
              collectionName: params.collectionName,
              entryId: params.entryId,
              tableName,
              fields,
              heldDraft: storeAsWorkingDraft,
            });

            // The version this update produced, which its status moves name below.
            let producedVersionNo: number | null = null;
            if (versionsConfig?.enabled && !storeAsWorkingDraft) {
              // The status the snapshot records, read from the row it was built from: the
              // written value, this locale's own status, or an author's translatable `status`
              // field, which the write routed to the companion and the payload no longer holds.
              const savedStatus = (parentRow as { status?: unknown }).status;
              const versionLocale = capturedLocaleState
                ? (localizedUpdate?.writeLocale ??
                  this.componentSnapshotLocale(params.locale))
                : null;
              const { versionNo } = await captureInTx(tx, this.versionCapture, {
                // An update: a save that changes nothing records nothing.
                onlyIfChanged: true,
                lifecycle: hasLifecycle(collection),
                ref: {
                  scopeKind: "collection",
                  scopeSlug: params.collectionName,
                  entryId: params.entryId,
                },
                // Prefer the written status; for a localized write the status
                // lives in the companion, so use this locale's effective value
                // before the prior main-row status. The same value the snapshot
                // records, or the version row would be indexed published while
                // its own document says draft.
                contentStatus: savedStatus,
                // See the create path: tagged for the snapshot only.
                parts: await this.snapshotPartsFor(documentParts, fields, tx),
                createdBy: params.user?.id ?? null,
                // Labelled with a locale only when locale-specific state was
                // actually captured. A migrated localized collection routes
                // every write through `localizedUpdate`, including one that
                // touches only shared fields on a locale with no companion
                // row — that snapshot holds no translations and falls back to
                // the MAIN row's status, so calling it that locale's would let
                // a restore publish a language from entry-level state.
                // The write locale when the collection stores its own
                // translations, otherwise the requested one: a collection
                // that is not localized itself can still embed a localized
                // component, and the components above were read as this
                // language. The create path records it the same way; leaving
                // it null here would make component translations captured on
                // update unrestorable.
                locale: versionLocale,
                sourceVersionNo: params.sourceVersionNo ?? null,
                maxPerDoc: versionsConfig.maxPerDoc,
              });
              producedVersionNo = versionNo;
              await this.recordSaveHistory(
                tx,
                params.collectionName,
                params.entryId,
                {
                  actor: actorForWrite(params.actor, params.user),
                  personName: params.user?.name ?? null,
                  locale: versionLocale,
                  toState: typeof savedStatus === "string" ? savedStatus : null,
                  versionNo,
                  sourceVersionNo: params.sourceVersionNo ?? null,
                },
                // Written in place: every language shows the shared values it wrote.
                this.translatedFieldsOf(collection, fields)
              );
            }

            // A status-less update to a published document is stored
            // as the working draft — the live row and its relations were left
            // untouched above — instead of updating the live row and capturing
            // a published version. The parent overlay already produced the
            // intended parent with no write; overlay the in-memory intended
            // relations onto the (unchanged) live relations read for the
            // snapshot so a changed component/m2m field is reflected.
            if (storeAsWorkingDraft) {
              // The same row with nothing of this write in it: a held write
              // has changed neither the parent, its translations nor its
              // relations, so these reads are still the live document.
              const liveParentRow = this.deserializeJsonFieldsForSnapshot(
                { ...currentParent, ...priorLocalizedValues },
                fields
              );
              stripPasswordFieldValues(
                liveParentRow,
                fields,
                await this.passwordReach(fields, tx.getDrizzle())
              );
              stripServerOnlyColumns(liveParentRow, tableName);
              const draftWrite = await this.storeWorkingDraftInTx(tx, {
                collection,
                collectionHasStatus,
                tableName,
                componentFieldData,
                // The locale this write is for: the companion row's write
                // locale when the patch touched localized columns, and the
                // request's otherwise. Derived through the same function the
                // read overlay and the promote use, so all three look under
                // one key.
                draftLocale: draftLocaleKey,
                fields,
                manyToManyData,
                params,
                parentRow,
                liveParentRow,
                translatedKeys: Object.keys(
                  localizedUpdate?.localizedFieldValues ?? {}
                ),
                snapshotComponents,
                snapshotM2M,
                splitComponentSchemas,
                updatePayload,
                updateFilters: writeFilters.filter(
                  check => check.params.operation === "update"
                ),
              });
              // Refused as a write moving the entry out of its filter is,
              // before anything of the edit is held.
              refuseWith(await this.heldEditRefusal(draftWrite));
              workingDraftDocument = draftWrite.workingDraftDocument;
              priorWorkingDraftDocument = draftWrite.priorWorkingDraftDocument;
            }

            // Promote-on-publish: the accumulated draft has been folded
            // into the live write above, so drop the sidecar in the SAME
            // transaction — its content is now the live row, and a surviving
            // draft would shadow the freshly published document on the next
            // trusted read. Uses the locale key the fetch used, so it removes
            // exactly the row that was promoted.
            if (promotedDraft) {
              await this.consumeWorkingDraft(
                tx,
                {
                  scopeKind: "collection",
                  scopeSlug: params.collectionName,
                  entryId: params.entryId,
                },
                // Same key the fetch and store use.
                draftLocaleKey,
                // The shared draft goes only where the promote carried it.
                promotesShared
              );
            }

            // Invalidate a stale working draft on any live write the split no
            // longer covers: drafts were turned off, versioning or the status
            // lifecycle was removed, or the collection became localized /
            // password-bearing / gained an ineligible component after a draft was
            // written. Once status or versioning is dropped the config no longer
            // signals that a sidecar could exist, so this cannot be narrowed to
            // the current status/versioning flags — a removed lifecycle would
            // leave the sidecar to resurface if the split were re-enabled. The
            // delete is a cheap indexed no-op when none exists, and it never hits
            // a just-stored draft: that path keeps `splitEnabled` true.
            if (!splitEnabled) {
              await this.consumeWorkingDraft(
                tx,
                {
                  scopeKind: "collection",
                  scopeSlug: params.collectionName,
                  entryId: params.entryId,
                },
                draftLocaleKey
              );
            }

            // A restore that lands a non-published status turns the live row
            // into a draft, which breaks the working-draft invariant: a sidecar
            // is pending edits OVER a published row, and once the row is a draft
            // no status-less edit can accumulate onto it (storeAsWorkingDraft
            // needs a published row) while editor reads still overlay the stale
            // sidecar and a later publish would promote it over the restored
            // content. A restore deliberately does not fold the sidecar, so drop
            // it here. A no-op when none exists; a restore to `published` keeps
            // the invariant and is left untouched.
            if (
              isRestoreWrite &&
              splitEnabled &&
              transitionNextStatus !== undefined &&
              transitionNextStatus !== "published"
            ) {
              await this.consumeWorkingDraft(
                tx,
                {
                  scopeKind: "collection",
                  scopeSlug: params.collectionName,
                  entryId: params.entryId,
                },
                draftLocaleKey
              );
            }

            // Append the outbox event in the same transaction, so it commits
            // with the entry and is never recorded for a write that rolls back.
            // `recorded` is false when the collection opted out of recording. A
            // draft edit records no public event: the live document did not
            // change.
            const updatedDocument = assembleDocument(documentParts);
            // A held edit left the live row as it was, so what this write
            // produced is the pending draft, marked as the hooks see it.
            writtenDocument = writtenByUpdate(
              updatedDocument,
              workingDraftDocument
            );
            if (!storeAsWorkingDraft) {
              recorded = await recordMutationEvent(tx, {
                type: "entry.updated",
                resource: {
                  kind: "entry",
                  collection: params.collectionName,
                  id: params.entryId,
                  // The resolved write locale — see the create path.
                  ...(localizedUpdate
                    ? { locale: localizedUpdate.writeLocale }
                    : {}),
                },
                data: workingDraftDocument ?? updatedDocument,
                previous: previousDocument,
                fields: webhookFields,
                actor: actorForWrite(params.actor, params.user),
                // Whether this write published the entry, for the trail: the
                // status it persists, the one the lock read, and whether it
                // promoted the pending edits, which leaves the status
                // published and so cannot be read from the changed fields.
                publication: {
                  // The companion `_status` is unparsed input, so only a
                  // string is a status the trail can judge.
                  statusAfter:
                    typeof transitionNextStatus === "string"
                      ? transitionNextStatus
                      : undefined,
                  statusBefore: draftLiveStatus,
                  promotedPendingEdits: promotedDraft,
                  restores: isRestoreWrite,
                  requestEdits: promotionCarriesContent,
                },
              });
            } else {
              // A working-draft save changes no live document, so there is no
              // public event for a subscriber to receive — but a person did
              // edit content, and the trail records people rather than
              // documents. Recorded on its own seam because the two answer
              // different questions; routing it through the event above would
              // have to invent a public event for a private edit.
              // Diffed against the DRAFT, not the live row. A draft save
              // deliberately leaves the live document and its relations
              // untouched, so comparing the live before and after reports every
              // draft edit as having changed nothing. These are the same two
              // documents the afterUpdate hooks compare — the new draft against
              // the prior one, or against the published row on the first save.
              await recordEntryActivity(tx, {
                action: "update",
                collection: params.collectionName,
                entryId: params.entryId,
                // 🔴 The resolved write locale, exactly as the event-backed
                // path above records it. This seam bypasses the outbox --
                // a draft save changes no live document -- so omitting it
                // filed every localized draft edit as default-locale
                // activity, and the feed then authorized the row against the
                // default translation while its heading came from the edited
                // one.
                ...(localizedUpdate
                  ? { locale: localizedUpdate.writeLocale }
                  : {}),
                data: workingDraftDocument ?? updatedDocument,
                previous: priorWorkingDraftDocument ?? previousDocument,
                actor: actorForWrite(params.actor, params.user),
              });
            }

            // D69 status lifecycle events, recorded in the SAME transaction as
            // entry.updated (mirrors the post-commit transitionStatus, but
            // durable/atomic). Main-row delta: the prior status read in-tx over
            // the pre-transaction one so a retry reports the true prior state,
            // and the status this write persisted to the main row (`undefined`
            // when the patch set no status, leaving to === from → no event).
            const actor = actorForWrite(params.actor, params.user);
            // Only a Draft/Published lifecycle collection has real status
            // transitions. A collection without it may define an ordinary user
            // field named `status`, whose values are business data, not publish
            // signals — so no lifecycle event fires for those.
            const collectionHasStatusLifecycle =
              (collection as { status?: boolean }).status === true;
            // Both statuses come from the ROW-LOCKED reads, not the request:
            // `preUpdateRow` is the prior main-row status read under the lock
            // (correct for unversioned collections and under a concurrent writer
            // that this tx waited on), and `currentRow` is the PERSISTED value
            // after this write — so a status the DB coerced into the text column
            // (a numeric/boolean input) is compared as its committed string, not
            // the raw request value.
            const mainFrom =
              ((preUpdateRow as { status?: unknown } | undefined)?.status as
                | string
                | undefined) ?? null;
            const mainTo = (currentParent as { status?: unknown }).status as
              | string
              | undefined;
            // A companion `_status` is written only for a STRING status on a
            // localized write; it is then the authoritative per-locale status
            // and the companion branch below records its transition, tagged
            // with the locale.
            const companionStatusWritten =
              typeof localizedUpdate?.companionData._status === "string";
            const companionNext =
              typeof localizedUpdate?.companionData._status === "string"
                ? localizedUpdate.companionData._status
                : undefined;
            // Route so exactly one branch records each real transition. The
            // default locale's status lives on BOTH the main row and its
            // companion, so a normal default-locale write records the same
            // transition on each — suppress the main-row event ONLY when the
            // companion write encodes that identical transition (same from AND
            // to). Otherwise the companion is a different locale's status, or a
            // no-op rewrite that left a real main-row transition unrecorded
            // (main row and default companion can drift after a coerced
            // non-string write, e.g. `status: 0`), so the main row still holds
            // a transition the companion branch will not emit — keep it.
            const companionEncodesMainTransition =
              companionStatusWritten &&
              localizedPreviousStatus === mainFrom &&
              companionNext === mainTo;
            // The main-row event must describe the main `status` column's
            // transition, but `updatedDocument`/`previousDocument` carry the
            // write-locale companion status overlaid — and for a default-locale
            // write whose status the DB coerced onto the main row (e.g.
            // `status: 0`), that overlay still reads the prior value. Overlay
            // the persisted main-row statuses so `data`/`previous` match
            // `statusChange` and `changedFields` reports `status` as changed.
            // For a non-localized collection these already equal the row values,
            // so the overlay is a no-op there.
            const mainRowData =
              mainTo !== undefined
                ? { ...updatedDocument, status: mainTo }
                : updatedDocument;
            const mainRowPrevious =
              previousDocument !== null
                ? { ...previousDocument, status: mainFrom }
                : previousDocument;
            const mainStatusRecorded =
              collectionHasStatusLifecycle && !companionEncodesMainTransition
                ? await this.recordStatusEvents(tx, {
                    collection: params.collectionName,
                    id: params.entryId,
                    from: mainFrom,
                    to: mainTo,
                    isCreate: false,
                    data: mainRowData,
                    previous: mainRowPrevious,
                    fields: webhookFields,
                    actor,
                  })
                : false;

            // Per-locale delta (i18n M6), for the write locale of a localized
            // write whose companion `_status` was written — including the
            // default locale, whose real status is the companion, not the main
            // row. Tagged with the write locale.
            let localizedStatusRecorded = false;
            if (collectionHasStatusLifecycle && companionStatusWritten) {
              localizedStatusRecorded = await this.recordStatusEvents(tx, {
                collection: params.collectionName,
                id: params.entryId,
                locale: localizedUpdate?.writeLocale,
                from: localizedPreviousStatus,
                to: companionNext,
                isCreate: false,
                data: workingDraftDocument ?? updatedDocument,
                previous: previousDocument,
                fields: webhookFields,
                actor,
              });
            }
            // {@link EVERY_LOCALE}: the languages the sweep moved that the
            // write locale's event does not cover.
            let sweptRecorded = false;
            // This attempt's swept moves, for the history event below.
            let sweptMoved: { locale: string; from: string | null }[] = [];
            if (
              collectionHasStatusLifecycle &&
              sweptLocaleTransitions !== undefined &&
              typeof companionNext === "string"
            ) {
              const swept = await this.recordSweptLocaleStatusEvents(tx, {
                collectionName: params.collectionName,
                entryId: params.entryId,
                moved: sweptLocaleTransitions,
                status: companionNext,
                skipLocale: localizedUpdate?.writeLocale,
                document: updatedDocument,
                fields: webhookFields,
                actor,
              });
              sweptRecorded = swept.recorded;
              sweptLocaleReplays = swept.transitions;
              sweptMoved = swept.transitions;
            }
            // The same moves in the document's history, one event per kind
            // naming the languages it moved.
            if (collectionHasStatusLifecycle) {
              await this.recordTransitionHistory(
                tx,
                params.collectionName,
                params.entryId,
                {
                  actor,
                  personName: params.user?.name ?? null,
                  versionNo: producedVersionNo,
                },
                // Publishing a held draft is a publish though the live row
                // was published before and after: the move history records
                // is the draft's, from draft to published, so it names the
                // publish and who made it.
                [
                  ...(companionEncodesMainTransition
                    ? []
                    : [
                        {
                          from:
                            promotedDraft && mainTo === "published"
                              ? "draft"
                              : mainFrom,
                          to: mainTo,
                        },
                      ]),
                  ...(companionStatusWritten
                    ? [
                        {
                          locale: localizedUpdate?.writeLocale,
                          from:
                            promotedDraft && companionNext === "published"
                              ? "draft"
                              : localizedPreviousStatus,
                          to: companionNext,
                        },
                      ]
                    : []),
                  ...sweptMoved.map(t => ({
                    locale: t.locale,
                    from: t.from,
                    to: companionNext,
                  })),
                ]
              );
            }
            recorded =
              recorded ||
              mainStatusRecorded ||
              localizedStatusRecorded ||
              sweptRecorded;

            // A receipt a caller pinned for this document is kept here, in
            // the write's own transaction, so it commits exactly when the
            // write does. Only a write to the live row: a held working draft
            // left the live document as it was. `mainTo` is the status this
            // transaction stored, read back from the row, not a hook's view.
            if (!storeAsWorkingDraft) {
              await recordWriteReceipt(
                tx,
                {
                  scopeKind: "collection",
                  scopeSlug: params.collectionName,
                  entryId: params.entryId,
                },
                { status: typeof mainTo === "string" ? mainTo : undefined }
              );
            }

            // Capture the pre-write slug inside the transaction so the
            // post-commit intent can bust the old slug tag after a rename.
            previousSlug = readStringField(previousDocument, "slug");
          }
        }

        // A real save SUPERSEDES this author's recovery point. The work it
        // held is now in the document, so leaving it would offer it back on
        // every subsequent open as though it were still unsaved.
        //
        // This is also what removes the need to compare a recovery point's
        // timestamp against the document's. Those two live in different
        // tables and do not share a clock -- one records UTC and the other
        // local time carrying a `Z` -- so every such comparison is wrong by
        // the server's offset. A row that only exists while there IS unsaved
        // work needs no comparison at all.
        //
        // Scoped to the SAVING author: another editor's recovery point is
        // their own unsaved work and must survive somebody else's save.
        //
        // Inside the write transaction, so a save that fails leaves the
        // recovery point intact rather than destroying the only copy of work
        // the save did not manage to store.
        await new VersionsRepository(tx).deleteAutosaves(
          {
            scopeKind: "collection",
            scopeSlug: params.collectionName,
            entryId: params.entryId,
          },
          params.user?.id ?? null
        );

        await this.recordOverwriteIfAsked(
          tx,
          versionCheck,
          {
            collection: params.collectionName,
            id: params.entryId,
            actor: params.actor,
            user: params.user,
          },
          { main: mainBefore, language: languageBefore, locale: judgedLocale }
        );

        writtenVersion = await documentVersionOn(tx, {
          dialect: this.dialect,
          table: tableName,
          id: params.entryId,
          // The split found the translation table there to write to;
          // without it the translated values are on the entry's own row.
          languagesTable: translationTableOf(localizedUpdate),
          localization: this.localization,
          // As asked: a wildcard write moved every language, and answers
          // for them all.
          locale: rawParams.locale,
        });

        // Last in the transaction, and so again on each retried attempt,
        // which is why every handler's writes go through this `tx`: a
        // discarded attempt's roll back with it.
        await this.runInTransactionPhase(tx, inTransactionHandlers, {
          collection: params.collectionName,
          operation: "update",
          id: params.entryId,
          data: writtenDocument,
          originalData: replacedByUpdate(
            previousDocument,
            priorWorkingDraftDocument
          ),
          user: params.user,
          context: sharedContext,
        });
      }, transactionOptions);
      // The transaction committed (skipped if the retry ultimately threw), so
      // the event is durable; a later hook failure must not hide the delivery.
      eventRecorded = recorded;

      // Fetch the updated entry to return it and use in hooks
      const [updated] = await this.db
        .select()
        .from(schema)
        .where(eq(schema.id, params.entryId))
        .limit(1);

      if (!updated) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
          // The event may already be durable (the row vanished only after the
          // update committed), so still signal a delivery is owed.
          eventRecorded,
        };
      }

      // The localized values were split out of the main update, so the re-fetched
      // main row lacks them. Merge the written values back (camelCase keys) so
      // afterUpdate hooks, events, and the response reflect them. `_status` is a
      // companion-only column, not an entry field.
      if (localizedUpdate) {
        const updatedRow = updated as Record<string, unknown>;
        for (const [column, value] of Object.entries(
          localizedUpdate.companionData
        )) {
          if (column === "_status") continue;
          updatedRow[toCamelCase(column)] = value;
        }
      }

      // Past the 404 guard the row exists and the transaction committed, so this
      // is a durable write — flagged for the retention pass independent of the
      // recording/revalidation opt-outs below.
      committedWrite = true;
      await this.recheckReleasesHolding(params.collectionName, [
        params.entryId,
      ]);

      // A pure draft edit leaves the live row untouched, so the re-fetched
      // `updated` is the OLD published content. Everything that reports what this
      // update produced — the response, the afterUpdate/afterChange hooks — uses
      // the pending draft document instead.
      const responseSource = (workingDraftDocument ?? updated) as Record<
        string,
        unknown
      >;
      // Stamped BEFORE the hooks run, not only on the response below.
      //
      // A draft edit leaves `status` at the live parent's value, so a document
      // handed to `afterUpdate` is indistinguishable from a real publish by its
      // own fields — and the two mean opposite things to anything that reports
      // on what a VISITOR sees, because this write changed nothing they can
      // load. The read overlay already stamps this flag for the same reason; a
      // hook could not ask the question at all until now.
      if (workingDraftDocument) {
        responseSource._isWorkingDraft = true;
      }

      // The tags this update invalidates: the id and current-slug tags, plus the
      // previous-slug tag when the slug changed (captured in the transaction), so
      // a read cached under the old URL clears. Built on the committed write, NOT
      // the outbox-event flag: reaching here past the 404 guard means the row was
      // written, so an opted-out (`webhooks: false`) update — which records no
      // event — must still bust its tags, exactly as create and delete do. A
      // draft edit changes nothing a visitor sees, so it busts no public tags.
      if (!workingDraftDocument) {
        revalidationIntent = buildEntryRevalidationIntent(
          params.collectionName,
          readRevalidateConfig(collection),
          {
            id: params.entryId,
            slug: readStringField(updated as Record<string, unknown>, "slug"),
            previousSlug,
            locale: localizedUpdate?.writeLocale,
          }
        );
      }

      // The after-hooks and events describe a durable row. Inside an enclosing
      // SQLite transaction they wait for its commit and never run for a row it
      // rolls back; see `afterCommitOver` for what they are handed. The event
      // payload is the stored row as committed, for the same reason.
      const updatedAtCommit = { ...(updated as Record<string, unknown>) };
      await this.afterCommitOver(responseSource, async committed => {
        // Post-commit reaction event (D8/D51), first, as on create. Skipped for
        // a pure draft edit: the live document did not change, so no cache
        // reaction is owed — mirroring the outbox `entry.updated` event, which
        // is already suppressed above.
        if (!workingDraftDocument) {
          emitCollectionEvent(
            "updated",
            params.collectionName,
            updatedAtCommit,
            params.user
          );
        }

        // Execute afterUpdate hooks (code-registered)
        // Hooks run after database update completes (for side effects)
        const afterContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "update" as const,
          data: committed,
          // On a repeat status-less save `responseSource` is the accumulated draft,
          // so diff it against the prior draft rather than the unchanged published
          // row; otherwise a hook reports an earlier save's fields as changing again.
          originalData: priorWorkingDraftDocument
            ? markedDraft(priorWorkingDraftDocument)
            : existingEntry,
          user: params.user,
          context: sharedContext, // Pass shared context from beforeUpdate
          req: requestFacts,
        });

        await this.hookService.hookRegistry.execute(
          "afterUpdate",
          afterContext
        );

        // Execute stored afterUpdate hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "afterUpdate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext({
            collection: params.collectionName,
            operation: "update",
            data: committed,
            queryDatabase: this.queryDatabaseFn,
            user: params.user,
            sharedContext,
            req: requestFacts,
          })
        );

        // D69 document-level status events. Status is a user-defined field;
        // emit only when a `status` field value actually changed on update.
        // `data` is shallow-snapshotted so async subscribers aren't exposed to the
        // in-place JSON-field deserialization that happens below for the response.
        // Prefer the status re-read inside the transaction (fresh across retries)
        // over the pre-transaction `existingEntry`, which a concurrent winner may
        // have superseded.
        const previousStatus =
          committedPreviousStatus ??
          ((existingEntry as Record<string, unknown>).status as
            | string
            | undefined) ??
          null;
        const nextStatus = (updatedAtCommit as { status?: unknown }).status;
        if (typeof nextStatus === "string" && nextStatus !== previousStatus) {
          this.transitionStatus({
            collection: params.collectionName,
            id: (updatedAtCommit as { id?: unknown }).id,
            data: { ...updatedAtCommit },
            user: params.user,
            previousStatus,
            status: nextStatus,
            emitStatusChanged: true,
          });
        }

        // Per-locale status transition (i18n M6). On a localized collection the
        // status moves to the companion `_status` for the write locale, leaving
        // the main row's status unchanged — so the document-level check above
        // never fires. Emit the same lifecycle events tagged with `locale` when a
        // write actually changes this locale's status (companion `_status` is set
        // only when `status` was explicitly in the patch), so workflows see the
        // German publish they would otherwise miss. Skipped when the value did not
        // move (re-publishing already-published content fires nothing).
        const localizedNextStatus = localizedUpdate?.companionData._status;
        if (
          localizedUpdate &&
          typeof localizedNextStatus === "string" &&
          localizedNextStatus !== localizedPreviousStatus
        ) {
          this.transitionStatus({
            collection: params.collectionName,
            id: (updatedAtCommit as { id?: unknown }).id,
            data: { ...updatedAtCommit },
            user: params.user,
            previousStatus: localizedPreviousStatus,
            status: localizedNextStatus,
            emitStatusChanged: true,
            locale: localizedUpdate.writeLocale,
          });
        }

        // {@link EVERY_LOCALE}: every other language the sweep moved, replayed
        // with its own `locale` — mirroring the block above, so a workflow
        // listening for a publish observes the German one too rather than only
        // the language the write happened to name.
        for (const replay of sweptLocaleReplays) {
          this.transitionStatus({
            collection: params.collectionName,
            id: (updatedAtCommit as { id?: unknown }).id,
            data: replay.data,
            user: params.user,
            previousStatus: replay.from,
            status: replay.data.status as string,
            emitStatusChanged: true,
            locale: replay.locale,
          });
        }
      });

      // Deserialize JSON fields (richtext, blocks, array, group, json) for
      // response. A no-op on the draft document, whose JSON fields are already
      // parsed by the snapshot builder.
      fields.forEach(field => {
        if (
          isJsonFieldType(field.type, field) &&
          responseSource[field.name] &&
          typeof responseSource[field.name] === "string"
        ) {
          try {
            responseSource[field.name] = JSON.parse(
              responseSource[field.name] as string
            );
          } catch {
            // If parsing fails, keep as string
          }
        }
      });

      // Field-level afterChange hooks observe the PERSISTED values — run
      // before response expansion so hooks see stored IDs, not the
      // populated relationship objects the response returns.
      await this.afterCommitOver(responseSource, committed =>
        runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "afterChange",
          data: committed,
          operation: "update",
          user: params.user,
        })
      );

      // Expand relationships in response if depth is specified. Runs on the
      // draft document too for a draft edit, so a trusted editor's save response
      // populates top-level relations at the requested depth just like a read.
      let responseEntry = responseSource;
      if (depth !== undefined && depth > 0) {
        try {
          responseEntry = await this.relationshipService.expandRelationships(
            responseSource,
            params.collectionName,
            fields,
            {
              depth,
              // Related rows carry the TARGET collection's own field rules, and
              // the response redaction below runs against THIS collection's
              // schema, so it cannot reach inside a populated row. A writer
              // supplied a relationship id, not the related row's protected
              // columns, so a mutation response is a read of that row and is
              // judged the same way a GET would judge it.
              enforceFieldAccess: true,
              user: params.user,
              overrideAccess: params.overrideAccess,
              // A mutation response is a READ of the related rows, so it is
              // bounded exactly as a GET would be. Without this the item a
              // write returns expands every target fully trusted, which is the
              // same exposure through a different verb.
              trusted: params.trusted,
              authenticatedScope: params.authenticatedScope,
              // The language just written, so a target collection whose read
              // rule filters on one of its own localized fields is judged in
              // the same language the response reports.
              locale: this.localization
                ? resolveRequestedLocale(this.localization, params.locale)
                : undefined,
              // A trusted write sees the row it just wrote regardless of
              // lifecycle; an untrusted one gets the published default, the
              // same answer its own GET would give.
              status:
                params.overrideAccess === true && !narrows(params.trusted)
                  ? "all"
                  : undefined,
            }
          );
        } catch (expansionError) {
          // If expansion fails, return the entry without expanded relationships
          this.logger.warn(
            "Failed to expand relationships in updateEntry response",
            { error: expansionError }
          );
        }
      }

      // Redact the response: drop write-only password hashes and any field
      // the caller may write but not read (parity with the query path).
      await this.redactResponseFields(
        responseEntry,
        fields,
        {
          user: params.user,
          overrideAccess: params.overrideAccess,
          routeAuthorized: params.routeAuthorized,
          authenticatedScope: params.authenticatedScope,
        },
        params.collectionName,
        tableName
      );

      // Signal that this save stored a pending working draft rather than writing
      // the live row (draft/published split): the caller edited a published,
      // drafts-enabled document without naming a status. The response reflects the
      // draft, but its `status` stays the live parent's value, so an editor UI
      // needs an explicit flag to show an "unpublished changes" state. Mirrors the
      // read overlay's `_isWorkingDraft`.
      if (workingDraftDocument) {
        responseEntry._isWorkingDraft = true;
      }
      setDocumentVersion(responseEntry, writtenVersion);

      return {
        success: true,
        statusCode: 200,
        message: "Entry updated successfully",
        data: responseEntry,
        // Reflects whether this update actually recorded an event (a no-op
        // update commits without one), so a no-op does not kick the drain.
        eventRecorded,
        revalidationIntent,
        committed: committedWrite,
      };
    } catch (error: unknown) {
      // A publish-transition refused against the row-locked status aborts the
      // write; return the 403 the pre-transaction guard resolved, not a 500.
      // Read from the out-of-band result rather than `instanceof`: the adapter
      // wraps the thrown sentinel in a DatabaseError before it reaches here.
      if (transitionDeniedResult) {
        return transitionDeniedResult;
      }
      // Answered after the rollback, from the document as it now is, so the
      // refusal names the save that came in between rather than this one.
      if (staleWrite.at && versionCheck.kind === "judge") {
        return this.staleVersionAnswer(
          params,
          versionCheck.given,
          staleWrite.at
        );
      }
      if (lockedPromotion.refusal) {
        return errorToServiceResult(
          lockedPromotion.refusal,
          { defaultMessage: "Failed to update entry" },
          this.dialect
        );
      }
      if (outOfDateShared) {
        return errorToServiceResult(
          // After the transaction: the caller's field rules resolve grants
          // on a pooled connection.
          await sharedValuesConflict({
            kind: "collection",
            slug: params.collectionName,
            entryId: params.entryId,
            fields: outOfDateShared.fields,
            live: outOfDateShared.live,
            user: params.user,
            overrideAccess: params.overrideAccess && !params.routeAuthorized,
            authenticatedScope: params.authenticatedScope,
          }),
          { defaultMessage: "Failed to update entry" },
          this.dialect
        );
      }
      // A translation table dropped after its `ready` verdict was remembered
      // fails the write at its first statement on it: answered, after the
      // rollback, as a write to a table that is not there is answered. Only
      // for a write that did not commit; a later step's failure keeps the
      // committed write's answer below.
      const companionGone = await this.companionGoneResult(
        {
          collectionName: params.collectionName,
          locale: params.locale,
          committed: committedWrite,
          defaultMessage: "Failed to update entry",
        },
        error
      );
      if (companionGone) return companionGone;
      // See createEntry's catch — legacy override messages are dropped in
      // favour of fromDatabaseError's spec-compliant generic strings.
      // Pass dialect explicitly so the helper can normalise raw driver errors.
      return {
        ...errorToServiceResult(
          // A write the database is not migrated for answers as such.
          await asNotMigrated(
            error,
            collectionNotMigrated(
              this.collectionService,
              params.collectionName,
              { trusted: fieldTrustOf(params) }
            ),
            { written: committedWrite }
          ),
          { defaultMessage: "Failed to update entry" },
          this.dialect
        ),
        eventRecorded,
        revalidationIntent,
        committed: committedWrite,
      };
    }
  }

  /**
   * The languages a delete of each of `entryIds` removes, which its rule is
   * asked in: each language the entry holds a row in, and every configured
   * language where the content reaches a localized field group. A field
   * group keeps its own rows per language, and nothing here reads them per
   * language yet, so each configured language is asked: that refuses where
   * any of them is refused, which can only refuse more than the entry's own
   * languages would. None for an entry holding no row in any language, as
   * for a collection that keeps none, whose rule is asked once. `undefined`
   * where the rows cannot be read yet, which refuses the delete rather than
   * guess. Read on `tx` where one is given.
   */
  private async languagesToDeleteEach(args: {
    collectionName: string;
    entryIds: readonly string[];
    fields: readonly { type: string; name?: string }[];
    tx?: TransactionContext;
  }): Promise<Map<string, string[]> | undefined> {
    const held = await this.languagesWithRows(
      args.collectionName,
      args.entryIds,
      args.tx
    );
    if (held === undefined) return undefined;
    const configured =
      this.localization?.locales.map(locale => locale.code) ?? [];
    // A delete removes each language's held edit and recovery point too,
    // whatever the collection keeps today, and a language may hold one with
    // no row of its own, so those languages are asked.
    await this.addPendingLanguages(held, {
      collectionName: args.collectionName,
      entryIds: args.entryIds,
      tx: args.tx,
    });
    const reachesLocalizedFieldGroup = await this.reachesLocalizedFieldGroup(
      args.fields,
      args.tx
    );
    return new Map(
      args.entryIds.map(id => [
        id,
        languagesToAsk(held.get(id) ?? [], {
          configured,
          reachesLocalizedFieldGroup,
        }),
      ])
    );
  }

  /**
   * Add to `held` each language an entry holds a pending row in, a working
   * draft or an autosave, whether or not the site still configures it or
   * the collection still keeps drafts, as a delete removes every one: one
   * query for every entry, in slices the database binds in one statement
   * beside the query's own conditions. A row naming no language is the
   * default language's.
   */
  private async addPendingLanguages(
    held: Map<string, string[]>,
    args: {
      collectionName: string;
      entryIds: readonly string[];
      tx?: TransactionContext;
    }
  ): Promise<void> {
    const db = args.tx ?? this.adapter;
    const defaultLocale = this.localization?.defaultLocale;
    // The scope takes binds of its own.
    const slice = this.idsPerStatement(2);
    for (let at = 0; at < args.entryIds.length; at += slice) {
      const drafts = await db.select<{
        entryId: string;
        locale: string | null;
      }>(VERSIONS_TABLE, {
        columns: ["entryId", "locale"],
        where: {
          and: [
            { column: "scopeKind", op: "=", value: "collection" },
            { column: "scopeSlug", op: "=", value: args.collectionName },
            {
              column: "entryId",
              op: "IN",
              value: args.entryIds.slice(at, at + slice),
            },
            // Pending rows carry no version number: a durable version always
            // takes one, and a delete leaves the history it numbers.
            { column: "versionNo", op: "IS NULL" },
          ],
        },
      });
      for (const draft of drafts) {
        const locale = draft.locale ?? defaultLocale;
        if (locale === undefined) continue;
        const id = String(draft.entryId);
        const languages = held.get(id) ?? [];
        if (!languages.includes(locale)) languages.push(locale);
        held.set(id, languages);
      }
    }
  }

  /**
   * How many ids one statement may bind beside `reserved` binds of its own,
   * within the database's limit on the parameters one statement takes.
   */
  private idsPerStatement(reserved: number): number {
    const limit = this.adapter.getCapabilities().maxParamsPerQuery;
    // An adapter stating no limit binds every id in one statement.
    if (!Number.isFinite(limit)) return Number.MAX_SAFE_INTEGER;
    return Math.max(1, limit - reserved);
  }

  /** {@link languagesToDeleteEach} for one entry. */
  private async languagesToDelete(args: {
    collectionName: string;
    entryId: string;
    fields: readonly { type: string; name?: string }[];
    tx?: TransactionContext;
  }): Promise<string[] | undefined> {
    const each = await this.languagesToDeleteEach({
      ...args,
      entryIds: [args.entryId],
    });
    return each?.get(args.entryId);
  }

  /**
   * The refusal of a delete by a caller who does not hold the delete grant,
   * or `null`: the grant alone, read before anything about the entries'
   * languages is, and no rule asked. A caller without it is refused whatever
   * the rule says, so the gate's own refusal answers, and none of the
   * language reads runs for them. A key is judged by its own scope, a
   * signed-in user by their roles, a visitor by the Public role's grants. A
   * plugin-defined person, and a caller the route already judged, are judged
   * by the gate as before.
   */
  private async deleteGrantRefusal(
    gate: Parameters<CollectionAccessService["checkCollectionWrite"]>[0]
  ): Promise<CollectionServiceResult | null> {
    if (gate.overrideAccess || gate.routeAuthorized) return null;
    const holds = await this.holdsDeleteGrant(gate);
    if (holds !== false) return null;
    return (await this.accessService.checkCollectionWrite(gate)).denied;
  }

  /**
   * Whether the caller holds the delete grant on the collection: `true`,
   * `false`, or `undefined` for a plugin-defined person, who holds no grant
   * of its own and is judged by the gate.
   */
  private async holdsDeleteGrant(
    gate: Parameters<CollectionAccessService["checkCollectionWrite"]>[0]
  ): Promise<boolean | undefined> {
    const executor =
      gate.executor === undefined ? {} : { executor: gate.executor };
    // The scope the gate itself judges by: the one named, else the one the
    // calling request authenticated, so a key's own grant answers for it.
    const scope = effectiveCallerScope(gate.authenticatedScope);
    if (scope?.actorType === "apiKey") {
      return (
        scopeHoldsSuperAdmin(scope) ||
        scope.permissions.includes(
          permissionSlug("delete", gate.collectionName)
        )
      );
    }
    if (gate.user) {
      return userHoldsPermission(
        gate.user.id,
        "delete",
        gate.collectionName,
        executor
      );
    }
    if (currentPrincipal() !== null) return undefined;
    const visitor = await actorForVisitor(executor);
    return visitor.permissions.some(
      grant =>
        grant.action === "delete" && grant.resource === gate.collectionName
    );
  }

  /**
   * A delete of one entry asked before any hook runs: the caller's grant
   * first, before anything about the entry's languages is read; then each
   * language the entry holds, with each filter answered matched in its
   * language and kept for the row lock. The refusal, or the languages asked
   * and the filters to match again.
   */
  private async deleteAskedInEachLanguage(args: {
    entry: Omit<
      Parameters<CollectionMutationService["languagesToDelete"]>[0],
      "tx"
    >;
    schema: Record<string, SQLWrapper | undefined> & { id: SQLWrapper };
    params: FilteredWriteCheck["params"];
    appliesFilter: boolean;
  }): Promise<
    | { refusal: CollectionServiceResult }
    | { languages: string[]; filters: FilteredWriteCheck[] }
  > {
    const withoutGrant = await this.deleteGrantRefusal(args.params);
    if (withoutGrant) return { refusal: withoutGrant };
    // The companion is read for the entry's languages, so it is ready first.
    await this.warmLocalizedReadiness(args.entry.collectionName);
    const languages = await this.languagesToDelete(args.entry);
    if (languages === undefined) {
      return {
        refusal: this.languagesUnknownRefusal(args.entry.collectionName),
      };
    }
    const filters: FilteredWriteCheck[] = [];
    const denied = await this.deleteRefusalInEachLanguage(filters, {
      schema: args.schema,
      params: args.params,
      appliesFilter: args.appliesFilter,
      languages,
    });
    return denied ? { refusal: denied } : { languages, filters };
  }

  /**
   * The refusal of a delete whose entry's languages, read again on `tx` as
   * its row is locked, are not those its rule was asked in, or `null`. Any
   * change is a conflict: a language gained was not asked about, and one lost
   * changes what every language was told, so the answers asked are not the
   * delete's. Languages that cannot be read refuse it too.
   */
  private async deleteLanguagesChangedUnderLock(
    tx: TransactionContext,
    entry: Omit<
      Parameters<CollectionMutationService["languagesToDelete"]>[0],
      "tx"
    >,
    asked: readonly string[]
  ): Promise<CollectionServiceResult | null> {
    const locked = await this.languagesToDelete({ ...entry, tx });
    if (locked === undefined) {
      return this.languagesUnknownRefusal(entry.collectionName);
    }
    const unasked = unaskedLanguages(asked, locked);
    const lost = unaskedLanguages(locked, asked);
    if (unasked.length === 0 && lost.length === 0) return null;
    return errorToServiceResult(
      languagesChangedConflict([...unasked, ...lost]),
      { defaultMessage: "Failed to delete entry" },
      this.dialect
    );
  }

  /**
   * The refusal of a delete whose entry's languages cannot be read yet: the
   * companion is not resolved, so which languages the delete removes, and so
   * which rules it owes, is not known.
   */
  private languagesUnknownRefusal(
    collectionName: string
  ): CollectionServiceResult {
    return errorToServiceResult(
      NextlyError.conflict({
        reason: "state",
        message: companionNotReadyMessage("collection"),
        logContext: { cause: "delete-languages-unknown", collectionName },
      }),
      { defaultMessage: "Failed to delete entry" },
      this.dialect
    );
  }

  /**
   * The languages each of `entryIds` holds a translation row in, keyed by
   * id: none where the collection keeps no companion or its table is not
   * there, and `undefined`, not known, where inside a transaction the
   * companion is not yet known to be ready, as no read of it is made before
   * it is. The locale alone is read, which every companion has,
   * whether or not it keeps a status per language. One query for all of
   * them, read on `tx` where one is given.
   */
  private async languagesWithRows(
    collectionName: string,
    entryIds: readonly string[],
    tx?: TransactionContext
  ): Promise<Map<string, string[]> | undefined> {
    const companion = await this.fileManager.loadCompanionSchema(
      collectionName,
      tx?.getDrizzle()
    );
    const held = new Map<string, string[]>();
    if (!companion) return held;
    if (
      cachedCompanionReadiness(this.adapter, companion.companionTableName) !==
      "ready"
    ) {
      // Inside a transaction the table cannot be looked for without leaving
      // it, so the languages are not known. Outside one, a companion table
      // that is not there holds no row in any language.
      if (tx) return undefined;
      if (
        !(await isCompanionReady(this.adapter, companion.companionTableName))
      ) {
        return held;
      }
    }
    if (entryIds.length === 0) return held;
    const table = companion.table as Record<string, unknown>;
    const db = (tx?.getDrizzle() ?? this.db) as Parameters<
      typeof readCompanionLocaleStatusAll
    >[0];
    // In slices the database binds in one statement, however many entries a
    // batch names.
    const slice = this.idsPerStatement(0);
    const rows: Record<string, unknown>[] = [];
    for (let at = 0; at < entryIds.length; at += slice) {
      rows.push(
        ...(await db
          .select({ parent: table._parent, locale: table._locale })
          .from(companion.table)
          .where(
            inArray(table._parent as never, entryIds.slice(at, at + slice))
          ))
      );
    }
    for (const row of rows) {
      if (typeof row.locale !== "string") continue;
      const id = String(row.parent);
      const languages = held.get(id) ?? [];
      if (!languages.includes(row.locale)) languages.push(row.locale);
      held.set(id, languages);
    }
    return held;
  }

  /**
   * The refusal of a delete asked in each of `languages`, or `null` where
   * every answer allows it. Each ask is the delete gate's, never on the
   * route's authority: the route asks the grant alone, as it cannot know the
   * entry's languages. Each filter answered is matched in its language and
   * added to `checks`, for the delete to match again under the row lock.
   * With no language, asked once in the operation's languages.
   */
  private async deleteRefusalInEachLanguage(
    checks: FilteredWriteCheck[],
    args: {
      schema: Record<string, SQLWrapper | undefined> & { id: SQLWrapper };
      params: FilteredWriteCheck["params"];
      appliesFilter: boolean;
      languages: readonly string[];
    }
  ): Promise<CollectionServiceResult | null> {
    const params = { ...args.params, routeAuthorized: false };
    const refused = await askEachLanguage(args.languages, async () => {
      const access = await this.deleteAccess(params, args.appliesFilter);
      return (
        access.denied ??
        (await this.addWriteFilter(checks, {
          schema: args.schema,
          access,
          params,
          locale: currentRuleLanguage().locale,
        }))
      );
    });
    return refused?.refusal ?? null;
  }

  /**
   * A delete batch's gate, asked before its rows: for each set of languages
   * its entries hold, in each of them, each time told that one and the set,
   * as a delete of one such entry is asked; once, in the operation's
   * languages, for an entry holding none and for a collection that keeps
   * none. Each entry's languages are read for the whole batch in one query
   * and read again as its row is locked. Refused where they cannot be read
   * yet. Read on `tx` where the batch runs in its caller's transaction.
   */
  async deleteBatchGate(
    gate: Parameters<CollectionAccessService["checkCollectionWrite"]>[0],
    ids: readonly string[],
    tx?: TransactionContext
  ): Promise<DeleteGateAnswer | DeleteRowLanguages> {
    const withoutGrant = await this.deleteGrantRefusal(gate);
    if (withoutGrant) return { denied: withoutGrant };
    const collection = await this.collectionService.getCollection(
      gate.collectionName,
      tx?.getDrizzle()
    );
    const fields = (collection.schemaDefinition?.fields ||
      collection.fields ||
      []) as FieldConfig[];
    const keepsLanguages =
      (this.localization?.locales.length ?? 0) > 0 &&
      ((collection as { localized?: boolean }).localized === true ||
        (await this.reachesLocalizedFieldGroup(fields, tx)));
    if (!keepsLanguages) return this.accessService.checkCollectionWrite(gate);
    // Read on the pool only before a transaction is open; inside one the
    // companion is read as already resolved.
    if (!tx) await this.warmLocalizedReadiness(gate.collectionName);
    const each = await this.languagesToDeleteEach({
      collectionName: gate.collectionName,
      entryIds: ids,
      fields,
      tx,
    });
    if (each === undefined) {
      // The caller's own refusal first: one who may not delete is told so,
      // not how the collection's translation table stands.
      const plain = await this.accessService.checkCollectionWrite(gate);
      if (plain.denied) return plain;
      return { denied: this.languagesUnknownRefusal(gate.collectionName) };
    }
    const bySet = new Map<string, Map<string, DeleteGateAnswer>>();
    for (const languages of each.values()) {
      const key = languageSetKey(languages);
      if (languages.length === 0 || bySet.has(key)) continue;
      const answers = new Map<string, DeleteGateAnswer>();
      for (const locale of languages) {
        answers.set(
          locale,
          await withRuleLanguage({ locale, locales: [...languages] }, () =>
            this.accessService.checkCollectionWrite(gate)
          )
        );
      }
      bySet.set(key, answers);
    }
    return {
      bySet,
      once: await this.accessService.checkCollectionWrite(gate),
    };
  }

  /**
   * The refusal of deleting `entryId` inside a transaction, or `null` where
   * it may go. The row is locked first and its languages read under the
   * lock, so the languages judged are those the delete removes. It is judged
   * in each of them, each told that one and all of them, by the batch's
   * answers for that set or, where nothing was asked before, by the gate
   * asked now on the transaction. A language refused, or whose filter the
   * entry is outside, matched in it, refuses the delete. A set the batch was
   * not asked about refuses it as a conflict, and languages that cannot be
   * read refuse it.
   */
  private async deleteRowRefusalInTransaction(
    tx: TransactionContext,
    args: {
      tableName: string;
      entryId: string;
      fields: readonly { type: string; name?: string }[];
      accessParams: Parameters<
        CollectionAccessService["checkCollectionWrite"]
      >[0] & { operation: "delete"; entryId: string };
      rowGate: "access-service" | DeleteRowFilter | DeleteRowLanguages;
    }
  ): Promise<CollectionServiceResult | null> {
    const { rowGate } = args;
    if (typeof rowGate === "object" && !("bySet" in rowGate)) {
      return this.deleteRowRefusalIn(tx, args, rowGate, undefined);
    }
    // Asked here, a caller without the delete grant is refused before the
    // row is locked or its languages read.
    if (rowGate === "access-service") {
      const withoutGrant = await this.deleteGrantRefusal(args.accessParams);
      if (withoutGrant) return withoutGrant;
    }
    await tx.lockRow(args.tableName, args.entryId);
    const held = await this.languagesToDelete({
      collectionName: args.accessParams.collectionName,
      entryId: args.entryId,
      fields: args.fields,
      tx,
    });
    if (held === undefined) {
      return this.languagesUnknownRefusal(args.accessParams.collectionName);
    }
    // An entry holding no row in any language is judged as a delete of one
    // is: by the gate asked once, in the operation's languages.
    if (held.length === 0) {
      // The batch's answer names no entry, so a refusal of it is asked again
      // for this one, as below: a caller who may not read the entry is told
      // it is missing.
      const once = typeof rowGate === "object" ? rowGate.once : undefined;
      return this.deleteRowRefusalIn(
        tx,
        args,
        once === undefined || once.denied
          ? await this.accessService.checkCollectionWrite(args.accessParams)
          : once,
        undefined
      );
    }
    const asked =
      typeof rowGate === "object"
        ? rowGate.bySet.get(languageSetKey(held))
        : undefined;
    if (typeof rowGate === "object" && asked === undefined) {
      return errorToServiceResult(
        languagesChangedConflict(held),
        { defaultMessage: "Failed to delete entry" },
        this.dialect
      );
    }
    for (const locale of held) {
      const askNow = () =>
        withRuleLanguage({ locale, locales: [...held] }, () =>
          this.accessService.checkCollectionWrite(args.accessParams)
        );
      const known = asked?.get(locale);
      // A refusal the batch asked before its rows names no entry, so it is
      // asked again for this one: a caller who may not read the entry is
      // told it is missing, as for an id that names nothing.
      const access =
        known === undefined || known.denied ? await askNow() : known;
      const refused = await this.deleteRowRefusalIn(tx, args, access, locale);
      if (refused) return refused;
    }
    return null;
  }

  /**
   * The refusal of deleting `args.entryId` by one answer of its gate: the
   * answer's own refusal, or that of an entry outside the filter it
   * answered, matched in `locale` on the transaction under the row lock.
   */
  private async deleteRowRefusalIn(
    tx: TransactionContext,
    args: {
      tableName: string;
      entryId: string;
      accessParams: Parameters<
        CollectionAccessService["checkCollectionWrite"]
      >[0] & { operation: "delete"; entryId: string };
    },
    access: DeleteGateAnswer | DeleteRowFilter,
    locale: string | undefined
  ): Promise<CollectionServiceResult | null> {
    if (access.denied) return access.denied;
    if (!access.filter) return null;
    return this.refusalOutsideFilterInTransaction(
      tx,
      args.tableName,
      args.entryId,
      access,
      args.accessParams,
      locale
    );
  }

  /**
   * The answer for a write that `error` failed because the collection's translation table is
   * missing (see {@link companionGoneRefusal}), or `undefined` for any other failure and for a
   * write that committed, whose later failure keeps its own answer.
   */
  private async companionGoneResult(
    write: {
      collectionName: string;
      locale: string | undefined;
      committed: boolean;
      defaultMessage: string;
    },
    error: unknown
  ): Promise<CollectionServiceResult | undefined> {
    if (write.committed) return undefined;
    const refusal = await this.companionGoneRefusal(
      write.collectionName,
      write.locale,
      error
    );
    return refusal
      ? errorToServiceResult(
          refusal,
          { defaultMessage: write.defaultMessage },
          this.dialect
        )
      : undefined;
  }

  /**
   * The refusal for a write that `error` failed because the collection's translation table is
   * missing (`companionFoundMissing`, which forgets the table's `ready` verdict), or `undefined`
   * for any other failure. The same 409, with the same remedy, as the check before a write gives
   * a table it finds is not there. Read after the transaction, on a pooled connection.
   */
  private async companionGoneRefusal(
    collectionName: string,
    locale: string | undefined,
    error: unknown
  ): Promise<NextlyError | undefined> {
    if (!this.localization) return undefined;
    // Classified before anything is read: a failure that is no missing table,
    // a lost connection among them, keeps its own answer rather than meeting
    // a second failure on the metadata read.
    if (!isMissingTable(error, this.adapter.dialect)) return undefined;
    const companion =
      await this.fileManager.loadCompanionSchema(collectionName);
    if (
      !companion ||
      !companionFoundMissing(
        this.adapter,
        this.adapter.dialect,
        companion.companionTableName,
        error
      )
    ) {
      return undefined;
    }
    return NextlyError.conflict({
      reason: "state",
      message: companionNotReadyMessage("collection"),
      logContext: {
        cause: "localized-write-without-companion",
        collection: collectionName,
        locale: resolveRequestedLocale(this.localization, locale),
        defaultLocale: this.localization.defaultLocale,
        companionTable: companion.companionTableName,
      },
    });
  }

  /**
   * The delete gate's answer: allowed, with the delete rule's filter to match
   * the entry against where it answered one, or the refusal to hand back.
   * Where the delete does not apply a filter, the gate that refuses one is
   * asked instead.
   */
  private async deleteAccess(
    accessParams: Parameters<
      CollectionAccessService["checkCollectionWrite"]
    >[0],
    appliesFilter: boolean
  ): ReturnType<CollectionAccessService["checkCollectionWrite"]> {
    if (appliesFilter) {
      return this.accessService.checkCollectionWrite(accessParams);
    }
    const denied = await this.accessService.checkCollectionAccess(accessParams);
    return denied ? { denied } : { denied: null };
  }

  /**
   * The match a write limited to a rule's filter makes of its entry, prepared
   * before any transaction opens: the filter's facts about the collection are
   * read here, so the match itself can be asked on the write's own
   * transaction. `undefined` where the caller is not limited to a filter.
   *
   * A filter on a translated field is matched in `locale`, the language the
   * write acts in; a write acting on every language matches in the default.
   * Whether the caller may read the entry is matched in the default language,
   * as the plain read its verdict comes from is asked.
   */
  private async prepareFilteredWrite(
    collectionName: string,
    action: FilteredWrite,
    schema: Record<string, SQLWrapper | undefined>,
    access: { filter?: RuleFilter; read?: ReadReach },
    options: { locale?: string; executor?: unknown } = {}
  ): Promise<FilteredWriteMatch | undefined> {
    if (!access.filter || !access.read) return undefined;
    const { executor } = options;
    // Every read the filter's facts need runs on the caller's transaction
    // where it holds one, as the write's own reads do: a pooled read inside it
    // would wait for the connection the transaction holds.
    const sources: FilterConditionSources = {
      getCollection: name =>
        this.collectionService.getCollection(name, executor),
      adapter: executor
        ? {
            dialect: this.adapter.dialect,
            getDrizzle: <T>() => executor as T,
          }
        : this.adapter,
      ...(this.fieldGroupDataService
        ? {
            getComponentTableName: slug =>
              this.fieldGroupDataService?.getComponentTableName(
                slug,
                executor
              ) ?? Promise.resolve(undefined),
          }
        : {}),
    };
    const prepared = await prepareWriteMatch(
      { collectionName, action, filter: access.filter, read: access.read },
      sources,
      this.logger
    );
    const companion = await this.fileManager.loadCompanionSchema(
      collectionName,
      executor
    );
    // A companion that is not ready yet, a collection still in its
    // pre-migration state, keeps its translated values on the main table, so
    // the filter reads them there. Resolved on the pool, or read from the
    // verdict already resolved where the write holds a transaction.
    const readiness = companion
      ? await this.companionReadinessOf(companion, executor)
      : undefined;
    const ready = readiness === "ready" ? (companion ?? null) : null;
    const writeLocale = options.locale ?? this.localization?.defaultLocale;
    return {
      columns: prepared.columns(schema, {
        writes: localizedFilterContext(
          ready,
          writeLocale ? [writeLocale] : null,
          schema
        ),
        // Whether the caller may read the entry is a plain read's question,
        // asked in the default language and its fallbacks; the read column
        // judges it in every language of the chain, as the read by id does.
        reads: localizedFilterContext(
          ready,
          resolveLocaleChain(this.localization, undefined, undefined),
          schema
        ),
      }),
    };
  }

  /**
   * The refusal of a write to `entryId` made inside the caller's transaction,
   * where the entry is outside the caller's filter: matched on that
   * transaction, under the row lock taken here, so the entry written is the
   * entry judged. `null` where it is inside the filter.
   */
  private async refusalOutsideFilterInTransaction<T>(
    tx: TransactionContext,
    tableName: string,
    entryId: string,
    access: { filter?: RuleFilter; read?: ReadReach },
    accessParams: Parameters<
      CollectionAccessService["refusalOutsideFilter"]
    >[0] & { operation: FilteredWrite },
    // The language a filter on a translated field is matched in; the
    // default where none is named.
    locale?: string
  ): Promise<CollectionServiceResult<T> | null> {
    const prepared = await this.matchInTransaction(
      tx,
      accessParams.operation,
      access,
      accessParams.collectionName,
      locale
    );
    if (!prepared) return null;
    await tx.lockRow(tableName, entryId);
    return (
      await this.judgedAgainstWriteFilter<T>(
        tx.getDrizzle<typeof this.db>(),
        prepared.schema,
        entryId,
        prepared.match,
        accessParams,
        { underLock: true }
      )
    ).refusal;
  }

  /**
   * The refusal of a write inside the caller's own transaction by the gate
   * `params` names, asked on that transaction: the gate's own refusal or,
   * where its rule answers a filter, that of an entry outside it. An entry
   * inside the filter has it added to `filteredWrites`, which the written row
   * is matched against again before the write may stand. A filter on a
   * translated field is matched in `locale`, or in the default.
   */
  private async refusalOfWriteInTransaction(
    tx: TransactionContext,
    params: FilteredWriteCheck["params"],
    filteredWrites: FilteredTransactionWrite[],
    locale?: string
  ): Promise<CollectionServiceResult | null> {
    const access = await this.accessService.checkCollectionWrite(params);
    if (access.denied) return access.denied;
    return this.refusalOutsideFilterOfWrite(
      tx,
      params,
      access,
      filteredWrites,
      locale
    );
  }

  /**
   * The refusal of an entry outside the filter a write's gate answered, the
   * entry matched on the caller's transaction. `null` where it is inside, or
   * where the gate answered no filter; an entry inside one has it added to
   * `filteredWrites`.
   */
  private async refusalOutsideFilterOfWrite(
    tx: TransactionContext,
    params: FilteredWriteCheck["params"],
    access: { filter?: RuleFilter; read?: ReadReach },
    filteredWrites: FilteredTransactionWrite[],
    locale?: string
  ): Promise<CollectionServiceResult | null> {
    const prepared = await this.matchInTransaction(
      tx,
      params.operation,
      access,
      params.collectionName,
      locale
    );
    if (!prepared) return null;
    const judged = await this.judgedAgainstWriteFilter(
      tx.getDrizzle<typeof this.db>(),
      prepared.schema,
      String(params.entryId),
      prepared.match,
      params,
      { underLock: true }
    );
    if (!judged.refusal && access.filter) {
      filteredWrites.push({
        ...prepared,
        params,
        filter: access.filter,
        reads: judged.reads,
      });
    }
    return judged.refusal;
  }

  /**
   * The transition authorization of an update inside the caller's own
   * transaction, asked on it. The one move the status this write names can
   * make (`"published"` publishes; any other value unpublishes) is judged as
   * the single update judges it: not again where its gate judged the write
   * already, else by that gate with its filter, the entry matched against it
   * now and again after the write. The other move cannot follow from that
   * status, and is asked as before.
   */
  private async transitionAuthorizationInTransaction(
    tx: TransactionContext,
    args: {
      collectionName: string;
      entryId: string;
      user?: UserContext;
      overrideAccess?: boolean;
      authenticatedScope?: AuthenticatedScope;
      hasLifecycle: boolean;
      namedStatus: unknown;
      judgedLifecycle?: "publish" | "unpublish";
      filteredWrites: FilteredTransactionWrite[];
    }
  ): Promise<TransitionAuthorization> {
    const named =
      args.overrideAccess ||
      !args.hasLifecycle ||
      args.namedStatus === undefined
        ? undefined
        : args.namedStatus === "published"
          ? "publish"
          : "unpublish";
    const auth = await this.resolveTransitionAuthorization({
      collectionName: args.collectionName,
      entryId: args.entryId,
      accessUser: args.overrideAccess ? undefined : args.user,
      overrideAccess: args.overrideAccess,
      executor: tx.getDrizzle(),
      askedByCaller: named,
    });
    if (!named || named === args.judgedLifecycle) return auth;
    const denied = await this.refusalOfWriteInTransaction(
      tx,
      {
        collectionName: args.collectionName,
        operation: named,
        entryId: args.entryId,
        user: args.user,
        overrideAccess: args.overrideAccess,
        routeAuthorized: false,
        authenticatedScope: args.authenticatedScope,
        executor: tx.getDrizzle(),
      },
      args.filteredWrites
    );
    return named === "publish"
      ? { ...auth, publishDenied: denied }
      : { ...auth, unpublishDenied: denied };
  }

  /**
   * A filtered write's match, prepared on the caller's transaction: the
   * collection's schema and the filter's facts are read on it, as every read
   * a write in a caller's transaction makes is. `undefined` where the caller
   * is not limited to a filter.
   */
  private async matchInTransaction(
    tx: TransactionContext,
    action: FilteredWrite,
    access: { filter?: RuleFilter; read?: ReadReach },
    collectionName: string,
    locale?: string
  ): Promise<
    | {
        schema: Record<string, SQLWrapper | undefined> & { id: SQLWrapper };
        match: FilteredWriteMatch;
      }
    | undefined
  > {
    if (!access.filter) return undefined;
    const executor = tx.getDrizzle();
    const schema = await this.fileManager.loadDynamicSchema(
      collectionName,
      executor
    );
    const match = await this.prepareFilteredWrite(
      collectionName,
      action,
      schema,
      access,
      { executor, locale }
    );
    return match ? { schema, match } : undefined;
  }

  /**
   * Whether a write left `entryId` outside the filter that judged it, asked on
   * the write's own transaction after it has written: an update may not move
   * an entry out of the filter it was allowed by, so the caller holding the
   * row refuses the write and rolls it back. A row gone is not this question.
   */
  private async movedOutOfWriteFilter(
    tx: TransactionContext,
    schema: Record<string, SQLWrapper | undefined> & { id: SQLWrapper },
    entryId: string,
    match: FilteredWriteMatch
  ): Promise<boolean> {
    const found = await this.storedWriteMatch(
      tx.getDrizzle<typeof this.db>(),
      schema,
      entryId,
      match
    );
    return found.exists && !found.writes;
  }

  /**
   * The refusal of a write to `entryId` where the row, as it is locked on
   * `tx`, is outside any filter that judged the write: one matched before the
   * write may have been moved out of it since. `null` where it is inside
   * every one.
   */
  private async refusalOutsideWriteFilters(
    tx: TransactionContext,
    schema: Record<string, SQLWrapper | undefined> & { id: SQLWrapper },
    entryId: string,
    checks: readonly FilteredWriteCheck[]
  ): Promise<CollectionServiceResult | null> {
    for (const check of checks) {
      const judged = await this.judgedAgainstWriteFilter(
        tx.getDrizzle<typeof this.db>(),
        schema,
        entryId,
        check.match,
        check.params,
        { underLock: true }
      );
      if (judged.refusal) return judged.refusal;
      // The row as it is locked decides how a later refusal is answered.
      check.reads = judged.reads;
    }
    return null;
  }

  /**
   * The refusal of a write that left `entryId` outside a filter that judged
   * it, asked on `tx` once the write is in. The caller could see the entry,
   * which was inside the filter, so the refusal is in words. `null` where the
   * entry is still inside every one.
   */
  private async refusalMovedOutOfWriteFilters(
    tx: TransactionContext,
    schema: Record<string, SQLWrapper | undefined> & { id: SQLWrapper },
    entryId: string,
    checks: readonly FilteredWriteCheck[]
  ): Promise<CollectionServiceResult | null> {
    for (const check of checks) {
      if (await this.movedOutOfWriteFilter(tx, schema, entryId, check.match)) {
        return this.accessService.refusalOutsideFilter(
          check.params,
          check.reads,
          true
        );
      }
    }
    return null;
  }

  /**
   * How the stored row of `entryId`, read on `db`, matches a write's filter
   * and the caller's read access, in one select: the one question both the
   * check before a write and the one after it ask.
   */
  private async storedWriteMatch(
    db: typeof this.db,
    schema: Record<string, SQLWrapper | undefined> & { id: SQLWrapper },
    entryId: string,
    match: FilteredWriteMatch,
    /** Asked under the row lock: then the select is itself a locking read. */
    options: { underLock?: boolean } = {}
  ): Promise<ReturnType<typeof writeMatchOf>> {
    const found = await this.storedWriteMatches(
      db,
      schema,
      [entryId],
      match,
      options
    );
    return found.get(entryId) ?? writeMatchOf(undefined);
  }

  /**
   * How the stored rows of `entryIds`, read on `db`, match a write's filter
   * and the caller's read access, keyed by id, in one select: the question
   * {@link storedWriteMatch} asks of one entry, asked of many. An id with no
   * row is left out.
   */
  private async storedWriteMatches(
    db: typeof this.db,
    schema: Record<string, SQLWrapper | undefined> & { id: SQLWrapper },
    entryIds: readonly string[],
    match: FilteredWriteMatch,
    /** Asked under the row lock: then the select is itself a locking read. */
    options: { underLock?: boolean } = {}
  ): Promise<Map<string, ReturnType<typeof writeMatchOf>>> {
    if (entryIds.length === 0) return new Map();
    const query = db
      .select({
        id: schema.id,
        writes: match.columns.writes,
        reads: match.columns.reads,
      })
      .from(schema)
      .where(inArray(schema.id as never, [...entryIds]));
    // A plain read under the lock answers from the transaction's snapshot,
    // which on MySQL's REPEATABLE READ can predate a commit that moved the
    // entry out of the filter. SQLite runs one writer at a time, and has no
    // `FOR UPDATE`.
    const rows: { id: unknown; writes: unknown; reads: unknown }[] =
      options.underLock && this.adapter.dialect !== "sqlite"
        ? await query.for("update")
        : await query;
    return new Map(rows.map(row => [String(row.id), writeMatchOf(row)]));
  }

  /**
   * Which of `entryIds` a write of `action` to every language by this caller
   * would find inside its rule's filter, judged now and without writing: the
   * gate's refusal, or the entries the caller may write. Every entry where the
   * rule answers no filter; with one, an entry whose stored row the filter
   * matches and the caller may read, so an entry the caller may not read is
   * left out as one that is gone is. The write itself judges each entry again
   * under its row lock.
   *
   * An unpublish is matched once, in the default language. A publish is
   * asked in each language it puts live, as the write asks it, and an entry
   * is within only where every one matches; an entry holding a working draft
   * the publish would promote is left out where the draft changes a field a
   * filter names, as the write refuses one the promotion takes out of it.
   *
   * Asked of a named caller, never as route-authorized: a release asks it of
   * the author its run will act as, and of the key that adds a document.
   *
   * @experimental
   */
  async entriesWithinWriteFilter(params: {
    collectionName: string;
    action: FilteredWrite;
    entryIds: readonly string[];
    user: UserContext;
    authenticatedScope?: AuthenticatedScope;
  }): Promise<
    | { readonly denied: CollectionServiceResult }
    | { readonly within: ReadonlySet<string> }
  > {
    const ids = [...new Set(params.entryIds)];
    // The gate first, before anything of the collection is read: a caller it
    // refuses, a collection that is gone among them, is answered here.
    const asked = await this.accessService.checkCollectionWrite(
      writeFilterQuestion(params)
    );
    if (asked.denied !== null) return { denied: asked.denied };
    const schema = await this.fileManager.loadDynamicSchema(
      params.collectionName
    );
    // An unpublish is asked once, in the default language. So is a publish
    // whose translation table lacks its per-language status: the write is
    // refused on that before any language is asked, and there are no
    // statuses to read the languages going live from.
    if (
      params.action !== "publish" ||
      (await this.companionLacksStatus(params.collectionName))
    ) {
      return this.entriesWithinWriteFilterNow(params, schema, ids, {
        asked,
      });
    }

    const collection = await this.collectionService.getCollection(
      params.collectionName
    );
    const fields = collectionFields(collection);
    const rows: Record<string, unknown>[] =
      ids.length === 0
        ? []
        : await this.db
            .select()
            .from(schema as never)
            .where(inArray(schema.id as never, ids));
    const heldEdits = await this.heldEditsPromotedBy(
      params.collectionName,
      collection,
      rows
    );
    // Entries putting the same languages live are asked together, each
    // language told all of them, as the write tells its rule.
    const byLanguages = new Map<
      string,
      { languages: string[]; ids: string[] }
    >();
    // An entry with no stored row puts nothing live: it is asked once, in
    // the rule language now, so a filter leaves it out as a gone one is and
    // a rule answering none keeps it, as every entry is kept.
    const stored = new Set(rows.map(row => String(row.id)));
    const gone = ids.filter(id => !stored.has(id));
    if (gone.length > 0) byLanguages.set("[]", { languages: [], ids: gone });
    for (const row of rows) {
      const entryId = String(row.id);
      const languages = await this.languagesToPublish({
        collectionName: params.collectionName,
        entryId,
        row,
        fields,
        promotesDraftOf: collection,
      });
      const key = JSON.stringify(languages);
      const group = byLanguages.get(key) ?? { languages, ids: [] };
      group.ids.push(entryId);
      byLanguages.set(key, group);
    }
    const within = new Set<string>();
    for (const { languages, ids: groupIds } of byLanguages.values()) {
      // Asked in each language as the write asks its rule (askEachLanguage),
      // each language narrowing what the ones before it left.
      let left: ReadonlySet<string> = new Set(groupIds);
      await askEachLanguage(languages, async () => {
        const inLanguage = await this.entriesWithinWriteFilterNow(
          params,
          schema,
          [...left],
          { promoted: { heldEdits, fields } }
        );
        // A rule that could not run never answered: the request ends with
        // that, not with no entry within as though the gate refused them.
        if (
          "denied" in inLanguage &&
          inLanguage.denied.code === "RULE_COULD_NOT_RUN"
        ) {
          throw errorFromServiceEnvelope(inLanguage.denied);
        }
        left = "within" in inLanguage ? inLanguage.within : new Set();
        return null;
      });
      for (const entryId of left) within.add(entryId);
    }
    return { within };
  }

  /**
   * {@link entriesWithinWriteFilter} asked once, in the rule language now:
   * the gate's refusal, or the entries the filter it answers matches in that
   * language, the caller may read, and whose held edit in `promoted`, if
   * any, changes no field the filter names.
   */
  private async entriesWithinWriteFilterNow(
    params: Parameters<
      CollectionMutationService["entriesWithinWriteFilter"]
    >[0],
    schema: Record<string, SQLWrapper | undefined> & { id: SQLWrapper },
    ids: readonly string[],
    given: {
      /** The gate's answer in this rule language, where it was asked already. */
      asked?: Awaited<
        ReturnType<CollectionAccessService["checkCollectionWrite"]>
      >;
      promoted?: {
        heldEdits: ReadonlyMap<
          string,
          { draft: Record<string, unknown>; live: Record<string, unknown> }
        >;
        fields: readonly FieldDefinition[];
      };
    } = {}
  ): Promise<
    | { readonly denied: CollectionServiceResult }
    | { readonly within: ReadonlySet<string> }
  > {
    const access =
      given.asked ??
      (await this.accessService.checkCollectionWrite(
        writeFilterQuestion(params)
      ));
    if (access.denied !== null) return { denied: access.denied };
    const promoted = given.promoted;
    const match = await this.prepareFilteredWrite(
      params.collectionName,
      params.action,
      schema,
      access,
      { locale: currentRuleLanguage().locale }
    );
    if (!match || !access.filter) return { within: new Set(ids) };
    const filter = access.filter;
    const found = await this.storedWriteMatches(this.db, schema, ids, match);
    return {
      within: new Set(
        ids.filter(id => {
          const entry = found.get(id);
          if (entry === undefined || !entry.writes || !entry.reads) {
            return false;
          }
          const held = promoted?.heldEdits.get(id);
          if (promoted === undefined || held === undefined) return true;
          return !changesFieldFilterNames(
            filter,
            held.draft,
            held.live,
            promoted.fields
          );
        })
      ),
    };
  }

  /**
   * The working draft a publish of every language would promote for each of
   * these stored rows, keyed by entry id, beside the live row it replaces:
   * the draft kept in that write's own slot, read in one query. The live row
   * holds the main table's columns only, so a filter naming a translated
   * field, a component or a many-to-many field counts as changed, and the
   * entry is left out: a draft can only be judged as changing more.
   */
  private async heldEditsPromotedBy(
    collectionName: string,
    collection: unknown,
    rows: readonly Record<string, unknown>[]
  ): Promise<
    Map<
      string,
      { draft: Record<string, unknown>; live: Record<string, unknown> }
    >
  > {
    const held = new Map<
      string,
      { draft: Record<string, unknown>; live: Record<string, unknown> }
    >();
    if (rows.length === 0 || !this.keepsWorkingDrafts(collection)) return held;
    const drafts = await new VersionsRepository(
      this.adapter
    ).findWorkingDraftsOf(
      { scopeKind: "collection", scopeSlug: collectionName },
      rows.map(row => String(row.id)),
      this.wildcardDraftLocale(collection)
    );
    for (const row of rows) {
      const draft = drafts.get(String(row.id));
      if (draft === undefined) continue;
      held.set(String(row.id), {
        draft: snapshotRecord(draft.snapshot),
        live: row,
      });
    }
    return held;
  }

  /**
   * A publish or unpublish asked in the rule language now, as asking it in
   * each language a write to every language puts live sets it: the gate's
   * refusal or, where its rule answers a filter, that of an entry the filter
   * does not match in that language. An entry it matches has the filter, in
   * that language, added to `checks`, so the write matches it again under
   * the row lock and once it is written.
   */
  private async refusalOfLifecycleInLanguage(
    checks: FilteredWriteCheck[],
    schema: Record<string, SQLWrapper | undefined> & { id: SQLWrapper },
    params: FilteredWriteCheck["params"]
  ): Promise<CollectionServiceResult | null> {
    const access = await this.accessService.checkCollectionWrite(params);
    return (
      access.denied ??
      (await this.addWriteFilter(checks, {
        schema,
        access,
        params,
        locale: currentRuleLanguage().locale,
      }))
    );
  }

  /**
   * Add the filter one gate of a write answered to `checks`, matching the
   * entry against it now, on the pool: the refusal where the entry is outside
   * it, before anything of the write has run.
   */
  private async addWriteFilter(
    checks: FilteredWriteCheck[],
    asked: {
      schema: Record<string, SQLWrapper | undefined> & { id: SQLWrapper };
      access: { filter?: RuleFilter; read?: ReadReach };
      params: FilteredWriteCheck["params"];
      locale?: string;
    }
  ): Promise<CollectionServiceResult | null> {
    const match = await this.prepareFilteredWrite(
      asked.params.collectionName,
      asked.params.operation,
      asked.schema,
      asked.access,
      { locale: asked.locale }
    );
    if (!match) return null;
    const judged = await this.judgedAgainstWriteFilter(
      this.db,
      asked.schema,
      String(asked.params.entryId),
      match,
      asked.params
    );
    if (!judged.refusal && asked.access.filter) {
      checks.push({
        match,
        params: asked.params,
        filter: asked.access.filter,
        reads: judged.reads,
      });
    }
    return judged.refusal;
  }

  /**
   * How the stored row of `entryId`, read on `db`, stands against a write's
   * filter: the refusal where it is outside it (`null` where it is inside, or
   * gone), and whether the caller may read it, which answers a refusal later
   * in the write.
   */
  private async judgedAgainstWriteFilter<T>(
    db: typeof this.db,
    schema: Record<string, SQLWrapper | undefined> & { id: SQLWrapper },
    entryId: string,
    match: FilteredWriteMatch,
    access: Parameters<CollectionAccessService["refusalOutsideFilter"]>[0],
    options: { underLock?: boolean } = {}
  ): Promise<{ refusal: CollectionServiceResult<T> | null; reads: boolean }> {
    const found = await this.storedWriteMatch(
      db,
      schema,
      entryId,
      match,
      options
    );
    if (!found.exists || found.writes) {
      return { refusal: null, reads: found.reads };
    }
    return {
      refusal: await this.accessService.refusalOutsideFilter<T>(
        access,
        found.reads
      ),
      reads: found.reads,
    };
  }

  /**
   * Delete an entry.
   * Applies collection-level access control and hooks.
   *
   * Security checks are applied in order:
   * 1. Collection-level access (the RBAC gate)
   *
   * @param params - Collection name, entry ID, and optional user context
   * @returns Deletion result or error
   */
  /**
   * The delete gate for one entry, as a delete asks it before any hook runs:
   * the caller's grant, then each language the entry holds, with each filter
   * a rule answers matched against the entry in its language and kept for the
   * row lock. The one place the question is asked, by `deleteEntry` and by
   * `canDeleteEntry` alike, so the check cannot drift from the writer. Reads
   * only: no hook runs and nothing is written.
   */
  private async deleteGateOf(
    params: {
      collectionName: string;
      entryId: string;
      user?: UserContext;
      overrideAccess?: boolean;
      routeAuthorized?: boolean;
      authenticatedScope?: AuthenticatedScope;
      appliesFilter?: boolean;
    },
    schema: Record<string, SQLWrapper | undefined> & { id: SQLWrapper }
  ) {
    // A delete rule that answers a filter allows only the entries it
    // matches, so the gate hands the filter back for the delete to match its
    // entry against.
    const accessParams = {
      collectionName: params.collectionName,
      operation: "delete" as const,
      entryId: params.entryId,
      user: params.user,
      overrideAccess: params.overrideAccess,
      routeAuthorized: params.routeAuthorized,
      // A scoped API key is judged on its own delete grant, so the session
      // super-admin bypass does not apply to a super-admin-owned key here.
      authenticatedScope: params.authenticatedScope,
    };
    // Collection metadata: for the languages the entry holds, and for the
    // stored hooks the delete runs after this.
    const collection = await this.collectionService.getCollection(
      params.collectionName
    );
    // A delete removes every language the entry holds, so it is asked in
    // each of them, each time told that one, and a refusal in any refuses
    // it. Each filter answered is matched in its language now, before any
    // hook runs, and again under the delete's row lock, so the entry removed
    // is the one judged.
    const deleteLanguages = {
      collectionName: params.collectionName,
      entryId: params.entryId,
      fields: (collection.schemaDefinition?.fields ||
        collection.fields ||
        []) as FieldConfig[],
    };
    const asked = await this.deleteAskedInEachLanguage({
      entry: deleteLanguages,
      schema,
      params: accessParams,
      appliesFilter: params.appliesFilter !== false,
    });
    if ("refusal" in asked) return { refusal: asked.refusal };
    return { refusal: undefined, collection, deleteLanguages, asked };
  }

  /**
   * Whether this caller may delete the entry, decided without deleting it
   * and without running any hook: the gate `deleteEntry` asks before its
   * hooks (`deleteGateOf`), a rule's row filter matched against this entry
   * included. Never overridden, since it exists to apply the rules. An entry
   * that is not there answers as a refusal, so missing and forbidden cannot
   * be told apart.
   *
   * @experimental
   */
  async canDeleteEntry(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    /** API-key scope; judges the delete gate on the key's own grant. */
    authenticatedScope?: AuthenticatedScope;
  }): Promise<boolean> {
    await refuseWriteIfRemovedFromCode("collection", params.collectionName);
    if (
      (await this.storedEntry(params.collectionName, params.entryId)) ===
      undefined
    ) {
      return false;
    }
    const schema = await this.fileManager.loadDynamicSchema(
      params.collectionName
    );
    const gate = await this.deleteGateOf(
      { ...params, overrideAccess: false, routeAuthorized: false },
      schema
    );
    return gate.refusal === undefined;
  }

  async deleteEntry(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    /** Who performed the delete, recorded on the outbox event. */
    actor?: RequestActor;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /** When true, the route middleware already ran the RBAC gate, so it is not
     * run again. See CollectionAccessService.checkCollectionAccess. */
    routeAuthorized?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
    /** The HTTP request behind this operation, when one produced it. */
    request?: Request;
    /**
     * The caller's authenticated scope. A scoped API key is judged on its OWN
     * delete grant here, so the session super-admin bypass does not apply to a
     * super-admin-owned key on the delete gate.
     */
    authenticatedScope?: AuthenticatedScope;
    /**
     * Whether a delete rule's filter is applied, deleting the entry only where
     * it matches. `false` refuses a rule that answers a filter, as a bulk
     * delete by ids does. Defaults to `true`.
     */
    appliesFilter?: boolean;
  }): Promise<CollectionServiceResult> {
    // Refused first when the collection is removed from code, before any hook
    // or read of the entry, so a refused write changes nothing.
    await refuseWriteIfRemovedFromCode("collection", params.collectionName);
    // Set once the outbox event is appended (below); lets the catch report a
    // committed-but-hook-failed delete as `eventRecorded` even when `success` is
    // false. Declared out here so both the success and catch returns see it.
    let eventRecorded = false;
    // Set once the row is actually removed, independent of the recording and
    // revalidation opt-outs — the durable-write signal the retention pass keys
    // off, so a delete that opts out of BOTH still triggers write-path cleanup.
    let committedWrite = false;
    // The tags this delete invalidates, computed post-commit and flushed with the
    // result. Hoisted so the catch return carries it too.
    let revalidationIntent: RevalidationIntent | undefined;
    try {
      const accessUser = params.overrideAccess ? undefined : params.user;

      const schema = await this.fileManager.loadDynamicSchema(
        params.collectionName
      );

      // Fetch the entry first (needed for access control and hooks)

      const [entry] = await this.db
        .select()
        .from(schema)
        .where(eq(schema.id, params.entryId))
        .limit(1);

      if (!entry) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // 1. Check collection-level access FIRST, before any hook runs: the
      // gate `canDeleteEntry` asks too, so the two cannot drift.
      const gate = await this.deleteGateOf(
        { ...params, user: accessUser },
        schema
      );
      if (gate.refusal !== undefined) return gate.refusal;
      const { collection, deleteLanguages } = gate;
      const { languages: askedLanguages, filters: deleteFilters } = gate.asked;
      const { storedHooks, tableName, sharedContext, requestFacts } =
        this.operationSetup(collection, params);

      // Execute beforeOperation hooks FIRST (before operation-specific hooks)
      // Can modify operation arguments (id) or throw to abort
      await this.hookService.hookRegistry.executeBeforeOperation({
        collection: params.collectionName,
        operation: "delete",
        args: { id: params.entryId },
        user: params.user
          ? { id: params.user.id, email: params.user.email }
          : undefined,
        context: sharedContext,
        req: requestFacts,
      });

      // Note: For delete, we don't use modified id since we already fetched the entry
      // and checked access. The hook can throw to abort if needed.

      // Execute beforeDelete hooks (code-registered)
      // Hooks run before deletion and can prevent deletion by throwing error
      const beforeContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "delete" as const,
        data: entry,
        user: params.user,
        context: sharedContext,
        req: requestFacts,
      });

      await this.hookService.hookRegistry.execute(
        "beforeDelete",
        beforeContext
      );

      // Execute stored beforeDelete hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "beforeDelete",
        storedHooks,
        this.hookService.buildPrebuiltHookContext({
          collection: params.collectionName,
          operation: "delete",
          data: entry,
          queryDatabase: this.queryDatabaseFn,
          user: params.user,
          sharedContext,
          req: requestFacts,
        })
      );

      // The collection schema, viewed two ways: the component cascade takes
      // FieldConfig, the outbox snapshot takes FieldDefinition. Both are the
      // same underlying array off the loosely-typed collection.
      const collectionFields = (collection.schemaDefinition?.fields ||
        collection.fields ||
        []) as FieldConfig[];
      const snapshotFields = (collection.schemaDefinition?.fields ||
        collection.fields ||
        []) as FieldDefinition[];
      // Resolved before the transaction opens: the expansion reads the component
      // registry on the pooled connection (see the create/update paths). Skipped
      // when the collection opted out.
      const webhookFields = await this.webhookFieldTreeIfRecording(
        params.collectionName,
        snapshotFields
      );

      // Delete the entry, cascade its component subtrees, and append the
      // `entry.deleted` event in one transaction, so the event commits with the
      // deletion and is never recorded for a delete that rolled back. (The
      // component cascade is best-effort inside the shared helper — it logs and
      // continues on a per-table failure — so this pairs the entry delete with
      // its event, not full cascade atomicity.)
      let deletedRow = false;
      // The locale the removed document represented, captured inside the
      // transaction so the post-commit intent can bust that locale's tag.
      let deletedLocaleForRevalidation: string | undefined;
      // The slug of the row actually deleted (the locked re-read), not the
      // pre-transaction fetch, so a slug changed by a racing update or a
      // beforeDelete hook still busts the correct tag.
      let deletedSlugForRevalidation: string | undefined;
      // Every locale's slug for a localized collection, read on the pool BEFORE
      // the transaction opens (like webhookFields above). Reading it inside the
      // transaction would either poison the transaction on error, or, on
      // `this.db`, re-enter the pool and deadlock a single-connection/saturated
      // pool. The companion rows are still committed here; if a slug shifts
      // between this read and the delete, the always-busted id tag still covers
      // every locale's page.
      // Resolved here, on the pool, for the same reason the slugs are read here. Everything the
      // transaction below does with the companion — including the snapshot that builds the durable
      // delete event — can only READ the verdict, because resolving issues a query and a query
      // against a missing relation aborts the whole transaction on PostgreSQL. On a worker whose
      // first act is a delete nothing has resolved this entity yet, and an unresolved verdict reads
      // as unusable, so every localized field would be silently missing from that event.
      //
      // Every field-group type the collection can hold, not just the collection's own companion:
      // the deleted-document snapshot reads each embedded component through the transaction, where
      // it can only consult what is already resolved. A delete is the one write with no second
      // chance — the event it records is the last description of the row there will ever be.
      await this.warmLocalizedReadiness(params.collectionName);
      const deletedLocalizedSlugsForRevalidation =
        await this.readCompanionSlugsAllLocales(
          this.db,
          params.collectionName,
          params.entryId
        );
      // False when the collection opted out of recording, so the post-commit
      // drain is not scheduled for a delete that recorded nothing.
      let recorded = false;
      // Set when the locked row is outside the caller's filter: a concurrent
      // write moved it out after the check above, and nothing is deleted.
      let refusedUnderLock: CollectionServiceResult | null = null;
      // Asked before the transaction opens: see `DashboardTables`.
      const tables = {
        dashboardPinsPresent: await dashboardPinsPresent(this.adapter),
        mediaUsagePresent: await mediaUsageTablePresent(this.adapter),
      };
      // The in-transaction handlers, asked once for this write.
      const inTransactionHandlers = this.inTransactionHandlersFor(
        params.collectionName
      );
      // Read committed when a handler runs; see `writeTransactionOptions`.
      const transactionOptions = this.writeTransactionOptions(
        inTransactionHandlers
      );
      await this.adapter.transaction(async tx => {
        // Lock and re-read the committed row inside the transaction. `entry`
        // above was read before the hooks ran and outside this transaction, so a
        // concurrent write may have changed or removed it; the event must
        // describe the row actually deleted, and the lock serializes a racing
        // delete so only one of them records the event. The adapter no-ops the
        // lock where row locking is unavailable (e.g. SQLite, itself serialized).
        await tx.lockRow(tableName, params.entryId);
        const [currentRow] = await tx
          .getDrizzle<typeof this.db>()
          .select()
          .from(schema)
          .where(eq(schema.id, params.entryId))
          .limit(1);
        if (!currentRow) return; // a concurrent delete won the race.
        refusedUnderLock = await this.deleteLanguagesChangedUnderLock(
          tx,
          deleteLanguages,
          askedLanguages
        );
        if (refusedUnderLock) return;
        refusedUnderLock = await this.refusalOutsideWriteFilters(
          tx,
          schema,
          params.entryId,
          deleteFilters
        );
        if (refusedUnderLock) return;

        // Read the removed document before the cascade delete removes its
        // relations, in the read shape create/update events use. A localized
        // collection keeps translatable values in the companion, so overlay the
        // default locale's.
        const { document: deletedDocument, locale: deletedLocale } =
          await this.buildDeletedDocument(tx, {
            collectionName: params.collectionName,
            entryId: params.entryId,
            tableName,
            row: currentRow as Record<string, unknown>,
            fields: snapshotFields,
            locale: this.localization?.defaultLocale,
          });
        deletedLocaleForRevalidation = deletedLocale;
        // Read the slug from the assembled document, which overlays the
        // companion locale values, so a user-localized slug (absent from the
        // main row) still busts the correct tag.
        deletedSlugForRevalidation = readStringField(deletedDocument, "slug");

        if (this.fieldGroupDataService) {
          await this.fieldGroupDataService.deleteComponentDataInTransaction(
            tx,
            {
              parentId: params.entryId,
              parentTable: tableName,
              fields: collectionFields,
            }
          );
        }

        const deletedCount = await tx.delete(
          tableName,
          this.whereEq("id", params.entryId)
        );
        // With the lock held a found row always deletes; the guard still covers
        // the lock-less dialects and keeps a racing delete from recording a
        // duplicate `entry.deleted` for a row it did not remove.
        if (deletedCount === 0) return;
        deletedRow = true;

        // Remove EVERY locale's pending working-draft sidecar for the deleted
        // same transaction: it is keyed by entry id and excluded from history and
        // retention queries, so after the row it belongs to is gone it would
        // otherwise linger unreachable in nextly_versions. A no-op when none.
        await new VersionsRepository(tx).deleteAllWorkingDrafts({
          scopeKind: "collection",
          scopeSlug: params.collectionName,
          entryId: params.entryId,
        });

        // Recovery points go with it, every author's. They are excluded from
        // history, from version reads and from retention pruning, so nothing
        // else would ever remove them and each would outlive its document as
        // unreachable unpublished content.
        await new VersionsRepository(tx).deleteAutosaves({
          scopeKind: "collection",
          scopeSlug: params.collectionName,
          entryId: params.entryId,
        });

        // So do the versions features have pinned against retention, and each
        // person's "last looked at" marker: nothing could release or read
        // either once the document is gone.
        await sweepDeletedDocument(
          tx,
          {
            scopeKind: "collection",
            scopeSlug: params.collectionName,
            entryId: params.entryId,
          },
          tables
        );
        // And its review state, every part's: counts, lists and the inbox
        // must never show a document that is gone.
        await removeDeletedDocumentReviewStates(tx, {
          scopeKind: "collection",
          scopeSlug: params.collectionName,
          entryId: params.entryId,
        });

        // The document's last history event: the whole document, every
        // language, is gone. Its history is kept for the activity log's window
        // from here.
        await this.recordHistoryEvent(
          tx,
          params.collectionName,
          params.entryId,
          {
            kind: "deleted",
            actor: actorForWrite(params.actor, params.user),
            personName: params.user?.name ?? null,
          }
        );

        // The removed document's final state ships as `data`; there is no
        // post-delete state, so `previous` is null (mirroring create, which
        // carries only `data`). `locale` is set only for a localized collection,
        // so a receiver knows which translation the payload represents.
        recorded = await recordMutationEvent(tx, {
          type: "entry.deleted",
          resource: {
            kind: "entry",
            collection: params.collectionName,
            id: params.entryId,
            ...(deletedLocale ? { locale: deletedLocale } : {}),
          },
          data: deletedDocument,
          previous: null,
          fields: webhookFields,
          actor: actorForWrite(params.actor, params.user),
        });

        // Last in the transaction, with the removed document: a handler that
        // throws keeps the entry, and what it writes goes with the delete.
        await this.runInTransactionPhase(tx, inTransactionHandlers, {
          collection: params.collectionName,
          operation: "delete",
          id: params.entryId,
          data: deletedDocument,
          user: params.user,
          context: sharedContext,
        });
      }, transactionOptions);
      // Set only after the transaction resolves: `deletedRow` is true exactly
      // when the delete committed, so a commit failure never flags a durable
      // event that isn't there; a later hook failure must not hide it. `recorded`
      // is false when the collection opted out, so an opted-out delete schedules
      // no drain.
      if (refusedUnderLock) return refusedUnderLock;
      eventRecorded = deletedRow && recorded;
      // The row is durable-gone exactly when it was removed, independent of the
      // opt-out flags — the retention-pass signal.
      committedWrite = deletedRow;

      // A concurrent delete removed the row first: report not-found rather than
      // a second success (and a duplicate event) for a deletion this call did
      // not perform.
      if (!deletedRow) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      const deleted = entry;
      await this.recheckReleasesHolding(params.collectionName, [
        params.entryId,
      ]);

      // The tags this delete invalidates: the collection tag and the removed
      // entry's id/slug tags (in its locale), so lists and any cached read of
      // the entry clear. The id tag survives the row's removal.
      revalidationIntent = buildEntryRevalidationIntent(
        params.collectionName,
        readRevalidateConfig(collection),
        {
          id: params.entryId,
          slug: deletedSlugForRevalidation,
          locale: deletedLocaleForRevalidation,
          localizedSlugs: deletedLocalizedSlugsForRevalidation,
        }
      );

      // After the removal is durable: inside an enclosing SQLite transaction,
      // once it commits, and never for a deletion it rolls back.
      await this.afterCommit(async () => {
        // Post-commit reaction event (D8/D51), first, as on create.
        emitCollectionEvent(
          "deleted",
          params.collectionName,
          deleted,
          params.user
        );

        // Execute afterDelete hooks (code-registered)
        // Hooks run after deletion completes (for cleanup)
        const afterContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "delete" as const,
          data: deleted,
          user: params.user,
          context: sharedContext, // Pass shared context from beforeDelete
          req: requestFacts,
        });

        await this.hookService.hookRegistry.execute(
          "afterDelete",
          afterContext
        );

        // Execute stored afterDelete hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "afterDelete",
          storedHooks,
          this.hookService.buildPrebuiltHookContext({
            collection: params.collectionName,
            operation: "delete",
            data: deleted,
            queryDatabase: this.queryDatabaseFn,
            user: params.user,
            sharedContext,
            req: requestFacts,
          })
        );
      });

      return {
        success: true,
        statusCode: 200,
        message: "Entry deleted successfully",
        data: { deleted: true },
        eventRecorded,
        revalidationIntent,
        committed: committedWrite,
      };
    } catch (caught: unknown) {
      // A delete the database is not migrated for answers as such, not as a 500.
      const error = await asNotMigrated(
        caught,
        collectionNotMigrated(this.collectionService, params.collectionName, {
          trusted: fieldTrustOf(params),
        }),
        { written: committedWrite }
      );
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error ? error.message : "Failed to delete entry",
        data: null,
        // A typed error keeps its own status and code. Hardcoding 500 reported
        // a hook's refusal or rate limit as a server fault, and left a boundary
        // nothing to rebuild it from.
        ...errorEnvelopeFields(error),
        eventRecorded,
        revalidationIntent,
        committed: committedWrite,
      };
    }
  }

  // ============================================================
  // Transaction-aware methods
  // ============================================================

  /**
   * Create an entry inside a transaction the caller owns.
   *
   * @param tx - Transaction context from adapter
   * @param params - Collection name and optional user context
   * @param body - Entry data
   * @returns Created entry or error
   */
  async createEntryInTransaction(
    tx: TransactionContext,
    params: CreateEntryWriteParams,
    body: Record<string, unknown>
  ): Promise<CollectionServiceResult<unknown>> {
    // The scope this write runs under becomes the ambient one for the whole
    // operation, not an argument handed to its first gate.
    //
    // A write passes several: the coarse collection check and the field-level
    // write and redaction passes. Only the first took an
    // `authenticatedScope` argument, so a caller that NARROWED its scope was
    // held to it once and judged on the request's original scope everywhere
    // after — a key that kept its write grant but surrendered a field grant
    // still wrote that field. Pinning covers every gate below, including the
    // ones added next.
    return runWithCallerScope(params.authenticatedScope, () =>
      this.createEntryWrite(tx, params, body, {
        enforceCollectionAccess: true,
        runHooks: true,
        shapeCallerObject: true,
        failureMessage: "Failed to create entry in transaction",
      })
    );
  }

  /**
   * The one create implementation. Both transaction entry points delegate here,
   * so a create is shaped, authorized, written and recorded the same way
   * whichever one a caller reached for.
   *
   * The options carry the only things that legitimately differ between them —
   * see `CreateEntryWriteOptions`. Everything else is identical by
   * construction rather than by two implementations agreeing.
   */
  // Replaces createEntryInTransaction (cyclomatic 20) and
  // createSingleEntryInTransaction (24), which were separate copies of this
  // pipeline. One implementation at 24 is the lower of the two, not a new
  // hotspot; the remaining count is the create pipeline's own branching, which
  // comes down by splitting the phases into their own units rather than by
  // keeping two copies of them.
  // fallow-ignore-next-line complexity
  private async createEntryWrite(
    tx: TransactionContext,
    params: CreateEntryWriteParams,
    body: Record<string, unknown>,
    options: CreateEntryWriteOptions
  ): Promise<CollectionServiceResult<unknown>> {
    // Refused first when the collection is removed from code. Read on the
    // caller's transaction, which every write in it then rolls back with.
    await refuseWriteIfRemovedFromCode("collection", params.collectionName, {
      executor: tx.getDrizzle(),
    });
    // A version sent with the body is the server's to decide; see updateEntry.
    body = withoutDocumentVersionKeys(body);
    // Computed right after the row is written (before response redaction can
    // strip the slug, and before the after-hooks run) and carried on every
    // post-write return, so a committed item whose after-hook then throws still
    // surfaces its intent to the batch caller. Hoisted so the catch return sees it.
    let revalidationIntent: RevalidationIntent | undefined;
    // The registry row this write read, kept for the catch: a failed statement
    // can leave the transaction unable to read it again (PostgreSQL aborts it).
    let writeRow: Record<string, unknown> | undefined;
    // Whether this write's row was written, set on the line after the statement
    // that writes it: a failure from then on is answered as it was, never as a
    // database to migrate, whose remedy (send it again) would repeat it.
    let rowWritten = false;
    try {
      // A direct caller runs this inside its own transaction, so every metadata
      // and access read below is bound to that transaction's connection — a
      // pooled read would take a second connection the transaction is holding,
      // which stalls against a small pool.
      const txExecutor = tx.getDrizzle<RelationshipDbExecutor>();
      // Check collection-level access FIRST, forwarding the caller's
      // `overrideAccess`/`routeAuthorized`: a trusted write must hit the
      // `overrideAccess` bypass rather than be re-evaluated against RBAC/stored
      // rules, and a route-authorized write must skip the redundant coarse RBAC
      // re-check. Skipped only when the caller already ran it — the batch
      // services check once per batch rather than once per entry.
      if (options.enforceCollectionAccess) {
        const accessDenied = await this.accessService.checkCollectionAccess({
          collectionName: params.collectionName,
          operation: "create",
          user: params.user,
          overrideAccess: params.overrideAccess,
          routeAuthorized: params.routeAuthorized,
          // The caller's OWN scope when it narrowed one. Passing `undefined`
          // sends the gate to the scope pinned for the request, which is the
          // full one — so a route that gave up a grant before a transactional
          // write would still be judged on the grant it surrendered.
          authenticatedScope: params.authenticatedScope,
          executor: txExecutor,
        });
        if (accessDenied) {
          return accessDenied;
        }
      }
      // Get collection metadata to identify relation fields. Runs on the
      // caller's transaction connection so this per-entry read does not re-enter
      // the pool from inside the transaction (which can stall against a small pool).
      const { collection, fields, storedHooks, tableName } =
        await this.readCollectionWriteMeta(
          params.collectionName,
          tx.getDrizzle()
        );
      writeRow = collection as Record<string, unknown>;

      // The transaction API has always shaped the caller's own object in place;
      // the batch worker shapes a copy. Both are preserved so neither caller's
      // observable behaviour changes here.
      let currentData: Record<string, unknown> = options.shapeCallerObject
        ? body
        : { ...body };
      // Shared context between all hooks in this request
      // Seeded from the caller, like the non-transactional pipelines. An
      // empty literal here meant a hook context reached every write EXCEPT
      // one made inside a transaction, which is the least obvious place for
      // a flag such as recursion suppression to stop working.
      const sharedContext: Record<string, unknown> = { ...params.context };
      // Resolved once for the whole operation, so every hook phase is told the
      // same thing about the caller and none of them re-reads a header.
      const requestFacts = resolveRequestFacts(params.request);

      // Execute hooks (unless skipped)
      if (options.runHooks) {
        // Execute beforeOperation hooks FIRST (before operation-specific hooks)
        // Can modify operation arguments or throw to abort
        const beforeOpArgs =
          await this.hookService.hookRegistry.executeBeforeOperation({
            collection: params.collectionName,
            operation: "create",
            args: { data: currentData },
            user: params.user
              ? { id: params.user.id, email: params.user.email }
              : undefined,
            context: sharedContext,
            req: requestFacts,
            // Bind a beforeOperation hook that reads via context.executor to the
            // caller's transaction connection so it does not re-enter the pool.
            executor: tx.getDrizzle(),
          });

        // Use modified data if returned by beforeOperation
        currentData =
          ((beforeOpArgs as BeforeOperationArgs)?.data as Record<
            string,
            unknown
          >) ?? currentData;

        // Execute beforeCreate hooks (code-registered)
        const beforeContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "create" as const,
          data: currentData,
          user: params.user,
          context: sharedContext,
          // Bind DB-reading hooks (e.g. the built-in sanitization hook, which
          // loads field metadata) to the caller's transaction connection so they
          // do not re-enter the pool from inside the transaction.
          executor: tx.getDrizzle(),
          req: requestFacts,
        });

        const modifiedData = await this.hookService.hookRegistry.execute(
          "beforeCreate",
          beforeContext
        );
        currentData = modifiedData ?? currentData;

        // Execute stored beforeCreate hooks (UI-configured)
        const storedBeforeResult =
          await this.hookService.storedHookExecutor.execute(
            "beforeCreate",
            storedHooks,
            this.hookService.buildPrebuiltHookContext({
              collection: params.collectionName,
              operation: "create",
              data: currentData,
              queryDatabase: this.queryDatabaseFn,
              user: params.user,
              sharedContext,
              req: requestFacts,
              // Bind a stored hook's uniqueness read to the caller's transaction
              // connection so it does not re-enter the pool from inside the tx.
              executor: tx.getDrizzle(),
            })
          );
        currentData = (storedBeforeResult.data ?? currentData) as Record<
          string,
          unknown
        >;
      }

      const finalData = currentData;

      // Password fields store bcrypt hashes, never the submitted value —
      // same guarantee as the non-transaction paths.
      // Enforce the schema's declared rules on the server. Every writer
      // (admin, REST, Direct API, bulk, forms) funnels through this path,
      // so this is where required/min/max/pattern/options are guaranteed;
      // runs on the post-hook data and before hashing so password rules
      // see the plaintext length, not the hash's.

      // Generate the auto-injected `slug`/`title` before write access +
      // validation (see createEntry). This path backs bulk create, so an
      // entry that omits slug/title must still receive them. The uniqueness
      // check runs on the transaction so entries created earlier in the same
      // bulk batch are seen.
      const isSlugTaken = async (slug: string) => {
        const existing = await tx.selectOne<Record<string, unknown>>(
          tableName,
          {
            where: this.whereEq("slug", slug),
          }
        );
        return existing != null;
      };
      await this.applyGeneratedSlugAndTitle(
        finalData,
        isSlugTaken,
        params.collectionName
      );

      // Field-level write access: fields the caller may not create are
      // stripped (Payload parity); a system write (no user) or an
      // explicit override bypasses. One resolver for this pass and the
      // field groups', read on the caller-owned transaction.
      const writeGrants = this.callerGrants(
        params.user,
        params.authenticatedScope,
        tx.getDrizzle()
      );
      await this.applyCreateFieldRules(params, finalData, writeGrants);
      // The field groups this entry stores inline, inside its groups and
      // repeaters, by their own rules: no field-group save reaches them.
      await this.judgeInlineFieldGroups({
        data: finalData,
        fields,
        params,
        // Still inside the caller-owned transaction.
        executor: tx.getDrizzle(),
        grants: writeGrants,
      });

      // Field-level beforeValidate hooks transform values ahead of the
      // validation gate (functions resolved via the field-level registry). A
      // hook can set `slug`, so re-sanitize after it so the validated and
      // stored value stays URL-safe.
      if (options.runHooks) {
        await runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "beforeValidate",
          data: finalData,
          operation: "create",
          user: params.user,
        });
        await this.reSanitizeSlug(
          finalData,
          isSlugTaken,
          params.collectionName
        );
      }

      {
        await this.assertEntryValid({
          data: finalData,
          fields,
          collectionName: params.collectionName,
          mode: "create",
          user: params.user,
          reader: params,
          // On the caller's transaction, so a row an earlier entry of the
          // same batch wrote is seen.
          tx,
        });
      }

      // Collection-level then field-level beforeChange hooks, on data the
      // validation gate has just passed. Both sit under the same `skipHooks`
      // gate: the flag means this write runs no user hooks at all, so a
      // collection-level handler running while the field-level one is skipped
      // would be the gate half-applied.
      if (options.runHooks) {
        await this.hookService.runBeforeChange({
          collection: params.collectionName,
          operation: "create",
          data: finalData,
          storedHooks,
          queryDatabase: this.queryDatabaseFn,
          user: params.user,
          sharedContext,
          executor: tx.getDrizzle(),
          req: requestFacts,
        });
        await runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "beforeChange",
          data: finalData,
          operation: "create",
          user: params.user,
        });
        // The whole-number floor judges what the hooks changed: a fraction a
        // hook produced would reach the integer column and let the database
        // decide, on every verb this gate guards.
        const hookIssues = hookChangedWholeNumberIssues(
          finalData,
          fields,
          "",
          // On the write's own connection, as the gate on this path reads.
          await this.hookWalkComponentResolver(fields, tx.getDrizzle())
        );
        if (hookIssues.length > 0) {
          throw NextlyError.validation({ errors: hookIssues });
        }
      }
      // A beforeChange hook can also set `slug`, so re-sanitize before
      // storage. Outside the hooks' gate: a write that skips hooks still
      // stores only a slug its collection can hold, since an early pass
      // leaves an unstorable slug path as given for this one to refuse.
      await this.reSanitizeSlug(finalData, isSlugTaken, params.collectionName);

      const { manyToManyFields, manyToManyData, componentFieldData } =
        await this.prepareCreateWritePayload(
          finalData,
          fields,
          tx.getDrizzle()
        );

      // Before the localized split below, which copies these values into the
      // companion payload for the row this create is about to insert.
      this.serializeJsonFieldValues(finalData, fields);
      this.serializeHasManyRelationships(finalData, fields);
      coerceDateFieldsToDate(finalData, fields);

      // Prepare entry data
      const nowForTxCreate = new Date();
      const entryData = {
        // The collection's own id decision: which generator, and whether a
        // client-supplied id is accepted at all. Read BEFORE the strip below,
        // which removes `id` along with every other client-supplied system
        // column — that strip is what made `allowIdOnCreate` unexpressible.
        id: resolveEntryId(
          collectionDbOptions(params.collectionName),
          finalData.id
        ),
        // Strip client-supplied system columns (id / timestamps / created_by,
        // both snake and camel) so the generated id, stamped owner, and
        // timestamps below are authoritative — a stray `createdBy` alias can't
        // survive to overwrite the owner stamp. Columns a schema hook
        // contributed to this table go too: their contributor writes them.
        ...stripImmutableSystemFields(
          finalData,
          "collection",
          tableName,
          fields
        ),
        // Snake_case keys: the runtime Drizzle schema names these columns
        // created_at / updated_at / created_by, and the adapter maps by column
        // name. (The prior camelCase createdAt/updatedAt keys here were ignored
        // by Drizzle and only "worked" via the columns' DB defaults — but a
        // strict driver like better-sqlite3 rejects the whole insert once any
        // unknown key is present, so bulk create needs the real column names.)
        created_at: nowForTxCreate,
        updated_at: nowForTxCreate,
        // Stamp the row owner with the creating user's id, so a consumer can
        // tell who made the row. Null for system/seed creates (no user context).
        created_by: params.user?.id ?? null,
      };

      // The bulk worker is a separate, streamlined path — the batch service calls it rather than
      // `createEntryInTransaction` — so it needs the rule too. Leaving it out is how batch writes
      // came to publish documents that carried no marker while single writes did.
      const createStamp = resolveFirstPublishedStamp({
        hasStatus: (collection as { status?: boolean }).status === true,
        previousStatus: null,
        nextStatus: finalData.status,
        existingMarker: null,
        now: nowForTxCreate,
      });
      if (createStamp) {
        (entryData as Record<string, unknown>).first_published_at = createStamp;
      }
      // The document's first changer, at its creation; its counter starts at
      // the default, 1.
      Object.assign(
        entryData,
        changerColumns(actorForWrite(params.actor, params.user)),
        { _changed_at: nowForTxCreate }
      );

      // The bulk create worker inserts status like any other field, so publishing
      // through it needs `publish-<slug>` the same as a single create — otherwise
      // batch create is a way around the gate. Judged on the post-hook `finalData`
      // (hooks run unless skipped); a create has no prior status, and a trusted
      // server write bypasses via overrideAccess.
      //
      // Authorization is resolved once by the batch caller before this shared
      // transaction (or here on the pooled connection when called directly), so no
      // permission read runs inside the transaction.
      const transitionAuth =
        params.transitionAuth ??
        (await this.resolveTransitionAuthorization({
          collectionName: params.collectionName,
          accessUser: params.overrideAccess ? undefined : params.user,
          overrideAccess: params.overrideAccess,
          // This fallback fires only for a direct caller-owned-tx write (the bulk
          // paths always pre-resolve and pass transitionAuth), so bind the reads
          // to this transaction's connection rather than re-entering the pool.
          executor: tx.getDrizzle(),
        }));
      const transitionDenied = await this.enforceTransitionUnderLock(tx, {
        tableName,
        nextStatus: finalData.status,
        isCreate: true,
        auth: transitionAuth,
        createDocument: entryData,
      });
      if (transitionDenied) {
        return transitionDenied;
      }

      // A localized collection keeps its translatable values in the companion
      // `_locales` table, and the migrated main table has no columns for them:
      // unsplit, this insert names columns the table does not have and every
      // row of a bulk create fails with the driver's own message. Split here,
      // as `createEntry` does, so the two create paths write a localized
      // collection the same way rather than one of them not at all. No locale
      // is named — the bulk entry points refuse one — so this is the default
      // language's write, which is what `undefined` resolves to. The metadata
      // read is bound to this transaction's connection; a pooled one would
      // wait for a connection this transaction is holding.
      const localizedWrite = await this.splitLocalizedWriteData(
        params.collectionName,
        entryData,
        undefined,
        true,
        tx.getDrizzle()
      );

      // The row and the rows that complete it — its translations and its
      // field-group instances — are written under one savepoint where the
      // transaction has them. A later step refused (a translation or
      // field-group table this instance has not registered, say) then undoes
      // the row too, so a caller that catches the failure and commits its own
      // transaction keeps nothing of this create. Side effects and hooks run
      // after it, as before.
      const entry = await underSavepoint(tx, async () => {
        // Insert using transaction context
        const entry = await tx.insert<unknown>(tableName, entryData, {
          returning: "*",
        });
        rowWritten = true;

        // The companion row for this write's locale, on the same transaction, so
        // it rolls back with the main row. A brand-new parent has no row to
        // conflict with, which is why this inserts where the update path upserts.
        if (localizedWrite) {
          // A failure here is a write-integrity failure: the parent row is
          // already written. Reported as a soft per-item failure, a batch under
          // `stopOnError: false` would carry on and commit a document whose
          // translations never landed — the row would exist with no content in
          // any language. Marked, the batch loop aborts and the transaction
          // rolls back, exactly as a failed component save does.
          try {
            await this.insertCompanionRow(
              tx,
              localizedWrite,
              (entry as { id: string }).id,
              actorForWrite(params.actor, params.user)
            );
          } catch (error: unknown) {
            throw markWriteIntegrityFailure(error);
          }
          // Split out of the insert, so the returned row lacks them: merge them
          // back for the hooks, the event and the response. Under the FIELD's
          // name rather than the column's — a field whose column differs
          // (`metaTitle` -> `meta_title`) would otherwise reach hooks and the
          // durable snapshot under a key no field has.
          for (const [field, value] of Object.entries(
            localizedWrite.localizedFieldValues
          )) {
            (entry as Record<string, unknown>)[field] = value;
          }
        }

        await this.saveComponentFieldDataInTx(tx, {
          parentId: (entry as { id: string }).id,
          tableName,
          fields,
          data: componentFieldData,
          user: params.user,
          access: this.fieldGroupAccess(params),
          write: this.validationWrite(
            params.collectionName,
            (entry as { id: string }).id,
            tx,
            localizedWrite?.writeLocale,
            // The payload as sent, with what the write lifted out of it put back.
            this.writtenPayload(
              finalData,
              [manyToManyData, componentFieldData],
              localizedWrite
            )
          ),
        });
        return entry;
      });

      // The in-transaction handlers, asked once for this write: the same set
      // decides how much of the document is assembled and which handlers run.
      const inTransactionHandlers = this.inTransactionHandlersFor(
        params.collectionName
      );
      // Junction rows, the version snapshot, the outbox event and the
      // revalidation intent, all on the caller's transaction.
      const createEffects = await this.recordCreateSideEffects(tx, {
        collectionName: params.collectionName,
        inTransactionHandlers,
        tableName,
        entry: entry as Record<string, unknown>,
        collection,
        fields,
        manyToManyFields,
        manyToManyData,
        user: params.user,
        actor: params.actor,
        // The language this create's translatable values went into, so the
        // version snapshot is tagged with it rather than reading as shared.
        localeTag: localizedWrite?.writeLocale,
      });
      const eventRecorded = createEffects.eventRecorded;
      revalidationIntent = createEffects.revalidationIntent;

      // Last of the write itself, on the caller's transaction, before the
      // after-hooks this path runs inside it. Run whether or not hooks are:
      // see `runInTransactionPhase`. A handler's failure is thrown, not
      // softened, so the caller's transaction keeps nothing of this entry.
      await this.runInTransactionPhase(tx, inTransactionHandlers, {
        collection: params.collectionName,
        operation: "create",
        id: (entry as { id: string }).id,
        data: createEffects.document,
        user: params.user,
        context: sharedContext,
      });

      // The collection event, held for the caller's commit. Announced whether
      // or not hooks run: it is not a hook, as the outbox event is not.
      await this.announceAtCommit(
        "created",
        params.collectionName,
        entry as Record<string, unknown>,
        params.user
      );

      // Execute afterCreate hooks (unless skipped)
      if (options.runHooks) {
        // Execute afterCreate hooks (code-registered)
        const afterContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "create" as const,
          data: entry,
          user: params.user,
          context: sharedContext,
          // Bind an after-hook that reads via context.executor to the caller's
          // transaction connection so it does not re-enter the pool from the tx.
          executor: tx.getDrizzle(),
          req: requestFacts,
        });

        await this.hookService.hookRegistry.execute(
          "afterCreate",
          afterContext
        );

        // Execute stored afterCreate hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "afterCreate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext({
            collection: params.collectionName,
            operation: "create",
            data: entry,
            queryDatabase: this.queryDatabaseFn,
            user: params.user,
            sharedContext,
            req: requestFacts,
            // Bind a stored hook's uniqueness read to the caller's transaction
            // connection so it does not re-enter the pool from inside the tx.
            executor: tx.getDrizzle(),
          })
        );
      }

      // Stored password hashes are write-only; the response never carries
      // them back to the client.
      // Field-level afterChange hooks observe the saved values (before the
      // password strip so they can see the full stored row).
      if (options.runHooks) {
        await runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "afterChange",
          data: entry as Record<string, unknown>,
          operation: "create",
          user: params.user,
        });
      }

      await this.redactResponseFields(
        entry as Record<string, unknown>,
        fields,
        {
          user: params.user,
          overrideAccess: params.overrideAccess,
          routeAuthorized: params.routeAuthorized,
          authenticatedScope: params.authenticatedScope,
        },
        params.collectionName,
        tableName,
        // Still inside the caller-owned transaction.
        tx.getDrizzle()
      );
      // Read on the caller's transaction, where this create is visible.
      setDocumentVersion(
        entry as Record<string, unknown>,
        await documentVersionOn(tx, {
          dialect: this.dialect,
          table: tableName,
          id: (entry as { id: string }).id,
          languagesTable: await this.translationTableOnTx(
            tx,
            collection,
            tableName
          ),
          localization: this.localization,
          locale: localizedWrite?.writeLocale,
        })
      );

      return {
        success: true,
        statusCode: 201,
        message: "Entry created successfully",
        data: entry,
        eventRecorded,
        revalidationIntent,
      };
    } catch (error: unknown) {
      // Carry the intent (set only once the row was written) so a committed item
      // whose after-hook then threw still busts its tags via the batch caller.
      // Pass dialect explicitly so the helper can normalise raw driver errors.
      // A post-write capture/recording failure was marked to abort the whole
      // batch transaction; re-throw it rather than reporting a soft success:false
      // that the bulk loop would continue past, committing an unversioned row.
      if (isWriteIntegrityFailure(error)) throw error;
      return {
        ...errorToServiceResult(
          // A write the database is not migrated for answers as such, judged
          // from the row read before the failed statement.
          await asNotMigrated(
            error,
            collectionRowNotMigrated(params.collectionName, writeRow, {
              trusted: fieldTrustOf(params),
            }),
            { written: rowWritten }
          ),
          { defaultMessage: options.failureMessage },
          this.dialect
        ),
        revalidationIntent,
      };
    }
  }

  /**
   * The in-transaction handlers a write runs, asked of the registry once per
   * write. The write keeps the set and uses it both to decide how much of the
   * document to assemble and to run the phase, so a handler registered in
   * between waits for the next write instead of being handed a document
   * assembled for none.
   */
  private inTransactionHandlersFor(
    collection: string
  ): InTransactionHandlerSet {
    return inTransactionHandlersFor(this.hookService.hookRegistry, collection);
  }

  /**
   * The options a write's own transaction opens with, given the
   * in-transaction handlers it runs: with any, it reads committed on every
   * dialect. A handler may serialize writes with a row lock and then judge
   * what other writes stored; under MySQL's default, REPEATABLE READ, its
   * reads would answer from the snapshot the transaction's first read took,
   * before the writer it waited for committed. PostgreSQL reads committed
   * already, and SQLite runs one writer at a time. A write running none keeps
   * the dialect's default.
   */
  private writeTransactionOptions(
    handlers: InTransactionHandlerSet,
    options?: TransactionOptions
  ): TransactionOptions | undefined {
    if (handlers.length === 0) return options;
    return { ...options, isolationLevel: "read committed" };
  }

  /**
   * The in-transaction phase for one write, run last on the write's own
   * transaction (see `hooks/in-transaction-phase`), with the handlers the
   * write took ({@link inTransactionHandlersFor}).
   *
   * A write no handler was registered for loads nothing and does exactly
   * what it did before the phase existed. It runs whether or not the write
   * runs its hooks: what a handler writes keeps a plugin's rows in step with
   * the entry, as the version and the outbox event do, and those are recorded
   * under `skipHooks` too.
   */
  private runInTransactionPhase(
    tx: TransactionContext,
    handlers: InTransactionHandlerSet,
    call: InTransactionCall
  ): Promise<void> {
    return runInTransactionPhaseFor(handlers, tx, call);
  }

  /**
   * Hand documents just saved or deleted to the early stop, once the write is
   * durable: a scheduled release holding one may now have a hard problem (a
   * pending change its author may not publish, the document gone), and is
   * stopped then rather than at its instant. Inside an enclosing SQLite
   * transaction this waits for its commit, and never runs for a write it
   * rolls back. One call for a whole batch, after its transaction.
   */
  recheckReleasesHolding(
    collectionName: string,
    entryIds: readonly string[]
  ): Promise<void> {
    if (entryIds.length === 0) return Promise.resolve();
    return this.afterCommit(() =>
      stopReleasesHolding({
        documents: entryIds.map(entryId => ({
          scopeKind: "collection",
          scopeSlug: collectionName,
          entryId,
        })),
      })
    );
  }

  /**
   * Announce a write made on a caller's transaction once that transaction
   * commits, as a write that opens its own transaction announces itself: the
   * event is held until the outermost transaction the calling flow is inside
   * commits, and dropped when it, or a savepoint this write ran in, rolls back.
   * The after-hooks of these paths run inline, inside that transaction, so
   * they come before the event here.
   *
   * Called once the write itself is done (its row, outbox event and
   * in-transaction handlers), so the event goes with exactly the rows the
   * outbox event goes with. The row and the user are detached now: what the
   * write and its inline hooks do to them afterwards (the response's parsing
   * and redaction) is not what subscribers are handed, and what a subscriber
   * does to its copy reaches neither the caller nor anything else.
   */
  private announceAtCommit(
    action: CollectionEventAction,
    collectionName: string,
    row: Record<string, unknown>,
    user: unknown
  ): Promise<void> {
    const committed = detachedForListeners(row);
    const by = detachedForListeners(user);
    return this.afterCommit(() =>
      deliverCollectionEvent(action, collectionName, committed, by)
    );
  }

  /**
   * Update an entry inside a transaction the caller owns.
   *
   * @param tx - Transaction context from adapter
   * @param params - Collection name, entry ID, and optional user context
   * @param body - Update data
   * @returns Updated entry or error
   */
  async updateEntryInTransaction(
    tx: TransactionContext,
    params: UpdateEntryWriteParams & { entryId: string },
    body: Record<string, unknown>
  ): Promise<CollectionServiceResult<unknown>> {
    // The scope this write runs under becomes the ambient one for the whole
    // operation, not an argument handed to its first gate.
    //
    // A write passes several: the coarse collection check and the field-level
    // write and redaction passes. Only the first took an
    // `authenticatedScope` argument, so a caller that NARROWED its scope was
    // held to it once and judged on the request's original scope everywhere
    // after — a key that kept its write grant but surrendered a field grant
    // still wrote that field. Pinning covers every gate below, including the
    // ones added next.
    return runWithCallerScope(params.authenticatedScope, () =>
      this.updateEntryWrite(tx, params, params.entryId, body, {
        rowGate: "access-service",
        runHooks: true,
        identifyMissingEntry: false,
        failureMessage: "Failed to update entry in transaction",
      })
    );
  }

  // Replaces updateEntryInTransaction (cyclomatic 43) and
  // updateSingleEntryInTransaction (57). One implementation at 59 is close to
  // the larger of the two and well under their sum; the branching is the
  // update pipeline's own — working drafts, localized splits, status
  // transitions — and comes down by splitting those phases out, not by
  // maintaining the copy this replaced.
  // fallow-ignore-next-line complexity
  private async updateEntryWrite(
    tx: TransactionContext,
    params: UpdateEntryWriteParams,
    entryId: string,
    body: Record<string, unknown>,
    options: UpdateEntryWriteOptions
  ): Promise<CollectionServiceResult<unknown>> {
    // Refused first when the collection is removed from code; see createEntryWrite.
    await refuseWriteIfRemovedFromCode("collection", params.collectionName, {
      executor: tx.getDrizzle(),
    });
    // How this item is judged, decided before the version and `_overwrite`
    // are dropped, as on updateEntry: an item that gives a version is judged
    // on its own, so a stale one is refused and the rest of a batch applied.
    const versionCheck = this.versionCheckOf(
      { collectionName: params.collectionName, entryId },
      body
    );
    if ("success" in versionCheck) return versionCheck;
    // A version sent with the body is the server's to decide; see updateEntry.
    body = withoutDocumentVersionKeys(body);
    // Computed right after the row is updated (before redaction can strip the
    // slug and before the after-hooks run) and carried on every post-write
    // return, so a committed item whose after-hook then throws still surfaces
    // its intent to the batch caller.
    let revalidationIntent: RevalidationIntent | undefined;
    // The registry row this write read, kept for the catch: a failed statement
    // can leave the transaction unable to read it again (PostgreSQL aborts it).
    let writeRow: Record<string, unknown> | undefined;
    // Whether this write's row was written, set on the line after the statement
    // that writes it: a failure from then on is answered as it was, never as a
    // database to migrate, whose remedy (send it again) would repeat it.
    let rowWritten = false;
    // The filters this write was judged by, where a rule answered one: the
    // written row is matched against each again before the write may stand.
    const filteredWrites: FilteredTransactionWrite[] = [];
    try {
      // Get collection metadata to identify relation fields. Runs on the
      // caller's transaction connection so this per-entry read does not re-enter
      // the pool from inside the transaction (which can stall against a small pool).
      const { collection, fields, storedHooks, tableName } =
        await this.readCollectionWriteMeta(
          params.collectionName,
          tx.getDrizzle()
        );
      writeRow = collection as Record<string, unknown>;
      // Read once, as plain data: a caller's object may compute a key on each
      // read, and the gate a write asks and the write itself must read the same
      // body.
      body = { ...body };
      // The lifecycle action this row's own gate asked and allowed, if any.
      let rowAllowed: "publish" | "unpublish" | undefined;
      // The filter the row's own gate answered: the row is matched against it
      // once it is locked, before any hook runs.
      let rowFilter: RowVerdict["filter"];

      // Asked before the row is locked, so a caller the gate refuses holds no
      // lock on an entry it may not change, however many rows a batch names.
      // A batch-hoisted row has nothing to re-check: the batch's caller asked
      // the collection-level update gate once, and no row-ownership rule is
      // left for a safety net to compare against.
      if (options.rowGate !== "batch-hoisted") {
        // Asked here, on the caller's transaction, where its caller owns it;
        // a batch that opened its own asked it before opening it, off its
        // connection, since a rule is the app's own code and may read the
        // database.
        const verdict =
          options.rowGate === "access-service"
            ? await this.rowVerdict(
                params,
                entryId,
                body,
                () => (collection as { status?: boolean }).status === true,
                tx.getDrizzle(),
                true
              )
            : options.rowGate;
        const { gate, denied } = verdict;
        rowFilter = verdict.filter;
        // Handed on as the status alone: the system columns a status-only body
        // may also name are never stored, and no hook is handed a value sent by
        // a caller judged without update.
        if (gate !== "update") body = { status: body.status };
        if (denied) {
          return asMissingItem(denied, entryId, options.identifyMissingEntry);
        }
        if (gate !== "update") rowAllowed = gate;
      }

      // No owner predicate: write access is decided for the collection rather
      // than per row, so the fetch is by id alone and the access service holds
      // the whole verdict.
      const fetchWhere = this.whereEq("id", entryId);

      // Fetch existing entry first (needed for owner checks and hooks). Lock the
      // row (`forUpdate`, a no-op on SQLite, which already serializes writers) so
      // a concurrent rename cannot commit between this read and the update below,
      // which would otherwise leave the `previousSlug` captured here stale and
      // the prior URL's cache tag unbusted.
      const existingEntry = await tx.selectOne<Record<string, unknown>>(
        tableName,
        { where: fetchWhere, forUpdate: true }
      );
      // The row as stored, apart from `existingEntry`, whose read shape below
      // withholds its passwords in place; the stored hashes are read from it.
      const storedRow = existingEntry ? detachData(existingEntry) : undefined;

      if (!existingEntry) {
        return {
          success: false,
          statusCode: 404,
          message: missingEntryMessage(entryId, options.identifyMissingEntry),
          data: null,
        };
      }
      // The main row's version, under the lock just taken and before this
      // item writes anything, so a refused item leaves nothing behind in a
      // transaction that goes on with the rest of a batch.
      if (rowFilter) {
        const outside = await this.refusalOutsideFilterOfWrite(
          tx,
          rowFilter.params,
          rowFilter.access,
          filteredWrites
        );
        if (outside) {
          return asMissingItem(outside, entryId, options.identifyMissingEntry);
        }
      }
      // Judged once the caller is known to reach this entry, so a refusal
      // never tells one the row filter excludes that the entry exists.
      // The default language, the one a batch writes, where its translation
      // table is ready: the version must name it, as a single save's must,
      // and a refusal for a version that does not is given here, before any
      // hook runs. It is judged with the main row, and named in a refusal so
      // the answer can be sent back with the same save.
      const defaultLocale = this.localization?.defaultLocale;
      const given = givenOf(versionCheck);
      const batchCompanion =
        given !== undefined && defaultLocale !== undefined
          ? await this.readyCompanionOf(params.collectionName, tx.getDrizzle())
          : null;
      if (batchCompanion && defaultLocale !== undefined) {
        try {
          judgedLanguage(given, defaultLocale);
        } catch (error) {
          return errorToServiceResult(
            error,
            { defaultMessage: "Failed to update entry" },
            this.dialect
          );
        }
      }
      const batchAt: StaleWrite =
        batchCompanion && defaultLocale !== undefined
          ? {
              table: tableName,
              languages: {
                table: batchCompanion.companionTableName,
                locales: [defaultLocale],
              },
            }
          : { table: tableName };
      // The main row's version and that language's, under the lock just
      // taken and before this item writes or runs anything, so a refused
      // item leaves nothing behind in a transaction that goes on with the
      // rest of a batch.
      const mainJudged = await judgeMainRow(tx, this.dialect, versionCheck, {
        table: tableName,
        id: entryId,
        languages: batchAt.languages,
      });
      if (mainJudged.stale && versionCheck.kind === "judge") {
        return this.staleVersionAnswerInTransaction(
          tx,
          params,
          entryId,
          versionCheck.given,
          batchAt
        );
      }

      let currentData: Record<string, unknown> = { ...body };

      // Shared context between all hooks in this request
      // Seeded from the caller, like the non-transactional pipelines. An
      // empty literal here meant a hook context reached every write EXCEPT
      // one made inside a transaction, which is the least obvious place for
      // a flag such as recursion suppression to stop working.
      const sharedContext: Record<string, unknown> = { ...params.context };
      // Resolved once for the whole operation, so every hook phase is told the
      // same thing about the caller and none of them re-reads a header.
      const requestFacts = resolveRequestFacts(params.request);

      // Execute hooks (unless skipped)
      if (options.runHooks) {
        // Execute beforeOperation hooks FIRST (before operation-specific hooks)
        // Can modify operation arguments (id, data) or throw to abort
        const beforeOpArgs =
          await this.hookService.hookRegistry.executeBeforeOperation({
            collection: params.collectionName,
            operation: "update",
            args: { id: entryId, data: body },
            user: params.user
              ? { id: params.user.id, email: params.user.email }
              : undefined,
            context: sharedContext,
            req: requestFacts,
            // Bind a beforeOperation hook that reads via context.executor to the
            // caller's transaction connection so it does not re-enter the pool.
            executor: tx.getDrizzle(),
          });

        // Use modified data if returned by beforeOperation
        currentData =
          ((beforeOpArgs as BeforeOperationArgs)?.data as Record<
            string,
            unknown
          >) ?? body;

        // Execute beforeUpdate hooks (code-registered)
        const beforeContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "update" as const,
          data: currentData,
          originalData: existingEntry,
          user: params.user,
          context: sharedContext,
          // Bind DB-reading hooks (e.g. the built-in sanitization hook) to the
          // caller's transaction connection so they do not re-enter the pool.
          executor: tx.getDrizzle(),
          req: requestFacts,
        });

        const modifiedData = await this.hookService.hookRegistry.execute(
          "beforeUpdate",
          beforeContext
        );
        currentData = modifiedData ?? currentData;

        // Execute stored beforeUpdate hooks (UI-configured)
        const storedBeforeResult =
          await this.hookService.storedHookExecutor.execute(
            "beforeUpdate",
            storedHooks,
            this.hookService.buildPrebuiltHookContext({
              collection: params.collectionName,
              operation: "update",
              data: currentData,
              queryDatabase: this.queryDatabaseFn,
              user: params.user,
              sharedContext,
              req: requestFacts,
              // Bind a stored hook's uniqueness read to the caller's transaction
              // connection so it does not re-enter the pool from inside the tx.
              executor: tx.getDrizzle(),
            })
          );
        currentData = (storedBeforeResult.data ?? currentData) as Record<
          string,
          unknown
        >;
      }

      const finalData = currentData;

      // Password fields store bcrypt hashes, never the submitted value —
      // same guarantee as the non-transaction paths.
      // Enforce the schema's declared rules on the server. Every writer
      // (admin, REST, Direct API, bulk, forms) funnels through this path,
      // so this is where required/min/max/pattern/options are guaranteed;
      // runs on the post-hook data and before hashing so password rules
      // see the plaintext length, not the hash's.
      // Field-level write access: fields the caller may not update are
      // stripped (Payload parity); a system write (no user) or an
      // explicit override bypasses.
      // With the field groups this entry stores inline, by their own rules,
      // and every denied value inside a container kept as the row holds it.
      const { storedPaths, storedValues } = await this.keepDeniedFieldsAtStored(
        {
          data: finalData,
          storedId: String(existingEntry.id),
          collectionName: params.collectionName,
          stored: await this.storedForCarryForward({
            row: existingEntry,
            fields,
            tableName,
            collectionName: params.collectionName,
            entryId,
            // A transactional update writes the default language.
            tx,
            overrideAccess: params.overrideAccess,
          }),
          tableName,
          fields,
          params,
          // Still inside the caller-owned transaction.
          executor: tx.getDrizzle(),
        }
      );

      // Field-level beforeValidate hooks transform values ahead of the
      // validation gate (functions resolved via the field-level registry).
      if (options.runHooks) {
        await runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "beforeValidate",
          data: finalData,
          operation: "update",
          user: params.user,
        });
      }

      {
        await this.assertEntryValid({
          data: finalData,
          fields,
          collectionName: params.collectionName,
          mode: "update",
          user: params.user,
          reader: params,
          id: entryId,
          tx,
          storedProvenancePaths: storedPaths,
        });
      }

      // Collection-level then field-level beforeChange hooks, on data the
      // validation gate has just passed. Both sit under the same `skipHooks`
      // gate: the flag means this write runs no user hooks at all.
      if (options.runHooks) {
        await this.hookService.runBeforeChange({
          collection: params.collectionName,
          operation: "update",
          data: finalData,
          originalData: existingEntry,
          storedHooks,
          queryDatabase: this.queryDatabaseFn,
          user: params.user,
          sharedContext,
          executor: tx.getDrizzle(),
          req: requestFacts,
        });
        await runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "beforeChange",
          data: finalData,
          operation: "update",
          user: params.user,
        });
        // The whole-number floor judges what the hooks changed: a fraction a
        // hook produced would reach the integer column and let the database
        // decide, on every verb this gate guards. Paths the restore kept
        // from the row for a denied rule are the row's own, not judged.
        const hookIssues = hookChangedWholeNumberIssues(
          finalData,
          fields,
          "",
          // On the write's own connection, as the gate on this path reads.
          await this.hookWalkComponentResolver(fields, tx.getDrizzle()),
          storedPaths,
          storedValues
        );
        if (hookIssues.length > 0) {
          throw NextlyError.validation({ errors: hookIssues });
        }
      }

      // A collection storing slug paths has its slug held to them here too,
      // after every hook that may set it: a transactional update must not
      // store an address (`../admin`) its plain update would refuse. Other
      // collections keep this path as it was.
      if (
        collectionDbOptions(params.collectionName).slugPaths === true &&
        typeof finalData.slug === "string" &&
        finalData.slug.trim() !== ""
      ) {
        finalData.slug = this.slugAsStored(
          params.collectionName,
          finalData.slug,
          true
        );
      }

      // Read AFTER every hook that may decide it: a `beforeChange` hook can
      // turn this write into a publish, and before the locale split below,
      // which may move the status out of the patch into the companion's.
      const publishes =
        (collection as { status?: boolean }).status === true &&
        finalData.status === "published";

      // A password the update leaves out of a container keeps its stored hash.
      // The same stored value is what its repeater rows keep their ids
      // against, below.
      const reach = await this.passwordReach(fields, tx.getDrizzle());
      const storedContainers = await this.storedContainersForWrite({
        row: storedRow ?? existingEntry,
        fields,
        reach,
        collectionName: params.collectionName,
        entryId,
        // A transactional update writes the default language.
        tx,
      });
      await hashPasswordFieldValues(
        finalData,
        fields,
        reach,
        carryStoredPasswords(finalData, storedContainers, fields, reach)
      );

      // Strip an explicit `status: undefined` AFTER every mutating hook has run.
      // A field-level beforeValidate/beforeChange hook can (re)introduce an own
      // `status: undefined`, which names no status change but would otherwise be
      // sanitized to SQL NULL on the raw-parameter path — silently unpublishing a
      // published row, or nulling a create's draft default — without passing the
      // publish/unpublish gate. Placed here, the last status-touching step before
      // the transition classification and the write, so the write payload and the
      // gate agree even when a hook set the undefined.
      stripUndefinedStatus(finalData);

      // A row its own gate judged as a publish or an unpublish in place of
      // update that a hook made an edit, naming a field or dropping the
      // status, asks update now, before anything is written. Asked on this
      // transaction's connection, which the row lock already holds.
      if (
        rowAllowed !== undefined &&
        !isStatusOnlyWrite(finalData, "collection")
      ) {
        // Its rule's filter limits the edit as an edit's own: matched against
        // the locked row now, and again after the write.
        const editDenied = await this.refusalOfWriteInTransaction(
          tx,
          {
            collectionName: params.collectionName,
            operation: "update",
            entryId,
            user: params.user,
            overrideAccess: params.overrideAccess,
            // The route admitted a status change, not this edit.
            routeAuthorized: false,
            authenticatedScope: params.authenticatedScope,
            executor: tx.getDrizzle(),
          },
          filteredWrites
        );
        if (editDenied) return editDenied;
      }

      // Normalize relationship field values (extract IDs from objects with display properties)
      // This must happen before many-to-many extraction and JSON serialization
      // Walks containers too: a reference left populated inside a group or
      // repeater is serialized to JSON as the row and never read back as a
      // reference.
      normalizeRelationshipFields(
        finalData,
        fields as unknown as FieldConfig[]
      );

      // Normalize upload field values (extract IDs from populated media objects)
      normalizeUploadFields(finalData, fields);

      // Every repeater row gets its saved id, as `shapeWriteParts` gives it:
      // after the field rules and the password pass have decided the value,
      // and before the field groups placed on the entry go to their tables.
      assignRepeaterRowIds(finalData, storedContainers, fields, reach);

      // Separate regular fields from many-to-many relations
      const manyToManyFields = fields.filter(
        f =>
          f.type === "relationship" &&
          // Only UI-built manyToMany routes through a junction table.
          // Code-first `hasMany: true` is stored as a JSON array on the
          // parent column (see field-column-descriptor.ts kind="json")
          // and is serialized later in the same finalData pass.
          f.options?.relationType === "manyToMany"
      );
      const manyToManyData: Record<string, string[]> = {};

      manyToManyFields.forEach(field => {
        if (finalData[field.name] !== undefined) {
          manyToManyData[field.name] = Array.isArray(finalData[field.name])
            ? (finalData[field.name] as string[])
            : finalData[field.name] === null
              ? []
              : [finalData[field.name] as string];
          delete finalData[field.name];
        }
      });

      // Field-group values have no column on the main row. Left in place they
      // were dropped by the UPDATE without an error, so the row reported
      // success and the component table kept its old value.
      const componentFieldData = this.extractComponentFieldData(
        finalData,
        fields
      );

      // Before the localized split below. The upsert writes these straight
      // into an existing translation, so an unconverted value fails there
      // rather than on the main row, where the cause reads plainly.
      this.serializeJsonFieldValues(finalData, fields);
      this.serializeHasManyRelationships(finalData, fields);
      coerceDateFieldsToDate(finalData, fields);

      // Update using transaction context
      // IMPORTANT: Use UTC ISO string for updatedAt to ensure consistent timezone handling
      // The Direct-API batch worker writes status like any other field, so a
      // status transition here needs `publish`/`unpublish` the same as a single
      // update — a bulk update must not publish what a single update could not.
      // A trusted server write bypasses via overrideAccess.
      //
      // Classified against the status read UNDER the row lock (not the pre-lock
      // `existingEntry`), using authorization resolved once by the batch caller
      // before this shared transaction, so a concurrent writer cannot slip a
      // transition past the gate and no permission read runs inside the batch's
      // transaction.
      //
      // This fallback fires only for a direct caller-owned-tx write (the bulk
      // paths always pre-resolve and pass transitionAuth), so its reads run on
      // this transaction's connection rather than re-entering the pool.
      const resolvedAuth =
        params.transitionAuth ??
        (await this.transitionAuthorizationInTransaction(tx, {
          collectionName: params.collectionName,
          entryId,
          user: params.user,
          overrideAccess: params.overrideAccess,
          authenticatedScope: params.authenticatedScope,
          hasLifecycle: (collection as { status?: boolean }).status === true,
          namedStatus: finalData.status,
          judgedLifecycle: rowAllowed,
          filteredWrites,
        }));
      // The action this row's own gate already allowed stands as that answer:
      // its rule is not asked again with a chance to answer otherwise after
      // the row's hooks have run.
      const transitionAuth: TransitionAuthorization =
        rowAllowed === "publish"
          ? { ...resolvedAuth, publishDenied: null }
          : rowAllowed === "unpublish"
            ? { ...resolvedAuth, unpublishDenied: null }
            : resolvedAuth;
      const transitionDenied = await this.enforceTransitionUnderLock(tx, {
        tableName,
        entryId,
        nextStatus: finalData.status,
        isCreate: false,
        auth: transitionAuth,
      });
      if (transitionDenied) {
        return transitionDenied;
      }

      // Same rule as every other update seam. Read under the lock the transition gate above
      // already holds, so the prior status and stored marker are the committed ones, and only
      // when the write could publish at all — a content-only edit must not pay for the read.
      const nowForUpdate = new Date();
      let updateStamp: Date | undefined;
      if (
        (collection as { status?: boolean }).status === true &&
        finalData.status === "published"
      ) {
        const lockedForMarker = await tx.selectOne<Record<string, unknown>>(
          tableName,
          { where: this.whereEq("id", entryId), forUpdate: true }
        );
        updateStamp = resolveFirstPublishedStamp({
          hasStatus: true,
          previousStatus:
            typeof lockedForMarker?.status === "string"
              ? lockedForMarker.status
              : null,
          nextStatus: finalData.status,
          existingMarker: lockedForMarker?.first_published_at,
          now: nowForUpdate,
        });
      }

      // The same eligibility question the other two paths ask, through the same
      // predicate. Without it a bulk update publishes every held edit in the
      // batch, which is the widest form of the defect: one call, many documents.
      const {
        hold: storeAsWorkingDraft,
        componentSchemas: splitComponentSchemas,
        draftLocale,
      } = await this.resolveWorkingDraftHold({
        collection,
        fields,
        namedStatus: finalData.status,
        liveStatus: existingEntry.status,
        // Inside the caller-owned transaction.
        executor: tx.getDrizzle(),
      });

      // The same split the single-entry update performs, for the same reason
      // the create path above needs one: a localized collection's translatable
      // values belong in the companion row, and the migrated main table has no
      // columns for them. Skipped for a held edit, which writes no live row at
      // all. No locale is named on this path, so it is the default language's.
      const localizedUpdate = storeAsWorkingDraft
        ? null
        : await this.splitLocalizedWriteData(
            params.collectionName,
            finalData,
            undefined,
            false,
            tx.getDrizzle()
          );

      // This locale's committed status, and its translations, as they stand
      // BEFORE anything is written. Both describe the prior state, so both have
      // to be read before the write that replaces it — read afterwards they
      // would describe the result and silently agree with it.
      //
      // Read under the row lock the transition gate above already took, so the
      // values are the committed ones and a concurrent writer cannot slip
      // between the two.
      let previousCompanionStatus: string | null = null;
      const previousLocalizedValues = localizedUpdate
        ? await this.readCompanionLocalizedValues(
            tx,
            params.collectionName,
            entryId,
            localizedUpdate.writeLocale
          )
        : {};
      if (localizedUpdate?.hasStatus) {
        // Gated on `hasStatus`: companion `_status` exists only on collections
        // migrated for per-locale status, and querying it otherwise fails the
        // whole write.
        previousCompanionStatus = await this.readLocaleStatus(
          tx,
          localizedUpdate,
          entryId
        );
        // A write moves the published state in two places, and the gate must
        // fire if EITHER makes a transition the caller cannot make. The main
        // row was judged above; this judges the write locale's companion
        // `_status`, which the upsert below writes. Checking only the main row
        // misses the state a reconcile can leave — a draft `_status` under a
        // published entry — where the main-row reading is `published ->
        // published`, a no-op needing no grant, while the companion write
        // publishes the translation.
        const companionDenied = this.denyIfTransitionUngranted(
          previousCompanionStatus,
          localizedUpdate.companionData._status,
          transitionAuth
        );
        // Before the UPDATE, so a denial leaves nothing written for this row.
        if (companionDenied) return companionDenied;
      }

      // A publish here writes the caller's fields onto the stored row, and
      // promotes no working draft, so the stored row is what goes live: judged
      // as it goes live, under the row lock taken above, on the document the
      // hooks finally left. No locale is named on this path, so the language
      // is the default one, whose own status lives in the companion where the
      // collection keeps status per language.
      const alreadyLive =
        existingEntry.status === "published" &&
        (localizedUpdate?.hasStatus !== true ||
          previousCompanionStatus === "published");
      if (publishes && !alreadyLive) {
        const goingLive = await this.storedDocumentGoingLive({
          row: existingEntry,
          // The locale split moved the translatable values out of the patch.
          patch: {
            ...finalData,
            ...localizedUpdate?.localizedFieldValues,
          },
          fields,
          collectionName: params.collectionName,
          entryId,
          locale: this.localization?.defaultLocale,
          // Read for this entry alone, under the lock taken above.
          tx,
          relations: {
            tableName,
            manyToManyFields,
            componentFieldData,
            manyToManyData,
            componentSchemas: null,
          },
        });
        await this.assertEntryValid({
          data: goingLive,
          fields,
          collectionName: params.collectionName,
          mode: "update",
          user: params.user,
          reader: params,
          // The document mixes the row's own content with this write's: only
          // what the caller named — the patch, the component and relation
          // values lifted out of it, the write locale's split values — is
          // this write's to judge; everything else it carries is the row's,
          // and a legacy stored fraction under it rides as stored.
          storedProvenancePaths: this.rowOwnedPathsOf(
            goingLive,
            new Set([
              ...Object.keys(finalData),
              ...Object.keys(localizedUpdate?.localizedFieldValues ?? {}),
              ...Object.keys(componentFieldData),
              ...Object.keys(manyToManyData),
            ])
          ),
          id: entryId,
          tx,
          goesLive: true,
          batch: params.goingLiveBatch,
        });
      }

      // Where this language's publication state lives, before and after this
      // write. On a collection that keeps status per language the companion row
      // owns it, so BOTH readings have to come from there: what it held, and
      // what this write leaves it holding — the value the patch set, or the one
      // already there when the patch named no status.
      //
      // Taking one from the companion and the other from the main row reports a
      // move no statement performed. A patch changing only translated content,
      // under an entry whose main row is published while this translation is
      // still a draft, would read `draft -> published` and announce
      // `entry.published` for a translation nothing published.
      const perLocaleStatus = localizedUpdate?.hasStatus === true;
      // Whether a companion row is written at all decides whether this locale
      // ends the write with a status of its own: a patch naming only shared
      // fields writes none, and the locale keeps having none.
      const writesCompanionRow =
        !!localizedUpdate &&
        Object.keys(localizedUpdate.companionData).length > 0;
      const localeStatusAfter = perLocaleStatus
        ? resolveEffectiveLocaleStatus({
            hasStatus: true,
            writesCompanionRow,
            requestedStatus: localizedUpdate.companionData._status,
            committedStatus: previousCompanionStatus,
          })
        : null;

      // The language's version, by this item's first write of its row, ahead
      // of the main row's write: a stale item is answered with nothing of it
      // written. Only when the row is written, so no empty translation row is
      // left behind.
      const languageJudged =
        localizedUpdate && writesCompanionRow
          ? await this.judgeLanguageInTransaction(
              tx,
              params,
              versionCheck,
              entryId,
              {
                table: tableName,
                languagesTable: localizedUpdate.companionTableName,
                written: localizedUpdate.writeLocale,
              }
            )
          : { stale: false, claimed: false };
      if ("success" in languageJudged) return languageJudged;

      // Skip the live-row UPDATE for a held edit; the pending change is stored
      // below instead.
      const [updated] = storeAsWorkingDraft
        ? [existingEntry]
        : await tx.update<unknown>(
            tableName,
            {
              ...stripImmutableSystemFields(
                finalData,
                "collection",
                tableName,
                fields
              ),
              // The SQL name: a dynamic table keys its system columns by it,
              // and the adapter-built update refuses a key that names no
              // column rather than dropping it.
              updated_at: nowForUpdate,
              ...(updateStamp ? { first_published_at: updateStamp } : {}),
              // As on the single-entry update: the document's counter moves
              // unless this save changed translated fields alone.
              ...mainRowBump(
                {
                  updatePayload: stripImmutableSystemFields(
                    finalData,
                    "collection",
                    tableName,
                    fields
                  ),
                  componentFieldData,
                  manyToManyData,
                },
                actorForWrite(params.actor, params.user),
                updateTimeOf(nowForUpdate)
              ),
            },
            this.whereEq("id", entryId),
            { returning: "*" }
          );
      rowWritten = true;

      if (!updated) {
        return {
          success: false,
          statusCode: 404,
          message: missingEntryMessage(entryId, options.identifyMissingEntry),
          data: null,
        };
      }

      // The translatable values, into the companion row for this write's
      // locale, on the same transaction. An upsert rather than an insert: the
      // parent already exists and may or may not have a row in this language.
      // Nothing is written when the patch touched no translatable field —
      // inventing a row there would claim a translation nobody made.
      if (
        localizedUpdate &&
        Object.keys(localizedUpdate.companionData).length > 0
      ) {
        // Write-integrity, as in the create path: the main row is already
        // written, and a soft per-item failure here would let the batch commit
        // a row whose translation never landed.
        try {
          await upsertCompanionRow(
            companionWriteVia(tx, this.dialect),
            localizedUpdate.companionTableName,
            entryId,
            localizedUpdate.writeLocale,
            localizedUpdate.companionData,
            undefined,
            {
              savedBy: actorForWrite(params.actor, params.user),
              revisionClaimed: languageJudged.claimed,
            }
          );
        } catch (error: unknown) {
          throw markWriteIntegrityFailure(error);
        }
      }

      // The write may not move the entry out of a filter that judged it.
      // In the caller's transaction a returned failure would leave the row
      // written, so the refusal aborts the transaction, as a write that
      // cannot stand does. Every filter is of this one collection, so the
      // first one's schema serves each.
      const [firstFilter] = filteredWrites;
      const movedOut =
        firstFilter &&
        (await this.refusalMovedOutOfWriteFilters(
          tx,
          firstFilter.schema,
          entryId,
          filteredWrites
        ));
      if (movedOut) {
        throw markWriteIntegrityFailure(errorFromServiceEnvelope(movedOut));
      }

      // The whole of this locale, not only what the patch named. A partial
      // translatable update carries just the changed values, and the main row
      // holds no translatable ones at all — so a snapshot built from those two
      // would record a document missing every field this write did not touch,
      // and a restore from it would drop them.
      //
      // Derived from the values read BEFORE the write rather than read back
      // after it. The upsert writes exactly the fields this write set, so the
      // row it leaves is the prior row overlaid with those values — which is
      // what this composes, field for field, without a second query. Deriving
      // it also means no read stands between the write and the commit: a
      // read-back that failed here would leave the main row already updated,
      // and a caller that tolerates per-item failures would commit it without
      // the version or the event that describe it. Keyed by field name.
      const localizedDocument = localizedUpdate
        ? {
            ...previousLocalizedValues,
            ...localizedUpdate.localizedFieldValues,
          }
        : {};
      for (const [field, value] of Object.entries(localizedDocument)) {
        if (field === "id") continue;
        (updated as Record<string, unknown>)[field] = value;
      }
      // Whether this write put anything into one language in particular, named
      // once because both the version and the events ask it.
      //
      // A status-only write looks like it should need a second clause and does
      // not: `readCompanionLocalizedValues` resolves an absent translation to
      // `null` rather than omitting it, so this map carries an entry for every
      // localized field whenever there is a companion at all — including for a
      // locale with no row yet. Adding `|| a status was written` would be
      // unreachable.
      const capturedLocaleState = Object.keys(localizedDocument).length > 0;
      // The status the MAIN row now holds, read before the overlay below
      // replaces it. The main row and a translation can move independently, so
      // the two transitions are recorded separately and each needs its own
      // pair of endpoints.
      const mainStatusAfter = (updated as { status?: unknown }).status as
        | string
        | undefined;

      // And this language's own status, for the same reason its values are
      // overlaid: what is recorded describes one translation, and the main
      // row's status describes the entry. Without it the snapshot and the
      // event report a translation as published while its companion row still
      // reads draft.
      if (typeof localeStatusAfter === "string") {
        (updated as Record<string, unknown>).status = localeStatusAfter;
      }

      // The row as it stood before this write, in the language this write
      // describes. The main row carries no translatable values and, for a
      // per-locale status, no current status either — both live in the
      // companion — so `existingEntry` alone describes the prior state of a
      // localized entry only in the fields that are not translated. Everything
      // below that reports on the PREVIOUS state reads this rather than the
      // main row: what a receiver is told changed, and which URL stops being
      // valid, are both claims about the translation.
      const previousEntry: Record<string, unknown> = {
        ...existingEntry,
        ...previousLocalizedValues,
        ...(previousCompanionStatus !== null
          ? { status: previousCompanionStatus }
          : {}),
      };

      // Compute the intent from the updated row and the pre-update row, before
      // the after-hooks run or redaction can strip the slug. The previous slug
      // lets a batch rename bust the old slug tag too — taken from the prior
      // translation, since a localized `slug` lives in the companion and the
      // main row's copy would leave the old URL cached.
      revalidationIntent = buildEntryRevalidationIntent(
        params.collectionName,
        readRevalidateConfig(collection),
        {
          id: entryId,
          slug: readStringField(updated as Record<string, unknown>, "slug"),
          previousSlug: readStringField(previousEntry, "slug"),
          // The language this write describes, so the locale-specific tag is
          // busted rather than only the unqualified one.
          ...(localizedUpdate?.writeLocale
            ? { locale: localizedUpdate.writeLocale }
            : {}),
        }
      );

      const versionsConfig = (collection as Record<string, unknown>)
        .versions as ResolvedVersionsConfig | null | undefined;
      // Skip the per-field component/m2m reads when neither a version nor an
      // event will consume them (versioning off AND recording disabled by
      // config). Gated on `isRecordingDisabledByConfig` — the SAME config-stable
      // decision the webhook field-tree uses — so the relations and the stripped
      // field tree are always assembled together: a decision that can flip
      // mid-write (a stored opt-out or endpoint activation) never leaves a
      // recorded event with a parent-only payload.
      // The activity trail consumes these documents too, and it is NOT gated on
      // webhook recording — so an opted-out collection whose update will be
      // recorded still has to assemble its relations. Without this a
      // relationship-only edit reaches the diff as two identical parent rows and
      // is filed as an update that changed nothing.
      const recordsActivity = willRecordMutationActivity(
        params.collectionName,
        actorForWrite(params.actor, params.user)
      );
      // An in-transaction handler is handed the whole document and the one
      // before it, as on the update that opens its own transaction. Asked
      // once: the same set decides the assembly here and runs below.
      const inTransactionHandlers = this.inTransactionHandlersFor(
        params.collectionName
      );
      const handsInTransaction = inTransactionHandlers.length > 0;
      const needsRelations =
        !!versionsConfig?.enabled ||
        recordsActivity ||
        handsInTransaction ||
        !isRecordingDisabledByConfig("collection", params.collectionName);
      // The `previous` document is carried by the outbox event and by the
      // trail's changed-field names, never by the version snapshot: a
      // version-only update that records neither still skips it instead of
      // paying a second full relational walk whose result is discarded.
      const previousNeedsRelations =
        recordsActivity ||
        handsInTransaction ||
        !isRecordingDisabledByConfig("collection", params.collectionName);

      // Assemble the `previous` document BEFORE the junction rows are rewritten,
      // so a relationship-only update still lists the changed field: reading m2m
      // after the delete+insert below would report the new ids as the old ones.
      // The pre-update parent row plus its current (pre-rewrite) relations on `tx`.
      const { documentParts: previousParts, document: previousDocument } =
        await this.readTxDocumentParts(tx, {
          collectionName: params.collectionName,
          tableName,
          entryId,
          parentRow: this.readShapeEventDocument(
            previousEntry,
            fields,
            tableName,
            await this.passwordReach(fields, tx.getDrizzle())
          ),
          fields,
          manyToManyFields,
          // A held edit needs the live relations regardless of what is being
          // recorded: they are the base the pending change accumulates onto.
          needsRelations: previousNeedsRelations || storeAsWorkingDraft,
        });

      // Store the pending edit rather than the live row, through the same
      // method the other two paths use.
      let workingDraftDocument: Record<string, unknown> | undefined;
      // The draft this save accumulated onto, if any: what the after-hooks
      // compare against, as on the single-entry update.
      let priorWorkingDraftDocument: Record<string, unknown> | undefined;
      if (storeAsWorkingDraft) {
        const draftWrite = await this.storeWorkingDraftInTx(tx, {
          collection,
          tableName,
          collectionHasStatus:
            (collection as { status?: boolean }).status === true,
          componentFieldData,
          draftLocale: draftLocale,
          translatedKeys: Object.keys(
            localizedUpdate?.localizedFieldValues ?? {}
          ),
          fields,
          manyToManyData,
          params: {
            collectionName: params.collectionName,
            entryId,
            user: params.user,
            actor: params.actor,
            overrideAccess: params.overrideAccess,
            authenticatedScope: params.authenticatedScope,
          },
          parentRow: this.readShapeEventDocument(
            {
              ...existingEntry,
              ...stripImmutableSystemFields(
                finalData,
                "collection",
                tableName,
                fields
              ),
            },
            fields,
            tableName,
            await this.passwordReach(fields, tx.getDrizzle())
          ),
          liveParentRow: this.readShapeEventDocument(
            existingEntry,
            fields,
            tableName,
            await this.passwordReach(fields, tx.getDrizzle())
          ),
          snapshotComponents: previousParts.components,
          snapshotM2M: previousParts.manyToMany,
          splitComponentSchemas: splitComponentSchemas,
          updatePayload: finalData,
          updateFilters: filteredWrites.filter(
            check => check.params.operation === "update"
          ),
        });
        // In the caller's transaction a returned failure would leave what the
        // write did so far, so the refusal aborts it.
        if (draftWrite.refusedBy) {
          throw markWriteIntegrityFailure(
            errorFromServiceEnvelope(
              await this.accessService.refusalOutsideFilter(
                draftWrite.refusedBy.params,
                draftWrite.refusedBy.reads,
                true
              )
            )
          );
        }
        workingDraftDocument = draftWrite.workingDraftDocument;
        priorWorkingDraftDocument = draftWrite.priorWorkingDraftDocument;
      }

      // Handle many-to-many relationships on the caller's transaction so the
      // junction writes commit atomically with the update.
      const txExecutor = tx.getDrizzle<RelationshipDbExecutor>();
      for (const field of manyToManyFields) {
        // Skipped for a held edit: junction rows are live content.
        if (!storeAsWorkingDraft && manyToManyData[field.name] !== undefined) {
          // Delete existing relations
          await this.relationshipService.deleteManyToManyRelations(
            params.collectionName,
            entryId,
            field,
            txExecutor
          );

          // Insert new relations
          const relatedIds = manyToManyData[field.name];
          if (relatedIds.length > 0) {
            await this.relationshipService.insertManyToManyRelations(
              params.collectionName,
              entryId,
              field,
              relatedIds,
              txExecutor
            );
          }
        }
      }

      // Component rows are live content like the junction rows above, so a
      // held edit keeps them in the draft (stored above) rather than here.
      if (!storeAsWorkingDraft) {
        // Which component values a publish carries are the row's own: only
        // those a denied rule kept from storage ride exempt from the
        // whole-number floor, as the gate judged the assembled document. The
        // caller's own are judged like any write's, for the entry gate judged
        // the document that goes live, not this write's patch alone. What a
        // hook left DIFFERENT from the row's own snapshot is this write's
        // production, judged like the container walk judges one — the value
        // the hook changed, never the stored children it did not.
        const callerComponents: Record<string, unknown> = {};
        const restoredComponents: Record<string, unknown> = {};
        const restoredHookIssues: ValidationIssue[] = [];
        for (const name of Object.keys(componentFieldData)) {
          if (publishes && !alreadyLive && storedPaths.has(name)) {
            restoredComponents[name] = componentFieldData[name];
            if (
              !isDeepStrictEqual(
                componentFieldData[name],
                storedValues.get(name)
              )
            ) {
              const field = fields.find(candidate => candidate.name === name);
              if (field) {
                restoredHookIssues.push(
                  ...hookChangedWholeNumberIssues(
                    { [name]: componentFieldData[name] },
                    [field] as ValidatableField[],
                    "",
                    await containedComponentResolver(
                      fields as unknown as FieldConfig[],
                      async componentSlug =>
                        (await this.fieldGroupDataService?.getComponentFields(
                          componentSlug,
                          tx.getDrizzle()
                        )) ?? null,
                      true
                    ),
                    storedPaths,
                    storedValues
                  )
                );
              }
            }
          } else {
            callerComponents[name] = componentFieldData[name];
          }
        }
        if (restoredHookIssues.length > 0) {
          throw NextlyError.validation({ errors: restoredHookIssues });
        }
        const componentSave = {
          parentId: entryId,
          tableName,
          fields,
          user: params.user,
          access: this.fieldGroupAccess(params),
          write: this.validationWrite(
            params.collectionName,
            entryId,
            tx,
            localizedUpdate?.writeLocale,
            // The payload as sent, with what the write lifted out of it put back.
            this.writtenPayload(
              finalData,
              [manyToManyData, componentFieldData],
              localizedUpdate
            )
          ),
        };
        await this.saveComponentFieldDataInTx(tx, {
          ...componentSave,
          data: callerComponents,
        });
        if (Object.keys(restoredComponents).length > 0) {
          await this.saveComponentFieldDataInTx(tx, {
            ...componentSave,
            data: restoredComponents,
            // The row's own content, carried by the assembled document the
            // gate judged: a legacy stored fraction under it is the row's.
            assembledFromStorage: true,
          });
        }
        // Which media items the entry uses now, from what this update stored.
        // A held edit stored nothing, so it changes nothing here either.
        await this.recordEntryMediaUsage(tx, {
          collectionName: params.collectionName,
          entryId,
          tableName,
          fields,
        });
      }

      // Record a durable version snapshot and the outbox event on the caller's
      // transaction so a batch update (updateEntries) is captured AND observable.
      // Recording and capture are NOT hooks, so they run even under `skipHooks`;
      // both are built from ONE post-rewrite relations read (parent row plus its
      // component subtrees and m2m id arrays on `tx`), shared by the version and
      // the event so both carry the same complete document, and recorded on `tx`
      // so they commit with the update and never survive a rollback. A
      // status-lifecycle transition also emits its publish/unpublish/
      // status_changed event, gated on the collection's Draft/Published flag.
      const { documentParts: updatedParts, document: updatedDocument } =
        await this.readTxDocumentParts(tx, {
          collectionName: params.collectionName,
          tableName,
          entryId,
          parentRow: this.readShapeEventDocument(
            updated as Record<string, unknown>,
            fields,
            tableName,
            await this.passwordReach(fields, tx.getDrizzle())
          ),
          fields,
          manyToManyFields,
          needsRelations,
        });
      // The version this update produced, which its status moves name below.
      let producedVersionNo: number | null = null;
      // A held edit records no durable version: nothing was published.
      if (!storeAsWorkingDraft) {
        const localeTag = capturedLocaleState
          ? localizedUpdate?.writeLocale
          : undefined;
        const savedStatus = (updated as { status?: unknown }).status;
        const versionNo = await this.captureTxVersion(tx, {
          onlyIfChanged: true,
          lifecycle: hasLifecycle(collection),
          collectionName: params.collectionName,
          entryId,
          contentStatus: savedStatus,
          createdBy: params.user?.id ?? null,
          versionsConfig,
          documentParts: updatedParts,
          fields,
          // The snapshot carries this locale's translatable values, so the
          // version is tagged with it. Untagged, history reads the snapshot as
          // shared and a restore drops every per-locale field — or refuses,
          // on a collection where they all are.
          localeTag,
        });
        producedVersionNo = versionNo;
        await this.recordSaveHistory(
          tx,
          params.collectionName,
          entryId,
          {
            actor: actorForWrite(params.actor, params.user),
            personName: params.user?.name ?? null,
            locale: localeTag ?? null,
            toState: typeof savedStatus === "string" ? savedStatus : null,
            versionNo,
          },
          // Written in place: every language shows the shared values it wrote.
          this.translatedFieldsOf(collection, fields)
        );
      }
      const eventFields = await this.webhookFieldTreeIfRecording(
        params.collectionName,
        fields,
        tx.getDrizzle()
      );
      const eventActor = actorForWrite(params.actor, params.user);
      let eventRecorded = await recordMutationEvent(tx, {
        type: "entry.updated",
        resource: {
          kind: "entry",
          collection: params.collectionName,
          id: entryId,
          // The language this event describes. A receiver reads it from the
          // resource alone, so a localized write that omits it is delivered as
          // belonging to no translation in particular. A write that moved only
          // this locale's STATUS counts: it carries no field value, and
          // counting field values alone would leave it unattributed.
          ...(capturedLocaleState && localizedUpdate?.writeLocale
            ? { locale: localizedUpdate.writeLocale }
            : {}),
        },
        data: updatedDocument,
        previous: previousDocument,
        fields: eventFields,
        actor: eventActor,
        // Whether this write published the entry, for the trail. This path
        // promotes no working draft, so the facts are the status the row is
        // left in and whether it was live before, as the lock read it.
        publication: {
          statusAfter:
            (collection as { status?: boolean }).status === true
              ? (finalData.status as string | null | undefined)
              : undefined,
          statusBefore: alreadyLive
            ? "published"
            : existingEntry.status !== "published"
              ? (existingEntry.status as string | null | undefined)
              : previousCompanionStatus,
        },
      });
      if ((collection as { status?: boolean }).status === true) {
        // A write can move the published state in two places that move
        // independently, so each is recorded on its own terms — the same
        // routing the single-entry update performs. Collapsing them into one
        // event gets a case wrong in each direction: a content-only patch on a
        // draft translation under a published entry announces a publication
        // nothing performed, and a patch that really does publish the main row
        // while the default translation was already published announces
        // nothing at all.
        const mainFrom = readStringField(existingEntry, "status") ?? null;
        const companionStatusWritten =
          typeof localizedUpdate?.companionData._status === "string";
        const companionNext = companionStatusWritten
          ? (localizedUpdate.companionData._status as string)
          : undefined;
        // The default locale's status lives on BOTH the main row and its
        // companion, so an ordinary default-locale write records the same
        // transition twice. Suppress the main-row event only when the
        // companion write encodes that identical move — same from AND same to.
        const companionEncodesMainTransition =
          companionStatusWritten &&
          previousCompanionStatus === mainFrom &&
          companionNext === mainStatusAfter;

        if (!companionEncodesMainTransition) {
          // Described in main-row terms: the documents carry this locale's
          // status overlaid, which is the other transition, not this one.
          const mainStatusRecorded = await this.recordStatusEvents(tx, {
            collection: params.collectionName,
            id: entryId,
            from: mainFrom,
            to: mainStatusAfter,
            isCreate: false,
            data:
              mainStatusAfter !== undefined
                ? { ...updatedDocument, status: mainStatusAfter }
                : updatedDocument,
            previous:
              previousDocument !== null
                ? { ...previousDocument, status: mainFrom }
                : previousDocument,
            fields: eventFields,
            actor: eventActor,
          });
          eventRecorded = eventRecorded || mainStatusRecorded;
        }

        if (companionStatusWritten) {
          // This translation's own move, tagged with the language it describes.
          const localeStatusRecorded = await this.recordStatusEvents(tx, {
            collection: params.collectionName,
            id: entryId,
            locale: localizedUpdate?.writeLocale,
            from: previousCompanionStatus,
            to: companionNext,
            isCreate: false,
            data: updatedDocument,
            previous: previousDocument,
            fields: eventFields,
            actor: eventActor,
          });
          eventRecorded = eventRecorded || localeStatusRecorded;
        }
        // The same moves in the document's history, one event per kind.
        await this.recordTransitionHistory(
          tx,
          params.collectionName,
          entryId,
          {
            actor: eventActor,
            personName: params.user?.name ?? null,
            versionNo: producedVersionNo,
          },
          [
            ...(companionEncodesMainTransition
              ? []
              : [{ from: mainFrom, to: mainStatusAfter }]),
            ...(companionStatusWritten
              ? [
                  {
                    locale: localizedUpdate?.writeLocale,
                    from: previousCompanionStatus,
                    to: companionNext,
                  },
                ]
              : []),
          ]
        );
      }

      // On the caller's transaction, so a batch that cannot record an
      // overwrite keeps nothing of it.
      await this.recordOverwriteIfAsked(
        tx,
        versionCheck,
        {
          collection: params.collectionName,
          id: entryId,
          actor: params.actor,
          user: params.user,
        },
        {
          main: mainJudged.before,
          language: languageJudged.before,
          locale: localizedUpdate?.writeLocale,
        }
      );

      // What this update wrote, as the single-entry update reports it: a held
      // edit leaves the live row unchanged, so the hooks, the field hooks and
      // the response get the pending draft, marked before the hooks run. A
      // draft keeps `status` at the live parent's value, so without the marker
      // a hook could not tell a draft save from a publish.
      const written = (workingDraftDocument ?? updated) as Record<
        string,
        unknown
      >;
      if (workingDraftDocument) {
        written._isWorkingDraft = true;
      }

      // Last of the write itself, on the caller's transaction, handed the
      // documents the outbox event carries; see the create path.
      await this.runInTransactionPhase(tx, inTransactionHandlers, {
        collection: params.collectionName,
        operation: "update",
        id: entryId,
        data: writtenByUpdate(updatedDocument, workingDraftDocument),
        originalData: replacedByUpdate(
          previousDocument,
          priorWorkingDraftDocument
        ),
        user: params.user,
        context: sharedContext,
      });

      // The collection event, held for the caller's commit, as on create.
      // Skipped for a held draft edit, which leaves the live row unchanged, as
      // a write that opens its own transaction skips it.
      if (!workingDraftDocument) {
        await this.announceAtCommit(
          "updated",
          params.collectionName,
          updated as Record<string, unknown>,
          params.user
        );
      }

      // Execute afterUpdate hooks (unless skipped)
      if (options.runHooks) {
        // Execute afterUpdate hooks (code-registered)
        const afterContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "update" as const,
          data: written,
          // A repeat draft save compares against the prior draft, not the
          // unchanged live row, so an earlier save's edits are not reported
          // as changing again.
          originalData: priorWorkingDraftDocument
            ? markedDraft(priorWorkingDraftDocument)
            : existingEntry,
          user: params.user,
          context: sharedContext,
          // Bind an after-hook that reads via context.executor to the caller's
          // transaction connection so it does not re-enter the pool from the tx.
          executor: tx.getDrizzle(),
          req: requestFacts,
        });

        await this.hookService.hookRegistry.execute(
          "afterUpdate",
          afterContext
        );

        // Execute stored afterUpdate hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "afterUpdate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext({
            collection: params.collectionName,
            operation: "update",
            data: written,
            queryDatabase: this.queryDatabaseFn,
            user: params.user,
            sharedContext,
            req: requestFacts,
            // Bind a stored hook's uniqueness read to the caller's transaction
            // connection so it does not re-enter the pool from inside the tx.
            executor: tx.getDrizzle(),
          })
        );
      }

      // Stored password hashes are write-only; the response never carries
      // them back to the client.
      // Field-level afterChange hooks observe the saved values (before the
      // password strip so they can see the full stored row).
      if (options.runHooks) {
        // The whole language is on this row, because the snapshot and the
        // events describe a translation rather than the one field of it that
        // moved. Only the fields this write actually touched should have
        // their handlers run, though: firing `afterChange` for a sibling
        // nobody edited sends mail, re-indexes and calls out for an unchanged
        // value.
        //
        // Named rather than withheld. Removing the untouched keys from the row
        // would suppress those handlers and also blind the ones that DO run —
        // a `title` hook that derives a search document from `metaTitle` needs
        // to read it, unchanged or not.
        const touched = localizedUpdate
          ? new Set([
              ...Object.keys(finalData),
              ...Object.keys(localizedUpdate.localizedFieldValues),
            ])
          : undefined;
        await runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "afterChange",
          data: written,
          operation: "update",
          user: params.user,
          only: touched,
        });
      }

      // A held edit answers with the pending document, not the live row, so
      // that is the document redacted: it carries the edited values, field
      // groups included, which the live row does not.
      const response = written;
      await this.redactResponseFields(
        response,
        fields,
        {
          user: params.user,
          overrideAccess: params.overrideAccess,
          routeAuthorized: params.routeAuthorized,
          authenticatedScope: params.authenticatedScope,
        },
        params.collectionName,
        tableName,
        // Still inside the caller-owned transaction.
        tx.getDrizzle()
      );
      // Read on the caller's transaction, where this save is visible and no
      // later one can be.
      setDocumentVersion(
        response,
        await documentVersionOn(tx, {
          dialect: this.dialect,
          table: tableName,
          id: entryId,
          // From the collection, not from this write: a held edit writes no
          // translation row, yet the version a read gives names its language.
          languagesTable: await this.translationTableOnTx(
            tx,
            collection,
            tableName
          ),
          localization: this.localization,
          locale: localizedUpdate?.writeLocale,
        })
      );

      return {
        success: true,
        statusCode: 200,
        message: "Entry updated successfully",
        data: response,
        eventRecorded,
        revalidationIntent,
      };
    } catch (error: unknown) {
      // Carry the intent (set only once the row was updated) so a committed item
      // whose after-hook then threw still busts its tags via the batch caller.
      // Pass dialect explicitly so the helper can normalise raw driver errors.
      // A post-write capture/recording failure was marked to abort the whole
      // batch transaction; re-throw it rather than reporting a soft success:false
      // that the bulk loop would continue past, committing an unversioned row.
      if (isWriteIntegrityFailure(error)) throw error;
      return {
        ...errorToServiceResult(
          // A write the database is not migrated for answers as such, judged
          // from the row read before the failed statement.
          await asNotMigrated(
            error,
            collectionRowNotMigrated(params.collectionName, writeRow, {
              trusted: fieldTrustOf(params),
            }),
            { written: rowWritten }
          ),
          { defaultMessage: options.failureMessage },
          this.dialect
        ),
        revalidationIntent,
      };
    }
  }

  /**
   * Delete an entry inside a transaction the caller owns.
   *
   * @param tx - Transaction context from adapter
   * @param params - Collection name, entry ID, and optional user context
   * @returns Deletion result or error
   */
  async deleteEntryInTransaction(
    tx: TransactionContext,
    params: {
      collectionName: string;
      entryId: string;
      user?: UserContext;
      /** Trusted server work; see {@link DeleteEntryWriteParams}. */
      overrideAccess?: boolean;
      /** The caller's own grants; see {@link DeleteEntryWriteParams}. */
      authenticatedScope?: AuthenticatedScope;
      /** Who performed the delete, recorded on the outbox event. */
      actor?: RequestActor;
    }
  ): Promise<CollectionServiceResult<{ deleted: boolean }>> {
    // The scope this write runs under becomes the ambient one for the whole
    // operation, not an argument handed to its first gate.
    //
    // A write passes several: the coarse collection check and the field-level
    // write and redaction passes. Only the first took an
    // `authenticatedScope` argument, so a caller that NARROWED its scope was
    // held to it once and judged on the request's original scope everywhere
    // after — a key that kept its write grant but surrendered a field grant
    // still wrote that field. Pinning covers every gate below, including the
    // ones added next.
    return runWithCallerScope(params.authenticatedScope, () =>
      this.deleteEntryWrite(tx, params, params.entryId, {
        rowGate: "access-service",
        runHooks: true,
        identifyMissingEntry: false,
        failureMessage: "Failed to delete entry in transaction",
      })
    );
  }

  /**
   * The one delete implementation. Both transaction entry points delegate here.
   *
   * `options` carries the only things that legitimately differ between them —
   * see `DeleteEntryWriteOptions`.
   */
  // Replaces deleteEntryInTransaction (cyclomatic 18) and
  // deleteSingleEntryInTransaction (27). One implementation at 33 carries both
  // row-gate shapes; it drops back under the threshold when the two gates
  // become one, which needs a deliberate decision about which of their
  // overrideAccess and API-key-scope behaviours is correct.
  // fallow-ignore-next-line complexity
  private async deleteEntryWrite(
    tx: TransactionContext,
    params: DeleteEntryWriteParams,
    entryId: string,
    options: DeleteEntryWriteOptions
  ): Promise<CollectionServiceResult<{ deleted: boolean }>> {
    // Refused first when the collection is removed from code; see createEntryWrite.
    await refuseWriteIfRemovedFromCode("collection", params.collectionName, {
      executor: tx.getDrizzle(),
    });
    // True only in the window between the row delete and the outbox insert: a
    // failure there has left this shared transaction with a delete but no event,
    // so the catch re-throws to force a rollback. Cleared once the event is
    // recorded — a later failure (e.g. an afterDelete hook) is a per-item
    // side-effect issue, not an eventless delete, and must NOT roll the batch back.
    let deleteNeedsRollback = false;
    // Set once the event is appended to the shared transaction; the batch caller
    // reads it back and applies it only after the transaction commits.
    let eventRecorded = false;
    // The tags this delete invalidates; the batch caller collects it per item and
    // flushes them together after the shared transaction commits.
    let revalidationIntent: RevalidationIntent | undefined;
    // The registry row this write read, kept for the catch: a failed statement
    // can leave the transaction unable to read it again (PostgreSQL aborts it).
    let writeRow: Record<string, unknown> | undefined;
    // Whether this write's row was written, set on the line after the statement
    // that writes it: a failure from then on is answered as it was, never as a
    // database to migrate, whose remedy (send it again) would repeat it.
    let rowWritten = false;
    try {
      // Get collection metadata early. Runs on the caller's transaction
      // connection so this read does not re-enter the pool from inside the
      // transaction (which can stall against a small pool).
      const collection = await this.collectionService.getCollection(
        params.collectionName,
        tx.getDrizzle()
      );
      writeRow = collection as Record<string, unknown>;

      const tableName = collectionTableName(collection, params.collectionName);

      // No owner predicate: delete access is decided for the collection rather
      // than per row, so the fetch is by id alone.
      const fetchWhere = this.whereEq("id", entryId);

      // Fetch entry first (needed for owner checks and hooks)
      const entry = await tx.selectOne<Record<string, unknown>>(tableName, {
        where: fetchWhere,
      });

      if (!entry) {
        return {
          success: false,
          statusCode: 404,
          message: missingEntryMessage(entryId, options.identifyMissingEntry),
          data: null,
        };
      }

      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      if (options.rowGate === "batch-hoisted") {
        // Nothing to re-check per row: the batch caller hoists the
        // collection-level delete gate out of its loop, and its rule answered
        // no filter to match the row against.
      } else {
        // The transaction API asks the access service for the whole verdict,
        // with the caller's `overrideAccess` as the create and update paths
        // forward it. Without it, trusted work naming no user was judged as
        // an anonymous visitor, whose write needs a rule that allows it.
        const accessParams = {
          collectionName: params.collectionName,
          operation: "delete" as const,
          // The one entry it deletes, so a caller who may not read it is
          // answered as if it were missing, as the ordinary delete answers.
          entryId,
          user: params.user,
          overrideAccess: params.overrideAccess,
          // The key the delete is made with, so its own grant is judged.
          authenticatedScope: params.authenticatedScope,
          executor: tx.getDrizzle(),
        };
        // A batch asked its gate before its transaction opened and hands each
        // row its answers; anything else asks here. Asked, or read, in each
        // language the entry holds, before any hook runs.
        const refused = await this.deleteRowRefusalInTransaction(tx, {
          tableName,
          entryId,
          fields: (collection.schemaDefinition?.fields ||
            collection.fields ||
            []) as FieldConfig[],
          accessParams,
          rowGate: options.rowGate,
        });
        if (refused) {
          return asMissingItem(
            refused as CollectionServiceResult<{ deleted: boolean }>,
            entryId,
            options.identifyMissingEntry
          );
        }
      }

      // Shared context between all hooks in this request
      // Seeded from the caller, like the non-transactional pipelines. An
      // empty literal here meant a hook context reached every write EXCEPT
      // one made inside a transaction, which is the least obvious place for
      // a flag such as recursion suppression to stop working.
      const sharedContext: Record<string, unknown> = { ...params.context };
      // Resolved once for the whole operation, so every hook phase is told the
      // same thing about the caller and none of them re-reads a header.
      const requestFacts = resolveRequestFacts(params.request);

      // Execute hooks (unless skipped)
      if (options.runHooks) {
        // Execute beforeOperation hooks FIRST (before operation-specific hooks)
        // Can modify operation arguments (id) or throw to abort
        await this.hookService.hookRegistry.executeBeforeOperation({
          collection: params.collectionName,
          operation: "delete",
          args: { id: entryId },
          user: params.user
            ? { id: params.user.id, email: params.user.email }
            : undefined,
          context: sharedContext,
          req: requestFacts,
          // Bind a beforeOperation hook that reads via context.executor to the
          // caller's transaction connection so it does not re-enter the pool.
          executor: tx.getDrizzle(),
        });

        // Note: For delete, we don't use modified id since we already fetched the entry
        // and checked access. The hook can throw to abort if needed.

        // Execute beforeDelete hooks (code-registered)
        const beforeContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "delete" as const,
          data: entry,
          user: params.user,
          context: sharedContext,
          // Bind a code beforeDelete hook that reads via context.executor to the
          // caller's transaction connection so it does not re-enter the pool.
          executor: tx.getDrizzle(),
          req: requestFacts,
        });

        await this.hookService.hookRegistry.execute(
          "beforeDelete",
          beforeContext
        );

        // Execute stored beforeDelete hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "beforeDelete",
          storedHooks,
          this.hookService.buildPrebuiltHookContext({
            collection: params.collectionName,
            operation: "delete",
            data: entry,
            queryDatabase: this.queryDatabaseFn,
            user: params.user,
            sharedContext,
            req: requestFacts,
            // Bind a stored hook's uniqueness read to the caller's transaction
            // connection so it does not re-enter the pool from inside the tx.
            executor: tx.getDrizzle(),
          })
        );
      }

      // The collection schema, two views: FieldConfig for the component cascade,
      // FieldDefinition for the outbox snapshot.
      const collectionFields = (collection.schemaDefinition?.fields ||
        collection.fields ||
        []) as FieldConfig[];
      const snapshotFields = (collection.schemaDefinition?.fields ||
        collection.fields ||
        []) as FieldDefinition[];

      // Lock and re-read the committed row before snapshotting it: `entry` above
      // was read before the hooks ran, so a concurrent update could otherwise
      // make the event describe values other than the row this delete removes.
      // The adapter no-ops the lock where row locking is unavailable (SQLite,
      // itself serialized).
      await tx.lockRow(tableName, entryId);
      const freshEntry = await tx.selectOne<Record<string, unknown>>(
        tableName,
        {
          where: this.whereEq("id", entryId),
        }
      );
      if (!freshEntry) {
        return {
          success: false,
          statusCode: 404,
          message: missingEntryMessage(entryId, options.identifyMissingEntry),
          data: null,
        };
      }

      // Assemble the removed document before the cascade removes its relations,
      // in the read shape create/update events use.
      const { document: deletedDocument, locale: deletedLocale } =
        await this.buildDeletedDocument(tx, {
          collectionName: params.collectionName,
          entryId,
          tableName,
          row: freshEntry,
          fields: snapshotFields,
          locale: this.localization?.defaultLocale,
        });
      // This runs inside the caller's transaction, so there is no safe place to
      // read every locale's companion slug: reading on the tx connection would
      // poison the transaction on error, and reading on the pool would re-enter
      // it and deadlock a saturated pool. The always-busted id tag clears every
      // locale's page (reads are id-tagged), so localized slug tags are omitted
      // on this path; the pool-owned deleteEntry path collects them pre-tx.

      // Cascade delete component data before deleting the main entry
      if (this.fieldGroupDataService) {
        await this.fieldGroupDataService.deleteComponentDataInTransaction(tx, {
          parentId: entryId,
          parentTable: tableName,
          fields: collectionFields,
        });
      }

      // Delete using transaction context
      const deletedCount = await tx.delete(
        tableName,
        this.whereEq("id", entryId)
      );
      rowWritten = deletedCount > 0;

      if (deletedCount === 0) {
        return {
          success: false,
          statusCode: 404,
          message: missingEntryMessage(entryId, options.identifyMissingEntry),
          data: null,
        };
      }
      deleteNeedsRollback = true;

      // Remove EVERY locale's pending working-draft sidecar for the deleted
      // same transaction, so a batch delete does not leave it unreachable in
      // nextly_versions after its row is gone. A no-op when none exists.
      await new VersionsRepository(tx).deleteAllWorkingDrafts({
        scopeKind: "collection",
        scopeSlug: params.collectionName,
        entryId,
      });

      // Recovery points go with it; see the single-delete path.
      await new VersionsRepository(tx).deleteAutosaves({
        scopeKind: "collection",
        scopeSlug: params.collectionName,
        entryId,
      });

      // Pins and markers go with it; see the single-delete path. The caller
      // owns this transaction, so the dashboard pins table's presence is asked
      // through it: on its own connection, never the pool, which on a pool of
      // one waits for the connection this transaction holds. A catalogue read,
      // it cannot fail the way a statement against a missing table would.
      await sweepDeletedDocument(
        tx,
        { scopeKind: "collection", scopeSlug: params.collectionName, entryId },
        {
          dashboardPinsPresent: await dashboardPinsPresent(
            this.adapter,
            undefined,
            transactionTableProbe(this.adapter, tx)
          ),
          mediaUsagePresent: await mediaUsageTablePresent(
            this.adapter,
            undefined,
            transactionTableProbe(this.adapter, tx)
          ),
        }
      );
      // Its review state goes too; see the single-delete path.
      await removeDeletedDocumentReviewStates(tx, {
        scopeKind: "collection",
        scopeSlug: params.collectionName,
        entryId,
      });

      // The document's last history event; see the single-delete path.
      await this.recordHistoryEvent(tx, params.collectionName, entryId, {
        kind: "deleted",
        actor: actorForWrite(params.actor, params.user),
        personName: params.user?.name ?? null,
      });

      // Append the outbox event in the same transaction so a batch delete
      // through this helper is observable too, in the same shape as the
      // single-delete path. Resolve component schemas on this transaction's
      // connection to avoid taking a second pooled connection. `locale` is set
      // only for a localized collection.
      const deleteRecorded = await recordMutationEvent(tx, {
        type: "entry.deleted",
        resource: {
          kind: "entry",
          collection: params.collectionName,
          id: entryId,
          ...(deletedLocale ? { locale: deletedLocale } : {}),
        },
        data: deletedDocument,
        previous: null,
        fields: await this.webhookFieldTreeIfRecording(
          params.collectionName,
          snapshotFields,
          tx.getDrizzle()
        ),
        actor: actorForWrite(params.actor, params.user),
      });
      // Last of the write itself, still inside the window whose failure is
      // thrown: a handler that refuses the delete keeps the entry.
      const inTransactionHandlers = this.inTransactionHandlersFor(
        params.collectionName
      );
      await this.runInTransactionPhase(tx, inTransactionHandlers, {
        collection: params.collectionName,
        operation: "delete",
        id: entryId,
        data: deletedDocument,
        user: params.user,
        context: sharedContext,
      });

      // The event is recorded, so the delete + event are now consistent; a later
      // failure no longer needs to force a rollback.
      deleteNeedsRollback = false;
      // False when the collection opted out — nothing to drain post-commit.
      eventRecorded = deleteRecorded;
      // The collection event, held for the caller's commit, as on create: the
      // row as it stood before the delete, which the after-hooks are handed.
      await this.announceAtCommit(
        "deleted",
        params.collectionName,
        entry,
        params.user
      );

      // The tags this delete invalidates, collected by the batch caller and
      // flushed once the shared transaction commits. Slug read from the assembled
      // document so a user-localized slug (in companion rows) still busts.
      revalidationIntent = buildEntryRevalidationIntent(
        params.collectionName,
        readRevalidateConfig(collection),
        {
          id: entryId,
          slug: readStringField(deletedDocument, "slug"),
          locale: deletedLocale,
        }
      );

      // Execute afterDelete hooks (unless skipped)
      if (options.runHooks) {
        // Execute afterDelete hooks (code-registered)
        const afterContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "delete" as const,
          data: entry,
          user: params.user,
          context: sharedContext,
          // Bind an after-hook that reads via context.executor to the caller's
          // transaction connection so it does not re-enter the pool from the tx.
          executor: tx.getDrizzle(),
          req: requestFacts,
        });

        await this.hookService.hookRegistry.execute(
          "afterDelete",
          afterContext
        );

        // Execute stored afterDelete hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "afterDelete",
          storedHooks,
          this.hookService.buildPrebuiltHookContext({
            collection: params.collectionName,
            operation: "delete",
            data: entry,
            queryDatabase: this.queryDatabaseFn,
            user: params.user,
            sharedContext,
            req: requestFacts,
            // Bind a stored hook's uniqueness read to the caller's transaction
            // connection so it does not re-enter the pool from inside the tx.
            executor: tx.getDrizzle(),
          })
        );
      }

      return {
        success: true,
        statusCode: 200,
        message: "Entry deleted successfully",
        data: { deleted: true },
        eventRecorded,
        revalidationIntent,
      };
    } catch (caught: unknown) {
      // Only a failure in the delete→event window propagates (to roll back an
      // eventless delete). Pre-delete failures and post-event failures (e.g. an
      // afterDelete hook) stay soft: the row is either untouched or already
      // consistent with its event, so a returned failure is safe.
      if (deleteNeedsRollback) throw caught;
      // A delete the database is not migrated for answers as such, judged from
      // the row read before the failed statement.
      const error = await asNotMigrated(
        caught,
        collectionRowNotMigrated(params.collectionName, writeRow, {
          trusted: fieldTrustOf(params),
        }),
        { written: rowWritten }
      );
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error ? error.message : options.failureMessage,
        data: null,
        // A typed error keeps its own status and code. Hardcoding 500 reported
        // a hook's refusal or rate limit as a server fault, and left a boundary
        // nothing to rebuild it from.
        ...errorEnvelopeFields(error),
        eventRecorded,
        revalidationIntent,
      };
    }
  }

  // ============================================================
  // Single-entry transaction helpers (used by CollectionBulkService)
  // ============================================================

  /**
   * Create one entry of a batch, on the batch's shared transaction.
   *
   * The batch services check collection access and resolve the publish
   * transition ONCE per batch, before the transaction opens, so this per-entry
   * path does neither — see `createEntryWrite`.
   *
   * @param skipHooks - Skip user hooks; a bulk-import option, not a fast path
   *   around validation, access or recording, none of which are hooks.
   */
  async createSingleEntryInTransaction(
    tx: TransactionContext,
    params: CreateEntryWriteParams,
    body: Record<string, unknown>,
    skipHooks: boolean
  ): Promise<CollectionServiceResult<unknown>> {
    return runWithCallerScope(params.authenticatedScope, () =>
      this.createEntryWrite(tx, params, body, {
        enforceCollectionAccess: false,
        runHooks: !skipHooks,
        shapeCallerObject: false,
        failureMessage: "Failed to create entry",
      })
    );
  }

  /**
   * Update one entry of a batch, on the batch's shared transaction.
   *
   * The batch services check collection access and resolve the publish
   * transition ONCE per batch, before the transaction opens, so this per-entry
   * path runs no collection gate of its own — see `updateEntryWrite`.
   *
   * @param skipHooks - Skip user hooks; a bulk-import option, not a fast path
   *   around validation, access or recording, none of which are hooks.
   */
  async updateSingleEntryInTransaction(
    tx: TransactionContext,
    params: UpdateEntryWriteParams,
    entryId: string,
    body: Record<string, unknown>,
    skipHooks: boolean,
    /**
     * `access-service` where the batch could not hoist its gate: a caller
     * refused update may still change only entries' status, so each row is
     * judged on its own. A {@link RowVerdict} is that judgement, asked before
     * the batch's transaction opened.
     */
    rowGate: UpdateEntryWriteOptions["rowGate"] = "batch-hoisted"
  ): Promise<CollectionServiceResult<unknown>> {
    return runWithCallerScope(params.authenticatedScope, () =>
      this.updateEntryWrite(tx, params, entryId, body, {
        rowGate,
        runHooks: !skipHooks,
        identifyMissingEntry: true,
        failureMessage: "Failed to update entry",
      })
    );
  }

  /**
   * A row's own gate and its answer: a write that changes only the status of
   * an entry with a lifecycle asks the publish or unpublish its status names,
   * any other update. Asked on `executor` where the caller owns a
   * transaction, else on the pool, before any transaction opens.
   *
   * Asked of a caller that matches the row against a filter its rule
   * answers (`appliesFilter`), the filter comes back with the verdict;
   * asked of any other, such a rule refuses.
   */
  async rowVerdict(
    params: Pick<
      UpdateEntryWriteParams,
      | "collectionName"
      | "user"
      | "overrideAccess"
      | "routeAuthorized"
      | "authenticatedScope"
    >,
    entryId: string,
    body: Record<string, unknown>,
    hasLifecycle: () => boolean | Promise<boolean>,
    executor?: Parameters<
      CollectionAccessService["checkCollectionAccess"]
    >[0]["executor"],
    appliesFilter = false
  ): Promise<RowVerdict> {
    const gate = await writeGateFor(body, "collection", hasLifecycle);
    const gateParams = {
      collectionName: params.collectionName,
      operation: gate,
      entryId,
      user: params.user,
      overrideAccess: params.overrideAccess,
      // The route attests only an update it ran itself.
      routeAuthorized: gate === "update" && params.routeAuthorized,
      // Without this a narrowed scope never reaches the gate, because the
      // transaction methods sit outside the plugin facade's re-pinning
      // wrapper.
      authenticatedScope: params.authenticatedScope,
      ...(executor === undefined ? {} : { executor }),
    };
    if (!appliesFilter) {
      return {
        gate,
        denied: await this.accessService.checkCollectionAccess(gateParams),
      };
    }
    const access = await this.accessService.checkCollectionWrite(gateParams);
    if (access.denied) return { gate, denied: access.denied };
    return access.filter
      ? { gate, denied: null, filter: { params: gateParams, access } }
      : { gate, denied: null };
  }

  /**
   * Whether the collection has the draft/published lifecycle: the flag on its
   * config, not a `status` column, which an ordinary field may also be called.
   * Pass `executor` when the caller owns a transaction, so the read is bound
   * to its connection.
   */
  async hasLifecycle(
    collectionName: string,
    executor?: Parameters<DynamicCollectionService["getCollection"]>[1]
  ): Promise<boolean> {
    const collection = await this.collectionService.getCollection(
      collectionName,
      executor
    );
    return (collection as { status?: boolean }).status === true;
  }

  /**
   * Delete one entry of a batch, on the batch's shared transaction.
   *
   * The batch services check collection access ONCE per batch, before the
   * transaction opens, so this per-entry path runs no collection gate of its
   * own — see `deleteEntryWrite`.
   *
   * @param skipHooks - Skip user hooks; a bulk-import option, not a fast path
   *   around access or recording, neither of which is a hook.
   */
  async deleteSingleEntryInTransaction(
    tx: TransactionContext,
    params: DeleteEntryWriteParams,
    entryId: string,
    skipHooks: boolean,
    rowGate:
      | "batch-hoisted"
      | DeleteRowFilter
      | DeleteRowLanguages = "batch-hoisted"
  ): Promise<CollectionServiceResult<{ deleted: boolean }>> {
    return runWithCallerScope(params.authenticatedScope, () =>
      this.deleteEntryWrite(tx, params, entryId, {
        rowGate,
        runHooks: !skipHooks,
        identifyMissingEntry: true,
        failureMessage: "Failed to delete entry",
      })
    );
  }
}

/**
 * The id a create will be stored under, where the CALLER chose it.
 *
 * A collection that accepts client ids (`db.allowIdOnCreate`) stores the one
 * supplied, so a validator judging the new entry against rows that already name
 * that id — a component a page places before it exists — has to know it. Any
 * other create mints its id in the write, and nothing can name it yet. The
 * shape of a supplied id is the insert's own check (`resolveEntryId`).
 */
function suppliedCreateId(
  mode: "create" | "update",
  collectionName: string,
  data: Record<string, unknown>
): string | undefined {
  if (mode !== "create") return undefined;
  if (collectionDbOptions(collectionName).allowIdOnCreate !== true) {
    return undefined;
  }
  return typeof data.id === "string" && data.id !== "" ? data.id : undefined;
}
