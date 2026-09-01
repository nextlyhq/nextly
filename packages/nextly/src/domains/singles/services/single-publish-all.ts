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
import {
  AccessControlService,
  isSuperAdminContext,
} from "../../../services/access";
import type { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import { BaseService } from "../../../shared/base-service";
import { convertTimestampsToCamelCase } from "../../../shared/lib/case-conversion";
import type { Logger } from "../../../shared/types";
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
import {
  resolveComponentFieldMap,
  tagComponentTypes,
  tagNestedComponentTypes,
} from "../../versions/tag-component-types";
import { VersionCaptureService } from "../../versions/version-capture-service";
import { withVersionConflictRetry } from "../../versions/version-conflict";
import { expandComponentFields } from "../../webhooks/expand-component-fields";
import { recordMutationEvent } from "../../webhooks/record-mutation-event";
import { isOutboxRecordingActive } from "../../webhooks/recording-activation";
import type { WebhookResource } from "../../webhooks/types";
import type {
  PublishAllSingleLocalesOptions,
  SingleDocument,
  SingleResult,
  UserContext,
} from "../types";

import { resolveSingleForRequest } from "./ensure-runtime-table";
import { promoteAllPendingChanges } from "./promote-all-pending-changes";
import { checkSingleAccess } from "./single-query-service";
import type { SingleRegistryService } from "./single-registry-service";
import {
  buildSingleWebhookDoc,
  readCompanionLocaleValues,
} from "./single-webhook-doc";

/**
 * Thrown inside the write transaction when the under-lock document-rule
 * re-check refuses the publish, so the whole transaction rolls back with
 * nothing written. The resolved 403 is carried on a variable rather than on the
 * error: the adapter re-wraps this as a database error while unwinding, so
 * `instanceof` no longer identifies it by the time the catch runs.
 */
class SinglePublishDeniedError extends NextlyError {
  constructor() {
    super({
      code: "FORBIDDEN",
      publicMessage: "Publishing this document is not allowed.",
    });
    this.name = "SinglePublishDeniedError";
  }
}

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
  actor: ReturnType<typeof actorForWrite>;
  /** Set by `authorizePublish`: re-judge the stored rule under the row lock. */
  deferDocumentRule: boolean;
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

/**
 * Whether this Single's stored publish rule has to be re-judged against the
 * ROW, inside the transaction, rather than decided here.
 *
 * Only owner-only and custom rules depend on the document; the rest — public,
 * authenticated, role-based — need none, so deciding them up front costs
 * nothing and keeps the transaction shorter.
 *
 * A session super-admin bypasses stored rules on every transport (matching
 * `checkSingleAccess`) but NOT via a scoped API key, so no document rule is
 * installed for them: the under-lock evaluation does not re-apply the bypass
 * and would otherwise 403 an admin on an owner-only Single they do not own.
 */
function deferDocumentRule(
  singleMeta: DynamicSingleRecord,
  options: PublishAllSingleLocalesOptions
): boolean {
  if (options.overrideAccess) return false;
  const isSuperAdminSession =
    isSuperAdminContext(options.user) &&
    options.authenticatedScope?.actorType !== "apiKey";
  if (isSuperAdminSession) return false;
  const publishRule = singleMeta.accessRules?.publish as
    | { type?: string }
    | undefined;
  return publishRule?.type === "owner-only" || publishRule?.type === "custom";
}

export class SinglePublishAllService extends BaseService {
  /** Evaluator for a Single's stored access rules (stateless, zero-arg). */
  private readonly accessControlService: AccessControlService;

  /** Stateless version-capture service, used inside the publish transaction. */
  private readonly versionCapture = new VersionCaptureService();

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly singleRegistryService: SingleRegistryService,
    private readonly fieldGroupDataService?: FieldGroupDataService,
    private readonly rbacAccessControlService?: RBACAccessControlService,
    private readonly localization?: SanitizedLocalizationConfig,
    accessControlService?: AccessControlService
  ) {
    super(adapter, logger);
    this.accessControlService =
      accessControlService ?? new AccessControlService();
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

    // Set when the under-lock document-rule re-check refuses the publish.
    // Declared out here so the catch can return the resolved 403 rather than a
    // 500: the sentinel thrown inside the transaction is re-wrapped as the
    // adapter unwinds, so its type is no longer recoverable there.
    let publishDenied: SingleResult<PublishAllSingleResult> | undefined;

    try {
      const resolved = await this.resolvePublishTarget(slug, options);
      if ("result" in resolved) return resolved.result;
      const plan = resolved.plan;

      const denial = await this.authorizePublish(plan, options);
      if (denial) return denial;

      const outcome = await withVersionConflictRetry(() =>
        this.adapter.transaction(tx =>
          this.commitPublish(tx, plan, options, denied => {
            publishDenied = denied;
          })
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
      // A publish refused by the under-lock re-check aborts the transaction;
      // return the 403 it resolved rather than a 500.
      if (publishDenied) return publishDenied;
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
      // publish gate still runs, and stored rules still run here.
      routeAuthorized: options.routeAuthorized,
      rbacAccessControlService: this.rbacAccessControlService,
      authenticatedScope: options.authenticatedScope,
      accessControlService: this.accessControlService,
      accessRules: singleMeta.accessRules,
      document: existingDoc,
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
        deferDocumentRule: false,
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
   *
   * A document-dependent (owner-only/custom) rule is DEFERRED to the under-lock
   * re-check, so it is judged against the row this publish actually overwrites:
   * a rule keyed on a mutable field a concurrent writer changed must not be
   * decided on the stale pre-transaction read. A session super-admin bypasses
   * stored rules on every transport (matching `checkSingleAccess`) but NOT via
   * a scoped API key, so no document rule is installed for them — the
   * under-lock evaluation does not re-apply the bypass and would otherwise 403
   * an admin on an owner-only Single they do not own.
   *
   * Mutates `plan.deferDocumentRule`, which the transaction reads.
   */
  private async authorizePublish(
    plan: PublishPlan,
    options: PublishAllSingleLocalesOptions
  ): Promise<SingleResult<PublishAllSingleResult> | undefined> {
    plan.deferDocumentRule = deferDocumentRule(plan.singleMeta, options);

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
        accessControlService: this.accessControlService,
        accessRules: plan.singleMeta.accessRules,
        document: plan.existingDoc,
        deferStoredRuleEval: plan.deferDocumentRule,
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
    onDenied: (denial: SingleResult<PublishAllSingleResult>) => void
  ): Promise<PublishOutcome> {
    const { slug, singleMeta, existingDoc, hasMainStatus } = plan;

    // Lock the main row up front. One read serves three needs: it is the
    // liveness check (a row deleted between the pre-transaction read and this
    // lock is gone here, so the publish writes and records nothing); it carries
    // the committed status the transition is judged against; and it is the
    // document the deferred publish rule re-checks.
    const lockedRow = await tx.selectOne<Record<string, unknown>>(
      singleMeta.tableName,
      { where: this.whereEq("id", existingDoc.id), forUpdate: true }
    );
    if (!lockedRow) {
      return { documentVanished: true, committed: false, eventRecorded: false };
    }

    await this.assertPublishAllowedUnderLock(
      plan,
      options,
      lockedRow,
      onDenied
    );

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

    const written = await this.writePublishedStatuses(
      tx,
      plan,
      lockedRow,
      priorCompanionStatuses
    );

    if (singleMeta.versions?.enabled) {
      await this.capturePublishSnapshot(
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

    const eventRecorded = plan.recordingEnabled
      ? await this.recordPublishEvents(tx, {
          plan,
          lockedRow,
          publishedRow: written.publishedRow,
          mainRowTransitioned: written.mainRowTransitioned,
          priorCompanionStatuses,
        })
      : false;

    return {
      documentVanished: false,
      // A publish that moved nothing — no main lifecycle and no stored
      // translation — has no content write for the caller to flush or prune.
      committed: hasMainStatus || priorCompanionStatuses.size > 0,
      eventRecorded,
    };
  }

  /**
   * Re-judge a deferred document-dependent publish rule against the row read
   * UNDER the lock, before any write, so a concurrent change to a field the
   * rule inspects is accounted for. Throwing rolls the publish back with
   * nothing written.
   */
  private async assertPublishAllowedUnderLock(
    plan: PublishPlan,
    options: PublishAllSingleLocalesOptions,
    lockedRow: Record<string, unknown>,
    onDenied: (denial: SingleResult<PublishAllSingleResult>) => void
  ): Promise<void> {
    const storedRules = plan.singleMeta.accessRules;
    if (!plan.deferDocumentRule || !storedRules) return;

    const docResult = await this.accessControlService.evaluateAccess(
      storedRules,
      "publish",
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
      plan.existingDoc.id,
      lockedRow
    );
    if (docResult.allowed) return;

    onDenied({
      success: false,
      statusCode: 403,
      message:
        docResult.reason ??
        `Access denied: publish on single "${plan.slug}" is not permitted`,
    });
    throw new SinglePublishDeniedError();
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
    priorCompanionStatuses: Map<string, string | null>
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
    await this.promotePendingChanges(tx, plan, publishNow);

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
   * Apply every language's pending change, then consume it.
   *
   * Split per language the same way an ordinary write is: a translated value
   * belongs on that language's companion row, and folding it into the main row
   * would write it to a table with no column for it.
   */
  private async promotePendingChanges(
    tx: TransactionContext,
    plan: PublishPlan,
    publishNow: Date
  ): Promise<void> {
    // Delegated: a wildcard-locale write owes the same debt, and one of the two
    // was written without it. See the module note.
    await promoteAllPendingChanges({
      tx,
      dialect: this.adapter.dialect,
      slug: plan.slug,
      tableName: plan.singleMeta.tableName,
      entryId: plan.existingDoc.id,
      companion: plan.companion,
      draftsEnabled: plan.singleMeta.versions?.drafts?.enabled === true,
      now: publishNow,
    });
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
  ): Promise<void> {
    // Match the read shape: keep user field keys (which may contain
    // underscores like `site_title`) exactly, converting only the timestamp
    // columns — camel-casing every key would rewrite those fields.
    const parentRow = convertTimestampsToCamelCase({ ...publishedRow });

    // Component schemas the snapshot's tagging needs, resolved once so the walk
    // itself stays synchronous, and read on the transaction's own connection —
    // a registry lookup on the pool would take a second connection while this
    // transaction still holds one.
    const componentSchemas = this.fieldGroupDataService
      ? await resolveComponentFieldMap(fieldConfigs, componentSlug =>
          this.fieldGroupDataService!.getComponentFields(
            componentSlug,
            tx.getDrizzle()
          )
        )
      : new Map<string, FieldConfig[]>();
    const resolveComponent = (componentSlug: string) =>
      componentSchemas.get(componentSlug);

    const components = await readComponentSubtrees({
      fieldGroupDataService: this.fieldGroupDataService,
      tx,
      entryId,
      parentTable: tableName,
      fieldConfigs,
      reason: "single-publish-all-component-read",
      logContext: { single: slug },
    });

    await captureInTx(tx, this.versionCapture, {
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
    localeStatus?: string
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
      localeStatus
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
      defaultLocale
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
          priorStatus ?? undefined
        ),
        fields: webhookFields,
        actor: plan.actor,
      });
      recorded = localeRecorded || recorded;
    }
    return recorded;
  }
}
