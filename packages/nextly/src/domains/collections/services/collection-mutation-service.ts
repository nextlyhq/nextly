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

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  TransactionContext,
  WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";
import { eq, ne, and, like, ilike } from "drizzle-orm";

// `OperationType` was removed during the PR 4 migration — this module no longer
// references it, so we import only `BeforeOperationArgs`.
import type { BeforeOperationArgs } from "@nextly/hooks/types";
import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import { actorForWrite, type RequestActor } from "../../../auth/request-actor";
import { isFieldGroupField } from "../../../collections/fields/guards";
import type { FieldConfig } from "../../../collections/fields/types";
// PR 4 migration: switched from mapDbErrorToServiceError to NextlyError.
import { toDbError } from "../../../database/errors";
// The public CollectionServiceResult shape is preserved because the legacy
// CollectionEntryService facade and CollectionBulkService still consume it;
// only the internal error mapping changed. fromDatabaseError keeps driver
// text out of the wire and routes identifying detail to logContext (§13.8).
import { NextlyError } from "../../../errors";
import { errorEnvelopeFields } from "../../../errors/from-service-envelope";
import { withOriginalError } from "../../../errors/original-error";
import type { ValidationPublicData } from "../../../errors/public-data";
import { emitDocumentEvent } from "../../../events/domain-events";
import { getEventBus } from "../../../events/event-bus";
import { recordFlattenedError } from "../../../hooks/side-effect-warnings";
import { toSnakeCase } from "../../../lib/case-conversion";
import { stripImmutableSystemFields } from "../../../lib/immutable-system-fields";
import {
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
import type { ResolvedVersionsConfig } from "../../../schemas/versions/types";
import type { CollectionAccessRules } from "../../../services/access";
import type { CollectionFileManager } from "../../../services/collection-file-manager";
import type {
  CollectionRelationshipService,
  RelationshipDbExecutor,
} from "../../../services/collections/collection-relationship-service";
import type { TrustBound } from "../../../services/collections/trust-grant";
import { narrows } from "../../../services/collections/trust-grant";
import type { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import type { Logger } from "../../../services/shared";
import type { AddressableField } from "../../../shared/addressable-fields";
import { addressableFields } from "../../../shared/addressable-fields";
import { BaseService } from "../../../shared/base-service";
import {
  convertTimestampsToCamelCase,
  rehydrateSystemTimestamps,
  SYSTEM_TIMESTAMP_KEYS,
} from "../../../shared/lib/case-conversion";
import { validateEntryData } from "../../../shared/lib/entry-validation";
import { applyFieldDefaults } from "../../../shared/lib/field-defaults";
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
import { toJsonColumnValue } from "../../../shared/lib/json-column-value";
import {
  hasPasswordField,
  hashPasswordFieldValues,
  stripPasswordFieldValues,
  stripSystemOwnerField,
} from "../../../shared/lib/password-fields";
import {
  isWriteIntegrityFailure,
  markWriteIntegrityFailure,
} from "../../../shared/write-integrity";
import type { SupportedDialect } from "../../../types/database";
import { willRecordMutationActivity } from "../../audit/record-activity";
import type { DynamicCollectionService } from "../../dynamic-collections";
import { readComponentSubtrees } from "../../field-groups/read-component-subtrees";
import { readFieldGroupType } from "../../field-groups/storage/field-group-type-key";
import {
  COMPANION_LOCALE_COLUMN,
  COMPANION_PARENT_COLUMN,
  COMPANION_STATUS_COLUMN,
} from "../../i18n/companion-columns";
import {
  populateCompanionFields,
  populateCompanionFieldsAllLocales,
  readCompanionLocaleStatusAll,
} from "../../i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import { EVERY_LOCALE } from "../../i18n/locale-selector";
import { COMPANION_DEFAULT_STATUS } from "../../i18n/migration/generate-up";
import {
  isValidLocale,
  resolveRequestedLocale,
} from "../../i18n/resolve-locale";
import {
  companionHasStatusColumn,
  companionContentStamp,
  companionWriteVia,
  upsertCompanionRow,
} from "../../i18n/runtime/companion-io";
import {
  cachedCompanionReadiness,
  companionNotReadyMessage,
  isCompanionReady,
  resolveCompanionReadiness,
} from "../../i18n/runtime/companion-readiness";
import { assembleDocument } from "../../versions/assemble-document";
import { captureInTx } from "../../versions/capture-in-tx";
import { resolveDraftHold } from "../../versions/draft-hold";
import { isDraftSplitEligible } from "../../versions/draft-split-eligibility";
import {
  buildRestorePayload,
  type ComponentSchemas,
  type RestoreSchemaContext,
} from "../../versions/restore-snapshot";
import { resolveComponentSchemas } from "../../versions/restore-version";
import {
  rehydrateSnapshotDates,
  resolveComponentFieldMap,
  tagComponentTypes,
  tagNestedComponentTypes,
} from "../../versions/tag-component-types";
import { VersionCaptureService } from "../../versions/version-capture-service";
import { withVersionConflictRetry } from "../../versions/version-conflict";
import { VersionsRepository } from "../../versions/versions-repository";
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
  PUBLISH_ALL_LOCALES,
  WITHDRAW_ALL_LOCALES,
  type AllLocalesLifecycleParams,
  type LifecycleDirection,
} from "./all-locales-lifecycle";
import type { CollectionAccessService } from "./collection-access-service";
import type {
  CollectionHookService,
  QueryDatabaseParams,
} from "./collection-hook-service";
import type { CollectionServiceResult, UserContext } from "./collection-types";
import {
  toCamelCase,
  isJsonFieldType,
  isRelationshipField,
  normalizeNestedRelationships,
  normalizeUploadFields,
  getTableName,
  generateSlug,
} from "./collection-utils";

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
 * best-effort: fired after the operation's transaction has committed and its
 * after* hooks have run, and wrapped so a missing/erroring bus can never break
 * the mutation. Use a hook (in-transaction) to modify/abort; use this to react.
 */
function emitCollectionEvent(
  action: "created" | "updated" | "deleted",
  collection: string,
  data: Record<string, unknown>,
  user: unknown
): void {
  try {
    getEventBus().emit(`collection.${collection}.${action}`, {
      collection,
      id: (data as { id?: unknown }).id,
      data,
      user,
    });
  } catch {
    // Best-effort — never surface event-dispatch failures to the caller.
  }
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
  /**
   * Pre-fetched inputs for the document-dependent (owner-only) publish/unpublish
   * check, or `null` when none applies. The permission fields above cannot judge
   * an owner-only rule up front because it needs the specific row (which is only
   * known under the lock); this carries the rules + user so the in-transaction
   * step can evaluate the owner against the row-locked document with no metadata
   * or permission read. `null` for a trusted write, a super-admin session, or a
   * collection without an owner-only transition rule — in which case the
   * transaction path skips the document check entirely.
   */
  documentRule: {
    accessRules: CollectionAccessRules;
    user: UserContext | undefined;
  } | null;
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
  collectionName: string;
  user?: UserContext;
  /**
   * Honoured only by the owner-predicate gate. The access-service gate hard-
   * codes `undefined` for it, as the transaction API always has.
   */
  overrideAccess?: boolean;
  /** Who performed the delete, recorded on the outbox event. */
  actor?: RequestActor;
}

/** The only things that differ between the two delete entry points. */
interface DeleteEntryWriteOptions {
  /** Which shape of the row gate to apply — see the comment at its use. */
  rowGate: "access-service" | "owner-predicate";
  /** Run user hooks. Access and recording are NOT hooks and always run. */
  runHooks: boolean;
  /** Name the missing id in a 404, so a failing batch item is identifiable. */
  identifyMissingEntry: boolean;
  /** Message for a failure that carries no message of its own. */
  failureMessage: string;
}

interface UpdateEntryWriteParams {
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
}

/** The only things that differ between the two update entry points. */
interface UpdateEntryWriteOptions {
  /**
   * Which shape of the row gate to apply. `access-service` asks
   * `checkCollectionAccess` for the whole verdict; `owner-predicate` folds an
   * owner filter into the fetch and re-checks it afterwards. See the comment
   * at the use site for why both exist.
   */
  rowGate: "access-service" | "owner-predicate";
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

interface CreateEntryWriteParams {
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
  params: { collectionName: string; entryId: string; user?: UserContext };
  parentRow: Record<string, unknown>;
  snapshotComponents: Record<string, unknown> | undefined;
  snapshotM2M: Record<string, string[]> | undefined;
  splitComponentSchemas: ComponentSchemas | null;
  updatePayload: Record<string, unknown>;
}

/** What the caller needs back: the draft as a read would shape it, and its predecessor. */
interface WorkingDraftWriteResult {
  workingDraftDocument?: Record<string, unknown>;
  /** The draft BEFORE this save, so a hook diffing old against new is like-for-like. */
  priorWorkingDraftDocument?: Record<string, unknown>;
}

export class CollectionMutationService extends BaseService {
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
    private readonly localization?: SanitizedLocalizationConfig
  ) {
    super(adapter, logger);
  }

  /**
   * Stateless version-capture service. Records a durable version snapshot
   * inside the write transaction when the collection opts into versioning, so
   * the version commits atomically with the content write.
   */
  private readonly versionCapture = new VersionCaptureService();

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
  private readShapeEventDocument(
    row: Record<string, unknown>,
    fields: readonly unknown[]
  ): Record<string, unknown> {
    const doc = convertTimestampsToCamelCase(
      this.deserializeJsonFieldsForSnapshot(
        { ...row },
        fields as Parameters<typeof this.deserializeJsonFieldsForSnapshot>[1]
      )
    );
    stripPasswordFieldValues(
      doc,
      fields as Parameters<typeof stripPasswordFieldValues>[1]
    );
    stripSystemOwnerField(doc);
    return doc;
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
    }
  ): Promise<void> {
    if (!args.versionsConfig?.enabled) {
      return;
    }
    try {
      await captureInTx(tx, this.versionCapture, {
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
        // The component subtrees were read at the default locale (these paths
        // pass no write locale); tag the version with it so a localized
        // component can be restored, exactly as the interactive create/update
        // paths do. Null when the snapshot has no component state, since there is
        // then one set of values and nothing to disambiguate.
        locale:
          Object.keys(args.documentParts.components ?? {}).length > 0
            ? this.componentSnapshotLocale(undefined)
            : null,
        maxPerDoc: args.versionsConfig.maxPerDoc,
      });
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
    }
  ): Promise<{
    eventRecorded: boolean;
    revalidationIntent: RevalidationIntent | undefined;
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
      getWebhookEmitSpec("collection", args.collectionName) !== undefined;
    const { documentParts: createdParts, document: createdDocument } =
      await this.readTxDocumentParts(tx, {
        collectionName: args.collectionName,
        tableName: args.tableName,
        entryId,
        parentRow: this.readShapeEventDocument(args.entry, args.fields),
        fields: args.fields,
        manyToManyFields: args.manyToManyFields,
        needsRelations,
      });
    await this.captureTxVersion(tx, {
      collectionName: args.collectionName,
      entryId,
      contentStatus: args.entry.status,
      createdBy: args.user?.id ?? null,
      versionsConfig,
      documentParts: createdParts,
      fields: args.fields,
    });
    const eventFields = await this.webhookFieldTreeIfRecording(
      args.collectionName,
      args.fields,
      tx.getDrizzle()
    );
    const eventActor = actorForWrite(args.actor, args.user);
    let eventRecorded = await recordMutationEvent(tx, {
      type: "entry.created",
      resource: {
        kind: "entry",
        collection: args.collectionName,
        id: entryId,
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
      args.fields
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
        from: null,
        to: args.entry.status as string | null | undefined,
        isCreate: true,
        data: createdDocument,
        previous: null,
        fields: eventFields,
        actor: eventActor,
      });
      eventRecorded = createdStatusRecorded || eventRecorded;
    }

    return {
      eventRecorded,
      revalidationIntent: buildEntryRevalidationIntent(
        args.collectionName,
        readRevalidateConfig(args.collection),
        {
          id: entryId,
          slug: readStringField(args.entry, "slug"),
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
    stripPasswordFieldValues(parentRow, fields);
    stripSystemOwnerField(parentRow);

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
    locale: string | undefined
  ): Promise<{
    localizedFieldNames: ReadonlySet<string>;
    enforceLocalizedRequired: boolean;
  }> {
    const companion =
      await this.fileManager.loadCompanionSchema(collectionName);
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
    const mainTableName = companion.companionTableName.replace(/_locales$/, "");
    const readiness = await resolveCompanionReadiness(this.adapter, {
      companionTableName: companion.companionTableName,
      mainTableName,
      localizedColumns: companion.localizedFields.map(f => f.column),
    });
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
  private shapeWriteParts(
    data: Record<string, unknown>,
    fields: FieldDefinition[],
    manyToManyFields: FieldDefinition[],
    collection: unknown
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

    // Extract component field data (stored in separate comp_{slug} tables)
    // Component fields should not be stored in the collection table
    const componentFieldData: Record<string, unknown> = {};
    fields.forEach(field => {
      if (isFieldGroupField(field) && data[field.name] !== undefined) {
        componentFieldData[field.name] = data[field.name];
        delete data[field.name]; // Remove from main update
      }
    });

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

    // Serialize JSON fields (richtext, blocks, array, group, json)
    fields.forEach(field => {
      if (isJsonFieldType(field.type, field) && data[field.name] != null) {
        data[field.name] = toJsonColumnValue(data[field.name]);
      }
    });

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
        data.slug = generateSlug(data.slug);
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

    const row: Record<string, unknown> = { id: entryId };
    await populateCompanionFields({
      db: tx.getDrizzle<Parameters<typeof populateCompanionFields>[0]["db"]>(),
      companionTable: companion.table,
      localizedFields: companion.localizedFields,
      rows: [row],
      localeChain: [locale],
      // Inside the caller's transaction, so the remembered verdict is read and never resolved:
      // resolving would query, and a query against a missing relation aborts the whole
      // transaction on PostgreSQL. The write path resolves before opening one.
      readiness: cachedCompanionReadiness(
        this.adapter,
        companion.companionTableName
      ),
    });

    const values: Record<string, unknown> = {};
    for (const field of companion.localizedFields) {
      const value = row[field.name];
      if (value !== undefined) values[field.name] = value;
    }
    return values;
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
  }): Promise<void> {
    const collection = await this.collectionService.getCollection(
      params.collectionName
    );
    const tableName = this.resolveTableName(collection, params.collectionName);
    await this.adapter.transaction(async tx => {
      // Serialize with concurrent draft-save upserts, which lock this same parent
      // row before writing the sidecar.
      await tx.lockRow(tableName, params.entryId);
      await new VersionsRepository(tx).deleteWorkingDraft(
        {
          scopeKind: "collection",
          scopeSlug: params.collectionName,
          entryId: params.entryId,
        },
        workingDraftLocale({
          documentLocalized:
            (collection as { localized?: boolean }).localized === true,
          requestLocale: params.locale ?? null,
          defaultLocale: this.localization?.defaultLocale ?? null,
        })
      );
    });
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
   * The write locale's per-locale `_status`, or null when the companion row has
   * none.
   *
   * Read with raw `tx.execute` (matching upsertCompanionRow / publishAllLocales):
   * the companion `_locales` table is not in the Drizzle schema, and the CRUD
   * helpers camelCase result keys, which would rename `_status`.
   */
  private async readCompanionStatus(
    tx: TransactionContext,
    companionTableName: string,
    entryId: string,
    locale: string
  ): Promise<string | null> {
    const isMysqlDialect = this.dialect === "mysql";
    const quote = (id: string) => (isMysqlDialect ? `\`${id}\`` : `"${id}"`);
    const placeholder = (i: number) =>
      this.dialect === "postgresql" ? `$${i}` : "?";
    const rows = await tx.execute<{ _status?: unknown }>(
      `SELECT ${quote("_status")} FROM ${quote(companionTableName)} ` +
        `WHERE ${quote("_parent")} = ${placeholder(1)} AND ${quote("_locale")} = ${placeholder(2)} LIMIT 1`,
      [entryId, locale]
    );
    const status = rows[0]?._status;
    return typeof status === "string" ? status : null;
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
    const mergedComponents = this.mergeSingleComponentPatches(
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
   * Overlay `patch` onto `base`, recursively merging single (non-repeatable)
   * component objects instead of replacing them.
   *
   * A patch-shaped save carries only the sub-fields it changed, so replacing a
   * component's whole object would drop sub-fields an earlier save set. Recurses
   * according to the resolved component schemas so a component nested inside a
   * component is merged at every depth. A dynamic zone (array), a repeatable
   * component, and a scalar are replaced whole (patch wins).
   */
  private mergeSingleComponentPatches(
    base: Record<string, unknown>,
    patch: Record<string, unknown>,
    fields: FieldConfig[],
    componentSchemas: ComponentSchemas | null
  ): Record<string, unknown> {
    // Flatten unnamed presentational groups (matching `tagComponentTypes`): a
    // single component declared inside such a group stores its value at the
    // enclosing level, so without flattening the lookup would miss it and treat
    // it as a scalar, replacing rather than merging a nested component patch.
    const byName = new Map<string, AddressableField>();
    for (const f of addressableFields(fields)) {
      const name = (f as { name?: unknown }).name;
      if (typeof name === "string") byName.set(name, f);
    }
    const out: Record<string, unknown> = { ...base };
    for (const [key, patchVal] of Object.entries(patch)) {
      const field = byName.get(key);
      const slug =
        field &&
        typeof (field as { component?: unknown }).component === "string" &&
        (field as { repeatable?: unknown }).repeatable !== true
          ? ((field as { component?: string }).component as string)
          : undefined;
      const baseVal = out[key];
      if (
        slug !== undefined &&
        baseVal !== null &&
        typeof baseVal === "object" &&
        !Array.isArray(baseVal) &&
        patchVal !== null &&
        typeof patchVal === "object" &&
        !Array.isArray(patchVal)
      ) {
        out[key] = this.mergeSingleComponentPatches(
          baseVal as Record<string, unknown>,
          patchVal as Record<string, unknown>,
          componentSchemas?.get(slug)?.fields ?? [],
          componentSchemas
        );
      } else {
        out[key] = patchVal;
      }
    }
    return out;
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
   * Delete password-field values from component instances in a snapshot's
   * component map, descending through nested components. `stripPasswordFieldValues`
   * handles a component instance's own passwords and any nested in a
   * group/repeater, but cannot follow a component referenced by slug; this
   * resolves each instance's schema (from the tagged `_componentType`, or the
   * field's single declared component) and recurses so a password two components
   * deep is removed too. Mutates in place: on every path that reaches here the
   * component data has already been saved (promote) or will never be saved
   * (draft edit), so stripping the snapshot copy cannot affect a live write.
   */
  private stripComponentPasswordsInPlace(
    components: Record<string, unknown>,
    schema: FieldConfig[],
    componentFields: Map<string, FieldConfig[]>
  ): void {
    const declaredSlugs = (field: FieldConfig): string[] => {
      const one = (field as { component?: unknown }).component;
      const many = (field as { components?: unknown }).components;
      const slugs: string[] = [];
      if (typeof one === "string") slugs.push(one);
      if (Array.isArray(many)) {
        for (const s of many) if (typeof s === "string") slugs.push(s);
      }
      return slugs;
    };
    const stripInstance = (instance: unknown, cfields: FieldConfig[]): void => {
      if (
        !instance ||
        typeof instance !== "object" ||
        Array.isArray(instance)
      ) {
        return;
      }
      const rec = instance as Record<string, unknown>;
      stripPasswordFieldValues(rec, cfields);
      for (const child of cfields) {
        const childSlugs = declaredSlugs(child);
        if (childSlugs.length > 0) stripField(rec, child, childSlugs);
      }
    };
    const stripField = (
      owner: Record<string, unknown>,
      field: FieldConfig,
      slugs: string[]
    ): void => {
      if (!field.name) return;
      const value = owner[field.name];
      const isArray = Array.isArray(value);
      const instances = isArray ? value : value != null ? [value] : [];
      const kept: unknown[] = [];
      let dropped = false;
      for (const inst of instances) {
        if (!inst || typeof inst !== "object") {
          kept.push(inst);
          continue;
        }
        // Asked rather than read: an instance already stored may carry either spelling of
        // this key, depending on which side of the storage migration wrote it.
        const tagged = readFieldGroupType(inst);
        const slug =
          typeof tagged === "string"
            ? tagged
            : slugs.length === 1
              ? slugs[0]
              : undefined;
        const cfields = slug ? componentFields.get(slug) : undefined;
        if (cfields) {
          stripInstance(inst, cfields);
          kept.push(inst);
        } else {
          // The instance's schema cannot be resolved (a dynamic-zone row naming
          // a component the field does not allow, or one absent from the
          // registry), so a password nested inside it cannot be located and
          // removed. Drop the instance rather than store an un-inspected value
          // in plaintext, the same safe direction the restore filter takes for
          // an unknown subtree.
          dropped = true;
        }
      }
      if (!dropped) return;
      if (isArray) owner[field.name] = kept;
      else delete owner[field.name];
    };
    for (const field of schema) {
      const slugs = declaredSlugs(field);
      if (slugs.length > 0) stripField(components, field, slugs);
    }
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
    const components = await readComponentSubtrees({
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
      locale,
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

    return { components, manyToMany };
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
    },
    slug: string
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
    stripPasswordFieldValues(entry, fields);
    // Strip the system owner column so a mutation response (e.g. an admin or
    // role-based updater) does not echo the row creator's user id. Owner-only
    // access reads it from SQL, never from the returned row.
    stripSystemOwnerField(entry);
    await applyFieldReadAccess({
      kind: "collection",
      slug,
      entry,
      user: params.user,
      overrideAccess: params.overrideAccess && !params.routeAuthorized,
    });
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
      tableName: this.resolveTableName(collection, collectionName),
    };
  }

  /** Resolve the physical table for a collection, honoring `dbName` overrides. */
  private resolveTableName(collection: unknown, slug: string): string {
    return (
      ((collection as Record<string, unknown>)?.tableName as string) ||
      getTableName(slug)
    );
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
    isSlugTaken: (slug: string) => Promise<boolean>
  ): Promise<void> {
    const provided =
      typeof finalData.slug === "string" && finalData.slug.trim() !== "";
    if (provided) {
      // Explicit slug: sanitize only, never dedupe — respect the caller's value.
      const sanitized = generateSlug(finalData.slug as string);
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
    isSlugTaken: (slug: string) => Promise<boolean>
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
    const sanitized = typeof current === "string" ? generateSlug(current) : "";
    finalData.slug =
      sanitized !== ""
        ? sanitized
        : await this.deriveSlug(finalData, isSlugTaken);
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
   * 1. Collection-level access (AccessControlService)
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
      // The caller's authenticated scope. For a scoped API-key REST create the
      // publish transition gate (a create-as-published) judges the key's OWN
      // grants — the route only authorized `create` against the key's scope.
      authenticatedScope?: AuthenticatedScope;
    },
    body: Record<string, unknown>,
    depth?: number
  ): Promise<CollectionServiceResult> {
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
      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "create",
        accessUser,
        undefined,
        undefined,
        params.overrideAccess,
        params.routeAuthorized,
        // A scoped API key is judged on its own grants here too, so the session
        // super-admin bypass does not apply to it on the create gate.
        params.authenticatedScope
      );
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
      const fields =
        ((
          (collection as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields as FieldDefinition[]) ||
        ((collection as Record<string, unknown>).fields as FieldDefinition[]) ||
        [];
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      const tableName = this.resolveTableName(
        collection,
        params.collectionName
      );

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = { ...params.context };

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
      applyFieldDefaults(seededBody, fields);

      const beforeOpArgs =
        await this.hookService.hookRegistry.executeBeforeOperation({
          collection: params.collectionName,
          operation: "create",
          args: { data: seededBody },
          user: params.user
            ? { id: params.user.id, email: params.user.email }
            : undefined,
          context: sharedContext,
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
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "create",
            dataAfterCodeHooks,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
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
      await this.applyGeneratedSlugAndTitle(finalData, isSlugTaken);

      // Field-level access: fields the caller may not create are stripped
      // silently (Payload parity); overrideAccess bypasses.
      await applyFieldWriteAccess({
        kind: "collection",
        slug: params.collectionName,
        data: finalData,
        operation: "create",
        user: params.user,
        overrideAccess: params.overrideAccess,
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
      await this.reSanitizeSlug(finalData, isSlugTaken);

      {
        // i18n M5b: `required` on a localized field is enforced only for the default-locale write;
        // other locales fall back, so the canonical validator gets the localized-field set and
        // whether this write's locale must enforce them.
        const localeCtx = await this.localizedRequiredContext(
          params.collectionName,
          params.locale
        );
        const validationIssues = await validateEntryData(
          this.validationView(finalData, fields),
          attachFieldValidators("collection", params.collectionName, fields),
          {
            mode: "create",
            req: params.user ? { user: params.user } : {},
            ...localeCtx,
          }
        );
        if (validationIssues.length > 0) {
          throw NextlyError.validation({ errors: validationIssues });
        }
      }

      // Collection-level beforeChange hooks, on data the validation gate has
      // just passed. Paired with the field-level phase below so the two
      // declarations of that name mean the same moment.
      await this.hookService.runBeforeChange({
        collection: params.collectionName,
        operation: "create",
        data: finalData,
        storedHooks,
        queryDatabase: this.queryDatabaseFn,
        user: params.user,
        sharedContext,
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

      // A beforeChange hook runs after validation and can also set `slug`;
      // re-sanitize once more so the stored value stays URL-safe.
      await this.reSanitizeSlug(finalData, isSlugTaken);

      await hashPasswordFieldValues(finalData, fields);

      // Strip an explicit `status: undefined` AFTER every mutating hook has run.
      // A field-level beforeValidate/beforeChange hook can (re)introduce an own
      // `status: undefined`, which names no status change but would otherwise be
      // sanitized to SQL NULL on the raw-parameter path — silently unpublishing a
      // published row, or nulling a create's draft default — without passing the
      // publish/unpublish gate. Placed here, the last status-touching step before
      // the transition classification and the write, so the write payload and the
      // gate agree even when a hook set the undefined.
      stripUndefinedStatus(finalData);

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

      // Extract many-to-many data from finalData (after hooks)
      manyToManyFields.forEach(field => {
        if (finalData[field.name]) {
          manyToManyData[field.name] = Array.isArray(finalData[field.name])
            ? (finalData[field.name] as string[])
            : [finalData[field.name] as string];
          delete finalData[field.name]; // Remove from main insert
        }
      });

      // Extract component field data (stored in separate comp_{slug} tables)
      // Component fields should not be stored in the collection table
      // Extract component field data for separate storage in comp_{slug} tables
      const componentFieldData: Record<string, unknown> = {};
      fields.forEach(field => {
        if (isFieldGroupField(field) && finalData[field.name] !== undefined) {
          componentFieldData[field.name] = finalData[field.name];
          delete finalData[field.name]; // Remove from main insert
        }
      });

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

      // Serialize JSON fields (richtext, blocks, array, group, json)
      fields.forEach(field => {
        if (
          isJsonFieldType(field.type, field) &&
          finalData[field.name] != null
        ) {
          finalData[field.name] = toJsonColumnValue(finalData[field.name]);
        }
      });

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
        id: this.collectionService.generateId(),
        // Strip client-supplied system columns (id / timestamps / created_by,
        // both snake and camel) so the generated id, stamped owner, and
        // timestamps below are authoritative — a stray `createdBy` alias can't
        // survive to overwrite the owner stamp.
        ...stripImmutableSystemFields(finalData, "collection"),
        created_at: now,
        updated_at: now,
        // Stamp the row owner with the creating user's id so owner-only access
        // works zero-config. Null for system/seed creates (no user context).
        created_by: params.user?.id ?? null,
      };
      const entryData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rawEntryData)) {
        entryData[toSnakeCase(key)] = value;
      }

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
        // A create has no prior row, so a document-dependent (owner-only/custom)
        // publish rule is judged against the row this create will persist. Pass
        // it so a custom rule inspecting the document does not see `data`
        // undefined and wrongly allow (or deny) a create-as-published.
        document: entryData,
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
      await this.adapter.transaction(async tx => {
        const rawEntry = await tx.insert<unknown>(tableName, entryData, {
          returning: "*",
        });

        // Convert snake_case keys from DB response back to camelCase field names
        // so hooks and the API response use the original field names.
        for (const [key, value] of Object.entries(
          rawEntry as Record<string, unknown>
        )) {
          entry[toCamelCase(key)] = value;
        }

        // i18n M5: write the translatable values to the companion `_locales` row for the
        // write's locale (same transaction → rolls back with the main insert).
        if (localizedWrite) {
          await tx.insert(
            localizedWrite.companionTableName,
            {
              _parent: entry.id,
              _locale: localizedWrite.writeLocale,
              ...localizedWrite.companionData,
              // i18n B2: this is the THIRD companion write path, and it does not go through
              // `upsertCompanionRow` -- it inserts a brand-new row on a parent this transaction
              // has just created, where there is no conflict to resolve. The stamp rule is shared
              // rather than restated, because a create that forgot it would leave every new
              // document's translations reading as UNKNOWN until each locale was rewritten, and a
              // staleness signal that never fires for new content is invisible.
              ...companionContentStamp(
                localizedWrite.companionData,
                localizedWrite.companionTableName,
                this.dialect
              ),
            },
            {}
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
              ...(localizedWrite?.localizedFieldValues ?? {}),
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
        stripPasswordFieldValues(snapshotParent, fields);
        stripSystemOwnerField(snapshotParent);
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
        // collection opts into versioning.
        if (versionsConfig?.enabled) {
          await captureInTx(tx, this.versionCapture, {
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
        }

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
        }
      });
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

      // Execute afterCreate hooks (code-registered)
      // Hooks run after database insert completes (for side effects)
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "create" as const,
        data: entry,
        user: params.user,
        context: sharedContext, // Pass shared context from beforeCreate
      });

      await this.hookService.hookRegistry.execute("afterCreate", afterContext);

      // Execute stored afterCreate hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "afterCreate",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "create",
          entry,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      // Post-commit reaction event (D8/D51).
      emitCollectionEvent("created", params.collectionName, entry, params.user);

      // D69: a document created directly as `published` is a publish event too.
      // (No statusChanged on create — there is no prior status to transition from.)
      const createdStatus = (entry as { status?: unknown }).status;
      if (createdStatus === "published") {
        this.transitionStatus({
          collection: params.collectionName,
          id: (entry as { id?: unknown }).id,
          data: { ...entry },
          user: params.user,
          previousStatus: null,
          status: "published",
          emitStatusChanged: false,
        });
      }

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
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "afterChange",
        data: entry,
        operation: "create",
        user: params.user,
      });

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
          console.warn(
            "Failed to expand relationships in createEntry response:",
            expansionError
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
        },
        params.collectionName
      );

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
      // Legacy per-kind override messages ("Duplicate value: ...",
      // "Missing required field", etc.) are dropped: the new mapping uses
      // the §13.8-compliant generic strings from fromDatabaseError so the
      // wire never reveals which constraint or column failed. The original
      // DbError is preserved on the NextlyError as `cause` for log lines.
      // Pass dialect explicitly so the helper can normalise raw driver errors.
      return {
        ...errorToServiceResult(
          error,
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
   * 1. Collection-level access (AccessControlService)
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
  private async writeCompanionStatus(
    tx: TransactionContext,
    args: {
      companionTableName: string;
      parentId: string;
      status: string;
      /** {@link EVERY_LOCALE}, or one locale code. */
      locale: string;
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
      { [COMPANION_STATUS_COLUMN]: args.status },
      { and: conditions }
    );
  }

  /**
   * Publish ALL languages of an entry at once (i18n M7, spec §10). Atomically sets the main
   * `status` to 'published' and — when the collection has per-locale status (M6) — every companion
   * row's `_status` to 'published', in a single transaction. For a non-localized / no-status
   * collection it is a plain publish of the single row. Only touches status columns (no field
   * values), so it needs none of the localized-write machinery.
   */
  private async setLifecycleAllLocales(
    direction: LifecycleDirection,
    params: AllLocalesLifecycleParams
  ): Promise<CollectionServiceResult> {
    // Set when the in-transaction document-rule re-check refuses the publish
    // against the row-locked document. Declared out here so the catch can read
    // it: the adapter re-wraps the thrown sentinel in a DatabaseError as the
    // transaction rolls back, so `instanceof` no longer identifies it.
    let publishDocDenied: CollectionServiceResult | undefined;
    // The tags this publish invalidates, set before the success return so a
    // publish busts the entry's cached reads. Publishing every locale, so no
    // single locale tag — the locale-less id tag covers them all.
    let revalidationIntent: RevalidationIntent | undefined;
    try {
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
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "update",
        accessUser,
        params.entryId,
        existingEntry,
        params.overrideAccess,
        // The route already ran the `update` gate (against the API key's scope,
        // when applicable), so skip the redundant RBAC re-check here; the publish
        // gate below still runs.
        params.routeAuthorized,
        params.authenticatedScope
      );
      if (accessDenied) return accessDenied;

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
      const companion = await this.fileManager.loadCompanionSchema(
        params.collectionName
      );
      const companionPublishable =
        !!companion &&
        companion.hasStatus &&
        // Only `ready` matters: a companion that is not there has no per-locale publish
        // lifecycle, and why it is not there changes nothing about that.
        (await isCompanionReady(this.adapter, companion.companionTableName));

      if (!hasMainStatus && !companionPublishable) {
        // Nothing to publish — the collection has no status concept. Returned
        // before the publish permission check so a collection with no lifecycle
        // does not demand `publish-<slug>` for a call that changes nothing.
        return {
          success: true,
          statusCode: 200,
          message: direction.nothingToDoMessage,
          data: { id: params.entryId },
        };
      }

      // This method exists to publish every locale, so it is unconditionally a
      // publish and needs the publish permission on top of update — checked
      // directly rather than via a transition, since it publishes companion
      // locales even when the main row is already published. Runs only once
      // there is actually something publishable.
      // Defer a document-dependent (owner-only/custom) publish rule to the
      // under-lock re-check so it is judged against the row-locked document, not
      // the stale pre-transaction `existingEntry` — a custom rule keyed on a
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

      // mutable field (e.g. an approval flag a concurrent writer clears) must
      // decide on the committed value this publish will overwrite.
      const publishStoredRules = this.accessService.getAccessRules(
        publishCollection as Record<string, unknown>
      );
      const deferPublishDocumentRule =
        this.accessService.isDocumentDependentRule(publishStoredRules?.publish);
      const publishDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        direction.accessAction,
        accessUser,
        params.entryId,
        existingEntry,
        params.overrideAccess,
        // Not route-authorized as publish: the POST was authorized as `update`,
        // so the publish permission is checked here.
        false,
        // Judge a scoped API key on its own `publish-<slug>` grant.
        params.authenticatedScope,
        deferPublishDocumentRule
      );
      if (publishDenied) return publishDenied;
      const publishDocumentRule = deferPublishDocumentRule
        ? this.accessService.resolveTransitionDocumentRule(
            publishCollection as Record<string, unknown>,
            accessUser,
            params.authenticatedScope
          )
        : null;

      // `publishCollection` (loaded above for the lifecycle flag) also resolves a
      // custom tableName/dbName override, matching every other mutation;
      // getTableName would hardcode the default dc_<slug> and target the wrong
      // table for a renamed collection.
      const tableName = this.resolveTableName(
        publishCollection,
        params.collectionName
      );

      // Resolved versioning config + field set for the in-transaction capture.
      const versionsConfig = (publishCollection as Record<string, unknown>)
        .versions as ResolvedVersionsConfig | null | undefined;
      const fields = ((publishCollection as { fields?: unknown }).fields ??
        []) as FieldDefinition[];
      const manyToManyFields = fields.filter(
        f =>
          f.type === "relationship" && f.options?.relationType === "manyToMany"
      );
      const previousStatusRaw = (existingEntry as { status?: unknown }).status;
      const previousStatus =
        typeof previousStatusRaw === "string" ? previousStatusRaw : null;

      // The parent row for both the snapshot and the status-change event is
      // re-read fresh inside the transaction (not the pre-transaction
      // `existingEntry`), mirroring updateEntry: a conflict retry re-runs this
      // closure, and any concurrent write committed before the tx began is then
      // reflected, so neither the recorded snapshot nor the emitted event
      // payload exposes a stale pre-image of the non-status columns. The closure
      // sets it; it is read once after commit for the event.
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
      // The event payload, version snapshot and workflow reaction are all built from the
      // PRE-update row with the new status overlaid, so without carrying this across they would
      // report the marker absent on the very publication that establishes it. Reset per attempt
      // by the closure, so a retry after a concurrent winner does not reuse a stale value.
      let publishFirstPublishedAt: Date | undefined;
      // The per-locale publish transitions recorded to the outbox inside the
      // transaction, replayed to the in-process workflow subscribers after it
      // commits — the durable event and the reaction event must not diverge on
      // which locales published. The closure rebuilds it each attempt.
      let perLocaleTransitions: {
        locale: string;
        from: string | null;
        data: Record<string, unknown>;
      }[] = [];
      // Whether the default locale's companion row transitions to published, so
      // the post-commit workflow replay suppresses the untagged main transition
      // (the default's locale-tagged replay stands in for it). Set in the tx.
      let defaultCompanionTransitions = false;
      // Read the fresh post-publish parent whenever the collection captures
      // versions or carries a status: the pre-transaction `previousStatus` can
      // be stale (a concurrent writer may commit between it and the lock), so a
      // transition detected only under the lock still needs the committed row
      // for its event payload rather than falling back to the stale pre-read.
      const needsFreshParent = !!versionsConfig?.enabled || hasMainStatus;

      // Retry the whole publish+capture transaction on a version_no allocation
      // race, mirroring updateEntry.
      await withVersionConflictRetry(() =>
        this.adapter.transaction(async tx => {
          // Lock the main row up front. One read serves three needs: it is the
          // liveness check (a row deleted between the pre-transaction read and
          // this lock is gone here, so the publish writes and records nothing);
          // it carries the committed status the publish transition is judged
          // against; and it is the document a deferred publish rule re-checks.
          // Reset per attempt because the conflict retry re-runs this closure.
          entryVanished = false;
          lockedPreviousStatus = previousStatus;
          publishFirstPublishedAt = undefined;
          perLocaleTransitions = [];
          defaultCompanionTransitions = false;
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
          // event pre-image; publishing changes only status, so its non-status
          // columns are the post-publish columns too. Read after the lock, so on
          // a retry it reflects the concurrent winner just like the pre-read did.
          const [lockedSchemaRow] = (await tx
            .getDrizzle<typeof this.db>()
            .select()
            .from(schema)
            .where(eq(schema.id, params.entryId))
            .limit(1)) as (Record<string, unknown> | undefined)[];
          const preImageRow = lockedSchemaRow ?? existingEntry;

          // Re-check a deferred document-dependent (owner-only/custom) publish
          // rule against the row read UNDER the lock, before the status write, so
          // a concurrent change to a field the rule inspects is accounted for.
          // Throwing here rolls the publish back with nothing written.
          if (publishDocumentRule) {
            {
              const documentDenied =
                await this.accessService.evaluateTransitionDocumentRule(
                  publishDocumentRule.accessRules,
                  "publish",
                  publishDocumentRule.user,
                  lockedRow
                );
              if (documentDenied) {
                publishDocDenied = documentDenied;
                throw new StatusTransitionDeniedError();
              }
            }
          }
          // Each locale's committed per-locale status BEFORE the bulk companion
          // flip below, so a real draft->published transition can be told from a
          // locale that was already live. Read under the lock and inside the
          // retry so it reflects the state this publish actually overwrites.
          let priorCompanionStatuses: Map<string, string | null>;
          try {
            priorCompanionStatuses =
              companion && companionPublishable
                ? await readCompanionLocaleStatusAll(
                    tx.getDrizzle<
                      Parameters<typeof readCompanionLocaleStatusAll>[0]
                    >(),
                    companion.table,
                    params.entryId,
                    cachedCompanionReadiness(
                      this.adapter,
                      companion.companionTableName
                    )
                  )
                : new Map<string, string | null>();
          } catch (err) {
            // The helper already tolerates a missing companion table; any error
            // here is a real database failure. Normalize it to the canonical
            // internal error so the raw driver message (which can carry schema
            // or connection details) does not reach the API caller through the
            // service's failure result.
            throw NextlyError.internal({
              cause: err instanceof Error ? err : undefined,
              logContext: {
                reason: "publish-all-companion-status-scan",
                collection: params.collectionName,
              },
            });
          }

          if (hasMainStatus) {
            // The marker this publish records, if any. Decided from the row read under the lock
            // above, so an already-published row records nothing — which matters most for rows
            // published before this column existed, whose marker is null precisely because their
            // history was never captured. Dating those today would report a publication that
            // never happened.
            const publishNow = new Date();
            const lockedMarker = (
              lockedRow as { first_published_at?: unknown } | undefined
            )?.first_published_at;
            // Publish-all can find a document in a mixed state: a draft main row alongside a
            // translation that has been live since before this column existed. The main row's own
            // transition then reads as a first publication when the document was already
            // reachable, so the same document-level question is asked here. No locale is excluded
            // — this write publishes all of them, so any already-published one predates it.
            // Only a PUBLICATION can establish first publication. A withdrawal
            // leaves the marker untouched: it records when the document first
            // became reachable, which taking it down does not change, and
            // re-dating or clearing it would make a later republish report a
            // first publication that had already happened years earlier.
            //
            // Nothing below needs a branch for that — `firstPublishedStamp`
            // stays undefined for a withdrawal, and every use of it is already a
            // conditional spread.
            if (direction.stampsFirstPublished) {
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
            // Through the adapter's Drizzle layer rather than an interpolated statement. That
            // also removes the reason the previous version needed a SQL `now()` expression: a
            // `Date` bound as a raw parameter stores wrong against SQLite's integer timestamps,
            // while Drizzle converts it per dialect.
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
          if (companion && companionPublishable) {
            await this.writeCompanionStatus(tx, {
              companionTableName: companion.companionTableName,
              parentId: params.entryId,
              status: direction.nextStatus,
              locale: EVERY_LOCALE,
            });
          }

          if (needsFreshParent) {
            // The committed post-publish parent, built from the pre-image read on
            // the transaction connection above: publish only mutates status, so
            // its non-status columns are already the post-publish ones — overlay
            // the new status rather than taking a second pooled connection while
            // this transaction holds one (which would deadlock a one-connection
            // pool). Undefined only if the row vanished, which the lock above
            // already rules out.
            // The marker is overlaid alongside the status for the same reason: it was written by
            // the UPDATE above and so is not on the pre-image this row is built from. Without it
            // the publication event and the captured version would both report no first
            // publication for the write that just established one.
            publishedParentRow = lockedSchemaRow
              ? {
                  ...lockedSchemaRow,
                  status: direction.nextStatus,
                  ...(publishFirstPublishedAt
                    ? { first_published_at: publishFirstPublishedAt }
                    : {}),
                }
              : undefined;

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
              stripPasswordFieldValues(parentRow, fields);
              stripSystemOwnerField(parentRow);
              const {
                components: snapshotComponents,
                manyToMany: snapshotM2M,
              } = await this.buildFullSnapshotRelations(
                tx,
                params.entryId,
                params.collectionName,
                tableName,
                fields,
                manyToManyFields
              );
              await captureInTx(tx, this.versionCapture, {
                ref: {
                  scopeKind: "collection",
                  scopeSlug: params.collectionName,
                  entryId: params.entryId,
                },
                contentStatus: direction.nextStatus,
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
            }
          }

          // Append the base `entry.updated` outbox event for the publish write,
          // then its publish lifecycle event, both on this transaction so they
          // commit with the status write and never survive a rollback. Built from
          // the post-publish document (the fresh in-tx row overlaid with the new
          // status, or the pre-read row so the event still fires when no fresh
          // read was needed). The publish event is gated on a real main-row
          // transition, matching the post-commit `transitionStatus` below.
          const publishedDocument = this.readShapeEventDocument(
            {
              ...(publishedParentRow ?? preImageRow),
              status: direction.nextStatus,
            },
            fields
          );
          // Overlay the committed publish instant AFTER camelCasing: the source
          // rows carry the pre-publish `updatedAt` (the pooled/pre-read excludes
          // this tx's own `SET updated_at = now()`), and a snake-case overlay
          // would be dropped because `convertTimestampsToCamelCase` keeps the
          // existing camelCase value. Without this the event reports the stale
          // timestamp and omits `updatedAt` from changedFields.
          publishedDocument.updatedAt = new Date();
          // Built from the pre-image read under the lock, so a concurrent write
          // committed between the pre-transaction read and the lock is reflected
          // rather than the stale pre-read (its non-status fields and its own
          // prior status).
          const previousDocument = this.readShapeEventDocument(
            preImageRow as Record<string, unknown>,
            fields
          );
          const publishEventFields = await this.webhookFieldTreeIfRecording(
            params.collectionName,
            fields,
            tx.getDrizzle()
          );
          const publishActor = actorForWrite(params.actor, params.user);
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
          });
          eventRecorded = baseRecorded || eventRecorded;
          // Whether the default locale's own companion row transitions to
          // published here. When it does, the per-locale loop below emits the
          // default locale's transition tagged `locale: <default>` — matching
          // the ordinary localized update path, where a default-locale status
          // that rides the companion is emitted locale-tagged and the untagged
          // main-row event is suppressed (its companion event already encodes
          // the transition). So a consumer routing the default language by its
          // locale still sees the default translation go live.
          const defaultLocale = this.localization?.defaultLocale;
          defaultCompanionTransitions =
            defaultLocale !== undefined &&
            priorCompanionStatuses.has(defaultLocale) &&
            priorCompanionStatuses.get(defaultLocale) !== direction.nextStatus;
          // The document-wide (main-row) publish transition, WITHOUT a locale
          // tag. Emitted only when a default-companion event does not already
          // encode it (a non-localized collection, or a default locale whose
          // status lives only on the main row) — otherwise the locale-tagged
          // default event below stands in, avoiding a duplicate. Gated on the
          // status read under the lock so a concurrent unpublish/publish is
          // judged correctly.
          if (
            hasMainStatus &&
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
          // Per-locale publish transitions. The bulk flip above moved every
          // companion locale to published in one statement, but a subscriber
          // watching a single language needs its own `entry.published` — so each
          // companion locale that actually transitioned gets a locale-tagged
          // event, with the locale's own prior `_status` as the transition
          // `from`. The default locale is included: its companion event replaces
          // the untagged main event suppressed above.
          // Only locales the app still configures get an event: a locale
          // removed from configuration can leave stale companion rows behind,
          // and a publish event tagged with a locale that normal reads/writes
          // reject would mislead locale-routed consumers.
          const configuredLocales = new Set(
            this.localization?.locales.map(l => l.code) ?? []
          );
          for (const [locale, priorLocaleStatus] of priorCompanionStatuses) {
            if (configuredLocales.size > 0 && !configuredLocales.has(locale))
              continue;
            if (priorLocaleStatus === direction.nextStatus) continue;
            // Build this locale's own before/after documents. Publishing changes
            // only status, so the locale's translatable values AND its component
            // subtrees are identical on both sides — read them at this locale and
            // assemble them onto the main-row event shape so a `locale`-tagged
            // event carries that language's full content (fields and localized
            // components) and its own prior status, matching the ordinary
            // localized update path. Read on the transaction (read-your-writes).
            let rawLocaleValues: Record<string, unknown>;
            try {
              // These values feed a durable locale-tagged event; a real
              // companion read failure must abort rather than commit a publish
              // event missing this locale's translated fields.
              rawLocaleValues = await this.readCompanionLocalizedValues(
                tx,
                params.collectionName,
                params.entryId,
                locale
              );
            } catch (err) {
              // Normalize the raw driver error the same way the status scan
              // above does, so a schema/permission failure returns the canonical
              // internal error instead of leaking the driver's message through
              // the service failure result.
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
            // Strip parent-level password fields before assembling: a localized
            // group/repeater can carry a nested password hash the overlay
            // reintroduces after `publishedDocument` was already redacted. The
            // durable outbox re-strips while building its envelope, but the
            // in-process `transitionStatus` replay receives this document
            // unchanged, so strip here to protect both paths. Component subtrees
            // are already password-stripped by the snapshot read.
            const localeDataParent = {
              ...publishedDocument,
              ...localeValues,
              status: direction.nextStatus,
            };
            stripPasswordFieldValues(localeDataParent, fields);
            const localePrevParent = {
              ...previousDocument,
              ...localeValues,
              status: priorLocaleStatus,
            };
            stripPasswordFieldValues(localePrevParent, fields);
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
            // Remember the transition so the same locale is replayed to the
            // in-process workflow subscribers post-commit, the way the localized
            // update path does — otherwise `statusTransition`/`published`
            // listeners never observe a companion locale going live.
            perLocaleTransitions.push({
              locale,
              from: priorLocaleStatus,
              data: localeData,
            });
          }
        })
      );

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

      // Post-commit status events: publishing is a real status transition, so
      // workflow subscribers on statusTransition/published must see it (this
      // path previously changed status without emitting anything). Skip when the
      // main row was already published (no transition, judged on the status read
      // under the lock), matching updateEntry. Prefer the fresh in-tx row; fall
      // back to the pre-read only if the row vanished mid-publish.
      if (
        hasMainStatus &&
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
      // revalidation / webhooks fire, matching a single-locale publish. Best-effort: a
      // reaction failure must not fail the already-committed publish.
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

      // Publishing all locales makes every locale's slug public at once, so bust
      // each localized slug's tag (read post-commit on the pool — publish only
      // flips status, so the committed companion slugs are stable here).
      const publishedLocalizedSlugs = await this.readCompanionSlugsAllLocales(
        this.db,
        params.collectionName,
        params.entryId
      );
      revalidationIntent = buildEntryRevalidationIntent(
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
          localizedSlugs: publishedLocalizedSlugs,
        }
      );

      return {
        success: true,
        statusCode: 200,
        message: "All languages published.",
        data: { id: params.entryId, status: direction.nextStatus },
        eventRecorded,
        revalidationIntent,
      };
    } catch (error) {
      // A publish refused by the under-lock document-rule re-check aborts the
      // transaction; return the 403 it resolved, not a 500.
      if (publishDocDenied) {
        return publishDocDenied;
      }
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error
            ? error.message
            : "Failed to publish all languages",
        data: null,
        // A typed error keeps its own status and code. Hardcoding 500 reported
        // a hook's refusal or rate limit as a server fault, and left a boundary
        // nothing to rebuild it from.
        ...errorEnvelopeFields(error),
      };
    }
  }

  /**
   * Publish ALL languages of an entry at once (i18n M7, spec §10).
   *
   * Unchanged in behaviour and in signature: the route, the dispatcher and the
   * admin hooks that call this keep working. What moved is where the work is
   * stated — see {@link LifecycleDirection}.
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
   * before Draft/Published was enabled on it: `reconcileCompanionColumns`
   * deliberately declines to add the column to an already-provisioned companion,
   * because ADD-then-backfill is not retryable from physical shape alone, and
   * tells the operator to run `nextly migrate` instead. In production, where
   * boot refuses DDL, that state persists.
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
    const companion = await this.fileManager.loadCompanionSchema(
      params.collectionName
    );
    if (
      companion?.hasStatus === true &&
      (await isCompanionReady(this.adapter, companion.companionTableName)) &&
      !(await companionHasStatusColumn(
        this.adapter,
        companion.companionTableName
      ))
    ) {
      return {
        success: false,
        statusCode: 409,
        message:
          `Cannot unpublish every language of '${params.collectionName}': its translation table ` +
          `is missing the per-language status column, so the translations cannot be taken down. ` +
          `This collection was localized before Draft/Published was enabled on it. ` +
          `Run \`nextly migrate\` to add the column, then retry. ` +
          `Nothing was changed.`,
        data: null,
      };
    }
    return this.setLifecycleAllLocales(WITHDRAW_ALL_LOCALES, params);
  }

  /**
   * Whether this user may update the entry, decided without writing anything.
   *
   * The same load-then-check `updateEntry` performs, so it sees the
   * collection's stored per-document rules — owner-only and role-based — which
   * coarse RBAC does not express. For callers that write something OTHER than
   * the document and must still be held to the document's update rules;
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
  }): Promise<boolean> {
    const schema = await this.fileManager.loadDynamicSchema(
      params.collectionName
    );

    // Loaded because owner-only rules compare against the stored row; without
    // it those rules cannot be evaluated at all.
    const [existingEntry] = await this.db
      .select()
      .from(schema)
      .where(eq(schema.id, params.entryId))
      .limit(1);

    // A document that is not there cannot be updated. Answered as a refusal so
    // the caller treats missing and forbidden identically, rather than letting
    // the difference between them be probed.
    if (!existingEntry) return false;

    const denied = await this.accessService.checkCollectionAccess(
      params.collectionName,
      "update",
      params.user,
      params.entryId,
      existingEntry,
      // Never overridden: this exists to APPLY the document's rules, so a
      // caller that could opt out of them would defeat the point.
      false,
      params.routeAuthorized,
      // A scoped API key is judged on its own update grant, so the session
      // super-admin bypass does not apply to a super-admin-owned key here.
      params.authenticatedScope
    );
    return denied === null;
  }

  /**
   * Additionally authorize a write that changes a document's published state.
   *
   * Publishing is an ordinary write that sets `status: "published"`, so the
   * `update`/`create` gate a path already ran does not distinguish it. A move
   * into published needs `publish`, a move out of it needs `unpublish`, and
   * both are ON TOP of the write permission — editing and publishing are
   * separate capabilities. A write that is not a transition returns `null` and
   * nothing extra is required.
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
    entryId?: string;
    document?: Record<string, unknown>;
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

    return this.accessService.checkCollectionAccess(
      args.collectionName,
      operation,
      args.accessUser,
      args.entryId,
      args.document,
      args.overrideAccess,
      // NOT route-authorized, even on a REST write. `routeAuthorized` means the
      // route middleware already ran this exact RBAC check — but the route
      // authorizes a document PATCH/create as `update`/`create`, never as
      // `publish`/`unpublish`, so for the transition operation that assertion
      // does not hold. Passing it through would skip the RBAC check for the very
      // permission this gate exists to enforce, letting any caller who may
      // update/create also publish.
      false,
      // A scoped API key is judged on its own publish/unpublish grant here, not
      // the key owner's.
      args.authenticatedScope
    );
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
  }): Promise<TransitionAuthorization> {
    if (args.overrideAccess) {
      return { publishDenied: null, unpublishDenied: null, documentRule: null };
    }
    const collection = await this.collectionService.getCollection(
      args.collectionName,
      args.executor
    );
    if ((collection as { status?: boolean }).status !== true) {
      return { publishDenied: null, unpublishDenied: null, documentRule: null };
    }
    // A document-dependent stored rule (owner-only or custom) must NOT be judged
    // docless here: owner-only would defer anyway, but a custom rule that denies
    // on absent `id`/`data` would cache a false denial that pre-empts the
    // under-lock recheck. Skip the stored-rule eval for such ops (the RBAC/
    // permission gate still runs) and evaluate the rule against the locked row
    // below via `documentRule`.
    const accessRules = this.accessService.getAccessRules(
      collection as Record<string, unknown>
    );
    const deferPublish = this.accessService.isDocumentDependentRule(
      accessRules?.publish
    );
    const deferUnpublish = this.accessService.isDocumentDependentRule(
      accessRules?.unpublish
    );
    // Resolve both concurrently; each is judged on the caller's own grant (a
    // scoped API key on its scope), never route-authorized — the route attested
    // update/create, never publish/unpublish.
    const [publishDenied, unpublishDenied] = await Promise.all([
      this.accessService.checkCollectionAccess(
        args.collectionName,
        "publish",
        args.accessUser,
        undefined,
        undefined,
        args.overrideAccess,
        false,
        args.authenticatedScope,
        deferPublish,
        args.executor
      ),
      this.accessService.checkCollectionAccess(
        args.collectionName,
        "unpublish",
        args.accessUser,
        undefined,
        undefined,
        args.overrideAccess,
        false,
        args.authenticatedScope,
        deferUnpublish,
        args.executor
      ),
    ]);
    // Owner-only / custom publish/unpublish rules cannot be judged above because
    // they need the specific row (only known under the lock). Pre-fetch the rules
    // + user off the already-loaded collection so the in-transaction step
    // evaluates them against the row-locked document with no further metadata read.
    const documentRule = this.accessService.resolveTransitionDocumentRule(
      collection as Record<string, unknown>,
      args.accessUser,
      args.authenticatedScope
    );
    return { publishDenied, unpublishDenied, documentRule };
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
      // The row a create will persist (owner-stamped `created_by` + final
      // status/data). A create has no prior row to lock, so a deferred
      // owner-only/custom publish rule is judged against this instead.
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
      // its writers) and its committed read is already current. The full row (not
      // just status) is read so an owner-only rule can be judged against the
      // locked owner column below.
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
    const op = resolvePublishTransition(lockedStatus, args.nextStatus);
    if (!op) return null;
    // Permission first (pre-resolved, no DB read): a caller lacking publish-<slug>
    // / unpublish-<slug> is denied regardless of ownership.
    const permissionDenied =
      op === "publish" ? args.auth.publishDenied : args.auth.unpublishDenied;
    if (permissionDenied) return permissionDenied;
    // Then the document-dependent (owner-only/custom) rule. Pre-resolved rules +
    // user are carried on `auth`, so this reads no metadata or permission storage
    // inside the transaction. For an update it is judged against the row-locked
    // document; for a create there is no prior row, so it is judged against the
    // row this create will persist — a deferred owner-only/custom publish rule
    // must still gate a create that lands directly on published (otherwise a
    // public create + owner-only publish could anonymously publish, or a custom
    // publish rule returning false would be skipped on creates).
    const documentForRule = lockedRow ?? args.createDocument ?? null;
    if (args.auth.documentRule && documentForRule) {
      return this.accessService.evaluateTransitionDocumentRule(
        args.auth.documentRule.accessRules,
        op,
        args.auth.documentRule.user,
        documentForRule
      );
    }
    return null;
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
        ? await resolveComponentSchemas(args.fields as unknown as FieldConfig[])
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
  ): Promise<Record<string, unknown>> {
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
    const draftDocument = this.mergeSingleComponentPatches(
      draftBase,
      patchFields,
      fields as unknown as FieldConfig[],
      splitComponentSchemas
    );
    return draftDocument;
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
    const existingDraft = await draftRepo.findWorkingDraft(
      draftRef,
      draftLocale
    );
    // The fields this save actually touched, at the assembled read
    // shape. `patchedDocument` overlaid the current patch onto the live
    // relations and REPLACED a single component whole, so a partial
    // patch is captured here (touched keys only) and merged onto the
    const draftDocument = await this.buildAccumulatedDraft(
      tx,
      ctx,
      existingDraft
    );
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
    await draftRepo.upsertWorkingDraft({
      ref: draftRef,
      // The split is non-localized only, so the working draft is one
      // logical document with no per-locale variant: key it under the
      // unlocalized `locale IS NULL` slot. Keying it by the resolved
      // request locale would orphan it when a later read or publish
      // arrives under a different locale in a localization-configured
      // app. The read overlay and promote use the same null key.
      locale: draftLocale,
      snapshot: draftDocument,
      createdBy: params.user?.id ?? null,
    });

    return { workingDraftDocument, priorWorkingDraftDocument };
  }

  async updateEntry(
    params: {
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
      /**
       * Set when this write restores an earlier version, recording which one on
       * the version it captures. Lineage cannot be inferred afterwards: a
       * restore is an ordinary write that happens to reproduce an earlier state.
       */
      sourceVersionNo?: number;
      // The caller's authenticated scope. For a scoped API-key REST write the
      // publish/unpublish transition gate judges the key's OWN grants, since the
      // route only authorized `update` against the key's scope.
      authenticatedScope?: AuthenticatedScope;
    },
    body: Record<string, unknown>,
    depth?: number
  ): Promise<CollectionServiceResult> {
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
    let previousSlug: string | undefined;
    // Set when the in-transaction transition check refuses the write. Declared
    // out here (not in `try`) so the catch can read it: the adapter wraps a
    // thrown error in a DatabaseError (see VersionConflictError), so `instanceof`
    // no longer identifies the sentinel after the throw, but this result stays
    // correct regardless of how the error is wrapped.
    let transitionDeniedResult: CollectionServiceResult | undefined;
    try {
      // reject an unknown write locale before doing anything else.
      const badLocale = this.rejectInvalidWriteLocale(params.locale);
      if (badLocale) return badLocale;

      const accessUser = params.overrideAccess ? undefined : params.user;

      const schema = await this.fileManager.loadDynamicSchema(
        params.collectionName
      );

      // Fetch the existing entry first (needed for access control and hooks)

      const [existingEntry] = await this.db
        .select()
        .from(schema)
        .where(eq(schema.id, params.entryId))
        .limit(1);

      if (!existingEntry) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

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
      // sufficient: the transaction runs inside `withVersionConflictRetry`,
      // which re-runs its closure up to three attempts, so only work whose
      // repetition is harmless belongs there. Database writes qualify, because
      // a rolled-back attempt leaves nothing behind. Hook dispatch does not,
      // whatever its signature accepts: `CollectionHookService.runBeforeChange`
      // takes an executor and still runs handlers that reach outside this
      // process, so a retried attempt re-fires effects no rollback can
      // withdraw. External dispatch stays outside the retrying closure.
      //
      // A rule that must be judged against the row as locked belongs in the
      // under-lock re-check the publish path already uses, not here.
      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "update",
        accessUser,
        params.entryId,
        existingEntry,
        params.overrideAccess,
        params.routeAuthorized,
        // A scoped API key is judged on its own grants here too, so the session
        // super-admin bypass does not apply to it on the update gate.
        params.authenticatedScope
      );
      if (accessDenied) {
        return accessDenied;
      }

      // Get collection metadata to identify relation fields and hooks
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const fields =
        ((
          (collection as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields as FieldDefinition[]) ||
        ((collection as Record<string, unknown>).fields as FieldDefinition[]) ||
        [];
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      const tableName = this.resolveTableName(
        collection,
        params.collectionName
      );

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = { ...params.context };

      // Execute beforeOperation hooks FIRST (before operation-specific hooks)
      // Can modify operation arguments (id, data) or throw to abort
      const beforeOpArgs =
        await this.hookService.hookRegistry.executeBeforeOperation({
          collection: params.collectionName,
          operation: "update",
          args: { id: params.entryId, data: body },
          user: params.user
            ? { id: params.user.id, email: params.user.email }
            : undefined,
          context: sharedContext,
        });

      // Use modified data if returned by beforeOperation
      const currentData = (beforeOpArgs as BeforeOperationArgs)?.data ?? body;

      // Execute beforeUpdate hooks (code-registered)
      // Hooks run before validation and can modify the incoming data
      const beforeContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "update" as const,
        data: currentData,
        originalData: existingEntry,
        user: params.user,
        context: sharedContext,
      });

      const modifiedData = await this.hookService.hookRegistry.execute(
        "beforeUpdate",
        beforeContext
      );
      const dataAfterCodeHooks = (modifiedData ?? currentData) as Record<
        string,
        unknown
      >;

      // Execute stored beforeUpdate hooks (UI-configured)
      // Runs after code hooks, can further modify data
      const storedBeforeResult =
        await this.hookService.storedHookExecutor.execute(
          "beforeUpdate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "update",
            dataAfterCodeHooks,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
        );
      let finalData = (storedBeforeResult.data ?? dataAfterCodeHooks) as Record<
        string,
        unknown
      >;

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
      await applyFieldWriteAccess({
        kind: "collection",
        slug: params.collectionName,
        data: finalData,
        operation: "update",
        user: params.user,
        overrideAccess: params.overrideAccess,
        id: params.entryId,
      });

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
        const validationIssues = await validateEntryData(
          this.validationView(finalData, fields),
          attachFieldValidators("collection", params.collectionName, fields),
          {
            mode: "update",
            req: params.user ? { user: params.user } : {},
            ...localeCtx,
          }
        );
        if (validationIssues.length > 0) {
          throw NextlyError.validation({ errors: validationIssues });
        }
      }

      // Collection-level beforeChange hooks, on data the validation gate has
      // just passed. Paired with the field-level phase below so the two
      // declarations of that name mean the same moment.
      await this.hookService.runBeforeChange({
        collection: params.collectionName,
        operation: "update",
        data: finalData,
        originalData: existingEntry,
        storedHooks,
        queryDatabase: this.queryDatabaseFn,
        user: params.user,
        sharedContext,
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

      await hashPasswordFieldValues(finalData, fields);

      // Strip an explicit `status: undefined` AFTER every mutating hook has run.
      // A field-level beforeValidate/beforeChange hook can (re)introduce an own
      // `status: undefined`, which names no status change but would otherwise be
      // sanitized to SQL NULL on the raw-parameter path — silently unpublishing a
      // published row, or nulling a create's draft default — without passing the
      // publish/unpublish gate. Placed here, the last status-touching step before
      // the transition classification and the write, so the write payload and the
      // gate agree even when a hook set the undefined.
      stripUndefinedStatus(finalData);

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
        collection
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
        console.log(
          "[updateEntry debug]",
          JSON.stringify({
            collectionName: params.collectionName,
            entryId: params.entryId,
            finalDataKeys: Object.keys(finalData),
            finalDataKeyTypes: keyTypes,
            schemaColumns: Object.keys(schema as unknown as object),
          })
        );
      }

      // i18n M5/M6: pull translatable values out of the main update (finalData uses camelCase field
      // keys) so they update the companion `_locales` row for the write's locale instead. `null` =
      // not localized / companion not migrated yet (values stay on main — dev path, unchanged).
      // The status this write intends to persist, captured before the locale
      // split below removes it from `finalData` for a non-default-locale write
      // (it moves into the companion `_status`). Post-hook value, not the raw
      // body — see the create path.
      const intendedStatus = finalData.status;

      let localizedUpdate = await this.splitLocalizedWriteData(
        params.collectionName,
        finalData,
        params.locale,
        false
      );

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
      // The guard carries the pre-resolved PERMISSION denial (document-
      // independent) plus, when the op's stored rule is document-dependent
      // (owner-only/custom), the rules to re-evaluate against the ROW-LOCKED
      // document inside the transaction — so a custom rule keyed on a mutable
      // field is not judged against the stale pre-transaction `existingEntry`.
      let transitionGuard: {
        op: "publish" | "unpublish";
        permissionDenied: CollectionServiceResult | null;
        documentRule: {
          accessRules: CollectionAccessRules;
          user: UserContext | undefined;
        } | null;
      } | null = null;
      if (
        collectionHasStatus &&
        !params.overrideAccess &&
        transitionNextStatus !== undefined
      ) {
        const transitionOp =
          transitionNextStatus === "published" ? "publish" : "unpublish";
        const storedRules = this.accessService.getAccessRules(
          collection as Record<string, unknown>
        );
        const deferDocumentRule = this.accessService.isDocumentDependentRule(
          storedRules?.[transitionOp]
        );
        const permissionDenied = await this.accessService.checkCollectionAccess(
          params.collectionName,
          transitionOp,
          accessUser,
          params.entryId,
          existingEntry,
          params.overrideAccess,
          // Never route-authorized: the route authorizes the write as `update`,
          // never as `publish`/`unpublish`, so the RBAC check must run.
          false,
          // A scoped API key is judged on its OWN publish/unpublish grant here,
          // not the key owner's — the route only checked `update` against the
          // key's scope.
          params.authenticatedScope,
          deferDocumentRule
        );
        // Pre-fetch the document-dependent rule + user so the in-transaction step
        // evaluates it against the row-locked document with no further metadata read.
        const documentRule = deferDocumentRule
          ? this.accessService.resolveTransitionDocumentRule(
              collection as Record<string, unknown>,
              accessUser,
              params.authenticatedScope
            )
          : null;
        if (permissionDenied || documentRule) {
          transitionGuard = {
            op: transitionOp,
            permissionDenied,
            documentRule,
          };
        }
      }

      // Wrap main update and component data save in a transaction so that
      // a component save failure rolls back the entry update — no partial state.
      // tx.execute() is used for the UPDATE so it runs on the same DB client
      // as the transaction (unlike tx.update() which delegates to the pool).
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
      const isPluginForRestore =
        (
          (collection as Record<string, unknown>).admin as
            | Record<string, unknown>
            | undefined
        )?.isPlugin === true;
      const promoteRestoreCtx: RestoreSchemaContext | null = promotePossible
        ? {
            hasStatus: collectionHasStatus,
            hasSlug: !isPluginForRestore || fields.some(f => f.name === "slug"),
            hasTitle:
              !isPluginForRestore || fields.some(f => f.name === "title"),
            componentSchemas: splitComponentSchemas ?? undefined,
            documentLocalized,
            // A working draft always knows which language it holds: it is keyed
            // by that language, and a write that cannot name one does not store
            // a draft at all. So the snapshot's locale is never the unknown one
            // here, and its translatable values need not be held back.
            localeUnknown: false,
          }
        : null;

      // Revalidate the promoted draft against the CURRENT schema before the
      // transaction opens. The caller validation above ran on the caller's
      // payload only, which for a publish is just `{ status }`; promote then
      // folds the whole accumulated draft into the live write, so a draft field
      // the schema has since made stricter (a tightened `minLength`/`max`/
      // `pattern`/`options`, or an emptied value that is now required) would
      // otherwise reach the live row unchecked. Read the draft advisory rather
      // than under the promote's row lock — validators are pure of the write
      // connection, but a lock taken here would be a second one against a small
      // pool — and validate the SAME merged shape the in-transaction fold
      // persists (`buildRestorePayload` output with the caller's fields on top).
      // The fold below stays authoritative for the write; this only gates it.
      if (promotePossible && promoteRestoreCtx) {
        const advisoryDraft = await new VersionsRepository(
          this.adapter
        ).findWorkingDraft(
          {
            scopeKind: "collection",
            scopeSlug: params.collectionName,
            entryId: params.entryId,
          },
          draftLocaleKey
        );
        if (advisoryDraft) {
          const { payload: draftInput } = buildRestorePayload(
            advisoryDraft.snapshot,
            fields as unknown as FieldConfig[],
            promoteRestoreCtx
          );
          // Assemble the full document the promotion will persist so both the
          // access filter and the validation below judge the real final values.
          // The caller gate above ran on the caller's payload only (a publish
          // sends just the status), and `shapeWriteParts` has already pulled the
          // caller's component and m2m fields out of `finalData`; folding them back
          // in gates a denied value at every depth (top-level, or nested in a
          // group/repeater/component) and covers component and m2m fields, not only
          // columns. The authoritative pass runs again on the locked draft in the
          // transaction (see the promote block).
          const merged = this.assemblePromotedDocument(
            draftInput,
            finalData,
            componentFieldData,
            manyToManyData,
            fields,
            manyToManyFields,
            splitComponentSchemas
          );
          await applyFieldWriteAccess({
            kind: "collection",
            slug: params.collectionName,
            data: merged,
            operation: "update",
            user: params.user,
            overrideAccess: params.overrideAccess,
            id: params.entryId,
          });
          const localeCtx = await this.localizedRequiredContext(
            params.collectionName,
            params.locale
          );
          const promoteIssues = await validateEntryData(
            this.validationView(merged, fields),
            attachFieldValidators("collection", params.collectionName, fields),
            {
              mode: "update",
              req: params.user ? { user: params.user } : {},
              ...localeCtx,
            }
          );
          if (promoteIssues.length > 0) {
            throw NextlyError.validation({ errors: promoteIssues });
          }
        }
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
      // `withVersionConflictRetry` re-runs the closure on a version_no conflict,
      // and the promote fold inside it rebinds these payloads (and sets the
      // pending-draft document). Capture the caller's own shaped input so each
      // attempt starts from it rather than from a prior attempt's merged draft.
      const baseFinalData = { ...finalData };
      const baseManyToManyData = { ...manyToManyData };
      const baseComponentFieldData = { ...componentFieldData };
      await withVersionConflictRetry(() =>
        this.adapter.transaction(async tx => {
          recorded = false;
          // Reset the payloads the promote fold rebinds, so a retried attempt
          // re-decides the split from the caller's input; and clear the pending
          // draft document, so a stale one from a promoted attempt cannot suppress
          // the outbox/reaction events or the revalidation intent of a committed
          // live write on the retry.
          finalData = { ...baseFinalData };
          manyToManyData = { ...baseManyToManyData };
          componentFieldData = { ...baseComponentFieldData };
          workingDraftDocument = undefined;
          // `let` because promote-on-publish rebinds it from the merged
          // draft+payload after the working draft is folded in below. Annotated
          // rather than inferred: the literal's own shape would refuse the
          // first-publish stamp appended before the UPDATE is assembled.
          let updatePayload: Record<string, unknown> = {
            ...stripImmutableSystemFields(finalData, "collection"),
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
          if (preUpdateRow) {
            // The main row holds no translatable values and, for a per-locale
            // status, no current status either — both live in the companion.
            // Without them `previous` would omit every localized field that
            // `data` carries, so the diff would report untouched translations as
            // changed and lose the old value of the ones that did change.
            const previousLocalizedValues = localizedUpdate
              ? await this.readCompanionLocalizedValues(
                  tx,
                  params.collectionName,
                  params.entryId,
                  localizedUpdate.writeLocale
                )
              : {};
            // The locale's committed status, read before the write. Gated on
            // `hasStatus` rather than on the patch carrying a status: a content-
            // only translation update still has to report THIS locale's status,
            // which can differ from the main row (a German draft under a
            // published entry). The gate is what keeps the read safe — companion
            // `_status` exists only on collections migrated for per-locale
            // status, and querying it otherwise fails the whole write.
            committedLocaleStatus =
              localizedUpdate && localizedUpdate.hasStatus
                ? await this.readCompanionStatus(
                    tx,
                    localizedUpdate.companionTableName,
                    params.entryId,
                    localizedUpdate.writeLocale
                  )
                : null;
            const previousCompanionStatus = committedLocaleStatus;
            const previousParent = this.deserializeJsonFieldsForSnapshot(
              {
                ...convertTimestampsToCamelCase({
                  ...(preUpdateRow as Record<string, unknown>),
                }),
                ...previousLocalizedValues,
                ...(previousCompanionStatus !== null
                  ? { status: previousCompanionStatus }
                  : {}),
              },
              fields
            );
            stripPasswordFieldValues(previousParent, fields);
            stripSystemOwnerField(previousParent);
            const { components: previousComponents, manyToMany: previousM2M } =
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
            previousDocument = assembleDocument({
              parentRow: previousParent,
              components: previousComponents,
              manyToMany: previousM2M,
            });

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
            if (firesOnMainRow || firesOnCompanion) {
              // Permission first (pre-resolved, no DB read): a caller lacking
              // publish-<slug>/unpublish-<slug> is denied regardless of the row.
              if (transitionGuard.permissionDenied) {
                transitionDeniedResult = transitionGuard.permissionDenied;
                throw new StatusTransitionDeniedError();
              }
              // Then the deferred document-dependent (owner-only/custom) rule,
              // judged against the ROW-LOCKED document (`preUpdateRow`) — not the
              // stale pre-transaction `existingEntry` — so a custom rule keyed on
              // a mutable field sees the committed value this update transitions
              // from. Pure evaluation, no metadata or permission read.
              if (transitionGuard.documentRule && preUpdateRow) {
                const documentDenied =
                  await this.accessService.evaluateTransitionDocumentRule(
                    transitionGuard.documentRule.accessRules,
                    transitionGuard.op,
                    transitionGuard.documentRule.user,
                    preUpdateRow as Record<string, unknown>
                  );
                if (documentDenied) {
                  transitionDeniedResult = documentDenied;
                  throw new StatusTransitionDeniedError();
                }
              }
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
          if (promotePossible && promoteRestoreCtx) {
            const workingDraft = await new VersionsRepository(
              tx
              // The split is non-localized only, so the working draft is keyed
              // under the unlocalized `locale IS NULL` slot — the same key the
              // read overlay and the store use, so a publish under any request
              // locale still finds the pending draft it would show the editor.
            ).findWorkingDraft(
              {
                scopeKind: "collection",
                scopeSlug: params.collectionName,
                entryId: params.entryId,
              },
              draftLocaleKey
            );
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
                if (transitionGuard.documentRule && preUpdateRow) {
                  const promoteDenied =
                    await this.accessService.evaluateTransitionDocumentRule(
                      transitionGuard.documentRule.accessRules,
                      transitionGuard.op,
                      transitionGuard.documentRule.user,
                      preUpdateRow as Record<string, unknown>
                    );
                  if (promoteDenied) {
                    transitionDeniedResult = promoteDenied;
                    throw new StatusTransitionDeniedError();
                  }
                }
              }
              // The snapshot is stored read-shaped, so buildRestorePayload turns
              // it into a safe update input (immutable ids stripped, removed
              // columns and password fields dropped, component subtrees whose
              // schema no longer resolves reported rather than written blind).
              // Shaping that input through the SAME pure pass the caller's input
              // took yields matching column and relation parts, so merging the
              // caller over the draft (caller wins per key, including the
              // published/draft `status`) and rebinding makes the writes below
              // persist the promoted content with no separate code path.
              const { payload: draftInput } = buildRestorePayload(
                workingDraft.snapshot,
                fields as unknown as FieldConfig[],
                promoteRestoreCtx
              );
              // Assemble the full document the promotion persists (the locked
              // draft, the caller's scalars overlaid, the caller's single-component
              // patches merged onto the draft's components, and the caller's m2m),
              // then filter it through the current field-level write access. A rule
              // that depends on a sibling the publish patch supplies (e.g. a field
              // writable only when `approved` is true, where the publish sets it
              // false) is judged on the real final values, and a denied value is
              // dropped at any depth for column, component, and m2m fields alike.
              // Re-extracting the write parts from the FILTERED document keeps a
              // denied component/m2m value out of the persisted parts, which the
              // earlier after-access merge would have restored.
              const mergedPromoteData = this.assemblePromotedDocument(
                draftInput,
                finalData,
                componentFieldData,
                manyToManyData,
                fields,
                manyToManyFields,
                splitComponentSchemas
              );
              await applyFieldWriteAccess({
                kind: "collection",
                slug: params.collectionName,
                data: mergedPromoteData,
                operation: "update",
                user: params.user,
                overrideAccess: params.overrideAccess,
                id: params.entryId,
              });
              const draftParts = this.shapeWriteParts(
                mergedPromoteData,
                fields,
                manyToManyFields,
                collection
              );
              finalData = mergedPromoteData;
              componentFieldData = draftParts.componentFieldData;
              manyToManyData = draftParts.manyToManyData;
              // Rebuild the companion payload from the promoted document, and
              // do it BEFORE the main-row payload is taken: the split moves a
              // localized field out of the document and into the companion, so
              // taking the main payload first would carry translated values to
              // the main table, which has no column for them.
              //
              // It was originally split from the CALLER's patch before this
              // transaction, and a publish carries no content of its own — so
              // without this the draft's translated values never reach the
              // language's row at all and the translation publishes unchanged.
              //
              // Bound to this transaction's executor: the companion metadata
              // read would otherwise take a second pooled connection that this
              // open transaction is holding.
              localizedUpdate = await this.splitLocalizedWriteData(
                params.collectionName,
                finalData,
                draftLocaleKey ?? params.locale,
                false,
                tx.getDrizzle()
              );
              updatePayload = {
                ...stripImmutableSystemFields(finalData, "collection"),
                updatedAt: updatePayload.updatedAt,
              };
              promotedDraft = true;
            }
          }

          // Dialect-aware identifier quoting and placeholder syntax.
          // PostgreSQL: "col" = $1   MySQL: `col` = ?   SQLite: "col" = $1 (convertPlaceholders handles →?)
          const isMysql = this.dialect === "mysql";
          const quoteId = (id: string) => (isMysql ? `\`${id}\`` : `"${id}"`);
          const sqlParams: unknown[] = [];
          const makePlaceholder = () =>
            this.dialect === "postgresql"
              ? `$${sqlParams.length}` // length already incremented by push below
              : "?";

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

          const setClauses = Object.entries(updatePayload)
            .map(([key, val]) => {
              sqlParams.push(val);
              return `${quoteId(toSnakeCase(key))} = ${makePlaceholder()}`;
            })
            .join(", ");
          sqlParams.push(params.entryId);
          // Skip the live-row UPDATE for a draft edit — the pending
          // change is stored as the working draft below, not written to the row.
          if (!storeAsWorkingDraft) {
            await tx.execute(
              `UPDATE ${quoteId(tableName)} SET ${setClauses} WHERE ${quoteId("id")} = ${makePlaceholder()}`,
              sqlParams as (
                | string
                | number
                | boolean
                | Date
                | null
                | undefined
              )[]
            );
          }

          // Capture the committed per-locale `_status` BEFORE the upsert so the
          // post-commit event can report the real prior value. Only when the
          // write actually changes this locale's status (companion `_status` is
          // present only when `status` was explicitly in the patch).
          if (
            !storeAsWorkingDraft &&
            localizedUpdate &&
            typeof localizedUpdate.companionData._status === "string"
          ) {
            localizedPreviousStatus = await this.readCompanionStatus(
              tx,
              localizedUpdate.companionTableName,
              params.entryId,
              localizedUpdate.writeLocale
            );
          }

          // i18n M5: upsert the translatable values into the companion row for the write's locale
          // (same transaction). Only the provided localized columns are touched.
          if (
            !storeAsWorkingDraft &&
            localizedUpdate &&
            Object.keys(localizedUpdate.companionData).length > 0
          ) {
            await upsertCompanionRow(
              companionWriteVia(tx, this.dialect),
              localizedUpdate.companionTableName,
              params.entryId,
              localizedUpdate.writeLocale,
              localizedUpdate.companionData
            );
          }

          // Clone per attempt: saveComponentDataInTransaction mutates the
          // component data in place (hashing password fields, assigning row
          // ids), so a conflict retry must start from the user's original
          // values — not a previously-hashed copy — and the snapshot below uses
          // this same post-save copy (ids populated) rather than the raw input.
          const attemptComponentData = structuredClone(componentFieldData);

          // Save component field data to separate comp_{slug} tables
          if (
            !storeAsWorkingDraft &&
            this.fieldGroupDataService &&
            Object.keys(attemptComponentData).length > 0
          ) {
            await this.fieldGroupDataService.saveComponentDataInTransaction(
              tx,
              {
                parentId: params.entryId,
                parentTable: tableName,
                fields: fields as unknown as FieldConfig[],
                data: attemptComponentData,
                // i18n: thread the write locale so an embedded localized component writes
                // translatable fields to its companion within the same transaction.
                locale: params.locale,
                // A component instance is validated by its own pass inside the field-group
                // service, so the request has to travel with it for a field rule nested in
                // a field group to see the same `user` a top-level field rule sees.
                req: params.user ? { user: params.user } : {},
              }
            );
          }

          // Replace many-to-many junction rows inside the transaction so a
          // junction failure rolls back the update (atomic write). The entry is
          // already known to exist (validated before the transaction). The
          // tx-scoped Drizzle handle binds the junction writes to this tx.
          const txExecutor = tx.getDrizzle<RelationshipDbExecutor>();
          for (const field of manyToManyFields) {
            if (
              !storeAsWorkingDraft &&
              manyToManyData[field.name] !== undefined
            ) {
              await this.relationshipService.deleteManyToManyRelations(
                params.collectionName,
                params.entryId,
                field,
                txExecutor
              );
              const relatedIds = manyToManyData[field.name];
              if (relatedIds.length > 0) {
                await this.relationshipService.insertManyToManyRelations(
                  params.collectionName,
                  params.entryId,
                  field,
                  relatedIds,
                  txExecutor
                );
              }
            }
          }

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
              const effectiveLocaleStatus =
                typeof companionStatus === "string"
                  ? companionStatus
                  : (committedLocaleStatus ??
                    (localizedUpdate?.hasStatus && writesCompanionRow
                      ? COMPANION_DEFAULT_STATUS
                      : null));
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
                  ...(localizedUpdate?.localizedFieldValues ?? {}),
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
              stripPasswordFieldValues(parentRow, fields);
              // Strip the system owner column (created_by) — see create path.
              stripSystemOwnerField(parentRow);
              const {
                components: snapshotComponents,
                manyToMany: snapshotM2M,
              } = await this.buildFullSnapshotRelations(
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
                Object.keys(localizedUpdate?.localizedFieldValues ?? {})
                  .length > 0 ||
                typeof effectiveLocaleStatus === "string" ||
                // Components were read as the write locale just above, so a
                // translation edit touching only embedded component content is
                // locale-specific too — the singles path counts it the same way.
                Object.keys(snapshotComponents ?? {}).length > 0;

              if (versionsConfig?.enabled && !storeAsWorkingDraft) {
                await captureInTx(tx, this.versionCapture, {
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
                  contentStatus:
                    (updatePayload as { status?: unknown }).status ??
                    effectiveLocaleStatus ??
                    (currentParent as { status?: unknown }).status,
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
                  locale: capturedLocaleState
                    ? (localizedUpdate?.writeLocale ??
                      this.componentSnapshotLocale(params.locale))
                    : null,
                  sourceVersionNo: params.sourceVersionNo ?? null,
                  maxPerDoc: versionsConfig.maxPerDoc,
                });
              }

              // A status-less update to a published document is stored
              // as the working draft — the live row and its relations were left
              // untouched above — instead of updating the live row and capturing
              // a published version. The parent overlay already produced the
              // intended parent with no write; overlay the in-memory intended
              // relations onto the (unchanged) live relations read for the
              // snapshot so a changed component/m2m field is reflected.
              if (storeAsWorkingDraft) {
                const draftWrite = await this.storeWorkingDraftInTx(tx, {
                  collection,
                  collectionHasStatus,
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
                  snapshotComponents,
                  snapshotM2M,
                  splitComponentSchemas,
                  updatePayload,
                });
                workingDraftDocument = draftWrite.workingDraftDocument;
                priorWorkingDraftDocument =
                  draftWrite.priorWorkingDraftDocument;
              }

              // Promote-on-publish: the accumulated draft has been folded
              // into the live write above, so drop the sidecar in the SAME
              // transaction — its content is now the live row, and a surviving
              // draft would shadow the freshly published document on the next
              // trusted read. Uses the locale key the fetch used, so it removes
              // exactly the row that was promoted.
              if (promotedDraft) {
                await new VersionsRepository(tx).deleteWorkingDraft(
                  {
                    scopeKind: "collection",
                    scopeSlug: params.collectionName,
                    entryId: params.entryId,
                  },
                  // Same unlocalized key the fetch and store use.
                  draftLocaleKey
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
                await new VersionsRepository(tx).deleteWorkingDraft(
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
                await new VersionsRepository(tx).deleteWorkingDraft(
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
              recorded =
                recorded || mainStatusRecorded || localizedStatusRecorded;

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
        })
      );
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

      // A pure draft edit leaves the live row untouched, so the re-fetched
      // `updated` is the OLD published content. Everything that reports what this
      // update produced — the response, the afterUpdate/afterChange hooks — uses
      // the pending draft document instead.
      const responseSource = (workingDraftDocument ?? updated) as Record<
        string,
        unknown
      >;

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

      // Execute afterUpdate hooks (code-registered)
      // Hooks run after database update completes (for side effects)
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "update" as const,
        data: responseSource,
        // On a repeat status-less save `responseSource` is the accumulated draft,
        // so diff it against the prior draft rather than the unchanged published
        // row; otherwise a hook reports an earlier save's fields as changing again.
        originalData: priorWorkingDraftDocument ?? existingEntry,
        user: params.user,
        context: sharedContext, // Pass shared context from beforeUpdate
      });

      await this.hookService.hookRegistry.execute("afterUpdate", afterContext);

      // Execute stored afterUpdate hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "afterUpdate",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "update",
          responseSource,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      // Post-commit reaction event (D8/D51). Skipped for a pure draft edit: the
      // live document did not change, so no cache reaction is owed — mirroring
      // the outbox `entry.updated` event, which is already suppressed above.
      if (!workingDraftDocument) {
        emitCollectionEvent(
          "updated",
          params.collectionName,
          updated,
          params.user
        );
      }

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
      const nextStatus = (updated as { status?: unknown }).status;
      if (typeof nextStatus === "string" && nextStatus !== previousStatus) {
        this.transitionStatus({
          collection: params.collectionName,
          id: (updated as { id?: unknown }).id,
          data: { ...(updated as Record<string, unknown>) },
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
          id: (updated as { id?: unknown }).id,
          data: { ...(updated as Record<string, unknown>) },
          user: params.user,
          previousStatus: localizedPreviousStatus,
          status: localizedNextStatus,
          emitStatusChanged: true,
          locale: localizedUpdate.writeLocale,
        });
      }

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
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "afterChange",
        data: responseSource,
        operation: "update",
        user: params.user,
      });

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
          console.warn(
            "Failed to expand relationships in updateEntry response:",
            expansionError
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
        },
        params.collectionName
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
      // See createEntry's catch — legacy override messages are dropped in
      // favour of fromDatabaseError's spec-compliant generic strings.
      // Pass dialect explicitly so the helper can normalise raw driver errors.
      return {
        ...errorToServiceResult(
          error,
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
   * Delete an entry.
   * Applies collection-level access control and hooks.
   *
   * Security checks are applied in order:
   * 1. Collection-level access (AccessControlService)
   *
   * @param params - Collection name, entry ID, and optional user context
   * @returns Deletion result or error
   */
  async deleteEntry(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    /** Who performed the delete, recorded on the outbox event. */
    actor?: RequestActor;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /** When true, the route middleware already ran the RBAC gate; stored rules
     * are still enforced. See CollectionAccessService.checkCollectionAccess. */
    routeAuthorized?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
    /**
     * The caller's authenticated scope. A scoped API key is judged on its OWN
     * delete grant here, so the session super-admin bypass does not apply to a
     * super-admin-owned key on the delete gate.
     */
    authenticatedScope?: AuthenticatedScope;
  }): Promise<CollectionServiceResult> {
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

      // 1. Check collection-level access FIRST (with document for owner checks)
      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "delete",
        accessUser,
        params.entryId,
        entry,
        params.overrideAccess,
        params.routeAuthorized,
        // A scoped API key is judged on its own delete grant, so the session
        // super-admin bypass does not apply to a super-admin-owned key here.
        params.authenticatedScope
      );
      if (accessDenied) {
        return accessDenied;
      }

      // Get collection metadata for stored hooks
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      const tableName = this.resolveTableName(
        collection,
        params.collectionName
      );

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = { ...params.context };

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
      });

      await this.hookService.hookRegistry.execute(
        "beforeDelete",
        beforeContext
      );

      // Execute stored beforeDelete hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "beforeDelete",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "delete",
          entry,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
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
      });
      // Set only after the transaction resolves: `deletedRow` is true exactly
      // when the delete committed, so a commit failure never flags a durable
      // event that isn't there; a later hook failure must not hide it. `recorded`
      // is false when the collection opted out, so an opted-out delete schedules
      // no drain.
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

      // Execute afterDelete hooks (code-registered)
      // Hooks run after deletion completes (for cleanup)
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "delete" as const,
        data: deleted,
        user: params.user,
        context: sharedContext, // Pass shared context from beforeDelete
      });

      await this.hookService.hookRegistry.execute("afterDelete", afterContext);

      // Execute stored afterDelete hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "afterDelete",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "delete",
          deleted,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      // Post-commit reaction event (D8/D51).
      emitCollectionEvent(
        "deleted",
        params.collectionName,
        deleted,
        params.user
      );

      return {
        success: true,
        statusCode: 200,
        message: "Entry deleted successfully",
        data: { deleted: true },
        eventRecorded,
        revalidationIntent,
        committed: committedWrite,
      };
    } catch (error: unknown) {
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
    return this.createEntryWrite(tx, params, body, {
      enforceCollectionAccess: true,
      runHooks: true,
      shapeCallerObject: true,
      failureMessage: "Failed to create entry in transaction",
    });
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
    // Computed right after the row is written (before response redaction can
    // strip the slug, and before the after-hooks run) and carried on every
    // post-write return, so a committed item whose after-hook then throws still
    // surfaces its intent to the batch caller. Hoisted so the catch return sees it.
    let revalidationIntent: RevalidationIntent | undefined;
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
        const accessDenied = await this.accessService.checkCollectionAccess(
          params.collectionName,
          "create",
          params.user,
          undefined,
          undefined,
          params.overrideAccess,
          params.routeAuthorized,
          undefined,
          undefined,
          txExecutor
        );
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

      // The transaction API has always shaped the caller's own object in place;
      // the batch worker shapes a copy. Both are preserved so neither caller's
      // observable behaviour changes here.
      let currentData: Record<string, unknown> = options.shapeCallerObject
        ? body
        : { ...body };

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = {};

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
            this.hookService.buildPrebuiltHookContext(
              params.collectionName,
              "create",
              currentData,
              this.queryDatabaseFn,
              params.user,
              sharedContext,
              // Bind a stored hook's uniqueness read to the caller's transaction
              // connection so it does not re-enter the pool from inside the tx.
              tx.getDrizzle()
            )
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
      await this.applyGeneratedSlugAndTitle(finalData, isSlugTaken);

      // Field-level write access: fields the caller may not create are
      // stripped (Payload parity); a system write (no user) or an
      // explicit override bypasses.
      await applyFieldWriteAccess({
        kind: "collection",
        slug: params.collectionName,
        data: finalData,
        operation: "create",
        user: params.user,
        overrideAccess: params.overrideAccess,
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
        await this.reSanitizeSlug(finalData, isSlugTaken);
      }

      {
        const validationIssues = await validateEntryData(
          this.validationView(finalData, fields),
          attachFieldValidators("collection", params.collectionName, fields),
          {
            mode: "create",
            req: params.user ? { user: params.user } : {},
          }
        );
        if (validationIssues.length > 0) {
          throw NextlyError.validation({ errors: validationIssues });
        }
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
        });
        await runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "beforeChange",
          data: finalData,
          operation: "create",
          user: params.user,
        });
        // A beforeChange hook can also set `slug`, so re-sanitize before
        // storage.
        await this.reSanitizeSlug(finalData, isSlugTaken);
      }

      await hashPasswordFieldValues(finalData, fields);

      // Strip an explicit `status: undefined` AFTER every mutating hook has run.
      // A field-level beforeValidate/beforeChange hook can (re)introduce an own
      // `status: undefined`, which names no status change but would otherwise be
      // sanitized to SQL NULL on the raw-parameter path — silently unpublishing a
      // published row, or nulling a create's draft default — without passing the
      // publish/unpublish gate. Placed here, the last status-touching step before
      // the transition classification and the write, so the write payload and the
      // gate agree even when a hook set the undefined.
      stripUndefinedStatus(finalData);

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
        if (finalData[field.name]) {
          manyToManyData[field.name] = Array.isArray(finalData[field.name])
            ? (finalData[field.name] as string[])
            : [finalData[field.name] as string];
          delete finalData[field.name];
        }
      });

      this.serializeHasManyRelationships(finalData, fields);

      // Convert date-field strings into `Date` objects so Drizzle can bind
      // them to `timestamp` columns. See `coerceDateFieldsToDate` for the
      // failure mode this guards against.
      coerceDateFieldsToDate(finalData, fields);

      // Prepare entry data
      const nowForTxCreate = new Date();
      const entryData = {
        id: this.collectionService.generateId(),
        // Strip client-supplied system columns (id / timestamps / created_by,
        // both snake and camel) so the generated id, stamped owner, and
        // timestamps below are authoritative — a stray `createdBy` alias can't
        // survive to overwrite the owner stamp.
        ...stripImmutableSystemFields(finalData, "collection"),
        // Snake_case keys: the runtime Drizzle schema names these columns
        // created_at / updated_at / created_by, and the adapter maps by column
        // name. (The prior camelCase createdAt/updatedAt keys here were ignored
        // by Drizzle and only "worked" via the columns' DB defaults — but a
        // strict driver like better-sqlite3 rejects the whole insert once any
        // unknown key is present, so bulk create needs the real column names.)
        created_at: nowForTxCreate,
        updated_at: nowForTxCreate,
        // Stamp the row owner with the creating user's id so owner-only access
        // works zero-config. Null for system/seed creates (no user context).
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

      // Insert using transaction context
      const entry = await tx.insert<unknown>(tableName, entryData, {
        returning: "*",
      });

      // Junction rows, the version snapshot, the outbox event and the
      // revalidation intent, all on the caller's transaction.
      const createEffects = await this.recordCreateSideEffects(tx, {
        collectionName: params.collectionName,
        tableName,
        entry: entry as Record<string, unknown>,
        collection,
        fields,
        manyToManyFields,
        manyToManyData,
        user: params.user,
        actor: params.actor,
      });
      const eventRecorded = createEffects.eventRecorded;
      revalidationIntent = createEffects.revalidationIntent;

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
        });

        await this.hookService.hookRegistry.execute(
          "afterCreate",
          afterContext
        );

        // Execute stored afterCreate hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "afterCreate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "create",
            entry,
            this.queryDatabaseFn,
            params.user,
            sharedContext,
            // Bind a stored hook's uniqueness read to the caller's transaction
            // connection so it does not re-enter the pool from inside the tx.
            tx.getDrizzle()
          )
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
        },
        params.collectionName
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
          error,
          { defaultMessage: options.failureMessage },
          this.dialect
        ),
        revalidationIntent,
      };
    }
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
    return this.updateEntryWrite(tx, params, params.entryId, body, {
      rowGate: "access-service",
      runHooks: true,
      identifyMissingEntry: false,
      failureMessage: "Failed to update entry in transaction",
    });
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
    // Computed right after the row is updated (before redaction can strip the
    // slug and before the after-hooks run) and carried on every post-write
    // return, so a committed item whose after-hook then throws still surfaces
    // its intent to the batch caller.
    let revalidationIntent: RevalidationIntent | undefined;
    try {
      // Get collection metadata to identify relation fields. Runs on the
      // caller's transaction connection so this per-entry read does not re-enter
      // the pool from inside the transaction (which can stall against a small pool).
      const { collection, fields, storedHooks, tableName } =
        await this.readCollectionWriteMeta(
          params.collectionName,
          tx.getDrizzle()
        );

      // When update access is `owner-only`, fold the ownership
      // predicate into the SQL WHERE clause of the initial fetch. A
      // non-owner sees a 404, never gets the row back, and the
      // post-fetch check below stays as a defense-in-depth guard for
      // any future caller that might mutate the fetch logic.
      // Two shapes of the same question — may this user write this row. The
      // batch worker folds an owner predicate into the fetch, so a row the
      // caller may not touch never leaves the database; the transaction API
      // fetches by id and asks the access service, which also applies RBAC and
      // route authorization. They are not interchangeable, so the caller picks
      // one and neither path's behaviour moves.
      const ownerConstraint =
        options.rowGate === "owner-predicate"
          ? await this.accessService.getOwnerConstraint(
              params.collectionName,
              "update",
              params.user,
              // A trusted override must not have an owner predicate forced onto its
              // fetch, or it would 404 rows it is entitled to update.
              params.overrideAccess,
              // A scoped API key keeps the owner predicate even when owned by a
              // super-admin, so a batch update judges the key on its OWN grant.
              params.authenticatedScope,
              // Bound to the caller's transaction connection so the metadata read does
              // not re-enter the pool from inside the transaction.
              tx.getDrizzle()
            )
          : null;
      const fetchWhere = ownerConstraint
        ? this.whereAnd({
            id: entryId,
            [ownerConstraint.field]: ownerConstraint.value,
          })
        : this.whereEq("id", entryId);

      // Fetch existing entry first (needed for owner checks and hooks). Lock the
      // row (`forUpdate`, a no-op on SQLite, which already serializes writers) so
      // a concurrent rename cannot commit between this read and the update below,
      // which would otherwise leave the `previousSlug` captured here stale and
      // the prior URL's cache tag unbusted.
      const existingEntry = await tx.selectOne<Record<string, unknown>>(
        tableName,
        { where: fetchWhere, forUpdate: true }
      );

      if (!existingEntry) {
        return {
          success: false,
          statusCode: 404,
          message: options.identifyMissingEntry
            ? `Entry not found: ${entryId}`
            : "Entry not found",
          data: null,
        };
      }

      if (options.rowGate === "owner-predicate") {
        // Defense-in-depth: the WHERE-clause filter above is the
        // load-bearing check. This explicit comparison is a safety net
        // that fires only if a future refactor accidentally weakens the
        // fetch query — at which point we'd rather return 403 than
        // silently let a non-owner through.
        const accessRules = this.accessService.getAccessRules(
          collection as Record<string, unknown>
        );

        // A super-admin bypasses stored rules on every transport — EXCEPT via a
        // scoped API key, which is judged on its own grant (mirrors the owner
        // predicate + checkCollectionAccess). So the safety net still fires for a
        // scoped key even when the key owner is a super-admin.
        const isScopedApiKey =
          params.authenticatedScope?.actorType === "apiKey";
        if (
          accessRules?.update?.type === "owner-only" &&
          params.user &&
          // A trusted override (overrideAccess) and a super-admin SESSION bypass
          // stored rules on every transport, including the batch transaction
          // path — mirror the SQL owner-predicate bypass so this safety net does
          // not re-impose owner-only on them. A scoped API key is not covered by
          // the super-admin bypass.
          !params.overrideAccess &&
          !(this.accessService.isSuperAdmin(params.user) && !isScopedApiKey)
        ) {
          // Default to the auto-stamped system owner column (snake_case, matching
          // the runtime schema and raw rows) so zero-config owner-only works.
          const ownerField = accessRules.update.ownerField ?? "created_by";
          const ownerId = existingEntry[ownerField];
          if (ownerId !== params.user.id) {
            return {
              success: false,
              statusCode: 403,
              message: "You can only update your own entries",
              data: null,
            };
          }
        }
      } else {
        // The transaction API asks the access service for the whole verdict:
        // RBAC, stored rules and the owner check together, judged on the row it
        // just fetched, with the caller's overrideAccess / routeAuthorized
        // forwarded.
        const accessDenied = await this.accessService.checkCollectionAccess(
          params.collectionName,
          "update",
          params.user,
          entryId,
          existingEntry,
          params.overrideAccess,
          params.routeAuthorized,
          undefined,
          undefined,
          tx.getDrizzle()
        );
        if (accessDenied) {
          return accessDenied;
        }
      }

      let currentData: Record<string, unknown> = { ...body };

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = {};

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
            this.hookService.buildPrebuiltHookContext(
              params.collectionName,
              "update",
              currentData,
              this.queryDatabaseFn,
              params.user,
              sharedContext,
              // Bind a stored hook's uniqueness read to the caller's transaction
              // connection so it does not re-enter the pool from inside the tx.
              tx.getDrizzle()
            )
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
      await applyFieldWriteAccess({
        kind: "collection",
        slug: params.collectionName,
        data: finalData,
        operation: "update",
        user: params.user,
        overrideAccess: params.overrideAccess,
        id: entryId,
      });

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
        const validationIssues = await validateEntryData(
          this.validationView(finalData, fields),
          attachFieldValidators("collection", params.collectionName, fields),
          {
            mode: "update",
            req: params.user ? { user: params.user } : {},
          }
        );
        if (validationIssues.length > 0) {
          throw NextlyError.validation({ errors: validationIssues });
        }
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
        });
        await runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "beforeChange",
          data: finalData,
          operation: "update",
          user: params.user,
        });
      }

      await hashPasswordFieldValues(finalData, fields);

      // Strip an explicit `status: undefined` AFTER every mutating hook has run.
      // A field-level beforeValidate/beforeChange hook can (re)introduce an own
      // `status: undefined`, which names no status change but would otherwise be
      // sanitized to SQL NULL on the raw-parameter path — silently unpublishing a
      // published row, or nulling a create's draft default — without passing the
      // publish/unpublish gate. Placed here, the last status-touching step before
      // the transition classification and the write, so the write payload and the
      // gate agree even when a hook set the undefined.
      stripUndefinedStatus(finalData);

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

      this.serializeHasManyRelationships(finalData, fields);

      // Convert date-field strings into `Date` objects so Drizzle can bind
      // them to `timestamp` columns. See `coerceDateFieldsToDate` for the
      // failure mode this guards against.
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
        draftLocale: draftLocale,
      } = await this.resolveWorkingDraftHold({
        collection,
        fields,
        namedStatus: finalData.status,
        liveStatus: existingEntry.status,
      });

      // Skip the live-row UPDATE for a held edit; the pending change is stored
      // below instead.
      const [updated] = storeAsWorkingDraft
        ? [existingEntry]
        : await tx.update<unknown>(
            tableName,
            {
              ...stripImmutableSystemFields(finalData, "collection"),
              updatedAt: nowForUpdate,
              ...(updateStamp ? { first_published_at: updateStamp } : {}),
            },
            this.whereEq("id", entryId),
            { returning: "*" }
          );

      if (!updated) {
        return {
          success: false,
          statusCode: 404,
          message: options.identifyMissingEntry
            ? `Entry not found: ${entryId}`
            : "Entry not found",
          data: null,
        };
      }

      // Compute the intent from the updated row and the pre-update row, before
      // the after-hooks run or redaction can strip the slug. The previous slug
      // (from existingEntry) lets a batch rename bust the old slug tag too.
      revalidationIntent = buildEntryRevalidationIntent(
        params.collectionName,
        readRevalidateConfig(collection),
        {
          id: entryId,
          slug: readStringField(updated as Record<string, unknown>, "slug"),
          previousSlug: readStringField(existingEntry, "slug"),
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
      const needsRelations =
        !!versionsConfig?.enabled ||
        recordsActivity ||
        !isRecordingDisabledByConfig("collection", params.collectionName);
      // The `previous` document is carried by the outbox event and by the
      // trail's changed-field names, never by the version snapshot: a
      // version-only update that records neither still skips it instead of
      // paying a second full relational walk whose result is discarded.
      const previousNeedsRelations =
        recordsActivity ||
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
          parentRow: this.readShapeEventDocument(existingEntry, fields),
          fields,
          manyToManyFields,
          // A held edit needs the live relations regardless of what is being
          // recorded: they are the base the pending change accumulates onto.
          needsRelations: previousNeedsRelations || storeAsWorkingDraft,
        });

      // Store the pending edit rather than the live row, through the same
      // method the other two paths use.
      let workingDraftDocument: Record<string, unknown> | undefined;
      if (storeAsWorkingDraft) {
        ({ workingDraftDocument: workingDraftDocument } =
          await this.storeWorkingDraftInTx(tx, {
            collection,
            collectionHasStatus:
              (collection as { status?: boolean }).status === true,
            componentFieldData: {},
            draftLocale: draftLocale,
            fields,
            manyToManyData,
            params: {
              collectionName: params.collectionName,
              entryId,
              user: params.user,
            },
            parentRow: this.readShapeEventDocument(
              {
                ...existingEntry,
                ...stripImmutableSystemFields(finalData, "collection"),
              },
              fields
            ),
            snapshotComponents: previousParts.components,
            snapshotM2M: previousParts.manyToMany,
            splitComponentSchemas: splitComponentSchemas,
            updatePayload: finalData,
          }));
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
            fields
          ),
          fields,
          manyToManyFields,
          needsRelations,
        });
      // A held edit records no durable version: nothing was published.
      if (!storeAsWorkingDraft) {
        await this.captureTxVersion(tx, {
          collectionName: params.collectionName,
          entryId,
          contentStatus: (updated as { status?: unknown }).status,
          createdBy: params.user?.id ?? null,
          versionsConfig,
          documentParts: updatedParts,
          fields,
        });
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
        },
        data: updatedDocument,
        previous: previousDocument,
        fields: eventFields,
        actor: eventActor,
      });
      if ((collection as { status?: boolean }).status === true) {
        const statusRecorded = await this.recordStatusEvents(tx, {
          collection: params.collectionName,
          id: entryId,
          from: readStringField(existingEntry, "status") ?? null,
          to: (updated as { status?: unknown }).status as
            | string
            | null
            | undefined,
          isCreate: false,
          data: updatedDocument,
          previous: previousDocument,
          fields: eventFields,
          actor: eventActor,
        });
        eventRecorded = eventRecorded || statusRecorded;
      }

      // Execute afterUpdate hooks (unless skipped)
      if (options.runHooks) {
        // Execute afterUpdate hooks (code-registered)
        const afterContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "update" as const,
          data: updated,
          originalData: existingEntry,
          user: params.user,
          context: sharedContext,
          // Bind an after-hook that reads via context.executor to the caller's
          // transaction connection so it does not re-enter the pool from the tx.
          executor: tx.getDrizzle(),
        });

        await this.hookService.hookRegistry.execute(
          "afterUpdate",
          afterContext
        );

        // Execute stored afterUpdate hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "afterUpdate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "update",
            updated,
            this.queryDatabaseFn,
            params.user,
            sharedContext,
            // Bind a stored hook's uniqueness read to the caller's transaction
            // connection so it does not re-enter the pool from inside the tx.
            tx.getDrizzle()
          )
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
          data: updated as Record<string, unknown>,
          operation: "update",
          user: params.user,
        });
      }

      await this.redactResponseFields(
        updated as Record<string, unknown>,
        fields,
        {
          user: params.user,
          overrideAccess: params.overrideAccess,
          routeAuthorized: params.routeAuthorized,
        },
        params.collectionName
      );

      return {
        success: true,
        statusCode: 200,
        message: "Entry updated successfully",
        // A held edit answers with the pending document, not the live row.
        data: workingDraftDocument ?? updated,
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
          error,
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
      /** Who performed the delete, recorded on the outbox event. */
      actor?: RequestActor;
    }
  ): Promise<CollectionServiceResult<{ deleted: boolean }>> {
    return this.deleteEntryWrite(tx, params, params.entryId, {
      rowGate: "access-service",
      runHooks: true,
      identifyMissingEntry: false,
      failureMessage: "Failed to delete entry in transaction",
    });
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
    try {
      // Get collection metadata early. Runs on the caller's transaction
      // connection so this read does not re-enter the pool from inside the
      // transaction (which can stall against a small pool).
      const collection = await this.collectionService.getCollection(
        params.collectionName,
        tx.getDrizzle()
      );

      const tableName = this.resolveTableName(
        collection,
        params.collectionName
      );

      // When delete access is `owner-only`, fold the ownership
      // predicate into the SQL WHERE clause of the initial fetch.
      // The post-fetch check below remains as a defense-in-depth
      // guard.
      // Two shapes of the same question — may this user delete this row. The
      // batch worker folds an owner predicate into the fetch so a row the caller
      // may not touch never leaves the database; the transaction API fetches by
      // id and asks the access service for the whole verdict. Selected by the
      // caller so neither path's behaviour moves.
      const ownerConstraint =
        options.rowGate === "owner-predicate"
          ? await this.accessService.getOwnerConstraint(
              params.collectionName,
              "delete",
              params.user,
              // A trusted override must not have an owner predicate forced onto its
              // fetch, or it would 404 rows it is entitled to delete.
              params.overrideAccess,
              // This worker carries no scoped-API-key context (unlike the update
              // worker); the owner predicate is resolved from the session user only.
              undefined,
              // Bound to the caller's transaction connection so the metadata read does
              // not re-enter the pool from inside the transaction.
              tx.getDrizzle()
            )
          : null;
      const fetchWhere = ownerConstraint
        ? this.whereAnd({
            id: entryId,
            [ownerConstraint.field]: ownerConstraint.value,
          })
        : this.whereEq("id", entryId);

      // Fetch entry first (needed for owner checks and hooks)
      const entry = await tx.selectOne<Record<string, unknown>>(tableName, {
        where: fetchWhere,
      });

      if (!entry) {
        return {
          success: false,
          statusCode: 404,
          message: options.identifyMissingEntry
            ? `Entry not found: ${entryId}`
            : "Entry not found",
          data: null,
        };
      }

      // See updateSingleEntryInTransaction for the rationale:
      // WHERE-clause filter is load-bearing, this comparison is the
      // safety net.
      const accessRules = this.accessService.getAccessRules(
        collection as Record<string, unknown>
      );
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      if (options.rowGate === "owner-predicate") {
        if (
          accessRules?.delete?.type === "owner-only" &&
          params.user &&
          // A trusted override (overrideAccess) and super-admins both bypass
          // stored rules on every transport, including the batch transaction
          // path — mirror the SQL owner-predicate bypass so this safety net does
          // not re-impose owner-only on them.
          !params.overrideAccess &&
          !this.accessService.isSuperAdmin(params.user)
        ) {
          // Default to the auto-stamped system owner column (snake_case, matching
          // the runtime schema and raw rows) so zero-config owner-only works.
          const ownerField = accessRules.delete.ownerField ?? "created_by";
          const ownerId = entry[ownerField];
          if (ownerId !== params.user.id) {
            return {
              success: false,
              statusCode: 403,
              message: "You can only delete your own entries",
              data: null,
            };
          }
        }
      } else {
        // The transaction API asks the access service for the whole verdict —
        // RBAC, stored rules and the owner check together — judged on the row it
        // just fetched.
        const accessDenied = await this.accessService.checkCollectionAccess<{
          deleted: boolean;
        }>(
          params.collectionName,
          "delete",
          params.user,
          entryId,
          entry,
          undefined,
          undefined,
          undefined,
          undefined,
          tx.getDrizzle()
        );
        if (accessDenied) {
          return accessDenied;
        }
      }

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = {};

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
        });

        await this.hookService.hookRegistry.execute(
          "beforeDelete",
          beforeContext
        );

        // Execute stored beforeDelete hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "beforeDelete",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "delete",
            entry,
            this.queryDatabaseFn,
            params.user,
            sharedContext,
            // Bind a stored hook's uniqueness read to the caller's transaction
            // connection so it does not re-enter the pool from inside the tx.
            tx.getDrizzle()
          )
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
          message: options.identifyMissingEntry
            ? `Entry not found: ${entryId}`
            : "Entry not found",
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

      if (deletedCount === 0) {
        return {
          success: false,
          statusCode: 404,
          message: options.identifyMissingEntry
            ? `Entry not found: ${entryId}`
            : "Entry not found",
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
      // The event is recorded, so the delete + event are now consistent; a later
      // failure no longer needs to force a rollback.
      deleteNeedsRollback = false;
      // False when the collection opted out — nothing to drain post-commit.
      eventRecorded = deleteRecorded;

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
        });

        await this.hookService.hookRegistry.execute(
          "afterDelete",
          afterContext
        );

        // Execute stored afterDelete hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "afterDelete",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "delete",
            entry,
            this.queryDatabaseFn,
            params.user,
            sharedContext,
            // Bind a stored hook's uniqueness read to the caller's transaction
            // connection so it does not re-enter the pool from inside the tx.
            tx.getDrizzle()
          )
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
    } catch (error: unknown) {
      // Only a failure in the delete→event window propagates (to roll back an
      // eventless delete). Pre-delete failures and post-event failures (e.g. an
      // afterDelete hook) stay soft: the row is either untouched or already
      // consistent with its event, so a returned failure is safe.
      if (deleteNeedsRollback) throw error;
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
    return this.createEntryWrite(tx, params, body, {
      enforceCollectionAccess: false,
      runHooks: !skipHooks,
      shapeCallerObject: false,
      failureMessage: "Failed to create entry",
    });
  }

  /**
   * Update one entry of a batch, on the batch's shared transaction.
   *
   * The batch services check collection access and resolve the publish
   * transition ONCE per batch, before the transaction opens, so this per-entry
   * path applies the owner predicate directly — see `updateEntryWrite`.
   *
   * @param skipHooks - Skip user hooks; a bulk-import option, not a fast path
   *   around validation, access or recording, none of which are hooks.
   */
  async updateSingleEntryInTransaction(
    tx: TransactionContext,
    params: UpdateEntryWriteParams,
    entryId: string,
    body: Record<string, unknown>,
    skipHooks: boolean
  ): Promise<CollectionServiceResult<unknown>> {
    return this.updateEntryWrite(tx, params, entryId, body, {
      rowGate: "owner-predicate",
      runHooks: !skipHooks,
      identifyMissingEntry: true,
      failureMessage: "Failed to update entry",
    });
  }

  /**
   * Delete one entry of a batch, on the batch's shared transaction.
   *
   * The batch services check collection access ONCE per batch, before the
   * transaction opens, so this per-entry path applies the owner predicate
   * directly — see `deleteEntryWrite`.
   *
   * @param skipHooks - Skip user hooks; a bulk-import option, not a fast path
   *   around access or recording, neither of which is a hook.
   */
  async deleteSingleEntryInTransaction(
    tx: TransactionContext,
    params: DeleteEntryWriteParams,
    entryId: string,
    skipHooks: boolean
  ): Promise<CollectionServiceResult<{ deleted: boolean }>> {
    return this.deleteEntryWrite(tx, params, entryId, {
      rowGate: "owner-predicate",
      runHooks: !skipHooks,
      identifyMissingEntry: true,
      failureMessage: "Failed to delete entry",
    });
  }
}
