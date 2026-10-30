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
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import {
  ownDatabaseVisitor,
  visitorWithoutAccessService,
} from "../../../auth/access/own-database-visitor";
import { askEachLanguage } from "../../../auth/access/rule-language";
import { actorForWrite } from "../../../auth/request-actor";
import type { FieldConfig } from "../../../collections/fields/types";
import type { RBACAccessControlService } from "../../../domains/auth/services/rbac-access-control-service";
import { errorEnvelopeFields } from "../../../errors/from-service-envelope";
import { NextlyError } from "../../../errors/nextly-error";
import {
  buildSingleRevalidationIntent,
  readRevalidateConfig,
} from "../../../revalidation/intent-builders";
import type { DynamicSingleRecord } from "../../../schemas/dynamic-singles/types";
import type { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import { BaseService } from "../../../shared/base-service";
import { convertTimestampsToCamelCase } from "../../../shared/lib/case-conversion";
import {
  resolvedCallerGrants,
  type CallerGrants,
  type VisitorGrantsLoader,
} from "../../../shared/lib/field-level-registry";
import type { Logger } from "../../../shared/types";
import type { PublicationFacts } from "../../audit/record-activity";
import { recordTransitionEvents } from "../../content-events/write-event";
import { refuseWriteIfRemovedFromCode } from "../../dynamic-collections/services/removed-from-code-writes";
import { readComponentSubtrees } from "../../field-groups/read-component-subtrees";
import {
  fieldGroupWriteAccessOf,
  type FieldGroupWriteAccess,
} from "../../field-groups/services/field-group-mutation-service";
import {
  populateTranslationStatus,
  readCompanionLocaleStatusAll,
} from "../../i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import {
  languagesChangedConflict,
  languagesGoingLiveFrom,
  languagesPromotedChangeReaches,
  languagesToAsk,
  unaskedLanguages,
} from "../../i18n/languages-going-live";
import {
  type LocalizationSource,
  localizationNow,
} from "../../i18n/localization-source";
import {
  perLanguageFieldNames,
  reachesLocalizedFieldGroup,
} from "../../i18n/per-language-fields";
import { resolveLocaleChain } from "../../i18n/resolve-locale";
import {
  buildCompanionSchema,
  type CompanionSchema,
} from "../../i18n/runtime/companion-io";
import {
  cachedCompanionReadiness,
  isCompanionReady,
} from "../../i18n/runtime/companion-readiness";
import { captureInTx } from "../../versions/capture-in-tx";
import { draftComponentValues } from "../../versions/draft-components";
import { schemaDraftSplit } from "../../versions/draft-split-eligibility";
import {
  judgeSharedValues,
  type LanguageOutcome,
  languageOutcomes,
  languagesGoingLiveAsStored,
  type LiveSharedDocument,
  type NamedVerdict,
  nameVerdict,
  type PendingChange,
  pendingChangesInSaveOrder,
  type PublishableShape,
  type PublishAllBlocker,
  type RefuseSharedFields,
  sharedStateForPublish,
} from "../../versions/publish-all-plan";
import {
  type FieldNameReader,
  readableFieldNames,
  releaseAllSharedBases,
  sharedValuesConflict,
} from "../../versions/shared-publish-base";
import {
  type ComponentFieldResolver,
  resolveComponentFieldMap,
  tagComponentTypes,
  tagNestedComponentTypes,
} from "../../versions/tag-component-types";
import { VersionCaptureService } from "../../versions/version-capture-service";
import { withVersionConflictRetry } from "../../versions/version-conflict";
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
} from "./promote-gate";
import {
  checkSingleAccess,
  singleGrantRefusal,
  type SingleQueryService,
} from "./single-query-service";
import type { SingleRegistryService } from "./single-registry-service";
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
 * Everything the publish acts on, resolved once before the transaction opens.
 *
 * Gathered up front because the transaction body may RE-RUN: `withVersionConflictRetry`
 * replays it on a version_no race, and anything resolved inside would be
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
  fieldConfigs: FieldConfig[];
  recordingEnabled: boolean;
  /**
   * Whether the Single may have working drafts, as its schema read reports.
   * A stored draft is promoted only while it does: one left from before the
   * schema made it ineligible is hidden from every read.
   */
  draftsEligible: boolean;
  actor: ReturnType<typeof actorForWrite>;
}

