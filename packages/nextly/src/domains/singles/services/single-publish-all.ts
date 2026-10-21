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

import { actorForWrite } from "../../../auth/request-actor";
import type { FieldConfig } from "../../../collections/fields/types";
import type { RBACAccessControlService } from "../../../domains/auth/services/rbac-access-control-service";
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
} from "../../../shared/lib/field-level-registry";
import type { Logger } from "../../../shared/types";
import { recordTransitionEvents } from "../../content-events/write-event";
import { readComponentSubtrees } from "../../field-groups/read-component-subtrees";
import { readCompanionLocaleStatusAll } from "../../i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
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
  editedSharedFields,
  outOfDateSharedFields,
  releaseAllSharedBases,
  sharedValuesConflict,
  snapshotRecord,
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
import { liveSharedSingle, perLanguageFieldNames } from "./live-shared-single";
import {
  assertDraftsMayBePromoted,
  liveStoredDocument,
  promoteCallerFor,
} from "./promote-gate";
import {
  checkSingleAccess,
  type SingleQueryService,
} from "./single-query-service";
import type { SingleRegistryService } from "./single-registry-service";
import {
  buildSingleWebhookDoc,
  readCompanionLocaleValues,
} from "./single-webhook-doc";

/**
 * What a publish-all reports back: the document it acted on, and the status it
 * moved to. `status` is absent only for a Single with no draft/published
 * lifecycle, where the call is a no-op and nothing moved.
 */
export interface PublishAllSingleResult {
  id: string;
  status?: "published";
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
}

