/**
 * Publish every language of a Single in one transaction.
 *
 * The collection entry path has had this since i18n M7; a Single had no
 * equivalent, so a translated Single could only be published one language at a
 * time, through as many writes as it had translations — and a failure partway
 * left half the document live.
 *
 * Its own service rather than another method on `SingleMutationService`: that
 * class already carries a 2000-line `update`, and this write shares almost none
 * of its shape. `update` persists caller content at ONE locale and derives the
 * status transition from it; this one persists no content, writes a status it
 * chose itself, and spans every locale at once. Extending `BaseService` the way
 * every other service here does gives it the adapter, the logger and the WHERE
 * builder without either duplicating them or reaching into a sibling.
 *
 * @module domains/singles/services/single-publish-all
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  TransactionContext,
  WhereClause,
} from "@nextlyhq/adapter-drizzle/types";

import {
  ownDatabaseVisitor,
  visitorWithoutAccessService,
} from "../../../auth/access/own-database-visitor";
import {
  askEachLanguage,
  withRuleLanguage,
  writeLanguagesFor,
} from "../../../auth/access/rule-language";
import { actorForWrite } from "../../../auth/request-actor";
import type { FieldConfig } from "../../../collections/fields/types";
import {
  asNotMigrated,
  type NotMigratedEntity,
  singleNotMigrated,
} from "../../../database/with-db-errors";
import type { RBACAccessControlService } from "../../../domains/auth/services/rbac-access-control-service";
import { errorEnvelopeFields } from "../../../errors/from-service-envelope";
import { NextlyError } from "../../../errors/nextly-error";
import type { HookRegistry } from "../../../hooks/hook-registry";
import {
  inTransactionHandlersFor,
  runInTransactionPhaseFor,
} from "../../../hooks/in-transaction-call";
import type { InTransactionHandlerSet } from "../../../hooks/in-transaction-phase";
import { resolveRequestFacts } from "../../../hooks/request-facts";
import {
  buildSingleRevalidationIntent,
  readRevalidateConfig,
} from "../../../revalidation/intent-builders";
import type { DynamicSingleRecord } from "../../../schemas/dynamic-singles/types";
import type { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import { BaseService } from "../../../shared/base-service";
import { convertTimestampsToCamelCase } from "../../../shared/lib/case-conversion";
import {
  getFieldFunctions,
  resolvedCallerGrants,
  runFieldHooks,
  type CallerGrants,
  type VisitorGrantsLoader,
} from "../../../shared/lib/field-level-registry";
import type { Logger } from "../../../shared/types";
import type { PublicationFacts } from "../../audit/record-activity";
import {
  type LifecycleParts,
  movesLanguage,
  movesShared,
} from "../../collections/services/all-locales-lifecycle";
import { fieldTrustOf } from "../../collections/services/collection-query-service";
import {
  publishCallerOf,
  publishGate,
  type PublishGateVerdict,
  type PublishPart,
} from "../../collections/services/publish-gate";
import {
  type PartsField,
  type PartsReads,
  type PartsState,
  publishValueIssues,
} from "../../collections/services/publish-parts";
import { refusePublishEarly } from "../../collections/services/save-door-gate";
import { entryWriteContext } from "../../collections/services/stored-field-read";
import {
  partsMovesRecord,
  recordTransitionEvents,
  type StatusMove,
} from "../../content-events/write-event";
import { refuseWriteIfRemovedFromCode } from "../../dynamic-collections/services/removed-from-code-writes";
import {
  readComponentSubtrees,
  readComponentSubtreesByLocale,
} from "../../field-groups/read-component-subtrees";
import {
  fieldGroupWriteAccessOf,
  type FieldGroupWriteAccess,
} from "../../field-groups/services/field-group-mutation-service";
import { readCompanionLocaleStatusAll } from "../../i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
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
} from "../../i18n/localization-source";
import {
  perLanguageFieldNames,
  reachesLocalizedFieldGroup,
} from "../../i18n/per-language-fields";
import {
  publishesPerLanguage,
  storesPerLanguage,
} from "../../i18n/per-language-storage";
import {
  buildCompanionSchema,
  type CompanionSchema,
} from "../../i18n/runtime/companion-io";
import {
  cachedCompanionReadiness,
  companionFoundMissing,
  companionNotReadyMessage,
  isCompanionReady,
} from "../../i18n/runtime/companion-readiness";
import { captureInTx } from "../../versions/capture-in-tx";
import { partsTogether, type ChangedParts } from "../../versions/changed-parts";
import {
  bumpDocumentRevision,
  documentVersionOn,
  revisionBumpColumns,
  translationRevisionBumpColumns,
  translationTableOf,
  versionLanguagesFor,
  withDocumentVersion,
} from "../../versions/document-revision";
import { draftComponentValues } from "../../versions/draft-components";
import { schemaDraftSplit } from "../../versions/draft-split-eligibility";
import { recordOverwriteIfAsked } from "../../versions/overwrite-record";
import {
  draftSlotParts,
  draftsKeptByPart,
  SHARED_DRAFT_SLOT,
} from "../../versions/part-drafts";
import {
  judgeSharedValues,
  type LanguageOutcome,
  languagesGoingLiveAsStored,
  languagesTold,
  type LiveSharedDocument,
  type NamedVerdict,
  nameVerdict,
  type PendingChange,
  pendingChangesByLanguage,
  pendingChangesInSaveOrder,
  type PublishableShape,
  promotionBlockers,
  promotionIssuesOf,
  type PublishAllBlocker,
  type RefuseSharedFields,
  sharedStateForPublish,
  storedLanguageOutcomes,
  withVerdictState,
} from "../../versions/publish-all-plan";
import {
  differingFields,
  type FieldNameReader,
  readableFieldNames,
  releaseAllSharedBases,
  releaseSharedBase,
  sharedValuesConflict,
  snapshotRecord,
} from "../../versions/shared-publish-base";
import {
  assertVersionNamesEvery,
  givenOf,
  languagesJudged,
  poolRevisionReader,
  refuseIfMainMoved,
  releaseRunExemptFor,
  type StaleWriteHolder,
  staleVersionErrorFor,
  type VersionCheck,
  versionCheckFor,
} from "../../versions/stale-version";
import {
  type ComponentFieldResolver,
  resolveComponentFieldMap,
  stripSingleComponentTags,
  tagComponentTypes,
  tagNestedComponentTypes,
} from "../../versions/tag-component-types";
import { VersionCaptureService } from "../../versions/version-capture-service";
import { versionConflictRetries } from "../../versions/version-conflict";
import { VersionsRepository } from "../../versions/versions-repository";
import { expandComponentFields } from "../../webhooks/expand-component-fields";
import {
  recordMutationEvent,
  recordSingleSaveActivity,
} from "../../webhooks/record-mutation-event";
import { isOutboxRecordingActive } from "../../webhooks/recording-activation";
import type { WebhookResource } from "../../webhooks/types";
import type {
  PublishAllSingleLocalesOptions,
  SingleDocument,
  SingleResult,
  UserContext,
} from "../types";

import {
  splitPendingChange,
  writeCompanionValues,
} from "./apply-pending-change";
import { resolveSingleForRequest } from "./ensure-runtime-table";
import { liveSharedSingle } from "./live-shared-single";
import {
  assertDraftsMayBePromoted,
  liveStoredDocument,
  promoteCallerFor,
  readsSingleInEveryLanguage,
} from "./promote-gate";
import { runSingleAfterUpdateHooks } from "./single-after-update";
import {
  runSingleStatusMoveBeforeHooks,
  type SingleBeforeHookCall,
} from "./single-before-update";
import { recordSingleProvenance } from "./single-provenance";
import {
  checkSingleAccess,
  getSingleHookCollection,
  singleGrantRefusal,
  type SingleQueryService,
} from "./single-query-service";
import type { SingleRegistryService } from "./single-registry-service";
import { buildSingleErrorResult } from "./single-utils";
import {
  buildSingleWebhookDoc,
  readCompanionLocaleValues,
  readCompanionValuesByLocale,
} from "./single-webhook-doc";

/**
 * What a publish-all reports back: the document it acted on, and the status it
 * moved to. `status` is absent only for a Single with no draft/published
 * lifecycle, where the call is a no-op and nothing moved.
 */
export interface PublishAllSingleResult {
  id: string;
  status?: "published";
  /**
   * Every language's version once the publish has committed.
   *
   * @experimental An update that hands it back is refused when it is no
   *   longer the current version (`STALE_VERSION`).
   */
  _rev?: string;
  /**
   * What the publish did to each configured language, as its preview said it
   * would. Empty for a Single whose languages carry no status of their own,
   * and absent where the Single has no lifecycle to publish.
   */
  languages?: LanguageOutcome[];
}

/**
 * What a publish of every language would do, without doing it: each configured
 * language's outcome, and what in the shared values would refuse the publish
 * as a whole. The field rules the promotion is judged by are not asked here:
 * the publish answers to them when it runs. A language
 * whose pending change is out of date is one of the outcomes, naming the
 * shared fields the caller may read and counting the others, as the
 * publish's refusal does.
 */
export interface PublishAllSinglePreview {
  id: string;
  languages: LanguageOutcome[];
  blockers: PublishAllBlocker[];
}

/**
 * A move of the parts a caller chose, as a publish or unpublish of chosen parts hands it to this
 * service: which parts move, every one where `parts` is absent.
 *
 * @experimental
 */
export interface SinglePartsMove {
  parts?: LifecycleParts;
}

/** What moving a Single's parts is told: the options of a publish, and the move of chosen parts. */
export type SinglePartsOptions = PublishAllSingleLocalesOptions & {
  /**
   * Present where the move is a publish or unpublish of chosen parts, whose value rules are
   * judged again under the lock; absent, every part moves.
   */
  partsMove?: SinglePartsMove;
  /**
   * A publish made without review, with the caller's reason, as the request asked for it: told to
   * the publish gate, never stored by the move.
   */
  withoutReview?: { reason: string };
};

/** What an unpublish of chosen parts reports back: the Single, and its version once committed. */
export interface UnpublishSinglePartsResult {
  id: string;
  /** Every language's version once the unpublish has committed. */
  _rev?: string;
}

/** One stored language as a publish of chosen parts judges it; see `PartsState`. */
interface PartsLanguage {
  live: boolean;
  values: Readonly<Record<string, unknown>>;
  pendingSharedEdits?: readonly string[];
}

/** Whether a move of `parts` moves the part kept under `locale`: the shared part for none. */
function movesPart(
  parts: LifecycleParts | undefined,
  locale: string | null
): boolean {
  return locale === null ? movesShared(parts) : movesLanguage(parts, locale);
}

/**
 * Everything the publish acts on, resolved once before the transaction opens.
 *
 * Gathered up front because the transaction body may RE-RUN: the version-conflict retry
 * (`versionConflictRetries`) replays it on a version_no race, and anything resolved inside would be
 * resolved again — including the permission reads, which would then take a
 * second connection while this write holds its own.
 */
interface PublishPlan {
  slug: string;
  singleMeta: DynamicSingleRecord;
  existingDoc: SingleDocument;
  /** Whether the MAIN row carries the draft/published lifecycle. */
  hasMainStatus: boolean;
  companion: CompanionSchema | null;
  /** Whether the companion exists AND carries a per-locale `_status`. */
  companionPublishable: boolean;
  /** Whether the translation table is there to read. */
  companionReady: boolean;
  fieldConfigs: FieldConfig[];
  recordingEnabled: boolean;
  /**
   * The in-transaction handlers this publish runs, asked once before the
   * transaction, so every attempt runs the same set and reads what it needs.
   */
  inTransactionHandlers: InTransactionHandlerSet;
  /**
   * Whether anything hears this publish once it is durable: the Single's
   * `afterUpdate` hooks (its own and those heard on every type) or its
   * fields' functions, which hold their `afterChange`. Asked before the
   * transaction, so the documents they are handed are read in it only where
   * someone will be handed them.
   */
  runsUpdateHooks: boolean;
  /**
   * Whether the Single may have working drafts, as its schema read reports.
   * A stored draft is promoted only while it does: one left from before the
   * schema made it ineligible is hidden from every read.
   */
  draftsEligible: boolean;
  actor: ReturnType<typeof actorForWrite>;
  /**
   * The parts this move moves, where it moves fewer than all of them: only their pending changes
   * are promoted, their statuses written and their rules asked. Absent, every part moves.
   */
  parts?: LifecycleParts;
}

/** What the committed transaction tells the caller it owes afterwards. */
interface PublishOutcome {
  /** The row was gone by the time the lock was taken; nothing was written. */
  documentVanished: boolean;
  /** A content write is durable, so cache tags and retention are owed. */
  committed: boolean;
  /** A durable outbox event was appended, so the fast drain is owed. */
  eventRecorded: boolean;
  /** Every language's version after the publish, read in its transaction. */
  version?: string;
  /** What the publish did to each configured language. */
  languages: LanguageOutcome[];
  /**
   * The document after and before the publish, read in its transaction, for
   * the update hooks run once it commits. Absent where none will run.
   */
  hookDocuments?: {
    /** The language a run is for: one whose pending change went live. */
    locale?: string;
    data: Record<string, unknown>;
    previous: Record<string, unknown>;
  }[];
}

/**
 * How a publish of every language is judged by the version its caller gave,
 * and what a refusal inside its transaction leaves for its answer once that
 * rolls back: the holder, and the document the lock was taken on.
 */
interface PublishAllStale {
  check: VersionCheck;
  holder: StaleWriteHolder;
  id?: string;
}

/**
 * The status the trail reads as the one before a publish of every language,
 * from each language's status read under the lock: published only when every
 * one already was, so a publish that puts any language live, or promotes
 * pending edits onto a live one, is told from a save.
 */
function statusBeforePublish(
  statuses: readonly (string | null | undefined)[]
): string | null | undefined {
  if (statuses.every(status => status === "published")) return "published";
  return statuses.find(status => status !== "published") ?? null;
}

export class SinglePublishAllService extends BaseService {
  /** Stateless version-capture service, used inside the publish transaction. */
  private readonly versionCapture = new VersionCaptureService();