/** What the committed transaction tells the caller it owes afterwards. */
interface PublishOutcome {
  /** The row was gone by the time the lock was taken; nothing was written. */
  documentVanished: boolean;
  /** A content write is durable, so cache tags and retention are owed. */
  committed: boolean;
  /** A durable outbox event was appended, so the fast drain is owed. */
  eventRecorded: boolean;
  /** What the publish did to each configured language. */
  languages: LanguageOutcome[];
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
    private readonly queryService?: SingleQueryService
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
    options: PublishAllSingleLocalesOptions = {}
  ): Promise<SingleResult<PublishAllSingleResult>> {
    // Refused first when the Single is removed from code, before any hook or
    // read of its document, so a refused write changes nothing.
    await refuseWriteIfRemovedFromCode("single", slug);
    this.logger.debug("Publishing all languages of a Single", { slug });

    // A refusal inside the transaction (the languages going live changed under
    // the lock) is kept here, since the rollback re-wraps what it throws.
    const refused: { denied?: SingleResult<PublishAllSingleResult> } = {};

    try {
      const resolved = await this.resolvePublishTarget(slug, options);
      if ("result" in resolved) return resolved.result;
      const plan = resolved.plan;

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

      // Resolved here because the gate that uses them runs inside the write
      // transaction, and resolving grants queries the pooled connection that
      // transaction is holding.
      const promoteGrants = await resolvedCallerGrants(
        options.user,
        options.authenticatedScope,
        this.fieldRuleVisitor
      );

      // Every component type's readiness, resolved before the transaction:
      // the drafts' component values are written inside it, where a verdict
      // can only be read, and an unknown one reads as unavailable. The payload
      // is empty, so this warms and refuses nothing.
      await this.fieldGroupDataService?.assertLocalizedFieldGroupsWritable({
        fields: plan.fieldConfigs,
        data: {},
        locale: undefined,
      });

      const outcome = await withVersionConflictRetry(() =>
        this.adapter.transaction(tx =>
          this.commitPublish(
            tx,
            plan,
            options,
            refused,
            askedLanguages,
            promoteGrants
          )
        )
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

      return {
        success: true,
        statusCode: 200,
        message: "All languages published.",
        data: {
          id: plan.existingDoc.id,
          status: "published",
          languages: outcome.languages,
        },
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
      if (error instanceof NextlyError) throw error;
      throw NextlyError.internal({
        cause: error instanceof Error ? error : undefined,
        logContext: { reason: "single-publish-all", single: slug },
      });
    }
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
    options: PublishAllSingleLocalesOptions = {}
  ): Promise<SingleResult<PublishAllSinglePreview>> {
    await refuseWriteIfRemovedFromCode("single", slug);
    try {
      const resolved = await this.resolvePublishTarget(slug, options);
      if ("result" in resolved) return previewOf(resolved.result);
      const { plan } = resolved;
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
      const preview = await this.adapter.transaction(tx =>
        this.previewIn(tx, plan, { options, promoteGrants })
      );
      return {
        success: true,
        statusCode: 200,
        message: "What publishing every language does.",
        data: { id: plan.existingDoc.id, ...preview },
      };
    } catch (error) {
      if (error instanceof NextlyError) throw error;
      throw NextlyError.internal({
        cause: error instanceof Error ? error : undefined,
        logContext: { reason: "single-publish-all-preview", single: slug },
      });
    }
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
    options: PublishAllSingleLocalesOptions
  ): Promise<
    { plan: PublishPlan } | { result: SingleResult<PublishAllSingleResult> }
  > {
    const singleMeta = await resolveSingleForRequest(
      this.adapter,
      this.singleRegistryService,
      slug,
      this.logger
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
            operation: "publish",
            user: options.user,
            overrideAccess: options.overrideAccess,
            rbacAccessControlService: this.rbacAccessControlService,
            visitor: this.fieldRuleVisitor,
            authenticatedScope: options.authenticatedScope,
            logger: this.logger,
          })
        : null;
    if (refused) return { result: refused };

    const { hasMainStatus, companion, companionPublishable } =
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
        fieldConfigs: singleMeta.fields ?? [],
        recordingEnabled: isOutboxRecordingActive("single", slug),
        actor: actorForWrite(options.actor ?? null, options.user),
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
  }> {
    const hasMainStatus = singleMeta.status === true;
    const companion =
      this.localization && singleMeta.localized === true
        ? buildCompanionSchema({
            slug,
            tableName: singleMeta.tableName,
            fields: singleMeta.fields as { name: string; type: string }[],
            dialect: this.adapter.dialect,
            status: hasMainStatus,
          })
        : null;
    // Only `ready` matters here: a companion that is not there has no
    // per-locale publish lifecycle, and why it is not there changes nothing
    // about that.
    const companionPublishable =
      !!companion &&
      companion.hasStatus &&
      (await isCompanionReady(this.adapter, companion.companionTableName));
    return { hasMainStatus, companion, companionPublishable };
  }

  /**
   * Check `publish-{slug}`, the whole of what publishing every language needs
   * since it changes only the status, and decide
   * whether the Single's stored publish rule has to be re-judged under the lock.
   *
   * Checked directly rather than through a transition, since this publishes
   * companion locales even when the main row is already published.
   */
  private async authorizePublish(
    plan: PublishPlan,
    options: PublishAllSingleLocalesOptions
  ): Promise<SingleResult<PublishAllSingleResult> | undefined> {
    return (
      (await checkSingleAccess({
        slug: plan.slug,
        operation: "publish",
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
    languages: readonly string[]
  ): Promise<SingleResult<PublishAllSingleResult> | undefined> {
    const denied = await askEachLanguage(languages, () =>
      this.authorizePublish(plan, options)
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
      ...languagesGoingLiveAsStored(
        publishableShape(plan),
        pending,
        { mainStatus, companion: statuses },
        new Set(this.localization?.locales.map(locale => locale.code) ?? [])
      ),
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
    const goingLive = languagesGoingLiveFrom({
      statuses,
      configured,
      defaultLocale,
      mainPublished: mainStatus === "published",
    });
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
          ...pending.flatMap(change =>
            languagesPromotedChangeReaches(
              change.locale ?? defaultLocale,
              configured
            )
          ),
          ...languagesToAsk(goingLive, {
            configured,
            reachesLocalizedFieldGroup: reaches,
          }),
        ].filter((locale): locale is string => typeof locale === "string")
      ),
    ];
  }

  /**
   * The publish itself: lock, re-check, write every status, capture, record.
   *
   * Runs inside `withVersionConflictRetry`, so the whole body may re-run — it
   * therefore derives everything it reports from values read under THIS
   * attempt's lock rather than carrying state across attempts.
   */
  private async commitPublish(
    tx: TransactionContext,
    plan: PublishPlan,
    options: PublishAllSingleLocalesOptions,
    /** Where a refusal to publish is kept for `publishAllLocales` to return. */
    refused: { denied?: SingleResult<PublishAllSingleResult> },
    /** The languages the publish rule was asked about before this transaction. */
    askedLanguages: readonly string[],
    /** Resolved before this transaction opened; see `publishAllLocales`. */
    promoteGrants?: () => Promise<CallerGrants>
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
    const alsoGoingLive = languagesGoingLiveAsStored(
      publishableShape(plan),
      stored,
      { mainStatus: lockedRow.status, companion: priorCompanionStatuses },
      new Set(this.localization?.locales.map(locale => locale.code) ?? [])
    );

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
      promoteGrants
    );

    // What the publish does to each language, judged before it writes, as a
    // preview of it judges it. Nothing pending is out of date by now: the
    // shared values were judged above.
    const languages = await this.languagesOf(
      tx,
      plan,
      stored,
      priorCompanionStatuses,
      lockedRow.status,
      new Map()
    );

    // The components as they stood before the drafts are promoted, for each
    // language an event's previous state is built in: the promotion rewrites
    // the component tables that assembly would otherwise read.
    const priorComponents = await this.componentsBeforePromotion(
      tx,
      plan,
      pending,
      priorCompanionStatuses
    );
    // Each language's translated values before the drafts are promoted, for
    // the same reason: the promotion rewrites the companion rows too.
    const priorCompanionValues = await this.companionValuesBeforePromotion(
      tx,
      plan,
      pending
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
        singleMeta.versions.maxPerDoc
      );
    }

    await this.recordPublishHistory(tx, plan, {
      user: options.user,
      mainFrom: lockedRow.status as string | null,
      priorCompanionStatuses,
      versionNo: publishVersionNo,
    });

    // A publish that moved nothing — no main lifecycle and no stored
    // translation — has no content write for the caller to flush or prune, and
    // nothing for the activity trail to record.
    const committed = hasMainStatus || priorCompanionStatuses.size > 0;

    await this.recordPublishActivity(tx, plan, committed, {
      statusAfter: "published",
      statusBefore: statusBeforePublish([
        lockedRow.status as string | null | undefined,
        ...priorCompanionStatuses.values(),
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

    return {
      documentVanished: false,
      committed,
      eventRecorded,
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

    if (hasMainStatus) {
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
        },
        this.whereEq("id", existingDoc.id)
      );
    }

    // Every language's pending change goes live with its status. Without this
    // the statuses would all say published while the content each author was
    // holding stayed unapplied — the document would report itself fully
    // published and show none of the work being published.
    await this.promotePendingChanges(tx, plan, publishNow, pending, access);

    if (companion && plan.companionPublishable) {
      // Every stored translation moves in ONE statement, through the adapter's
      // typed update rather than an interpolated string, so the dialect quoting
      // and parameter binding are the adapter's problem and not this module's.
      await tx.update(
        companion.companionTableName,
        { _status: "published" },
        this.whereEq("_parent", existingDoc.id)
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
      ...(hasMainStatus ? { status: "published", updated_at: publishNow } : {}),
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
    promoteGrants?: () => Promise<CallerGrants>
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
    await assertDraftsMayBePromoted(pending, {
      ...promoteCallerFor({
        tx,
        slug,
        defaultLocale: this.localization?.defaultLocale ?? null,
        fields: fieldConfigs,
        componentFields,
        options,
        grants: promoteGrants,
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
          { ...main, updated_at: publishNow },
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
        });
      }
      await this.promoteComponents(tx, plan, components, draft.locale, access);
    }

    await new VersionsRepository(tx).deleteAllWorkingDrafts(
      this.workingDraftRef(plan)
    );
    // Their bases go with them, so retention may let those versions go.
    await releaseAllSharedBases(tx, this.workingDraftRef(plan));
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
    access: FieldGroupWriteAccess
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
    return perLanguageFieldNames(fieldConfigs, localizedFieldNames, slug =>
      service.isComponentLocalized(slug, tx.getDrizzle())
    );
  }

  /**
   * Each language's component subtrees before the drafts are promoted, keyed
   * by locale ("" for none), for the previous state of this publish's events.
   * Empty when no event is recorded, or when no pending change holds a
   * component value: nothing is then rewritten, and the assembly reads the
   * tables as they stand.
   */
  private async componentsBeforePromotion(
    tx: TransactionContext,
    plan: PublishPlan,
    pending: readonly PendingChange[],
    priorCompanionStatuses: Map<string, string | null>
  ): Promise<Map<string, Record<string, unknown>>> {
    const prior = new Map<string, Record<string, unknown>>();
    if (!plan.recordingEnabled) return prior;
    const holdsComponents = pending.some(
      draft =>
        Object.keys(
          draftComponentValues(
            (draft.snapshot ?? {}) as Record<string, unknown>,
            plan.fieldConfigs
          )
        ).length > 0
    );
    if (!holdsComponents || !this.fieldGroupDataService) return prior;
    const defaultLocale = this.localization?.defaultLocale;
    const locales = new Set<string | undefined>([
      defaultLocale,
      ...priorCompanionStatuses.keys(),
    ]);
    for (const locale of locales) {
      prior.set(
        locale ?? "",
        await readComponentSubtrees({
          fieldGroupDataService: this.fieldGroupDataService,
          tx,
          entryId: plan.existingDoc.id,
          parentTable: plan.singleMeta.tableName,
          fieldConfigs: plan.fieldConfigs,
          locale,
          reason: "webhook-single-component-read",
          logContext: { table: plan.singleMeta.tableName },
        })
      );
    }
    return prior;
  }

  /**
   * Each language's translated values before the drafts are promoted, keyed by
   * locale, for the previous state of this publish's events. Read only for the
   * languages whose pending change the promotion writes: every other
   * language's companion row is left as it is, so the values read after the
   * publish are the same. Empty when no event is recorded.
   */
  private async companionValuesBeforePromotion(
    tx: TransactionContext,
    plan: PublishPlan,
    pending: readonly PendingChange[]
  ): Promise<Map<string, Record<string, unknown>>> {
    const { companion } = plan;
    if (!plan.recordingEnabled || pending.length === 0) return new Map();
    if (!companion || !plan.companionPublishable) return new Map();
    // One read for every promoted language, however many there are: it runs
    // while this publish holds the row's lock.
    return readCompanionValuesByLocale(
      this.adapter,
      tx,
      companion,
      plan.existingDoc.id,
      [
        ...new Set(
          pending.flatMap(draft =>
            draft.locale === null ? [] : [draft.locale]
          )
        ),
      ]
    );
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
    return pendingChangesInSaveOrder(tx, this.workingDraftRef(plan));
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
    const configured = localization.locales.map(locale => locale.code);
    // Whether each language has content of its own, as the translation
    // overview judges it, so the two never disagree.
    const row: Record<string, unknown> = { id: plan.existingDoc.id };
    await populateTranslationStatus({
      db: tx.getDrizzle<
        Parameters<typeof populateTranslationStatus>[0]["db"]
      >(),
      companionTable: companion.table,
      localizedFields: companion.localizedFields,
      rows: [row],
      locales: configured,
      defaultLocale: localization.defaultLocale,
      hasStatus: companion.hasStatus,
      // A publishable companion is one that is there.
      readiness: "ready",
    });
    const overview = (row._translations ?? {}) as Record<
      string,
      { translated?: boolean } | undefined
    >;
    return languageOutcomes({
      configured,
      defaultLocale: localization.defaultLocale,
      pending: new Set(stored.map(draft => draft.locale)),
      outOfDate,
      prior,
      mainStatus,
      hasOwnContent: locale => overview[locale]?.translated === true,
      // The chain a read of the language resolves through, so the language
      // named is the one its readers see.
      fallbackChain: locale =>
        resolveLocaleChain(localization, locale, undefined) ?? [locale],
    });
  }

  /**
   * What publishing every language would do, read on one transaction that
   * writes nothing and locks nothing: the planner's verdict on the pending
   * changes, named as the caller may read it, and each language's outcome.
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
    const stored = await this.pendingChanges(tx, plan);
    const document =
      stored.length > 0 ? await this.liveSharedDocument(tx, plan) : null;
    const named: NamedVerdict = document
      ? await nameVerdict(
          await judgeSharedValues(
            tx,
            this.workingDraftRef(plan),
            stored,
            document
          ),
          fields =>
            readableFieldNames(
              this.fieldNameReader(plan, caller),
              fields,
              document.live
            )
        )
      : { outOfDate: new Map(), blockers: [] };
    return {
      languages: await this.languagesOf(
        tx,
        plan,
        stored,
        prior,
        (plan.existingDoc as { status?: unknown }).status,
        named.outOfDate
      ),
      blockers: named.blockers,
    };
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
    maxPerDoc: number | false | undefined
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
      contentStatus: "published",
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
      maxPerDoc,
    });
    return versionNo;
  }

  /**
   * One history event for the whole publish, naming the languages it moved
   * (the app's own; a locale it no longer configures names nothing it
   * exposes), whatever the Single's webhook settings.
   */
  private async recordPublishHistory(
    tx: TransactionContext,
    plan: PublishPlan,
    publish: {
      user: UserContext | undefined;
      mainFrom: string | null;
      priorCompanionStatuses: Map<string, string | null>;
      versionNo: number | null;
    }
  ): Promise<void> {
    const configuredLocales = new Set(
      this.localization?.locales.map(locale => locale.code) ?? []
    );
    await recordTransitionEvents(
      tx,
      { adapter: this.adapter },
      {
        subject: { kind: "single", slug: plan.slug, id: plan.existingDoc.id },
        actor: plan.actor,
        personName: publish.user?.name ?? null,
        versionNo: publish.versionNo,
      },
      [
        ...(plan.hasMainStatus
          ? [{ from: publish.mainFrom, to: "published" }]
          : []),
        ...[...publish.priorCompanionStatuses]
          .filter(
            ([locale]) =>
              configuredLocales.size === 0 || configuredLocales.has(locale)
          )
          .map(([locale, from]) => ({ locale, from, to: "published" })),
      ]
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

    // Whether the default locale's own companion row transitions here. When it
    // does, the per-locale pass emits the default language's transition tagged
    // with its locale, and the untagged document event would duplicate it.
    const defaultCompanionTransitions =
      defaultLocale !== undefined &&
      priorCompanionStatuses.has(defaultLocale) &&
      priorCompanionStatuses.get(defaultLocale) !== "published";

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
      emitPublished:
        plan.hasMainStatus &&
        mainRowTransitioned &&
        !defaultCompanionTransitions,
    });

    const localeRecorded = await this.recordLocaleEvents(tx, {
      plan,
      lockedRow,
      publishedRow,
      priorCompanionStatuses,
      webhookFields,
      resource,
      priorComponents: args.priorComponents,
      priorCompanionValues: args.priorCompanionValues,
      promotedLocales: args.promotedLocales,
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
      priorComponents: Map<string, Record<string, unknown>>;
      priorCompanionValues: Map<string, Record<string, unknown>>;
    }
  ): Promise<boolean> {
    const { plan, lockedRow, publishedRow, webhookFields, resource } = args;
    const defaultLocale = this.localization?.defaultLocale;
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
        type: "single.published",
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

  /**
   * The locale-tagged events of each translation whose live content this
   * publish changed, as a publish of that one language records them: a
   * `single.updated` and a `single.published` for a translation that went
   * live, and a `single.updated` for one already live whose pending change
   * went live.
   *
   * The bulk flip moved every companion locale in one statement, but a
   * subscriber watching a single language needs its own event, carrying that
   * language's content and its own prior status.
   *
   * Only locales the app still CONFIGURES get one: a locale removed from
   * configuration can leave stale companion rows behind, and an event tagged
   * with a locale that normal reads and writes reject would mislead a
   * locale-routed consumer.
   */
  private async recordLocaleEvents(
    tx: TransactionContext,
    args: {
      plan: PublishPlan;
      lockedRow: Record<string, unknown>;
      publishedRow: Record<string, unknown>;
      priorCompanionStatuses: Map<string, string | null>;
      webhookFields: Awaited<ReturnType<typeof expandComponentFields>>;
      resource: WebhookResource;
      priorComponents: Map<string, Record<string, unknown>>;
      priorCompanionValues: Map<string, Record<string, unknown>>;
      promotedLocales: ReadonlySet<string | null>;
    }
  ): Promise<boolean> {
    const {
      plan,
      lockedRow,
      publishedRow,
      priorCompanionStatuses,
      webhookFields,
      resource,
    } = args;
    const configuredLocales = new Set(
      this.localization?.locales.map(l => l.code) ?? []
    );
    let recorded = false;

    // The languages this publish tells: those that went live, and those
    // already live whose pending change went live.
    const told = [...priorCompanionStatuses].filter(
      ([locale, priorStatus]) =>
        (configuredLocales.size === 0 || configuredLocales.has(locale)) &&
        (priorStatus !== "published" || args.promotedLocales.has(locale))
    );
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
          told.map(([locale]) => locale)
        )
      : new Map<string, Record<string, unknown>>();

    for (const [locale, priorStatus] of told) {
      const localeValues = after.get(locale) ?? {};
      const data = await this.buildEventDocument(
        tx,
        plan,
        publishedRow,
        localeValues,
        locale,
        "published"
      );
      const previous = await this.buildEventDocument(
        tx,
        plan,
        lockedRow,
        args.priorCompanionValues.get(locale) ?? localeValues,
        locale,
        priorStatus ?? undefined,
        args.priorComponents.get(locale)
      );
      // What a publish of this one language records: the write, and, where
      // the language went live, its move to published.
      const types =
        priorStatus === "published"
          ? (["single.updated"] as const)
          : (["single.updated", "single.published"] as const);
      for (const type of types) {
        const localeRecorded = await recordMutationEvent(tx, {
          type,
          resource: { ...resource, locale },
          data,
          previous,
          fields: webhookFields,
          actor: plan.actor,
        });
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
}