export class SinglePublishAllService extends BaseService {
  /** Stateless version-capture service, used inside the publish transaction. */
  private readonly versionCapture = new VersionCaptureService();

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly singleRegistryService: SingleRegistryService,
    private readonly fieldGroupDataService?: FieldGroupDataService,
    private readonly rbacAccessControlService?: RBACAccessControlService,
    private readonly localization?: SanitizedLocalizationConfig,
    /** Reads the promote gate needs: the logical shape, and the live document. */
    private readonly queryService?: SingleQueryService
  ) {
    super(adapter, logger);
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
    this.logger.debug("Publishing all languages of a Single", { slug });

    try {
      const resolved = await this.resolvePublishTarget(slug, options);
      if ("result" in resolved) return resolved.result;
      const plan = resolved.plan;

      const denial = await this.authorizePublish(plan, options);
      if (denial) return denial;

      // Resolved here because the gate that uses them runs inside the write
      // transaction, and resolving grants queries the pooled connection that
      // transaction is holding.
      const promoteGrants = await resolvedCallerGrants(
        options.user,
        options.authenticatedScope
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
          this.commitPublish(tx, plan, options, promoteGrants)
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
        data: { id: plan.existingDoc.id, status: "published" },
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
      if (error instanceof NextlyError) throw error;
      throw NextlyError.internal({
        cause: error instanceof Error ? error : undefined,
        logContext: { reason: "single-publish-all", single: slug },
      });
    }
  }

  /**
   * Resolve what this publish would act on, or the answer that ends it early.
   *
   * Three things end it before any authorization to publish: no such Single, no
   * document to publish, and a caller who may not update this Single at all.
   * A fourth ends it successfully — a Single with no draft/published lifecycle
   * has nothing to publish, and that answer is produced HERE, before the
   * publish permission is asked for, so a caller holding update but not publish
   * is not refused for a call that would change nothing.
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

    const accessDenied = await checkSingleAccess({
      slug,
      operation: "update",
      user: options.user,
      overrideAccess: options.overrideAccess,
      // The route ran the `update` gate already (against an API key's scope
      // where applicable), so skip only that redundant RBAC re-check; the
      // publish gate still runs.
      routeAuthorized: options.routeAuthorized,
      rbacAccessControlService: this.rbacAccessControlService,
      authenticatedScope: options.authenticatedScope,
      logger: this.logger,
    });
    if (accessDenied) return { result: accessDenied };

    const { hasMainStatus, companion, companionPublishable } =
      await this.resolveLifecycle(slug, singleMeta);

    if (!hasMainStatus && !companionPublishable) {
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
   * Check `publish-{slug}` on top of the update already granted, and decide
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
        // A scoped API key is judged on its own `publish-{slug}` grant, not the
        // key owner's — the route checked only `update` against the scope.
        authenticatedScope: options.authenticatedScope,
        logger: this.logger,
      })) ?? undefined
    );
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
      return { documentVanished: true, committed: false, eventRecorded: false };
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
    const pending = await this.sharedValuesForPublish(
      tx,
      plan,
      await this.pendingChanges(tx, plan),
      options,
      promoteGrants
    );
    await this.assertPendingChangesMayBePromoted(
      tx,
      plan,
      lockedRow,
      [
        ...pending,
        ...languagesGoingLiveAsStored(
          plan,
          pending,
          { mainStatus: lockedRow.status, companion: priorCompanionStatuses },
          new Set(this.localization?.locales.map(locale => locale.code) ?? [])
        ),
      ],
      options,
      promoteGrants
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

    const written = await this.writePublishedStatuses(
      tx,
      plan,
      lockedRow,
      priorCompanionStatuses,
      pending,
      options.user
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

    await this.recordPublishActivity(tx, plan, committed);

    const eventRecorded = plan.recordingEnabled
      ? await this.recordPublishEvents(tx, {
          plan,
          lockedRow,
          publishedRow: written.publishedRow,
          mainRowTransitioned: written.mainRowTransitioned,
          priorCompanionStatuses,
          priorComponents,
        })
      : false;

    return {
      documentVanished: false,
      committed,
      eventRecorded,
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
    committed: boolean
  ): Promise<void> {
    if (!committed) return;
    await recordSingleSaveActivity(tx, {
      slug: plan.slug,
      entryId: plan.existingDoc.id,
      label: plan.singleMeta.label,
      locale: null,
      actor: plan.actor,
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
    /** The publisher, whom the component save's own field rules see. */
    user: UserContext | undefined
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
    await this.promotePendingChanges(tx, plan, publishNow, pending, user);

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

    return {
      publishedRow: {
        ...lockedRow,
        ...(hasMainStatus
          ? { status: "published", updated_at: publishNow }
          : {}),
        ...(firstPublishedAt ? { first_published_at: firstPublishedAt } : {}),
      },
      mainRowTransitioned,
    };
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
    user: UserContext | undefined
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
      await this.promoteComponents(tx, plan, components, draft.locale, user);
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
    user: UserContext | undefined
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
      req: user ? { user } : {},
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
   * Every language's pending change, where the Single keeps drafts, in the
   * order their languages last saved. They are applied to one main row in this
   * order, so where two changed one shared field the later save's value is
   * the one left, whatever order the database returns the rows in.
   */
  private async pendingChanges(
    tx: TransactionContext,
    plan: PublishPlan
  ): Promise<PendingChange[]> {
    if (!plan.draftsEligible) return [];
    const repo = new VersionsRepository(tx);
    const drafts = await repo.findAllWorkingDrafts(this.workingDraftRef(plan));
    if (drafts.length < 2) return drafts;
    const newest = await repo.newestVersionNoByLocale(
      this.workingDraftRef(plan),
      drafts.map(draft => draft.locale)
    );
    const savedAt = (draft: PendingChange) => newest.get(draft.locale) ?? 0;
    return [...drafts].sort((a, b) => savedAt(a) - savedAt(b));
  }

  /**
   * The pending changes as this publish writes them, each carrying the one
   * shared state the publish leaves.
   *
   * Refused first, naming every field, when any change holds a shared value
   * someone else published after it began: that is the out-of-date change a
   * single publish refuses too, and nothing is merged on its behalf.
   *
   * Otherwise every change began from the live shared values, and each brings
   * only the shared fields it edited itself, measured against its own base.
   * Where two edited one field, the later save's value is kept. Combining the
   * edits of changes that are all current is not the field-by-field merge an
   * out-of-date change was refused to avoid: no change here is behind live,
   * so none of its values reverts another's. Every change is then written with
   * the same shared state, so the order the rows are applied in no longer
   * decides it.
   */
  private async sharedValuesForPublish(
    tx: TransactionContext,
    plan: PublishPlan,
    pending: readonly PendingChange[],
    options: PublishAllSingleLocalesOptions,
    promoteGrants?: () => Promise<CallerGrants>
  ): Promise<PendingChange[]> {
    const { companion, singleMeta, existingDoc } = plan;
    const reader = this.queryService;
    if (!companion || !reader || pending.length === 0) return [...pending];
    // Read under the lock this transaction took on the row, with its shared
    // components.
    const { live, shared } = await liveSharedSingle(
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
    await this.assertNoneOutOfDate(
      tx,
      plan,
      pending,
      { live, shared },
      {
        options,
        promoteGrants,
      }
    );
    const state = await this.mergedSharedState(tx, plan, pending, live, shared);
    return pending.map(draft => withSharedState(draft, shared, state));
  }

  /** Refuse, naming every field, when any change is behind live. */
  private async assertNoneOutOfDate(
    tx: TransactionContext,
    plan: PublishPlan,
    pending: readonly PendingChange[],
    document: { live: Record<string, unknown>; shared: readonly string[] },
    caller: {
      options: PublishAllSingleLocalesOptions;
      promoteGrants?: () => Promise<CallerGrants>;
    }
  ): Promise<void> {
    const ref = this.workingDraftRef(plan);
    const stale = new Set<string>();
    for (const draft of pending) {
      const fields = await outOfDateSharedFields(tx, {
        ref,
        locale: draft.locale,
        shared: document.shared,
        live: document.live,
        pending: snapshotRecord(draft.snapshot),
      });
      for (const name of fields) stale.add(name);
    }
    if (stale.size === 0) return;
    const { options } = caller;
    throw await sharedValuesConflict({
      kind: "single",
      slug: plan.slug,
      entryId: plan.existingDoc.id,
      fields: [...stale],
      live: document.live,
      user: options.user,
      // A routed request runs trusted but still answers to the caller's field
      // read rules.
      overrideAccess: options.overrideAccess && !options.routeAuthorized,
      authenticatedScope: options.authenticatedScope,
      // Resolved before the transaction opened.
      grants: caller.promoteGrants,
    });
  }

  /**
   * The live shared values, each overlaid by the latest change that edited
   * it: `pending` is in the order the languages last saved.
   */
  private async mergedSharedState(
    tx: TransactionContext,
    plan: PublishPlan,
    pending: readonly PendingChange[],
    live: Record<string, unknown>,
    shared: readonly string[]
  ): Promise<Record<string, unknown>> {
    const ref = this.workingDraftRef(plan);
    const state: Record<string, unknown> = Object.fromEntries(
      shared.map(name => [name, live[name]])
    );
    for (const draft of pending) {
      const values = snapshotRecord(draft.snapshot);
      const edited = await editedSharedFields(tx, {
        ref,
        locale: draft.locale,
        shared,
        pending: values,
      });
      for (const name of edited) state[name] = values[name];
    }
    return state;
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
    tx: TransactionContext,
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
   * Three kinds, matching what a consumer of the ordinary write path already
   * expects: one `single.updated` for the write itself; one untagged
   * `single.published` when the main row transitioned and no default-locale
   * companion event already encodes it; and one locale-tagged
   * `single.published` per translation that actually went live.
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
    const previous = await this.buildEventDocument(
      tx,
      plan,
      lockedRow,
      defaultCompanionValues,
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
   * One locale-tagged `single.published` per translation that actually went
   * live.
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

    for (const [locale, priorStatus] of priorCompanionStatuses) {
      if (configuredLocales.size > 0 && !configuredLocales.has(locale))
        continue;
      if (priorStatus === "published") continue;

      // Publishing changes only the status, so this language's translatable
      // values and its component subtrees are identical on both sides — read
      // once and used for both.
      const localeValues = plan.companion
        ? await readCompanionLocaleValues(
            this.adapter,
            tx,
            plan.companion,
            plan.existingDoc.id,
            locale
          )
        : {};
      const localeRecorded = await recordMutationEvent(tx, {
        type: "single.published",
        resource: { ...resource, locale },
        data: await this.buildEventDocument(
          tx,
          plan,
          publishedRow,
          localeValues,
          locale,
          "published"
        ),
        previous: await this.buildEventDocument(
          tx,
          plan,
          lockedRow,
          localeValues,
          locale,
          priorStatus ?? undefined,
          args.priorComponents.get(locale)
        ),
        fields: webhookFields,
        actor: plan.actor,
      });
      recorded = localeRecorded || recorded;
    }
    return recorded;
  }
}

/** One language's pending change, as the versions store holds it. */
type PendingChange = Awaited<
  ReturnType<VersionsRepository["findAllWorkingDrafts"]>
>[number];

/** Each language's status as committed before this publish moved it. */
interface PriorStatuses {
  /** The main row's, which is the whole document's for an unlocalized Single. */
  readonly mainStatus: unknown;
  /** Each stored translation's `_status`, keyed by locale. */
  readonly companion: ReadonlyMap<string, string | null>;
}

/**
 * The languages this publish judges as stored, beside its pending changes:
 * those it puts live from their stored rows alone, and, when a pending change
 * may rewrite the shared values beneath them, those already live too. A
 * language that was live and is not touched was judged as published when it
 * went live, and a pending change is judged on its own account.
 *
 * The main row is one of them where nothing else carries it: shared content
 * goes live with the main row's status even where no translation is stored,
 * as on a Single whose only edits were shared ones, so it is judged then too.
 */
function languagesGoingLiveAsStored(
  plan: PublishPlan,
  pending: ReadonlyArray<{ locale: string | null }>,
  prior: PriorStatuses,
  /**
   * The languages the app configures. A removed language's row can outlive
   * it, and no request can reach it to repair, so it is not judged.
   */
  configured: ReadonlySet<string>
): { locale: string | null; snapshot: Record<string, never> }[] {
  const held = new Set(pending.map(change => change.locale));
  // A pending change can write shared values to the main row, which every
  // language's document reads, so a language already live is changed by it as
  // surely as one going live: with anything pending, every stored translation
  // is judged.
  const changesShared = pending.length > 0;
  const translations =
    plan.companion && plan.companionPublishable
      ? [...prior.companion]
          .filter(
            ([locale, status]) =>
              !held.has(locale) &&
              (configured.size === 0 || configured.has(locale)) &&
              (changesShared || status !== "published")
          )
          .map(([locale]) => ({ locale, snapshot: {} }))
      : [];
  // Each of these is judged on the main row too, so it carries it already.
  if (translations.length > 0 || pending.length > 0) return translations;
  if (!plan.hasMainStatus || prior.mainStatus === "published") return [];
  return [{ locale: null, snapshot: {} }];
}

/** A pending change carrying the one shared state a publish of every language leaves. */
function withSharedState(
  draft: PendingChange,
  shared: readonly string[],
  state: Record<string, unknown>
): PendingChange {
  const values = snapshotRecord(draft.snapshot);
  return {
    ...draft,
    snapshot: {
      ...values,
      ...Object.fromEntries(
        shared.filter(name => name in values).map(name => [name, state[name]])
      ),
    },
  };
}