  /** The site's languages as they are now: the source may be the language registry. */
  private get localization(): SanitizedLocalizationConfig | undefined {
    return localizationNow(this.localizationSource);
  }

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly singleRegistryService: SingleRegistryService,
    private readonly fieldGroupDataService?: FieldGroupDataService,
    private readonly rbacAccessControlService?: RBACAccessControlService,
    private readonly localizationSource?: LocalizationSource,
    /** Reads the promote gate needs: the logical shape, and the live document. */
    private readonly queryService?: SingleQueryService,
    /**
     * Where the Single's in-transaction handlers are registered. Without one a
     * publish runs no in-transaction phase.
     */
    private readonly hookRegistry?: HookRegistry
  ) {
    super(adapter, logger);
  }

  /**
   * Where this service's Single gate and promotion field rules read a
   * visitor's Public grants: the read service's, built over the same database
   * and access-control service, so publishing judges the Public role the read
   * and update paths do. A service built without one reads its own database
   * the same way.
   */
  private get fieldRuleVisitor(): VisitorGrantsLoader | undefined {
    if (this.queryService) return this.queryService.fieldRuleVisitor;
    return visitorWithoutAccessService(
      this.rbacAccessControlService,
      ownDatabaseVisitor({
        adapter: this.adapter,
        logger: this.logger,
        db: () => this.db,
      })
    );
  }

  /**
   * Set every language of this Single to published, atomically.
   *
   * The main row's status and every companion `_status` move in ONE
   * transaction, so a document is never left half-live: the state a reader can
   * observe is either the whole document before the publish or the whole
   * document after it.
   *
   * Authorized as `update-{slug}` (which the REST route already ran) plus
   * `publish-{slug}`, because editing and publishing are separate capabilities
   * — the same split the ordinary write path enforces for a status change.
   */
  async publishAllLocales(
    slug: string,
    // A publish of chosen parts carries them here, with the gate it asks under the lock.
    options: SinglePartsOptions = {}
  ): Promise<SingleResult<PublishAllSingleResult>> {
    // Refused first when the Single is removed from code, before any hook or
    // read of its document, so a refused write changes nothing.
    await refuseWriteIfRemovedFromCode("single", slug);
    this.logger.debug("Publishing all languages of a Single", { slug });

    // A refusal inside the transaction (the languages going live changed under
    // the lock) is kept here, since the rollback re-wraps what it throws.
    const refused: { denied?: SingleResult<PublishAllSingleResult> } = {};
    // The Single's translations table, once known, for the catch below.
    let translationsTable: string | undefined;
    // Judged against the version the caller read, when it sent one, as a save
    // is: a publish from an out-of-date view would put live what the publisher
    // never saw. A refusal inside the transaction is kept here, and answered
    // once it has rolled back.
    const stale: PublishAllStale = {
      check: { kind: "unjudged" },
      holder: {},
    };

    // One context and one account of the request for every hook of the
    // publish, before and after it, as a save shares them between its phases.
    const sharedContext: Record<string, unknown> = { ...options.context };
    const requestFacts = resolveRequestFacts(options.request);

    try {
      stale.check = versionCheckFor(
        { ...options.data },
        {
          exempt: releaseRunExemptFor({ scopeKind: "single", scopeSlug: slug }),
        }
      );
      const resolved = await this.resolvePublishTarget(slug, options);
      if ("result" in resolved) return resolved.result;
      const plan = resolved.plan;
      const hookCall: SingleBeforeHookCall = {
        slug,
        id: plan.existingDoc.id,
        // Compared against as a save's hooks compare: in its read shape.
        originalData:
          this.queryService?.deserializeJsonFields(
            plan.existingDoc,
            plan.fieldConfigs
          ) ?? plan.existingDoc,
        user: options.user,
        context: sharedContext,
        req: requestFacts,
      };
      translationsTable = plan.companion?.companionTableName;
      // Every language this moves is judged, so the version must name each
      // one: asked before any work only a publish needs.
      const judged = this.everyLanguageJudged(plan, stale.check);

      // The publish permission and rule, asked once for each language this
      // puts live, before the transaction and off its connection: a rule is
      // the app's own code and may read the database. The lock re-reads what
      // goes live, and asks nothing. Asked before the grants and readiness
      // below too, so a caller who may not publish is refused before any of
      // the work only a publish needs.
      const askedLanguages = await this.languagesAsStored(
        this.adapter,
        plan,
        (plan.existingDoc as { status?: unknown }).status
      );
      const denied = await this.refusedInEachLanguage(
        plan,
        options,
        askedLanguages
      );
      if (denied) return denied;

      // The publish gate's early answer, before any hook runs: a publish the gate holds back runs
      // none, whichever door it came through. A publish of chosen parts (`partsMove`) asked it
      // already with the rest of its request. The verdict under the row lock follows either way.
      if (options.partsMove === undefined) {
        const statuses =
          plan.companion && plan.companionPublishable
            ? await this.readPriorCompanionStatuses(
                this.adapter,
                plan.companion,
                plan.existingDoc.id,
                plan.slug
              )
            : new Map<string, string | null>();
        await refusePublishEarly({
          scope: { kind: "single", slug: plan.slug },
          entryId: plan.existingDoc.id,
          direction: "publish",
          parts: this.gatePartsOf(plan),
          live: {
            languages: [...statuses]
              .filter(([, status]) => status === "published")
              .map(([locale]) => locale),
            shared:
              (plan.existingDoc as { status?: unknown }).status === "published",
          },
          caller: publishCallerOf(options),
          ...(options.actor === undefined ? {} : { actor: options.actor }),
          ...(options.withoutReview === undefined
            ? {}
            : { withoutReview: options.withoutReview }),
        });
      }

      // The hooks a status change of one language runs before it writes, run
      // once for the publish of every language: after the caller is known to
      // be allowed to make it, and before anything is written, so a site's
      // rule refuses this as it refuses a save. Run outside the transaction,
      // as a save runs them: the transaction may re-run on a version
      // conflict, and a hook's effects outside it could not be withdrawn.
      await runSingleStatusMoveBeforeHooks(
        this.hookRegistry,
        hookCall,
        "published"
      );

      // Resolved here because the gate that uses them runs inside the write
      // transaction, and resolving grants queries the pooled connection that
      // transaction is holding.
      const promoteGrants = await resolvedCallerGrants(
        options.user,
        options.authenticatedScope,
        this.fieldRuleVisitor
      );
      // Whether the caller may read the Single, which decides what a refusal
      // of the promotion may name; asked here for the same reason. Trusted
      // code is told every issue, so it is not asked.
      const promoteReads =
        options.overrideAccess === true
          ? undefined
          : await this.readsSingle(plan.slug, options);

      // Every component type's readiness, resolved before the transaction:
      // the drafts' component values are written inside it, where a verdict
      // can only be read, and an unknown one reads as unavailable. The payload
      // is empty, so this warms and refuses nothing.
      await this.fieldGroupDataService?.assertLocalizedFieldGroupsWritable({
        fields: plan.fieldConfigs,
        data: {},
        locale: undefined,
      });

      const outcome = await this.adapter.transaction(
        tx =>
          this.commitPublish(
            tx,
            plan,
            options,
            refused,
            askedLanguages,
            promoteGrants,
            promoteReads,
            { stale, languages: judged, personName: options.user?.name ?? null }
          ),
        versionConflictRetries()
      );

      // The document was deleted out from under the publish: nothing was
      // written or recorded, so answer not-found rather than reporting success
      // for content that is gone.
      if (outcome.documentVanished) {
        return {
          success: false,
          statusCode: 404,
          message: `Single "${slug}" has no document to publish`,
        };
      }

      // A publish of every language is an update of the Single, so the hooks
      // an update runs once it is durable run for it: inside an enclosing
      // SQLite transaction, once that commits, and never for one it rolls
      // back. A hook's failure is recorded, not thrown: the publish stands.
      const hookDocuments = outcome.hookDocuments;
      if (hookDocuments !== undefined) {
        await this.afterCommit(async () => {
          for (const documents of hookDocuments) {
            const run = () => this.runUpdateHooks(hookCall, documents);
            // A run for one language's pending change is told that language,
            // as a publish of that language alone is; a move of statuses alone
            // is told every language it moved.
            await (documents.locale === undefined
              ? run()
              : withRuleLanguage(
                  { locale: documents.locale, locales: [documents.locale] },
                  run
                ));
          }
        });
      }

      return {
        success: true,
        statusCode: 200,
        message: "All languages published.",
        data: withDocumentVersion(
          {
            id: plan.existingDoc.id,
            status: "published" as const,
            languages: outcome.languages,
          },
          outcome.version
        ),
        eventRecorded: outcome.eventRecorded,
        committed: outcome.committed,
        // A Single is consumed sitewide, so its one tag is the whole cascade.
        // Built whenever a row was written, including for a Single that opts
        // out of recording: a committed content write must still bust its tag.
        revalidationIntent: outcome.committed
          ? buildSingleRevalidationIntent(
              slug,
              readRevalidateConfig(plan.singleMeta)
            )
          : undefined,
      };
    } catch (error) {
      if (refused.denied) return refused.denied;
      const staleRefusal = await this.staleRefusal(slug, options, stale);
      if (staleRefusal) return staleRefusal;
      const gone = this.translationsGoneRefusal(slug, translationsTable, error);
      if (gone) throw gone;
      throw await publishAllFailure(
        error,
        singleNotMigrated(this.singleRegistryService, slug, {
          trusted: fieldTrustOf(options),
        })
      );
    }
  }

  /**
   * The hooks an update of the Single runs once it is durable, run for a
   * publish of every language: the fields' `afterChange`, then the Single's
   * `afterUpdate`, over the document the publish committed, as a save runs
   * them over the document it wrote. What they return reshapes nothing: the
   * publish answers with its languages, not the document.
   */
  private async runUpdateHooks(
    call: SingleBeforeHookCall,
    documents: {
      data: Record<string, unknown>;
      previous: Record<string, unknown>;
    }
  ): Promise<void> {
    await runFieldHooks({
      kind: "single",
      slug: call.slug,
      phase: "afterChange",
      data: documents.data,
      operation: "update",
      user: call.user,
    });
    if (this.hookRegistry === undefined) return;
    await runSingleAfterUpdateHooks(this.hookRegistry, {
      slug: call.slug,
      data: documents.data,
      originalData: documents.previous,
      user: call.user,
      // The context the publish's before hooks shared.
      context: call.context,
      req: call.req,
    });
  }

  /**
   * What publishing every language would do, language by language, without
   * doing it.
   *
   * Asked as the publish is asked: the same refusals before any read (a
   * Single removed from code, no Single, no document) and the same publish
   * permission and rule in each language it would put live, so a caller who
   * may not publish is not told what a publish would do. Then the same
   * verdict, read on a transaction that writes nothing and takes no lock.
   */
  async previewPublishAllLocales(
    slug: string,
    // A description of a publish of chosen parts carries them here; its gate is never judged.
    options: SinglePartsOptions = {}
  ): Promise<SingleResult<PublishAllSinglePreview>> {
    await refuseWriteIfRemovedFromCode("single", slug);
    let translationsTable: string | undefined;
    try {
      const resolved = await this.resolvePublishTarget(slug, options);
      if ("result" in resolved) return previewOf(resolved.result);
      const { plan } = resolved;
      translationsTable = plan.companion?.companionTableName;
      const askedLanguages = await this.languagesAsStored(
        this.adapter,
        plan,
        (plan.existingDoc as { status?: unknown }).status
      );
      const denied = await this.refusedInEachLanguage(
        plan,
        options,
        askedLanguages
      );
      if (denied) return previewOf(denied);
      // Resolved before the transaction, as the publish resolves them: they
      // query the pooled connection.
      const promoteGrants = await resolvedCallerGrants(
        options.user,
        options.authenticatedScope,
        this.fieldRuleVisitor
      );
      // Whether the caller may read the Single, which decides what the
      // gate's refusal may name, asked as the publish asks it.
      const promoteReads =
        options.overrideAccess === true
          ? undefined
          : await this.readsSingle(plan.slug, options);
      const preview = await this.adapter.transaction(tx =>
        this.previewIn(tx, plan, { options, promoteGrants, promoteReads })
      );
      return {
        success: true,
        statusCode: 200,
        message: "What publishing every language does.",
        data: { id: plan.existingDoc.id, ...preview },
      };
    } catch (error) {
      // Answered as the publish answers it: a translations table found
      // missing, then a database not migrated for the Single, are named as
      // such; anything else untyped is internal.
      const gone = this.translationsGoneRefusal(slug, translationsTable, error);
      if (gone) throw gone;
      throw await publishAllFailure(
        error,
        singleNotMigrated(this.singleRegistryService, slug, {
          trusted: fieldTrustOf(options),
        })
      );
    }
  }

  /**
   * The id of the Single's document, which a publish of chosen parts answers and tells its gate
   * about, or the answer that ends the request: no such Single, or no document. Never creates the
   * document, as a publish never does.
   */
  async documentIdOf(
    slug: string
  ): Promise<{ id: string } | { result: SingleResult<never> }> {
    const singleMeta = await resolveSingleForRequest(
      this.adapter,
      this.singleRegistryService,
      slug,
      this.logger,
      { intent: "write" }
    );
    if (!singleMeta) {
      return {
        result: {
          success: false,
          statusCode: 404,
          message: `Single "${slug}" not found`,
        },
      };
    }
    const row = await this.adapter.selectOne<{ id: string }>(
      singleMeta.tableName,
      { columns: ["id"] }
    );
    return row
      ? { id: row.id }
      : {
          result: {
            success: false,
            statusCode: 404,
            message: `Single "${slug}" has no document to publish`,
          },
        };
  }

  /**
   * What a publish or unpublish of chosen parts reads before it decides anything: the Single as
   * stored (see `partsStateOn`), and the caller's refusal for each language asked and, where
   * `shared`, for the shared part, each one asked rather than stopping at the first. A language is
   * asked in that language; the shared part in every language, since every language shows it. The
   * rules are asked off any transaction, since a rule is the app's own code and may read the
   * database. The move asks them again as it moves the parts. A Single with no document to move,
   * or a caller without the grant, is answered with the result that ends the request.
   *
   * @experimental
   */
  async publishPartsReads(
    slug: string,
    options: PublishAllSingleLocalesOptions,
    ask: {
      action: "publish" | "unpublish";
      /** The languages whose refusal is asked, or every language the site has. */
      locales: readonly string[] | "all";
      shared: boolean;
    }
  ): Promise<PartsReads | SingleResult<PublishAllSingleResult>> {
    await refuseWriteIfRemovedFromCode("single", slug);
    const resolved = await this.resolvePublishTarget(slug, options, ask.action);
    if ("result" in resolved) return resolved.result;
    const { plan } = resolved;
    // Read on one transaction that writes nothing and locks nothing, as a preview reads.
    const state = await this.adapter.transaction(tx =>
      this.partsStateOn(tx, plan, plan.existingDoc)
    );
    // Each language the request names, asked in that language, never route-authorized: a route
    // attests no publish or unpublish rule.
    const languageRefusals = new Map<string, string>();
    for (const locale of ask.locales === "all"
      ? state.configured
      : ask.locales) {
      const refusal = await withRuleLanguage(
        writeLanguagesFor(this.localization, locale),
        () => this.authorizePublish(plan, options, ask.action)
      );
      if (refusal) languageRefusals.set(locale, refusal.message ?? "Refused.");
    }
    const sharedRefusal = ask.shared
      ? await withRuleLanguage(
          writeLanguagesFor(this.localization, EVERY_LOCALE),
          () => this.authorizePublish(plan, options, ask.action)
        )
      : undefined;
    return {
      state,
      languageRefusals,
      sharedRefusal: sharedRefusal
        ? (sharedRefusal.message ?? "Refused.")
        : null,
    };
  }

  /**
   * Take the chosen parts of this Single down, atomically: each chosen language's `_status` and,
   * where the shared part moves, the Single's own status, to draft, in one transaction under the
   * Single's row lock, or nothing. Every part where `partsMove.parts` is absent.
   *
   * Asked as a publish is asked, with the unpublish permission and rule: the grant before any
   * work, the rule in each language taken down. The hooks a status change runs, run as for a
   * move to draft; the history, the activity trail, the events and the version record what moved.
   * Never judged by the publish gate, which governs what goes live. Taking the shared part down
   * while a language not chosen stays live is refused, judged under the lock.
   *
   * @experimental
   */
  async unpublishParts(
    slug: string,
    options: SinglePartsOptions = {}
  ): Promise<SingleResult<UnpublishSinglePartsResult>> {
    await refuseWriteIfRemovedFromCode("single", slug);
    const refused: { denied?: SingleResult<PublishAllSingleResult> } = {};
    let translationsTable: string | undefined;
    const stale: PublishAllStale = {
      check: { kind: "unjudged" },
      holder: {},
    };
    // One context and one account of the request for every hook of the unpublish.
    const sharedContext: Record<string, unknown> = { ...options.context };
    const requestFacts = resolveRequestFacts(options.request);
    try {
      // Judged against the version the caller read, as a publish is.
      stale.check = versionCheckFor(
        { ...options.data },
        {
          exempt: releaseRunExemptFor({ scopeKind: "single", scopeSlug: slug }),
        }
      );
      const resolved = await this.resolvePublishTarget(
        slug,
        options,
        "unpublish"
      );
      if ("result" in resolved) return resolved.result;
      const { plan } = resolved;
      const hookCall: SingleBeforeHookCall = {
        slug,
        id: plan.existingDoc.id,
        originalData:
          this.queryService?.deserializeJsonFields(
            plan.existingDoc,
            plan.fieldConfigs
          ) ?? plan.existingDoc,
        user: options.user,
        context: sharedContext,
        req: requestFacts,
      };
      translationsTable = plan.companion?.companionTableName;
      const judged = this.everyLanguageJudged(plan, stale.check);

      // The unpublish permission and rule, asked in each language taken down (every one where
      // every part moves), before the transaction and off its connection.
      const configured =
        this.localization?.locales.map(locale => locale.code) ?? [];
      const denied = await this.refusedInEachLanguage(
        plan,
        options,
        plan.parts === undefined ? configured : [...plan.parts.locales],
        "unpublish"
      );
      if (denied) return denied;

      // The hooks a status change runs before it writes, for a move to draft, outside the
      // transaction, which may re-run on a version conflict.
      await runSingleStatusMoveBeforeHooks(
        this.hookRegistry,
        hookCall,
        "draft"
      );

      const outcome = await this.adapter.transaction(
        tx =>
          this.commitUnpublish(tx, plan, options, refused, {
            stale,
            languages: judged,
            personName: options.user?.name ?? null,
          }),
        versionConflictRetries()
      );
      if (outcome.documentVanished) {
        return {
          success: false,
          statusCode: 404,
          message: `Single "${slug}" has no document to unpublish`,
        };
      }
      // The hooks an update runs once it is durable, as a publish runs them:
      // one run, over the documents of a move of statuses alone, told every
      // language it moved.
      const hookDocuments = outcome.hookDocuments;
      if (hookDocuments !== undefined) {
        await this.afterCommit(async () => {
          for (const documents of hookDocuments) {
            await this.runUpdateHooks(hookCall, documents);
          }
        });
      }
      return {
        success: true,
        statusCode: 200,
        message: "Unpublished.",
        data: withDocumentVersion({ id: plan.existingDoc.id }, outcome.version),
        eventRecorded: outcome.eventRecorded,
        committed: outcome.committed,
        // A committed status write busts the Single's tag, as a publish's does.
        revalidationIntent: outcome.committed
          ? buildSingleRevalidationIntent(
              slug,
              readRevalidateConfig(plan.singleMeta)
            )
          : undefined,
      };
    } catch (error) {
      if (refused.denied) return refused.denied;
      const staleRefusal = await this.staleRefusal(slug, options, stale);
      if (staleRefusal) return staleRefusal;
      const gone = this.translationsGoneRefusal(slug, translationsTable, error);
      if (gone) throw gone;
      throw await publishAllFailure(
        error,
        singleNotMigrated(this.singleRegistryService, slug, {
          trusted: fieldTrustOf(options),
        })
      );
    }
  }

  /**
   * The unpublish itself: lock, re-check, write the chosen parts' statuses, capture, record.
   * Retried on a version conflict, so it derives everything from what this attempt's lock read.
   */
  private async commitUnpublish(
    tx: TransactionContext,
    plan: PublishPlan,
    options: SinglePartsOptions,
    refused: { denied?: SingleResult<PublishAllSingleResult> },
    version: {
      stale: PublishAllStale;
      languages: ReturnType<typeof languagesJudged>;
      personName: string | null;
    }
  ): Promise<PublishOutcome> {
    const { singleMeta, existingDoc, companion } = plan;
    const lockedRow = await tx.selectOne<Record<string, unknown>>(
      singleMeta.tableName,
      { where: this.whereEq("id", existingDoc.id), forUpdate: true }
    );
    if (!lockedRow) {
      return {
        documentVanished: true,
        committed: false,
        eventRecorded: false,
        languages: [],
      };
    }
    await this.refuseIfMoved(tx, plan, version);
    const priorCompanionStatuses =
      companion && plan.companionPublishable
        ? await this.readPriorCompanionStatuses(
            tx,
            companion,
            existingDoc.id,
            plan.slug
          )
        : new Map<string, string | null>();

    // Taking the shared part down while a language not chosen stays live would leave that
    // language shown without it. Judged here, under the lock, on the statuses this overwrites: a
    // language published since the request was judged refuses it too.
    const { parts } = plan;
    if (parts !== undefined && parts.shared) {
      const stillLive = [...priorCompanionStatuses]
        .filter(
          ([locale, status]) =>
            status === "published" && !parts.locales.has(locale)
        )
        .map(([locale]) => locale);
      if (stillLive.length > 0) {
        const one = stillLive.length === 1;
        throw this.refuseWith(
          NextlyError.conflict({
            reason: "state",
            message:
              `The shared part stays live while ${stillLive.join(", ")} ` +
              `${one ? "is" : "are"} published: unpublish ${one ? "it" : "them"} too, ` +
              `or keep the shared part. Nothing was changed.`,
            logContext: {
              cause: "shared-part-under-live-languages",
              single: plan.slug,
              stillLive,
            },
          }),
          refused
        );
      }
    }

    const now = new Date();
    // The Single's own status is the shared part's: written only where the shared part moves.
    const mainMoves = plan.hasMainStatus && movesShared(parts);
    if (mainMoves) {
      await tx.update(
        singleMeta.tableName,
        {
          status: "draft",
          updated_at: now,
          ...revisionBumpColumns(plan.actor, now),
        },
        this.whereEq("id", existingDoc.id)
      );
    } else {
      // A move of chosen languages is a save of the Single, whose own row is left as it is.
      await bumpDocumentRevision(
        tx,
        singleMeta.tableName,
        { id: existingDoc.id },
        plan.actor
      );
    }
    const translations = this.movedTranslations(plan);
    if (companion && plan.companionPublishable && translations) {
      await tx.update(
        companion.companionTableName,
        {
          _status: "draft",
          ...translationRevisionBumpColumns(plan.actor, this.adapter.dialect),
        },
        translations
      );
    }
    // The row as this unpublish left it, read back on the lock it holds.
    const unpublishedRow =
      (await tx.selectOne<Record<string, unknown>>(singleMeta.tableName, {
        where: this.whereEq("id", existingDoc.id),
      })) ?? lockedRow;

    // The moves the unpublish's history event names, decided before its version is recorded, so
    // the version names the same parts it took down.
    const historyMoves = this.publishMoves(
      plan,
      lockedRow.status as string | null,
      priorCompanionStatuses,
      "draft"
    );
    const versionNo = singleMeta.versions?.enabled
      ? await this.capturePublishSnapshot(
          tx,
          plan.slug,
          existingDoc.id,
          singleMeta.tableName,
          unpublishedRow,
          plan.fieldConfigs,
          options.user,
          singleMeta.versions.maxPerDoc,
          partsMovesRecord(historyMoves),
          "draft"
        )
      : null;
    await this.recordPublishHistory(tx, plan, {
      user: options.user,
      moves: historyMoves,
      versionNo,
    });
    // Each moved part that was live before is what this took down.
    const takenDown = [...priorCompanionStatuses].filter(
      ([locale, status]) =>
        status === "published" && movesLanguage(parts, locale)
    );
    const committed = mainMoves || takenDown.length > 0;
    await this.recordPublishActivity(tx, plan, committed, {
      statusAfter: "draft",
      statusBefore: mainMoves
        ? (lockedRow.status as string | null | undefined)
        : takenDown.length > 0
          ? "published"
          : "draft",
      promotedPendingEdits: false,
    });
    const documents = {
      plan,
      lockedRow,
      publishedRow: unpublishedRow,
      priorComponents: new Map<string, Record<string, unknown>>(),
      priorCompanionValues: new Map<string, Record<string, unknown>>(),
    };
    const eventRecorded = plan.recordingEnabled
      ? await this.recordUnpublishEvents(tx, {
          ...documents,
          mainRowTransitioned: mainMoves && lockedRow.status === "published",
          takenDown: takenDown.map(([locale]) => locale),
        })
      : false;
    await this.runInTransactionPhase(tx, documents, options.user);
    // An unpublish puts no pending change live, so its hooks run once, over
    // the documents in the default language, named for no one language.
    const hookDocuments = plan.runsUpdateHooks
      ? [await this.publishDocuments(tx, documents)]
      : undefined;
    return {
      documentVanished: false,
      committed,
      eventRecorded,
      hookDocuments,
      version: await documentVersionOn(tx, {
        dialect: this.adapter.dialect,
        table: singleMeta.tableName,
        id: existingDoc.id,
        languagesTable: translationTableOf(plan.companion, plan.companionReady),
        localization: this.localization,
        locale: EVERY_LOCALE,
      }),
      languages: [],
    };
  }

  /**
   * The refusal for a publish of every language (or its preview) that `error`
   * failed because this Single's translations table is missing: dropped after
   * its `ready` verdict was remembered, so the publish met it at its first
   * statement on it. The same 409, with the same remedy, as a write of one
   * language gets (`companionFoundMissing` forgets the verdict, so the next
   * request resolves readiness again). Undefined for any other failure.
   */
  private translationsGoneRefusal(
    slug: string,
    translationsTable: string | undefined,
    error: unknown
  ): NextlyError | undefined {
    if (!translationsTable || !this.localization) return undefined;
    if (
      !companionFoundMissing(
        this.adapter,
        this.adapter.dialect,
        translationsTable,
        error
      )
    ) {
      return undefined;
    }
    return NextlyError.conflict({
      reason: "state",
      message: companionNotReadyMessage("single"),
      logContext: {
        cause: "localized-write-without-companion",
        single: slug,
        defaultLocale: this.localization.defaultLocale,
        companionTable: translationsTable,
      },
    });
  }

  /**
   * The languages a publish of every language is judged on, as the table and
   * locales the judgement reads: every language a read of every language
   * names, and the version must name each one (`assertVersionNamesEvery`).
   * None where nothing is given, or the Single keeps no translations to move.
   *
   * @throws NextlyError.validation for a version that does not name every
   *   language.
   */
  private everyLanguageJudged(
    plan: PublishPlan,
    check: VersionCheck
  ): ReturnType<typeof languagesJudged> {
    const given = givenOf(check);
    const table = translationTableOf(plan.companion, plan.companionPublishable);
    // Only the languages this move moves, where it moves chosen ones.
    const locales = versionLanguagesFor({
      localized: table !== null,
      localization: this.localization,
      locale: EVERY_LOCALE,
    })?.filter(locale => movesLanguage(plan.parts, locale));
    if (given === undefined || !locales || locales.length === 0) {
      return undefined;
    }
    assertVersionNamesEvery(given, locales);
    return languagesJudged(table, locales);
  }

  /**
   * Judge the publish under the Single's lock, and record an overwrite of a
   * change since the read in this transaction, so a publish that cannot
   * record it is not kept either.
   */
  private async refuseIfMoved(
    tx: TransactionContext,
    plan: PublishPlan,
    version: {
      stale: PublishAllStale;
      languages: ReturnType<typeof languagesJudged>;
      personName: string | null;
    }
  ): Promise<void> {
    const { stale } = version;
    stale.id = plan.existingDoc.id;
    const before = await refuseIfMainMoved(
      tx,
      this.adapter.dialect,
      stale.check,
      {
        table: plan.singleMeta.tableName,
        id: plan.existingDoc.id,
        languages: version.languages,
      },
      stale.holder
    );
    await recordOverwriteIfAsked(
      tx,
      { adapter: this.adapter },
      stale.check,
      {
        subject: { kind: "single", slug: plan.slug, id: plan.existingDoc.id },
        actor: plan.actor,
        personName: version.personName,
        locale: null,
      },
      { main: before }
    );
  }

  /**
   * The parts a publish moves, as the publish gate is told them early and under the lock: every
   * language the site has where it moves them all, the chosen ones otherwise, and the shared part
   * where it moves.
   */
  private gatePartsOf(plan: PublishPlan): PublishPart[] {
    const configured =
      this.localization?.locales.map(locale => locale.code) ?? [];
    return [
      ...(plan.parts === undefined ? configured : [...plan.parts.locales]).map(
        locale => ({ kind: "language" as const, locale })
      ),
      ...(movesShared(plan.parts) ? [{ kind: "shared" as const }] : []),
    ];
  }

  /**
   * The publish gate's verdict on a publish, asked on `tx` after the Single's row is locked, with
   * the parts live before the move as the lock read them; a collection entry's publish asks it
   * the same way. A part it holds back refuses the whole move, every refusal named, kept in
   * `refused` before the throw that rolls the transaction back.
   */
  private async gateVerdict(
    tx: TransactionContext,
    plan: PublishPlan,
    options: SinglePartsOptions,
    under: {
      lockedRow: Record<string, unknown>;
      priorCompanionStatuses: ReadonlyMap<string, string | null>;
      refused: { denied?: SingleResult<PublishAllSingleResult> };
    }
  ): Promise<PublishGateVerdict> {
    const verdict = await publishGate().judge(tx, {
      scope: { kind: "single", slug: plan.slug },
      entryId: plan.existingDoc.id,
      direction: "publish",
      parts: this.gatePartsOf(plan),
      live: {
        languages: [...under.priorCompanionStatuses]
          .filter(([, status]) => status === "published")
          .map(([locale]) => locale),
        shared: under.lockedRow.status === "published",
      },
      caller: publishCallerOf(options),
      ...(options.actor === undefined ? {} : { actor: options.actor }),
      ...(options.withoutReview === undefined
        ? {}
        : { withoutReview: options.withoutReview }),
    });
    if (verdict.refusals.length === 0) return verdict;
    // Each held part as a validation issue, as the request's own refusals name parts.
    throw this.refuseWith(
      NextlyError.validation({
        errors: verdict.refusals.map(({ part, code, message }) =>
          part.kind === "shared"
            ? { path: "shared", code, message }
            : { path: part.locale, code, locale: part.locale, message }
        ),
      }),
      under.refused
    );
  }

  /**
   * Keep `error` as the answer of a move whose transaction it rolls back, every issue in its
   * message as a publish of chosen parts words its own refusals, and hand it back to throw.
   */
  private refuseWith(
    error: NextlyError,
    refused: { denied?: SingleResult<PublishAllSingleResult> }
  ): NextlyError {
    const result = buildSingleErrorResult(error, "Refused.");
    const issues = result.errors ?? [];
    refused.denied =
      issues.length > 0
        ? { ...result, message: issues.map(issue => issue.message).join(" ") }
        : result;
    return error;
  }

  /**
   * Whether a value rule of a publish could refuse anything of this Single: a Single has no
   * setting that requires every language to hold its own values, so only a required unique
   * translated field can. Read from the declaration, so most Singles read nothing more.
   */
  private valueRulesCanRefuse(plan: PublishPlan): boolean {
    const translated = new Set(
      (plan.companion?.localizedFields ?? []).map(field => field.name)
    );
    return plan.fieldConfigs.some(config => {
      // Read as declared: not every kind of field carries each of these.
      const field = config as {
        name?: unknown;
        required?: unknown;
        unique?: unknown;
      };
      return (
        typeof field.name === "string" &&
        translated.has(field.name) &&
        field.required === true &&
        field.unique === true
      );
    });
  }

  /**
   * Refuse a publish of chosen parts, by throwing, where the value rules refuse the languages it
   * puts live as this transaction locked the Single: judged before the transaction too, and again
   * here since a change saved since is what goes live. Only for a move of chosen parts.
   */
  private async refuseValueRulesUnderLock(
    tx: TransactionContext,
    plan: PublishPlan,
    options: SinglePartsOptions,
    lockedRow: Record<string, unknown>,
    refused: { denied?: SingleResult<PublishAllSingleResult> }
  ): Promise<void> {
    if (options.partsMove === undefined || !this.valueRulesCanRefuse(plan)) {
      return;
    }
    const issues = publishValueIssues(
      await this.partsStateOn(tx, plan, lockedRow),
      plan.parts === undefined ? "all" : [...plan.parts.locales]
    );
    if (issues.length === 0) return;
    throw this.refuseWith(NextlyError.validation({ errors: issues }), refused);
  }

  /**
   * The Single as a publish of chosen parts judges it, read on `tx`: whether its shared part is
   * live, and each stored language's own state and own values (never filled from another
   * language) with its pending change's translated values laid over them, since a publish
   * promotes that change. Where a language's change holds the whole document, the shared fields it
   * edits are named too, so a publish of it alone is told to take the shared part with it.
   */
  private async partsStateOn(
    tx: TransactionContext,
    plan: PublishPlan,
    /** The Single's own row, as the caller read it. */
    row: Record<string, unknown>
  ): Promise<PartsState> {
    const { companion } = plan;
    const statuses =
      companion && plan.companionPublishable
        ? await this.readPriorCompanionStatuses(
            tx,
            companion,
            plan.existingDoc.id,
            plan.slug
          )
        : new Map<string, string | null>();
    const values =
      companion && plan.companionReady
        ? await readCompanionValuesByLocale(
            this.adapter,
            tx,
            companion,
            plan.existingDoc.id,
            [...statuses.keys()]
          )
        : new Map<string, Record<string, unknown>>();
    const translated = new Set(
      (companion?.localizedFields ?? []).map(field => field.name)
    );
    const fields: PartsField[] = plan.fieldConfigs.flatMap(config => {
      // Read as declared: not every kind of field carries each of these.
      const field = config as {
        name?: unknown;
        label?: unknown;
        required?: unknown;
        unique?: unknown;
      };
      return typeof field.name === "string"
        ? [
            {
              name: field.name,
              label: typeof field.label === "string" ? field.label : field.name,
              required: field.required === true,
              unique: field.unique === true,
              translatable: translated.has(field.name),
            },
          ]
        : [];
    });
    const languages = new Map<string, PartsLanguage>(
      [...statuses].map(([locale, status]) => [
        locale,
        { live: status === "published", values: values.get(locale) ?? {} },
      ])
    );
    const drafts = plan.draftsEligible
      ? await new VersionsRepository(tx).findAllWorkingDrafts(
          this.workingDraftRef(plan)
        )
      : [];
    // The live shared values a whole-document change is compared with, read once where needed.
    const live =
      !draftsKeptByPart() && drafts.some(draft => draft.locale !== null)
        ? await this.liveSharedDocument(tx, plan)
        : null;
    for (const draft of drafts) {
      if (draft.locale === null) continue;
      const snapshot = snapshotRecord(draft.snapshot);
      const stored = languages.get(draft.locale);
      const pending = Object.fromEntries(
        Object.entries(snapshot).filter(([name]) => translated.has(name))
      );
      languages.set(draft.locale, {
        live: stored?.live ?? false,
        values: { ...stored?.values, ...pending },
        ...(live === null
          ? {}
          : {
              pendingSharedEdits: differingFields(
                live.shared.filter(name => name in snapshot),
                snapshot,
                live.live,
                live.views
              ),
            }),
      });
    }
    return {
      configured: this.localization?.locales.map(locale => locale.code) ?? [],
      translated:
        plan.singleMeta.localized === true && this.localization !== undefined,
      defaultLocale: this.localization?.defaultLocale ?? "",
      sharedLive: row.status === "published",
      languages,
      fields,
      // A Single has no setting requiring every language to hold its own values.
      requireEveryLanguage: false,
    };
  }

  /**
   * The refusal of a publish found out of date inside its transaction, read
   * from the Single as it is now that the transaction has rolled back.
   */
  private async staleRefusal(
    slug: string,
    options: PublishAllSingleLocalesOptions,
    stale: PublishAllStale
  ): Promise<SingleResult<PublishAllSingleResult> | undefined> {
    if (!stale.holder.at || !stale.id || stale.check.kind !== "judge") {
      return undefined;
    }
    return buildSingleErrorResult(
      await staleVersionErrorFor(poolRevisionReader(this.adapter), {
        dialect: this.adapter.dialect,
        scopeKind: "single",
        slug,
        id: stale.id,
        given: stale.check.given,
        at: stale.holder.at,
        reader: {
          user: options.user,
          trusted: fieldTrustOf(options),
          authenticatedScope: options.authenticatedScope,
        },
      }),
      "Failed to publish all languages"
    );
  }

  /**
   * Resolve what this publish would act on, or the answer that ends it early.
   *
   * Two things end it before any authorization to publish: no such Single, and
   * no document to publish. A third ends it successfully — a Single with no
   * draft/published lifecycle has nothing to publish, and that answer is
   * produced HERE, to a caller who may update it, before the publish
   * permission is asked for, so a caller holding update but not publish is
   * not refused for a call that would change nothing.
   */
  private async resolvePublishTarget(
    slug: string,
    options: SinglePartsOptions,
    // The grant asked up front: an unpublish of chosen parts asks its own.
    operation: "publish" | "unpublish" = "publish"
  ): Promise<
    { plan: PublishPlan } | { result: SingleResult<PublishAllSingleResult> }
  > {
    const singleMeta = await resolveSingleForRequest(
      this.adapter,
      this.singleRegistryService,
      slug,
      this.logger,
      // A write: refused in production where the Single was never registered.
      { intent: "write" }
    );
    if (!singleMeta) {
      return {
        result: {
          success: false,
          statusCode: 404,
          message: `Single "${slug}" not found`,
        },
      };
    }

    // The live row. Unlike `update`, this path never auto-creates one: a
    // Single that has never been written holds no content, and materializing
    // an empty document in order to declare it published would put a blank
    // page live. Reading the document is what creates it, so anything an
    // editor can see already has a row here.
    const existingDoc = await this.adapter.selectOne<SingleDocument>(
      singleMeta.tableName,
      {}
    );
    if (!existingDoc) {
      return {
        result: {
          success: false,
          statusCode: 404,
          message: `Single "${slug}" has no document to publish`,
        },
      };
    }

    // A Single with a lifecycle is asked the publish grant here, before any
    // work only a publish needs; its rule is asked below, once the languages
    // going live are known. A caller without the grant is refused as the full
    // gate words it.
    const refused =
      (singleMeta as { status?: boolean }).status === true
        ? await singleGrantRefusal({
            slug,
            operation,
            user: options.user,
            overrideAccess: options.overrideAccess,
            rbacAccessControlService: this.rbacAccessControlService,
            visitor: this.fieldRuleVisitor,
            authenticatedScope: options.authenticatedScope,
            logger: this.logger,
          })
        : null;
    if (refused) return { result: refused };

    const { hasMainStatus, companion, companionPublishable, companionReady } =
      await this.resolveLifecycle(slug, singleMeta);

    if (!hasMainStatus && !companionPublishable) {
      // Nothing moves, so this is no publish: the caller's update gate decides
      // whether they are told so. A Single with a lifecycle asks no update
      // gate, since publishing every language changes only its status and the
      // publish gate judges that.
      const accessDenied = await checkSingleAccess({
        slug,
        operation: "update",
        user: options.user,
        overrideAccess: options.overrideAccess,
        routeAuthorized: options.routeAuthorized,
        rbacAccessControlService: this.rbacAccessControlService,
        visitor: this.fieldRuleVisitor,
        authenticatedScope: options.authenticatedScope,
        logger: this.logger,
      });
      if (accessDenied) return { result: accessDenied };
      return {
        result: {
          success: true,
          statusCode: 200,
          message: "Nothing to publish (single has no status).",
          data: { id: existingDoc.id },
        },
      };
    }

    return {
      plan: {
        slug,
        singleMeta,
        existingDoc,
        hasMainStatus,
        companion,
        companionPublishable,
        companionReady,
        fieldConfigs: singleMeta.fields ?? [],
        recordingEnabled: isOutboxRecordingActive("single", slug),
        inTransactionHandlers: inTransactionHandlersFor(
          this.hookRegistry,
          getSingleHookCollection(slug)
        ),
        runsUpdateHooks:
          this.hookRegistry?.hasHooks(
            "afterUpdate",
            getSingleHookCollection(slug)
          ) === true || getFieldFunctions("single", slug) !== undefined,
        actor: actorForWrite(options.actor ?? null, options.user),
        // Only the chosen parts move, where a move of chosen parts names them.
        ...(options.partsMove?.parts === undefined
          ? {}
          : { parts: options.partsMove.parts }),
        // Resolved before the transaction: it reads the component registry.
        draftsEligible: (
          await schemaDraftSplit({
            status: (singleMeta as { status?: boolean }).status,
            versions: singleMeta.versions,
            fields: singleMeta.fields ?? [],
            slug,
            localized: singleMeta.localized,
            entityKind: "single",
          })
        ).eligible,
      },
    };
  }

  /**
   * Where this Single's draft/published lifecycle actually lives: the main row,
   * its per-locale companion, or neither.
   *
   * `hasMainStatus` reads the CONFIG flag, not the mere presence of a `status`
   * column: a Single defining an ordinary user field named `status` has the
   * column and no lifecycle, so it is not publishable and must not be made to
   * demand the publish permission.
   */
  private async resolveLifecycle(
    slug: string,
    singleMeta: DynamicSingleRecord
  ): Promise<{
    hasMainStatus: boolean;
    companion: CompanionSchema | null;
    companionPublishable: boolean;
    /** Whether the translation table is there to read. */
    companionReady: boolean;
  }> {
    const hasMainStatus = singleMeta.status === true;
    // Where the Single's translatable values live, as its reads and writes
    // find them: under per-language storage a Single keeps them per language
    // whether or not it is translated, and has a per-language status only
    // when it publishes each language on its own.
    const companion =
      this.localization && storesPerLanguage(singleMeta)
        ? buildCompanionSchema({
            slug,
            tableName: singleMeta.tableName,
            fields: singleMeta.fields as { name: string; type: string }[],
            dialect: this.adapter.dialect,
            status: publishesPerLanguage(singleMeta),
          })
        : null;
    // Only `ready` matters here: a companion that is not there has no
    // per-locale publish lifecycle, and why it is not there changes nothing
    // about that.
    const companionReady =
      !!companion &&
      (await isCompanionReady(this.adapter, companion.companionTableName));
    const companionPublishable =
      !!companion && companion.hasStatus && companionReady;
    // A localized Single whose translations table isn't there has nowhere to
    // put any language but the default, so publishing every language is
    // refused, with the remedy, as a write of one other language is.
    const otherLanguages =
      this.localization?.locales.some(
        locale => locale.code !== this.localization?.defaultLocale
      ) ?? false;
    if (companion && !companionReady && otherLanguages) {
      throw NextlyError.conflict({
        reason: "state",
        message: companionNotReadyMessage("single"),
        logContext: {
          cause: "localized-write-without-companion",
          single: slug,
          companionTable: companion.companionTableName,
        },
      });
    }
    return { hasMainStatus, companion, companionPublishable, companionReady };
  }

  /**
   * Check `publish-{slug}`, the whole of what publishing every language needs
   * since it changes only the status, and decide
   * whether the Single's stored publish rule has to be re-judged under the lock.
   *
   * Checked directly rather than through a transition, since this publishes
   * companion locales even when the main row is already published.
   */
  /**
   * Whether `options`' caller may read the Single in every language; see
   * `readsSingleInEveryLanguage`.
   */
  private async readsSingle(
    slug: string,
    options: PublishAllSingleLocalesOptions
  ): Promise<boolean> {
    return readsSingleInEveryLanguage({
      slug,
      user: options.user,
      authenticatedScope: options.authenticatedScope,
      rbacAccessControlService: this.rbacAccessControlService,
      visitor: this.fieldRuleVisitor,
      logger: this.logger,
      localization: this.localization,
    });
  }

  private async authorizePublish(
    plan: PublishPlan,
    options: PublishAllSingleLocalesOptions,
    // An unpublish of chosen parts is judged by its own permission and rule.
    operation: "publish" | "unpublish" = "publish"
  ): Promise<SingleResult<PublishAllSingleResult> | undefined> {
    return (
      (await checkSingleAccess({
        slug: plan.slug,
        operation,
        user: options.user,
        overrideAccess: options.overrideAccess,
        // NOT route-authorized: the route authorized this POST as `update`, so
        // the publish permission is checked here for the first time.
        routeAuthorized: false,
        rbacAccessControlService: this.rbacAccessControlService,
        visitor: this.fieldRuleVisitor,
        // A scoped API key is judged on its own `publish-{slug}` grant, not the
        // key owner's — the route checked only `update` against the scope.
        authenticatedScope: options.authenticatedScope,
        logger: this.logger,
      })) ?? undefined
    );
  }

  /**
   * Whether this publish is refused in any of `languages`: the publish
   * permission and rule asked once for each, each time told that language and
   * all of them, so a rule that answers by language answers for each. Asked
   * before the transaction, never on its connection: a rule is the app's own
   * code and may read the database, which on a held connection waits for one
   * the transaction keeps. With no language at all, asked once. The languages
   * refused go to the server log only.
   */
  private async refusedInEachLanguage(
    plan: PublishPlan,
    options: PublishAllSingleLocalesOptions,
    languages: readonly string[],
    operation: "publish" | "unpublish" = "publish"
  ): Promise<SingleResult<PublishAllSingleResult> | undefined> {
    const denied = await askEachLanguage(languages, () =>
      this.authorizePublish(plan, options, operation)
    );
    if (!denied) return undefined;
    this.logger.warn("Publish refused in some languages", {
      single: plan.slug,
      refusedLanguages: denied.refused,
    });
    return denied.refusal;
  }

  /**
   * Refuses this publish as a conflict, by throwing, where `goingLive` (re-read
   * under the lock) holds a language the rule was not asked about before the
   * transaction. The refusal is kept in `refused` first, since the rollback
   * re-wraps what is thrown.
   */
  private assertNoLanguageUnasked(
    asked: readonly string[],
    goingLive: readonly string[],
    refused: { denied?: SingleResult<PublishAllSingleResult> }
  ): Promise<void> {
    const unasked = unaskedLanguages(asked, goingLive);
    if (unasked.length === 0) return Promise.resolve();
    const conflict = languagesChangedConflict(unasked);
    refused.denied = {
      success: false,
      statusCode: 500,
      message: conflict.message,
      ...errorEnvelopeFields(conflict),
    };
    return Promise.reject(conflict);
  }

  /**
   * The languages a publish of every language asks its rule about, as stored
   * now, read on `db` (the pool before the transaction): its pending changes
   * and the translations it puts live, beside the main row's `mainStatus`.
   */
  private async languagesAsStored(
    db: TransactionContext | DrizzleAdapter,
    plan: PublishPlan,
    mainStatus: unknown
  ): Promise<string[]> {
    const pending = await this.pendingChanges(db, plan);
    const statuses =
      plan.companion && plan.companionPublishable
        ? await this.readPriorCompanionStatuses(
            db,
            plan.companion,
            plan.existingDoc.id,
            plan.slug
          )
        : new Map<string, string | null>();
    const judged = [
      ...pending,
      ...this.goingLiveAsStored(plan, pending, {
        mainStatus,
        companion: statuses,
      }),
    ];
    return this.publishLanguages(
      db,
      plan,
      judged,
      pending,
      statuses,
      mainStatus
    );
  }

  /**
   * The languages a publish of every language asks its rule about: those it
   * judges, a change with no language of its own (the shared values) being
   * the default language's; those the one answer to "what goes live" names,
   * the default language among them whenever the main row goes live, which
   * the judged list leaves to the translations it carries; every configured
   * language where a pending change is promoted, since it can carry shared
   * values every language shows, a language with no translation stored
   * included; and every configured language where the Single reaches a
   * localized field group.
   */
  private async publishLanguages(
    db: TransactionContext | DrizzleAdapter,
    plan: PublishPlan,
    judged: ReadonlyArray<{ locale: string | null }>,
    pending: ReadonlyArray<{ locale: string | null }>,
    statuses: ReadonlyMap<string, string | null>,
    mainStatus: unknown
  ): Promise<string[]> {
    const configured =
      this.localization?.locales.map(locale => locale.code) ?? [];
    const defaultLocale = this.localization?.defaultLocale;
    const { parts } = plan;
    const sharedMoves = movesShared(parts);
    // Of what goes live, only the chosen languages, where a move chooses some; and the default
    // language with no translation of its own where the shared part moves, since it goes live
    // with the Single's own status.
    const goingLive = languagesGoingLiveFrom({
      statuses,
      configured,
      defaultLocale,
      mainPublished: mainStatus === "published",
    }).filter(
      locale =>
        movesLanguage(parts, locale) ||
        (sharedMoves && locale === defaultLocale && !statuses.has(locale))
    );
    const service = this.fieldGroupDataService;
    const reaches =
      service !== undefined &&
      (await reachesLocalizedFieldGroup(plan.fieldConfigs, slug =>
        service.getComponentDefinition(slug, db.getDrizzle())
      ));
    return [
      ...new Set(
        [
          ...judged.map(change => change.locale ?? defaultLocale),
          // A promoted change reaches every language only where it may carry the shared values,
          // which it does where the shared part moves; otherwise its own language alone.
          ...pending.flatMap(change =>
            sharedMoves
              ? languagesPromotedChangeReaches(
                  change.locale ?? defaultLocale,
                  configured
                )
              : [change.locale ?? defaultLocale]
          ),
          ...languagesToAsk(goingLive, {
            configured: sharedMoves
              ? configured
              : configured.filter(locale => movesLanguage(parts, locale)),
            reachesLocalizedFieldGroup: reaches,
          }),
        ].filter((locale): locale is string => typeof locale === "string")
      ),
    ];
  }

  /**
   * The languages a publish judges as stored beside its pending changes (see
   * `languagesGoingLiveAsStored`), of the parts it moves: a move of chosen parts judges only
   * theirs, the Single's own row (no language) only where the shared part moves.
   */
  private goingLiveAsStored(
    plan: PublishPlan,
    pending: ReadonlyArray<{ locale: string | null }>,
    prior: {
      mainStatus: unknown;
      companion: ReadonlyMap<string, string | null>;
    }
  ): { locale: string | null; snapshot: Record<string, never> }[] {
    return languagesGoingLiveAsStored(
      publishableShape(plan),
      pending,
      prior,
      new Set(this.localization?.locales.map(locale => locale.code) ?? [])
    ).filter(change => movesPart(plan.parts, change.locale));
  }

  /**
   * The publish itself: lock, re-check, write every status, capture, record.
   *
   * Retried on a version conflict (`versionConflictRetries`), so the whole body may re-run — it
   * therefore derives everything it reports from values read under THIS
   * attempt's lock rather than carrying state across attempts.
   */
  private async commitPublish(
    tx: TransactionContext,
    plan: PublishPlan,
    options: SinglePartsOptions,
    /** Where a refusal to publish is kept for `publishAllLocales` to return. */
    refused: { denied?: SingleResult<PublishAllSingleResult> },
    /** The languages the publish rule was asked about before this transaction. */
    askedLanguages: readonly string[],
    /** Resolved before this transaction opened; see `publishAllLocales`. */
    promoteGrants?: () => Promise<CallerGrants>,
    /** Whether the caller may read the Single, asked with `promoteGrants`. */
    promoteReads?: boolean,
    /** How the version given is judged; see `publishAllLocales`. */
    version?: {
      stale: PublishAllStale;
      languages: ReturnType<typeof languagesJudged>;
      /** The caller's name, kept with an overwrite as every save keeps it. */
      personName: string | null;
    }
  ): Promise<PublishOutcome> {
    const { slug, singleMeta, existingDoc, hasMainStatus } = plan;

    // Lock the main row up front. One read serves three needs: it is the
    // liveness check (a row deleted between the pre-transaction read and this
    // lock is gone here, so the publish writes and records nothing); it carries
    // the committed status the transition is judged against.
    const lockedRow = await tx.selectOne<Record<string, unknown>>(
      singleMeta.tableName,
      { where: this.whereEq("id", existingDoc.id), forUpdate: true }
    );
    if (!lockedRow) {
      return {
        documentVanished: true,
        committed: false,
        eventRecorded: false,
        languages: [],
      };
    }
    // Judged under the lock, before anything is written: the Single's own row
    // and every language it moves. A refusal throws, rolling back the publish.
    if (version) await this.refuseIfMoved(tx, plan, version);

    // The value rules a publish of chosen parts was judged by before the transaction, judged
    // again on the Single as this transaction locked it, before the gate is asked: a change saved
    // since is what goes live.
    await this.refuseValueRulesUnderLock(tx, plan, options, lockedRow, refused);

    // Each locale's committed `_status` BEFORE the bulk flip below, so a real
    // draft->published transition can be told from a locale that was already
    // live. Read under the lock and inside the retry so it reflects the state
    // this publish actually overwrites.
    const priorCompanionStatuses =
      plan.companion && plan.companionPublishable
        ? await this.readPriorCompanionStatuses(
            tx,
            plan.companion,
            existingDoc.id,
            slug
          )
        : new Map<string, string | null>();

    // Whatever governs publishing beyond access, asked on this transaction once the row is locked
    // and before anything is written: a part it holds back refuses the whole move. Its verdict is
    // settled once the parts are written, before this commits.
    const verdict = await this.gateVerdict(tx, plan, options, {
      lockedRow,
      priorCompanionStatuses,
      refused,
    });

    // Judged before anything is written, on the row this transaction locked:
    // the gate is the precondition of the publish, not a check of its result.
    // As ONE outcome, because the promotion applies every language's snapshot
    // to the same main row, so the shared values that survive are the last
    // writer's. A language with nothing pending goes live as it is stored,
    // judged when it was saved as a draft and never as published, so it is
    // judged as a promotion of an empty change in the same outcome.
    const stored = await this.pendingChanges(tx, plan);
    // Derived from the stored changes, which carry the same languages as the
    // merged ones below: merging shared values replaces a change's values,
    // never a change or its language.
    // Of the parts this moves, where it moves chosen ones.
    const alsoGoingLive = this.goingLiveAsStored(plan, stored, {
      mainStatus: lockedRow.status,
      companion: priorCompanionStatuses,
    });

    // What goes live, re-read on the row this transaction locked and before
    // anything is written. The rule was asked before the transaction; a
    // language it was not asked about refuses the publish as a conflict, so
    // nothing goes live. No rule runs here. Before the shared values are
    // merged, so a publish refused here never reports which shared fields
    // conflict.
    await this.assertNoLanguageUnasked(
      askedLanguages,
      await this.publishLanguages(
        tx,
        plan,
        [...stored, ...alsoGoingLive],
        stored,
        priorCompanionStatuses,
        lockedRow.status
      ),
      refused
    );

    const pending = await this.sharedValuesForPublish(
      tx,
      plan,
      stored,
      options,
      promoteGrants
    );
    const judged = [...pending, ...alsoGoingLive];

    await this.assertPendingChangesMayBePromoted(
      tx,
      plan,
      lockedRow,
      judged,
      options,
      promoteGrants,
      promoteReads
    );

    // What the publish does to each language, judged before it writes, as a
    // preview of it judges it. Nothing pending is out of date by now: the
    // shared values were judged above.
    // Only the languages this moves are reported, where it moves chosen ones.
    const languages = (
      await this.languagesOf(
        tx,
        plan,
        stored,
        priorCompanionStatuses,
        lockedRow.status,
        new Map()
      )
    ).filter(language => movesLanguage(plan.parts, language.locale));

    // Every language's content as it stood before the drafts are promoted,
    // for the previous state its events are built from: the promotion
    // rewrites the companion rows and component tables they would otherwise
    // be read from.
    const { components: priorComponents, values: priorCompanionValues } =
      await this.stateBeforePromotion(
        tx,
        plan,
        pending,
        priorCompanionStatuses
      );

    const written = await this.writePublishedStatuses(
      tx,
      plan,
      lockedRow,
      priorCompanionStatuses,
      pending,
      // A visitor's promoted field groups judged by the Public role this
      // service's gate reads.
      fieldGroupWriteAccessOf(options, this.fieldRuleVisitor)
    );

    // The moves the publish's history event names, decided before its
    // version is recorded, so the version names the same parts. The event
    // names status moves only; what the publish put live is those, with each
    // pending change it promoted, in the part its draft holds.
    const historyMoves = this.publishMoves(
      plan,
      lockedRow.status as string | null,
      priorCompanionStatuses
    );
    const putLive = partsTogether([
      partsMovesRecord(historyMoves),
      ...pending.map(change => draftSlotParts(change.locale)),
    ]);
    let publishVersionNo: number | null = null;
    if (singleMeta.versions?.enabled) {
      publishVersionNo = await this.capturePublishSnapshot(
        tx,
        slug,
        existingDoc.id,
        singleMeta.tableName,
        written.publishedRow,
        plan.fieldConfigs,
        options.user,
        singleMeta.versions.maxPerDoc,
        putLive
      );
    }

    // Which media items the Single uses now. A publish that promoted held
    // working drafts wrote their content, in any language, so every language
    // is read again. Loaded when it is recorded, not with the service.
    const { recordSingleMediaUsage } = await import("./single-media-usage");
    await recordSingleMediaUsage(
      tx,
      {
        adapter: this.adapter,
        logger: this.logger,
        fieldGroupDataService: this.fieldGroupDataService,
        localization: this.localizationSource,
      },
      {
        slug: plan.slug,
        rowId: plan.existingDoc.id,
        tableName: plan.singleMeta.tableName,
        fields: plan.fieldConfigs,
        companion: plan.companion,
      }
    );
    await this.recordPublishHistory(tx, plan, {
      user: options.user,
      moves: historyMoves,
      versionNo: publishVersionNo,
    });

    // A publish that moved nothing — no main lifecycle and no stored
    // translation — has no content write for the caller to flush or prune, and
    // nothing for the activity trail to record.
    const committed = hasMainStatus || priorCompanionStatuses.size > 0;

    // The status before, of the parts this moved: the Single's own only where the shared part
    // moved, and each moved language's.
    await this.recordPublishActivity(tx, plan, committed, {
      statusAfter: "published",
      statusBefore: statusBeforePublish([
        ...(movesShared(plan.parts)
          ? [lockedRow.status as string | null | undefined]
          : []),
        ...[...priorCompanionStatuses]
          .filter(([locale]) => movesLanguage(plan.parts, locale))
          .map(([, status]) => status),
      ]),
      promotedPendingEdits: pending.length > 0,
    });

    const eventRecorded = plan.recordingEnabled
      ? await this.recordPublishEvents(tx, {
          plan,
          lockedRow,
          publishedRow: written.publishedRow,
          mainRowTransitioned: written.mainRowTransitioned,
          priorCompanionStatuses,
          priorComponents,
          priorCompanionValues,
          promotedLocales: new Set(pending.map(draft => draft.locale)),
        })
      : false;

    // Last in the transaction, and so again on each retried attempt: a
    // publish of every language is an update of the Single.
    await this.runInTransactionPhase(
      tx,
      {
        plan,
        lockedRow,
        publishedRow: written.publishedRow,
        priorComponents,
        priorCompanionValues,
      },
      options.user
    );

    // The document the update hooks are handed once this commits, read here
    // as the in-transaction phase and the events read it: in the default
    // language, as the publish committed it. Read again rather than shared
    // with those, which hand theirs to code that may change it.
    // One document for each language whose pending change went live, as a
    // publish of that language alone hands its update hooks; otherwise one, in
    // the default language, for a move of statuses alone.
    const promotedLanguages = [
      ...new Set(
        pending.flatMap(change =>
          change.locale === null ? [] : [change.locale]
        )
      ),
    ];
    let hookDocuments:
      | {
          locale?: string;
          data: Record<string, unknown>;
          previous: Record<string, unknown>;
        }[]
      | undefined;
    if (plan.runsUpdateHooks) {
      const documentArgs = {
        plan,
        lockedRow,
        publishedRow: written.publishedRow,
        priorComponents,
        priorCompanionValues,
      };
      hookDocuments = [];
      if (promotedLanguages.length === 0) {
        hookDocuments.push(await this.publishDocuments(tx, documentArgs));
      }
      for (const locale of promotedLanguages) {
        hookDocuments.push({
          locale,
          ...(await this.publishDocuments(tx, { ...documentArgs, locale })),
        });
      }
    }

    // The gate's verdict finishes once the parts are written, on this transaction before it
    // commits: a verdict that no longer holds throws, and the whole publish rolls back.
    await verdict.settle();

    return {
      documentVanished: false,
      committed,
      eventRecorded,
      hookDocuments,
      version: await documentVersionOn(tx, {
        dialect: this.adapter.dialect,
        table: singleMeta.tableName,
        id: existingDoc.id,
        languagesTable: translationTableOf(plan.companion, plan.companionReady),
        localization: this.localization,
        locale: EVERY_LOCALE,
      }),
      languages,
    };
  }

  /**
   * The publish's row in the activity trail: one for the whole publish, every
   * language at once, so no language is named. Written outside the outbox
   * gate, as a single save's row is: the trail holds on every install,
   * webhooks or not. A publish that moved nothing records nothing.
   */
  private async recordPublishActivity(
    tx: TransactionContext,
    plan: PublishPlan,
    committed: boolean,
    publication: PublicationFacts
  ): Promise<void> {
    if (!committed) return;
    await recordSingleSaveActivity(tx, {
      slug: plan.slug,
      entryId: plan.existingDoc.id,
      label: plan.singleMeta.label,
      locale: null,
      actor: plan.actor,
      publication,
    });
  }

  /**
   * Move the main row's status and every companion `_status` to published, and
   * return the committed post-publish row.
   *
   * The row is built by OVERLAY rather than re-read: publishing mutates only
   * the status and the marker, so the locked row's other columns are already
   * the post-publish ones, and a second pooled read while this transaction
   * holds a connection would deadlock a one-connection pool.
   */
  private async writePublishedStatuses(
    tx: TransactionContext,
    plan: PublishPlan,
    lockedRow: Record<string, unknown>,
    priorCompanionStatuses: Map<string, string | null>,
    /** The pending changes, already judged. */
    pending: readonly PendingChange[],
    /** The publisher, whom the component save's own field rules judge. */
    access: FieldGroupWriteAccess
  ): Promise<{
    publishedRow: Record<string, unknown>;
    mainRowTransitioned: boolean;
  }> {
    const { singleMeta, existingDoc, hasMainStatus, companion } = plan;
    const publishNow = new Date();
    const lockedStatus =
      typeof lockedRow.status === "string" ? lockedRow.status : null;
    let mainRowTransitioned = false;
    let firstPublishedAt: Date | undefined;

    // The Single's own status is the shared part's: written only where the shared part moves.
    if (hasMainStatus && movesShared(plan.parts)) {
      mainRowTransitioned = lockedStatus !== "published";
      firstPublishedAt = this.resolveFirstPublication(
        lockedRow,
        lockedStatus,
        priorCompanionStatuses,
        publishNow
      );
      await tx.update(
        singleMeta.tableName,
        {
          status: "published",
          updated_at: publishNow,
          ...(firstPublishedAt ? { first_published_at: firstPublishedAt } : {}),
          ...revisionBumpColumns(plan.actor, publishNow),
        },
        this.whereEq("id", existingDoc.id)
      );
    } else {
      // A publish of every language is a save of the document even where the
      // main row keeps no status of its own; its content is left as it is.
      await bumpDocumentRevision(
        tx,
        singleMeta.tableName,
        { id: existingDoc.id },
        plan.actor
      );
    }

    // Every language's pending change goes live with its status. Without this
    // the statuses would all say published while the content each author was
    // holding stayed unapplied — the document would report itself fully
    // published and show none of the work being published.
    await this.promotePendingChanges(tx, plan, publishNow, pending, access);

    // Only the chosen languages' rows, where the move chooses some.
    const translations = this.movedTranslations(plan);
    if (companion && plan.companionPublishable && translations) {
      // Every stored translation moves in ONE statement, through the adapter's
      // typed update rather than an interpolated string, so the dialect quoting
      // and parameter binding are the adapter's problem and not this module's.
      await tx.update(
        companion.companionTableName,
        {
          _status: "published",
          ...translationRevisionBumpColumns(plan.actor, this.adapter.dialect),
        },
        translations
      );
    }

    // The row as this publish left it, read back on the lock it holds: the
    // promotion wrote the pending changes' shared values to it, so the locked
    // row with the status laid over it would still carry the old ones, in the
    // version the publish records and in every event's current state.
    const publishedRow = (await tx.selectOne<Record<string, unknown>>(
      singleMeta.tableName,
      {
        where: this.whereEq("id", existingDoc.id),
      }
    )) ?? {
      ...lockedRow,
      ...(hasMainStatus && movesShared(plan.parts)
        ? { status: "published", updated_at: publishNow }
        : {}),
      ...(firstPublishedAt ? { first_published_at: firstPublishedAt } : {}),
    };
    return { publishedRow, mainRowTransitioned };
  }

  /**
   * Judge every pending change this publish would promote, and refuse the
   * whole publish if any of them may not be.
   *
   * Refusing all-or-nothing matches what the write does: `promotePendingChanges`
   * applies every language's change and then deletes them all in one
   * transaction, so publishing some and refusing others would leave a caller
   * with no way to say what happened.
   */
  /**
   * Judge every pending change this publish would promote, and refuse the
   * whole publish if any of them may not be.
   *
   * All-or-nothing matches the write it guards: `promotePendingChanges`
   * applies every language's change and deletes them all together, so
   * publishing some and refusing others would leave a caller with no way to
   * say what happened.
   */
  private async assertPendingChangesMayBePromoted(
    tx: TransactionContext,
    plan: PublishPlan,
    /** The main row as this transaction locked it, which the write lands on. */
    lockedRow: Record<string, unknown>,
    pending: ReadonlyArray<{ locale: string | null; snapshot: unknown }>,
    options: PublishAllSingleLocalesOptions,
    promoteGrants?: () => Promise<CallerGrants>,
    promoteReads?: boolean
  ): Promise<void> {
    // Nothing goes live that was not live already: nothing to judge.
    if (pending.length === 0) return;
    const { slug, singleMeta, existingDoc, companion, fieldConfigs } = plan;
    // The row the write lands on, not the one read before the transaction.
    const live = lockedRow as SingleDocument;
    const reader = this.queryService;
    // Constructed without a reader only by a caller that built this service
    // directly. The gate cannot run blind, and silently skipping it would make
    // this the unjudged path again, so say so rather than pass.
    if (!reader) {
      throw NextlyError.internal({
        logContext: {
          cause: "publish-all-without-reader",
          slug,
          detail:
            "Publishing every language needs the read service to judge each pending change.",
        },
      });
    }

    const localizedFieldNames = new Set(
      (companion?.localizedFields ?? []).map(f => f.name)
    );
    // The gate takes the type tags off nested components as well.
    const componentFields = await this.componentFieldsOn(tx, fieldConfigs);
    // Each change judged as the language it goes live in, the shared draft's
    // values within them, never as a language of its own.
    const judged = pendingChangesByLanguage(
      pending,
      this.localization?.defaultLocale ?? null
    );
    await assertDraftsMayBePromoted(judged, {
      ...promoteCallerFor({
        tx,
        slug,
        defaultLocale: this.localization?.defaultLocale ?? null,
        fields: fieldConfigs,
        componentFields,
        options,
        grants: promoteGrants,
        readsEntry: promoteReads,
        localization: this.localization,
        tableName: singleMeta.tableName,
      }),
      entryId: existingDoc.id,
      toLogical: doc =>
        reader.deserializeJsonFields(
          { id: existingDoc.id, updatedAt: live.updatedAt, ...doc },
          singleMeta.fields
        ),
      // The stored row, in the shape a snapshot holds, so an untouched upload
      // or relationship is compared identifier with identifier rather than
      // identifier with the document a read would have expanded it into. And
      // with this language's companion values over it, since a translation
      // lives there and the main row reports every one of them as absent.
      liveStoredFor: locale =>
        liveStoredDocument({
          tx,
          row: live,
          locale,
          companion,
          // The condition this read has always been taken under here.
          companionExists: companion !== null,
          fieldGroupDataService: this.fieldGroupDataService,
          parentTable: singleMeta.tableName,
          fieldConfigs,
          slug,
        }),
      // A language whose draft was saved as a draft still goes live here.
      status: "published",
      localizedFieldNames,
      perLanguageFieldNames: await this.perLanguageFieldNames(
        tx,
        fieldConfigs,
        localizedFieldNames
      ),
      // Every language goes live here, so none of them is falling back to
      // another and each one's required values are enforced.
      enforceLocalizedRequired: true,
    });
  }

  /**
   * Apply every language's pending change, then consume it.
   *
   * Split per language the same way an ordinary write is: a translated value
   * belongs on that language's companion row, and folding it into the main row
   * would write it to a table with no column for it.
   */
  /**
   * A component's fields by its slug, for the walks that tag and untag the
   * components a snapshot records. Resolved once per call so each walk stays
   * synchronous, and on the transaction's own connection: a registry lookup on
   * the pool would take a second connection while this transaction holds one.
   */
  private async componentFieldsOn(
    tx: TransactionContext,
    fieldConfigs: FieldConfig[]
  ): Promise<ComponentFieldResolver> {
    const schemas = this.fieldGroupDataService
      ? await resolveComponentFieldMap(fieldConfigs, componentSlug =>
          this.fieldGroupDataService!.getComponentFields(
            componentSlug,
            tx.getDrizzle()
          )
        )
      : new Map<string, FieldConfig[]>();
    return componentSlug => schemas.get(componentSlug);
  }

  private async promotePendingChanges(
    tx: TransactionContext,
    plan: PublishPlan,
    publishNow: Date,
    /** Judged before the statuses moved; see the transaction body. */
    pending: readonly PendingChange[],
    /** The publisher, whom the component save's own field rules judge. */
    access: FieldGroupWriteAccess
  ): Promise<void> {
    if (pending.length === 0) return;
    const { singleMeta, existingDoc, companion } = plan;
    // So the type tags the drafts record come off at every depth.
    const componentFields = await this.componentFieldsOn(tx, plan.fieldConfigs);

    for (const draft of pending) {
      // The pending change carries no lifecycle of its own; the statuses this
      // publish writes are the ones that count.
      const {
        main,
        companion: companionValues,
        components,
      } = splitPendingChange(
        draft.snapshot,
        plan.singleMeta.tableName,
        plan.singleMeta.fields,
        companion,
        undefined,
        componentFields
      );
      delete main.status;

      if (Object.keys(main).length > 0) {
        await tx.update(
          singleMeta.tableName,
          {
            ...main,
            updated_at: publishNow,
            ...revisionBumpColumns(plan.actor, publishNow),
          },
          this.whereEq("id", existingDoc.id)
        );
      }
      if (
        companion &&
        draft.locale &&
        Object.keys(companionValues).length > 0
      ) {
        await writeCompanionValues({
          tx,
          dialect: this.adapter.dialect,
          companionTableName: companion.companionTableName,
          entryId: existingDoc.id,
          locale: draft.locale,
          values: companionValues,
          savedBy: plan.actor,
        });
        // The held draft's record of where its values came from goes live
        // with them.
        await recordSingleProvenance(
          {
            adapter: this.adapter,
            logger: this.logger,
            defaultLocale: this.localization?.defaultLocale,
          },
          tx,
          {
            slug: singleMeta.slug,
            entryId: existingDoc.id,
            locale: draft.locale,
            values: companionValues,
            localizedFields: companion.localizedFields,
            savedBy: plan.actor,
            promotesDraft: true,
          }
        );
      }
      await this.promoteComponents(
        tx,
        plan,
        components,
        draft.locale,
        access,
        // The whole pending change, published: what the instances' validators
        // are handed as the write, without the markers only a snapshot
        // carries, nested ones included.
        {
          ...stripSingleComponentTags(
            (draft.snapshot ?? {}) as Record<string, unknown>,
            plan.fieldConfigs,
            componentFields
          ),
          status: "published",
        }
      );
    }

    await this.consumePromotedDrafts(tx, plan, pending);
  }

  /**
   * Remove the pending changes a publish promoted, with their bases, so retention may let those
   * versions go. Every one where every part moves; where chosen parts move, only the promoted
   * ones, the shared draft only where the shared part moved: another language's change stays
   * held.
   */
  private async consumePromotedDrafts(
    tx: TransactionContext,
    plan: PublishPlan,
    pending: readonly PendingChange[]
  ): Promise<void> {
    const ref = this.workingDraftRef(plan);
    if (plan.parts === undefined) {
      await new VersionsRepository(tx).deleteAllWorkingDrafts(ref);
      await releaseAllSharedBases(tx, ref);
      return;
    }
    const slots = new Set(pending.map(change => change.locale));
    // Kept by part, a language's promoted change carried the shared draft with it
    // (`part-drafts`), so the shared draft goes too where the shared part moved.
    if (movesShared(plan.parts) && draftsKeptByPart()) {
      slots.add(SHARED_DRAFT_SLOT);
    }
    const repo = new VersionsRepository(tx);
    for (const slot of slots) {
      await repo.deleteWorkingDraft(ref, slot);
      await releaseSharedBase(tx, ref, slot);
    }
  }

  /**
   * The translation rows a move writes the status of: every one of the Single's, or only the
   * chosen languages' where the move chooses some.
   */
  private movedTranslations(plan: PublishPlan): WhereClause | null {
    const { parts } = plan;
    if (parts === undefined)
      return this.whereEq("_parent", plan.existingDoc.id);
    // No language chosen moves no translation: the shared part alone.
    if (parts.locales.size === 0) return null;
    return {
      and: [
        { column: "_parent", op: "=", value: plan.existingDoc.id },
        { column: "_locale", op: "IN", value: [...parts.locales] },
      ],
    };
  }

  /**
   * Write a pending change's component values, the way an ordinary publish
   * writes them. They live in tables of their own, so without this the drafts
   * are consumed and a held component edit is lost while the publish succeeds.
   * Cloned because the save mutates its input (ids, hashed passwords).
   */
  private async promoteComponents(
    tx: TransactionContext,
    plan: PublishPlan,
    components: Record<string, unknown>,
    locale: string | null,
    access: FieldGroupWriteAccess,
    payload: Record<string, unknown>
  ): Promise<void> {
    if (!this.fieldGroupDataService || Object.keys(components).length === 0) {
      return;
    }
    await this.fieldGroupDataService.saveComponentDataInTransaction(tx, {
      parentId: plan.existingDoc.id,
      parentTable: plan.singleMeta.tableName,
      fields: plan.fieldConfigs,
      data: structuredClone(components),
      locale: locale ?? undefined,
      req: access.user ? { user: access.user } : {},
      access,
      // The Single's write, on its transaction, so a field inside an instance
      // that reads the library judges it as the Single's own fields are.
      // In the language published, and as a publish: the payload is the
      // published document, so such a field judges the published form too.
      write: {
        ...entryWriteContext({
          kind: "single",
          slug: plan.slug,
          ...(locale === null ? {} : { locale }),
          connection: {
            db: tx,
            executor: tx.getDrizzle(),
            defaultLocale: this.localization?.defaultLocale ?? null,
          },
        }),
        payload,
      },
    });
  }

  /**
   * The fields each language's draft carries a value of its own for: the
   * translated fields, and every field whose component is translated, whose
   * values `promoteComponents` writes per language.
   */
  private async perLanguageFieldNames(
    tx: TransactionContext,
    fieldConfigs: FieldConfig[],
    localizedFieldNames: Set<string>
  ): Promise<Set<string>> {
    const service = this.fieldGroupDataService;
    if (!service) return new Set(localizedFieldNames);
    return perLanguageFieldNames(
      fieldConfigs,
      localizedFieldNames,
      slug => service.isComponentLocalized(slug, tx.getDrizzle()),
      // The components placed directly in each, whose values are rows of their own.
      async slug =>
        (await service.getComponentDefinition(slug, tx.getDrizzle()))?.fields ??
        null
    );
  }

  /**
   * Every language's content before the drafts are promoted, for the previous
   * state of this publish's events: one capture for every language an event
   * can be told, so no language's "before" is read after the promotion.
   *
   * - `components`: the component subtrees, keyed by locale ("" for none), of
   *   the default language, every stored translation, and every promoted
   *   language, a change that creates its translation row included. Empty when
   *   no pending change holds a component value: nothing is then rewritten,
   *   and the assembly reads the tables as they stand.
   * - `values`: the translated values of each promoted language, in one read.
   *   Every other language's companion row is left as it is, so the values
   *   read after the publish are the same.
   *
   * Both empty when no event is recorded, no in-transaction handler runs
   * and no update hook hears the publish: each is handed the before-state.
   */
  private async stateBeforePromotion(
    tx: TransactionContext,
    plan: PublishPlan,
    pending: readonly PendingChange[],
    priorCompanionStatuses: Map<string, string | null>
  ): Promise<{
    components: Map<string, Record<string, unknown>>;
    values: Map<string, Record<string, unknown>>;
  }> {
    const components = new Map<string, Record<string, unknown>>();
    if (
      (!plan.recordingEnabled &&
        plan.inTransactionHandlers.length === 0 &&
        !plan.runsUpdateHooks) ||
      pending.length === 0
    ) {
      return { components, values: new Map() };
    }
    const promoted = [
      ...new Set(
        pending.flatMap(draft => (draft.locale === null ? [] : [draft.locale]))
      ),
    ];
    const { companion } = plan;
    // One read for every promoted language, however many there are: it runs
    // while this publish holds the row's lock.
    const values =
      companion && plan.companionPublishable
        ? await readCompanionValuesByLocale(
            this.adapter,
            tx,
            companion,
            plan.existingDoc.id,
            promoted
          )
        : new Map<string, Record<string, unknown>>();
    const holdsComponents = pending.some(
      draft =>
        Object.keys(
          draftComponentValues(
            (draft.snapshot ?? {}) as Record<string, unknown>,
            plan.fieldConfigs
          )
        ).length > 0
    );
    if (!holdsComponents || !this.fieldGroupDataService) {
      return { components, values };
    }
    const locales = new Set<string | undefined>([
      this.localization?.defaultLocale,
      ...priorCompanionStatuses.keys(),
      ...promoted,
    ]);
    // Every language's subtrees in one read of each component table: this
    // runs while the publish holds the row's lock, so its reads must not
    // multiply with the languages.
    const read = await readComponentSubtreesByLocale({
      fieldGroupDataService: this.fieldGroupDataService,
      tx,
      entryId: plan.existingDoc.id,
      parentTable: plan.singleMeta.tableName,
      fieldConfigs: plan.fieldConfigs,
      locales: [...locales],
      reason: "webhook-single-component-read",
      logContext: { table: plan.singleMeta.tableName },
    });
    for (const locale of locales) {
      components.set(locale ?? "", read.get(locale) ?? {});
    }
    return { components, values };
  }

  /**
   * Every language's pending change, where the Single keeps drafts, in the
   * order their languages last saved.
   */
  private async pendingChanges(
    tx: TransactionContext | DrizzleAdapter,
    plan: PublishPlan
  ): Promise<PendingChange[]> {
    if (!plan.draftsEligible) return [];
    const { parts } = plan;
    if (parts === undefined) {
      return pendingChangesInSaveOrder(tx, this.workingDraftRef(plan));
    }
    // Languages moved without the shared part promote their own changes alone. Kept by part, a
    // language's change as stored holds its own values only, where the save-order read lays the
    // shared draft's under it, which would put the shared changes live without the shared part.
    if (!parts.shared && draftsKeptByPart()) {
      return (
        await new VersionsRepository(tx).findAllWorkingDrafts(
          this.workingDraftRef(plan)
        )
      ).filter(
        change => change.locale !== null && parts.locales.has(change.locale)
      );
    }
    // Each chosen language's change, and the shared part's own (kept under no language) only
    // where the shared part moves.
    return (
      await pendingChangesInSaveOrder(tx, this.workingDraftRef(plan))
    ).filter(change => movesPart(parts, change.locale));
  }

  /**
   * The Single's shared values as they are live, with its shared components,
   * read on the caller's transaction: what the planner judges pending changes
   * against. Null for a Single with no translations, where nothing is shared
   * between languages.
   */
  private async liveSharedDocument(
    tx: TransactionContext,
    plan: PublishPlan
  ): Promise<LiveSharedDocument | null> {
    const { companion, singleMeta, existingDoc } = plan;
    const reader = this.queryService;
    if (!companion || !reader) return null;
    return liveSharedSingle(
      tx,
      {
        fieldGroupDataService: this.fieldGroupDataService,
        deserialize: row =>
          reader.deserializeJsonFields(
            row as SingleDocument,
            singleMeta.fields
          ),
      },
      {
        singleMeta,
        entryId: existingDoc.id,
        locale: null,
        translated: new Set(companion.localizedFields.map(f => f.name)),
      }
    );
  }

  /**
   * The pending changes as this publish writes them, each carrying the one
   * shared state the publish leaves, judged by the shared planner on the
   * Single's live shared values, read under the lock this transaction took on
   * the row.
   */
  private async sharedValuesForPublish(
    tx: TransactionContext,
    plan: PublishPlan,
    pending: readonly PendingChange[],
    options: PublishAllSingleLocalesOptions,
    promoteGrants?: () => Promise<CallerGrants>
  ): Promise<PendingChange[]> {
    if (pending.length === 0) return [...pending];
    const document = await this.liveSharedDocument(tx, plan);
    if (!document) return [...pending];
    const caller = { options, promoteGrants };
    return sharedStateForPublish(
      tx,
      this.workingDraftRef(plan),
      pending,
      document,
      refused => this.sharedConflict(plan, caller, refused)
    );
  }

  /**
   * Who is told the names of the shared fields a publish judges: the fields
   * their read rules hide are counted, never named, in a refusal and in a
   * preview alike.
   */
  private fieldNameReader(
    plan: PublishPlan,
    caller: SharedFieldsCaller
  ): FieldNameReader {
    const { options } = caller;
    return {
      kind: "single",
      slug: plan.slug,
      user: options.user,
      // A routed request runs trusted but still answers to the caller's field
      // read rules.
      overrideAccess: options.overrideAccess && !options.routeAuthorized,
      authenticatedScope: options.authenticatedScope,
      // Resolved before any transaction opened.
      grants: caller.promoteGrants,
    };
  }

  /** A refusal over shared fields, named as this caller may read them. */
  private sharedConflict(
    plan: PublishPlan,
    caller: SharedFieldsCaller,
    refused: Parameters<RefuseSharedFields>[0]
  ): Promise<NextlyError> {
    return sharedValuesConflict({
      ...this.fieldNameReader(plan, caller),
      entryId: plan.existingDoc.id,
      ...refused,
    });
  }

  /**
   * What a publish of every language does to each configured language, judged
   * from the stored rows before anything is written, by the shared planner.
   * Empty for a Single whose languages carry no status of their own.
   */
  private async languagesOf(
    tx: TransactionContext,
    plan: PublishPlan,
    stored: readonly PendingChange[],
    prior: ReadonlyMap<string, string | null>,
    /** The main row's status before the publish. */
    mainStatus: unknown,
    outOfDate: NamedVerdict["outOfDate"]
  ): Promise<LanguageOutcome[]> {
    const { companion } = plan;
    const localization = this.localization;
    if (!companion || !plan.companionPublishable || !localization) return [];
    return storedLanguageOutcomes(tx, {
      companion,
      localization,
      entryId: plan.existingDoc.id,
      pending: stored,
      prior,
      mainStatus,
      outOfDate,
    });
  }

  /**
   * What publishing every language would do, read on one transaction that
   * writes nothing and locks nothing, judged in the order the publish judges
   * it: the planner's verdict on the shared values, then, where that refuses
   * nothing, the promotion's own gate on what the write would leave. Every
   * refusal is named as the caller may read it.
   */
  private async previewIn(
    tx: TransactionContext,
    plan: PublishPlan,
    caller: SharedFieldsCaller
  ): Promise<Omit<PublishAllSinglePreview, "id">> {
    const prior =
      plan.companion && plan.companionPublishable
        ? await this.readPriorCompanionStatuses(
            tx,
            plan.companion,
            plan.existingDoc.id,
            plan.slug
          )
        : new Map<string, string | null>();
    const mainRow =
      (await tx.selectOne<Record<string, unknown>>(plan.singleMeta.tableName, {
        where: this.whereEq("id", plan.existingDoc.id),
      })) ?? plan.existingDoc;
    const stored = await this.pendingChanges(tx, plan);
    const document =
      stored.length > 0 ? await this.liveSharedDocument(tx, plan) : null;
    const reader = this.fieldNameReader(plan, caller);
    const nameIn =
      (live: Record<string, unknown>) => (fields: readonly string[]) =>
        readableFieldNames(reader, fields, live);
    const verdict = document
      ? await judgeSharedValues(
          tx,
          this.workingDraftRef(plan),
          stored,
          document
        )
      : null;
    const named: NamedVerdict = verdict
      ? await nameVerdict(verdict, nameIn(document!.live))
      : { outOfDate: new Map(), blockers: [] };
    const blockers = [...named.blockers];
    // The gate runs only where the shared values refuse nothing, as in the
    // publish, which refuses on them first.
    if (named.outOfDate.size === 0 && blockers.length === 0) {
      blockers.push(
        ...(await this.promotionBlockersOf(
          tx,
          plan,
          mainRow,
          [
            ...(verdict ? withVerdictState(stored, verdict) : stored),
            // Of the parts the publish moves, as it judges them.
            ...this.goingLiveAsStored(plan, stored, {
              mainStatus: mainRow.status,
              companion: prior,
            }),
          ],
          caller,
          nameIn(document?.live ?? mainRow)
        ))
      );
    }
    return {
      // Only the languages the publish moves, where it moves chosen ones.
      languages: (
        await this.languagesOf(
          tx,
          plan,
          stored,
          prior,
          mainRow.status,
          named.outOfDate
        )
      ).filter(language => movesLanguage(plan.parts, language.locale)),
      blockers,
    };
  }

  /**
   * What the promotion's gate would refuse, asked as the publish asks it, as
   * blockers rather than a refusal. A refusal that names no field is not one
   * the preview can report, so it is thrown as the publish would throw it.
   */
  private async promotionBlockersOf(
    tx: TransactionContext,
    plan: PublishPlan,
    mainRow: Record<string, unknown>,
    judged: ReadonlyArray<{ locale: string | null; snapshot: unknown }>,
    caller: SharedFieldsCaller,
    name: (
      fields: readonly string[]
    ) => Promise<{ named: string[]; hidden: number }>
  ): Promise<PublishAllBlocker[]> {
    try {
      await this.assertPendingChangesMayBePromoted(
        tx,
        plan,
        mainRow,
        judged,
        caller.options,
        caller.promoteGrants,
        caller.promoteReads
      );
      return [];
    } catch (error) {
      const issues = promotionIssuesOf(error);
      if (!issues) throw error;
      return promotionBlockers(issues, name);
    }
  }

  private workingDraftRef(plan: PublishPlan) {
    return {
      scopeKind: "single" as const,
      scopeSlug: plan.slug,
      entryId: plan.existingDoc.id,
    };
  }

  /**
   * The first-publication marker this write establishes, or undefined when it
   * records none.
   *
   * Two conditions, and they answer different questions. The marker must still
   * be ABSENT, which is what makes this the first publication rather than the
   * latest — a republish after an unpublish must not move it. And the document
   * must not ALREADY be public: publish-all can find a Single in a mixed state,
   * a draft main row beside a translation that has been live since before this
   * column existed, and the main row's own transition then reads as a first
   * publication when the document was already reachable. Such a row carries
   * null precisely because its history was never captured, so dating it today
   * would report a publication that never happened.
   *
   * No locale is excluded from that question — this write publishes all of
   * them, so any already-published one predates it.
   */
  private resolveFirstPublication(
    lockedRow: Record<string, unknown>,
    lockedStatus: string | null,
    priorCompanionStatuses: Map<string, string | null>,
    publishNow: Date
  ): Date | undefined {
    if (lockedRow.first_published_at != null) return undefined;
    const alreadyPublic =
      lockedStatus === "published" ||
      [...priorCompanionStatuses.values()].some(s => s === "published");
    return alreadyPublic ? undefined : publishNow;
  }

  /**
   * Every stored translation's committed `_status`, read on the publish
   * transaction.
   *
   * Wrapped so a real database failure surfaces as the canonical internal error
   * rather than the driver's own message: the helper already tolerates a
   * companion table that is not there, so anything reaching the catch carries
   * schema or connection detail that must not reach an API caller through the
   * service's failure result.
   */
  private async readPriorCompanionStatuses(
    tx: TransactionContext | DrizzleAdapter,
    companion: CompanionSchema,
    entryId: string,
    slug: string
  ): Promise<Map<string, string | null>> {
    try {
      return await readCompanionLocaleStatusAll(
        tx.getDrizzle<Parameters<typeof readCompanionLocaleStatusAll>[0]>(),
        companion.table,
        entryId,
        // Inside the transaction, so the remembered verdict is READ rather than
        // resolved: resolving issues a query, and a query against a missing
        // relation aborts the whole transaction on PostgreSQL.
        cachedCompanionReadiness(this.adapter, companion.companionTableName)
      );
    } catch (err) {
      throw NextlyError.internal({
        cause: err instanceof Error ? err : undefined,
        logContext: {
          reason: "single-publish-all-companion-status-scan",
          single: slug,
        },
      });
    }
  }

  /**
   * Record a version snapshot for the publish, inside the publish transaction.
   *
   * Deliberately UNLABELLED by locale, matching the collection publish-all
   * capture. This write spans every language and the snapshot is the main row
   * alone — on a localized Single the translatable columns live only in the
   * companion, so it holds no locale's translated values. Claiming a locale
   * would tell a restore to write content this snapshot never captured.
   */
  private async capturePublishSnapshot(
    tx: TransactionContext,
    slug: string,
    entryId: string,
    tableName: string,
    publishedRow: Record<string, unknown>,
    fieldConfigs: FieldConfig[],
    user: UserContext | undefined,
    maxPerDoc: number | false | undefined,
    // The parts the move changed: put live by a publish, taken down by an unpublish.
    changedParts: ChangedParts,
    // The status the move left the Single's content in: draft for an unpublish.
    contentStatus: "published" | "draft" = "published"
  ): Promise<number | null> {
    // Match the read shape: keep user field keys (which may contain
    // underscores like `site_title`) exactly, converting only the timestamp
    // columns — camel-casing every key would rewrite those fields.
    const parentRow = convertTimestampsToCamelCase({ ...publishedRow });

    // The component schemas the snapshot's tagging needs.
    const resolveComponent = await this.componentFieldsOn(tx, fieldConfigs);

    const components = await readComponentSubtrees({
      fieldGroupDataService: this.fieldGroupDataService,
      tx,
      entryId,
      parentTable: tableName,
      fieldConfigs,
      reason: "single-publish-all-component-read",
      logContext: { single: slug },
    });

    // Always recorded: publishing every language can change only a
    // language's status, which this snapshot does not hold, so it would
    // compare equal with the version before.
    const { versionNo } = await captureInTx(tx, this.versionCapture, {
      // A publish exists only under the Draft/Published lifecycle.
      lifecycle: true,
      ref: { scopeKind: "single", scopeSlug: slug, entryId },
      contentStatus,
      parts: {
        parentRow: tagNestedComponentTypes(
          parentRow,
          fieldConfigs,
          resolveComponent
        ) as Record<string, unknown>,
        components: tagComponentTypes(
          components,
          fieldConfigs,
          resolveComponent
        ),
      },
      createdBy: user?.id ?? null,
      locale: null,
      changedParts,
      maxPerDoc,
    });
    return versionNo;
  }

  /**
   * The moves a publish (or unpublish) makes, as its one history event names
   * them: of the parts it moves, the Single's own status where it keeps one
   * and the shared part moves, and each moved language the app configures (a
   * locale it no longer configures names nothing it exposes), from the status
   * each held. A move of every language moves every part. Its version records
   * the parts they name (`partsMovesRecord`).
   */
  private publishMoves(
    plan: PublishPlan,
    mainFrom: string | null,
    priorCompanionStatuses: Map<string, string | null>,
    to: "published" | "draft" = "published"
  ): StatusMove[] {
    const configuredLocales = new Set(
      this.localization?.locales.map(locale => locale.code) ?? []
    );
    return [
      ...(plan.hasMainStatus && movesShared(plan.parts)
        ? [{ from: mainFrom, to }]
        : []),
      ...[...priorCompanionStatuses]
        .filter(
          ([locale]) =>
            (configuredLocales.size === 0 || configuredLocales.has(locale)) &&
            movesLanguage(plan.parts, locale)
        )
        .map(([locale, from]) => ({ locale, from, to })),
    ];
  }

  /**
   * One history event for the whole publish, naming the moves
   * {@link publishMoves} decided, whatever the Single's webhook settings.
   */
  private async recordPublishHistory(
    tx: TransactionContext,
    plan: PublishPlan,
    publish: {
      user: UserContext | undefined;
      moves: readonly StatusMove[];
      versionNo: number | null;
    }
  ): Promise<void> {
    await recordTransitionEvents(
      tx,
      { adapter: this.adapter },
      {
        subject: { kind: "single", slug: plan.slug, id: plan.existingDoc.id },
        actor: plan.actor,
        personName: publish.user?.name ?? null,
        versionNo: publish.versionNo,
      },
      publish.moves
    );
  }

  /**
   * Append this publish's outbox events on the publish transaction, so they
   * commit with the status write and never survive a rollback.
   *
   * Matching what a consumer of the ordinary write path already expects: one
   * untagged `single.updated` for the write itself; one untagged
   * `single.published` when the main row transitioned and no default-locale
   * companion event already encodes it; and, for each translation whose live
   * content changed, the locale-tagged events a publish of that one language
   * records (`single.updated`, with `single.published` where it went live).
   * The default language's write is then described by both an untagged and a
   * tagged `single.updated`.
   *
   * The untagged main event is SUPPRESSED when the default locale's own
   * companion row transitions here, because that locale-tagged event stands in
   * for it — the same rule the localized update path follows, where a
   * default-locale status riding the companion is emitted locale-tagged and the
   * main-row event is dropped to avoid a duplicate.
   */
  private async recordPublishEvents(
    tx: TransactionContext,
    args: {
      plan: PublishPlan;
      lockedRow: Record<string, unknown>;
      publishedRow: Record<string, unknown>;
      mainRowTransitioned: boolean;
      priorCompanionStatuses: Map<string, string | null>;
      /** Each language's components before promotion, keyed by locale ("" for none). */
      priorComponents: Map<string, Record<string, unknown>>;
      /** Each language's translated values before promotion, keyed by locale. */
      priorCompanionValues: Map<string, Record<string, unknown>>;
      /** The languages whose pending change this publish promoted. */
      promotedLocales: ReadonlySet<string | null>;
    }
  ): Promise<boolean> {
    const {
      plan,
      lockedRow,
      publishedRow,
      mainRowTransitioned,
      priorCompanionStatuses,
    } = args;
    const entryId = plan.existingDoc.id;
    const defaultLocale = this.localization?.defaultLocale;

    // The Single's field tree with component references expanded, so a
    // subscriber's field filter can address a component's own fields. Read on
    // the transaction, for the same reason every other read here is.
    const webhookFields = await expandComponentFields(
      plan.fieldConfigs,
      async componentSlug =>
        this.fieldGroupDataService
          ? await this.fieldGroupDataService.getComponentFields(
              componentSlug,
              tx.getDrizzle()
            )
          : null
    );
    const resource: WebhookResource = {
      kind: "single",
      slug: plan.slug,
      id: entryId,
    };

    // The languages this publish tells, decided once for both passes below: only the chosen
    // ones, where it moves chosen parts.
    const told = this.languagesTold({
      lockedRow,
      priorCompanionStatuses,
      promotedLocales: args.promotedLocales,
    }).filter(language => movesLanguage(plan.parts, language.locale));
    // Whether the default language goes live through its own tagged events
    // here, a translation row its pending change creates included. When it
    // does, the per-locale pass emits its transition tagged with its locale,
    // and the untagged document event would duplicate it.
    const defaultCompanionTransitions =
      defaultLocale !== undefined &&
      told.some(
        language =>
          language.locale === defaultLocale &&
          language.priorStatus !== "published"
      );

    const documentRecorded = await this.recordDocumentEvents(tx, {
      plan,
      lockedRow,
      publishedRow,
      webhookFields,
      resource,
      priorComponents: args.priorComponents,
      priorCompanionValues: args.priorCompanionValues,
      // The untagged publish event is emitted only when the main row really
      // transitioned AND no default-locale companion event already encodes it.
      // `mainRowTransitioned` is false where the shared part did not move.
      emitPublished:
        plan.hasMainStatus &&
        mainRowTransitioned &&
        !defaultCompanionTransitions,
    });

    const localeRecorded = await this.recordLocaleEvents(tx, {
      plan,
      lockedRow,
      publishedRow,
      told,
      webhookFields,
      resource,
      priorComponents: args.priorComponents,
      priorCompanionValues: args.priorCompanionValues,
    });

    return documentRecorded || localeRecorded;
  }

  /**
   * Append an unpublish's outbox events on its transaction, as a publish appends its own: one
   * untagged `single.updated` for the write, with `single.unpublished` where the Single's own row
   * was taken down and the default language's tagged events do not already say so; and, for each
   * language taken down, the locale-tagged `single.updated` and `single.unpublished`.
   */
  private async recordUnpublishEvents(
    tx: TransactionContext,
    args: {
      plan: PublishPlan;
      lockedRow: Record<string, unknown>;
      publishedRow: Record<string, unknown>;
      mainRowTransitioned: boolean;
      /** The configured languages this took down. */
      takenDown: readonly string[];
      priorComponents: Map<string, Record<string, unknown>>;
      priorCompanionValues: Map<string, Record<string, unknown>>;
    }
  ): Promise<boolean> {
    const { plan } = args;
    const configured = new Set(
      this.localization?.locales.map(locale => locale.code) ?? []
    );
    const told = args.takenDown
      .filter(locale => configured.size === 0 || configured.has(locale))
      .map(locale => ({
        locale,
        priorStatus: "published" as unknown,
        promoted: false,
      }));
    const webhookFields = await expandComponentFields(
      plan.fieldConfigs,
      async componentSlug =>
        this.fieldGroupDataService
          ? await this.fieldGroupDataService.getComponentFields(
              componentSlug,
              tx.getDrizzle()
            )
          : null
    );
    const resource: WebhookResource = {
      kind: "single",
      slug: plan.slug,
      id: plan.existingDoc.id,
    };
    const defaultLocale = this.localization?.defaultLocale;
    const documentRecorded = await this.recordDocumentEvents(tx, {
      ...args,
      webhookFields,
      resource,
      emitPublished:
        args.mainRowTransitioned &&
        !told.some(language => language.locale === defaultLocale),
      transition: "single.unpublished",
    });
    const localeRecorded = await this.recordLocaleEvents(tx, {
      ...args,
      told,
      webhookFields,
      resource,
      to: "draft",
    });
    return documentRecorded || localeRecorded;
  }

  /**
   * Build one side of an event payload for this Single.
   *
   * On a localized Single the main row omits translatable columns, so the
   * caller supplies the companion values to overlay and the locale the payload
   * REPRESENTS — the default language for an untagged event, that language's
   * own for a locale-tagged one.
   */
  private buildEventDocument(
    tx: TransactionContext,
    plan: PublishPlan,
    row: Record<string, unknown>,
    companionValues: Record<string, unknown>,
    payloadLocale: string | undefined,
    localeStatus?: string,
    components?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return buildSingleWebhookDoc(
      this.fieldGroupDataService,
      tx,
      plan.existingDoc.id,
      plan.singleMeta.tableName,
      row,
      plan.fieldConfigs,
      plan.companion,
      !!plan.companion && plan.companionPublishable,
      companionValues,
      payloadLocale,
      localeStatus,
      components
    );
  }

  /**
   * The publish's document after and before, in the default language, in the
   * read shape the outbox event carries: the one answer the event and the
   * in-transaction phase are both given.
   */
  private async publishDocuments(
    tx: TransactionContext,
    args: {
      plan: PublishPlan;
      lockedRow: Record<string, unknown>;
      publishedRow: Record<string, unknown>;
      priorComponents: Map<string, Record<string, unknown>>;
      priorCompanionValues: Map<string, Record<string, unknown>>;
      /** The language the documents are read in; the default language when absent. */
      locale?: string;
    }
  ): Promise<{
    data: Record<string, unknown>;
    previous: Record<string, unknown>;
  }> {
    const { plan, lockedRow, publishedRow } = args;
    // Named for the default language it reads when no language is asked.
    const defaultLocale = args.locale ?? this.localization?.defaultLocale;
    const defaultCompanionValues =
      plan.companion && plan.companionPublishable && defaultLocale !== undefined
        ? await readCompanionLocaleValues(
            this.adapter,
            tx,
            plan.companion,
            plan.existingDoc.id,
            defaultLocale
          )
        : {};

    const data = await this.buildEventDocument(
      tx,
      plan,
      publishedRow,
      defaultCompanionValues,
      defaultLocale
    );
    // The default language as readers saw it before: its translated values
    // read before the promotion rewrote them, where it did.
    const previous = await this.buildEventDocument(
      tx,
      plan,
      lockedRow,
      (defaultLocale !== undefined
        ? args.priorCompanionValues.get(defaultLocale)
        : undefined) ?? defaultCompanionValues,
      defaultLocale,
      undefined,
      args.priorComponents.get(defaultLocale ?? "")
    );
    return { data, previous };
  }

  /**
   * The in-transaction phase for this publish, as operation `update` under
   * the Single's hook namespace, with the handlers the plan took before the
   * transaction. The documents are read only when that set is not empty, so
   * a publish nobody handles reads nothing more, and the set that decided
   * what was read (the before-state included) is the one that runs. No hook
   * context is shared on this path, so the handler's is empty.
   */
  private async runInTransactionPhase(
    tx: TransactionContext,
    args: Parameters<SinglePublishAllService["publishDocuments"]>[1],
    user: PublishAllSingleLocalesOptions["user"]
  ): Promise<void> {
    const handlers = args.plan.inTransactionHandlers;
    if (handlers.length === 0) return;
    const collection = getSingleHookCollection(args.plan.slug);
    const { data, previous } = await this.publishDocuments(tx, args);
    await runInTransactionPhaseFor(handlers, tx, {
      collection,
      operation: "update",
      id: String(args.plan.existingDoc.id),
      data,
      originalData: previous,
      user,
      context: {},
    });
  }

  /**
   * The document-wide pair: `single.updated` for the write, and
   * `single.published` when the main row itself went live.
   *
   * Both payloads are assembled at the DEFAULT locale, which is the language an
   * untagged event describes.
   */
  private async recordDocumentEvents(
    tx: TransactionContext,
    args: {
      plan: PublishPlan;
      lockedRow: Record<string, unknown>;
      publishedRow: Record<string, unknown>;
      webhookFields: Awaited<ReturnType<typeof expandComponentFields>>;
      resource: WebhookResource;
      emitPublished: boolean;
      /** The transition event emitted where `emitPublished`: a publish's, where absent. */
      transition?: "single.published" | "single.unpublished";
      priorComponents: Map<string, Record<string, unknown>>;
      priorCompanionValues: Map<string, Record<string, unknown>>;
    }
  ): Promise<boolean> {
    const { plan, webhookFields, resource } = args;
    const { data, previous } = await this.publishDocuments(tx, args);

    let recorded = await recordMutationEvent(tx, {
      type: "single.updated",
      resource,
      data,
      previous,
      fields: webhookFields,
      actor: plan.actor,
    });
    if (args.emitPublished) {
      const published = await recordMutationEvent(tx, {
        type: args.transition ?? "single.published",
        resource,
        data,
        previous,
        fields: webhookFields,
        actor: plan.actor,
      });
      recorded = published || recorded;
    }
    return recorded;
  }

  /** The languages this publish tells; see `languagesTold` in the planner. */
  private languagesTold(args: {
    lockedRow: Record<string, unknown>;
    priorCompanionStatuses: Map<string, string | null>;
    promotedLocales: ReadonlySet<string | null>;
  }): LanguageTold[] {
    return languagesTold({
      configured: new Set(this.localization?.locales.map(l => l.code) ?? []),
      defaultLocale: this.localization?.defaultLocale ?? "",
      prior: args.priorCompanionStatuses,
      promoted: new Set(
        [...args.promotedLocales].filter(
          (locale): locale is string => locale !== null
        )
      ),
      mainStatus: args.lockedRow.status,
    });
  }

  /**
   * The locale-tagged events of each translation whose live content this
   * publish changed, as a publish of that one language records them: a
   * `single.updated` and a `single.published` for a translation that went
   * live, and a `single.updated` for one already live whose pending change
   * went live.
   *
   * The bulk flip moved every companion locale in one statement, but a
   * subscriber watching a single language needs its own event, carrying that
   * language's content and its own prior status. The languages are those
   * `languagesTold` chose.
   */
  private async recordLocaleEvents(
    tx: TransactionContext,
    args: {
      plan: PublishPlan;
      lockedRow: Record<string, unknown>;
      publishedRow: Record<string, unknown>;
      /** The languages this publish tells, with each one's status before. */
      told: readonly LanguageTold[];
      /** The status the languages moved to: published, where absent. */
      to?: "published" | "draft";
      webhookFields: Awaited<ReturnType<typeof expandComponentFields>>;
      resource: WebhookResource;
      priorComponents: Map<string, Record<string, unknown>>;
      priorCompanionValues: Map<string, Record<string, unknown>>;
    }
  ): Promise<boolean> {
    const { plan, lockedRow, publishedRow, told, webhookFields, resource } =
      args;
    let recorded = false;
    // Each language's translated values as the publish left them, in one read
    // for all of them: it runs while this publish holds the row's lock. As
    // they stood before it, the promotion rewrote them where a pending change
    // was promoted, and left them alone where none was.
    const after = plan.companion
      ? await readCompanionValuesByLocale(
          this.adapter,
          tx,
          plan.companion,
          plan.existingDoc.id,
          told.map(language => language.locale)
        )
      : new Map<string, Record<string, unknown>>();

    const to = args.to ?? "published";
    for (const { locale, priorStatus } of told) {
      const localeValues = after.get(locale) ?? {};
      const data = await this.buildEventDocument(
        tx,
        plan,
        publishedRow,
        localeValues,
        locale,
        to
      );
      const previous = await this.buildEventDocument(
        tx,
        plan,
        lockedRow,
        args.priorCompanionValues.get(locale) ?? localeValues,
        locale,
        typeof priorStatus === "string" ? priorStatus : undefined,
        args.priorComponents.get(locale)
      );
      // What a publish of this one language records: the write, and, where
      // the language went live, its move to published.
      // A language taken down records the write and its move to draft.
      const types =
        to === "draft"
          ? (["single.updated", "single.unpublished"] as const)
          : priorStatus === "published"
            ? (["single.updated"] as const)
            : (["single.updated", "single.published"] as const);
      for (const type of types) {
        // This language's events name it alone, as the after-hook run for
        // its change is told it.
        const localeRecorded = await withRuleLanguage(
          { locale, locales: [locale] },
          () =>
            recordMutationEvent(tx, {
              type,
              resource: { ...resource, locale },
              data,
              previous,
              fields: webhookFields,
              actor: plan.actor,
            })
        );
        recorded = localeRecorded || recorded;
      }
    }
    return recorded;
  }
}

/**
 * A publish's early answer as its preview's: a refusal as it is, and a Single
 * with nothing to publish as a preview in which nothing moves.
 */
function previewOf(
  result: SingleResult<PublishAllSingleResult>
): SingleResult<PublishAllSinglePreview> {
  const { data, ...rest } = result;
  return data
    ? { ...rest, data: { id: data.id, languages: [], blockers: [] } }
    : rest;
}

/** How the Single carries its languages' statuses, as the planner reads it. */
function publishableShape(plan: PublishPlan): PublishableShape {
  return {
    hasMainStatus: plan.hasMainStatus,
    translationsPublishable: !!plan.companion && plan.companionPublishable,
  };
}

/** Who publishes, for the field read rules a refusal answers to. */
interface SharedFieldsCaller {
  options: PublishAllSingleLocalesOptions;
  promoteGrants?: () => Promise<CallerGrants>;
  /**
   * Whether the caller may read the Single; undefined for trusted code. The
   * promotion gate names a refused field only to a caller who may.
   */
  promoteReads?: boolean;
}

/**
 * What a Single's publish-all throws for `error`: a typed error as it is, the
 * not-migrated answer for a database not migrated for the Single, and an
 * internal error for anything else. Nothing after the publish's transaction
 * reads the database, so a failure here never follows a written row.
 */
async function publishAllFailure(
  error: unknown,
  single: NotMigratedEntity
): Promise<NextlyError> {
  if (error instanceof NextlyError) return error;
  const notMigrated = await asNotMigrated(error, single);
  if (NextlyError.is(notMigrated)) return notMigrated;
  return NextlyError.internal({
    cause: error instanceof Error ? error : undefined,
    logContext: { reason: "single-publish-all", single: single.slug },
  });
}

/** A language a publish of every language tells; see `languagesTold`. */
type LanguageTold = ReturnType<typeof languagesTold>[number];
