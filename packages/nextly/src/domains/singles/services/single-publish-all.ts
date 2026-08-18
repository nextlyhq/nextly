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
import type { RevalidationIntent } from "../../../revalidation/types";
import {
  AccessControlService,
  isSuperAdminContext,
} from "../../../services/access";
import type { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import { BaseService } from "../../../shared/base-service";
import { convertTimestampsToCamelCase } from "../../../shared/lib/case-conversion";
import type { Logger } from "../../../shared/types";
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

import { ensureSingleRuntimeTable } from "./ensure-runtime-table";
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
    // Whether the transaction appended a durable outbox event, so the caller
    // knows to schedule the fast drain after it commits.
    let eventRecorded = false;
    // Whether the transaction committed a real status write, independent of the
    // recording and revalidation opt-outs — the signal the retention pass keys
    // off, so a Single opting out of both still triggers write-path cleanup.
    let committedWrite = false;
    // Set inside the transaction when the row is gone by the time the lock is
    // taken, so the caller answers not-found rather than reporting a publish of
    // content that no longer exists.
    let documentVanished = false;

    try {
      const singleMeta = await this.singleRegistryService.getSingleBySlug(slug);
      if (!singleMeta) {
        return {
          success: false,
          statusCode: 404,
          message: `Single "${slug}" not found`,
        };
      }

      // Register the Single's runtime table (and its companion) in THIS
      // process before any read touches them: registration happens at create
      // and at boot, so a worker that has seen neither would otherwise fail on
      // a table missing from the schema registry.
      await ensureSingleRuntimeTable(this.adapter, singleMeta, this.logger);

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
          success: false,
          statusCode: 404,
          message: `Single "${slug}" has no document to publish`,
        };
      }

      const accessDenied = await checkSingleAccess({
        slug,
        operation: "update",
        user: options.user,
        overrideAccess: options.overrideAccess,
        // The route ran the `update` gate already (against an API key's scope
        // where applicable), so skip only that redundant RBAC re-check; the
        // publish gate below still runs, and stored rules still run here.
        routeAuthorized: options.routeAuthorized,
        rbacAccessControlService: this.rbacAccessControlService,
        authenticatedScope: options.authenticatedScope,
        accessControlService: this.accessControlService,
        accessRules: singleMeta.accessRules,
        document: existingDoc,
        logger: this.logger,
      });
      if (accessDenied) return accessDenied;

      // The draft/published lifecycle flag on the Single's own config, NOT the
      // mere presence of a `status` column: a Single defining an ordinary user
      // field named `status` has the column and no lifecycle, so it is not
      // publishable and must not demand the publish permission below.
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

      if (!hasMainStatus && !companionPublishable) {
        // Nothing to publish. Returned BEFORE the publish permission check, so
        // a Single with no lifecycle does not demand `publish-{slug}` for a
        // call that would change nothing.
        return {
          success: true,
          statusCode: 200,
          message: "Nothing to publish (single has no status).",
          data: { id: existingDoc.id },
        };
      }

      // This method exists to publish, so it is unconditionally a publish and
      // owes `publish-{slug}` on top of update — checked directly rather than
      // through a transition, since it publishes companion locales even when
      // the main row is already published.
      //
      // A document-dependent (owner-only/custom) rule is DEFERRED to the
      // under-lock re-check inside the transaction, so it is judged against the
      // row this publish actually overwrites: a rule keyed on a mutable field
      // that a concurrent writer changed must not be decided on the stale
      // pre-transaction read. A session super-admin bypasses stored rules on
      // every transport (matching `checkSingleAccess`) but NOT via a scoped API
      // key, so no document rule is installed for them — the under-lock
      // evaluation does not re-apply the bypass and would otherwise 403 an
      // admin on an owner-only Single they do not own.
      const isSuperAdminSession =
        isSuperAdminContext(options.user) &&
        options.authenticatedScope?.actorType !== "apiKey";
      const storedRules = singleMeta.accessRules;
      const publishRule = storedRules?.publish as { type?: string } | undefined;
      const deferPublishDocumentRule =
        !options.overrideAccess &&
        !isSuperAdminSession &&
        (publishRule?.type === "owner-only" || publishRule?.type === "custom");
      const publishPermissionDenied = await checkSingleAccess({
        slug,
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
        accessRules: singleMeta.accessRules,
        document: existingDoc,
        deferStoredRuleEval: deferPublishDocumentRule,
        logger: this.logger,
      });
      if (publishPermissionDenied) return publishPermissionDenied;

      const fieldConfigs = singleMeta.fields ?? [];
      const recordingEnabled = isOutboxRecordingActive("single", slug);
      const actor = actorForWrite(options.actor ?? null, options.user);

      // The per-locale transitions this publish recorded, rebuilt each attempt
      // by the closure so a version-conflict retry does not reuse a stale list.
      let publishedLocales: string[] = [];
      // Whether the main row itself moved to published, read under the lock.
      let mainRowTransitioned = false;

      await withVersionConflictRetry(() =>
        this.adapter.transaction(async tx => {
          // Reset per attempt: the conflict retry re-runs this whole closure.
          documentVanished = false;
          publishedLocales = [];
          mainRowTransitioned = false;

          // Lock the main row up front. One read serves three needs: it is the
          // liveness check (a row deleted between the pre-transaction read and
          // this lock is gone here, so the publish writes and records nothing);
          // it carries the committed status the transition is judged against;
          // and it is the document the deferred publish rule re-checks.
          const lockedRow = await tx.selectOne<Record<string, unknown>>(
            singleMeta.tableName,
            { where: this.whereEq("id", existingDoc.id), forUpdate: true }
          );
          if (!lockedRow) {
            documentVanished = true;
            return;
          }
          const lockedStatus =
            typeof lockedRow.status === "string" ? lockedRow.status : null;

          // Re-check the deferred document-dependent publish rule against the
          // row read UNDER the lock, before any write, so a concurrent change
          // to a field the rule inspects is accounted for. Throwing here rolls
          // the publish back with nothing written.
          if (deferPublishDocumentRule && storedRules) {
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
              existingDoc.id,
              lockedRow
            );
            if (!docResult.allowed) {
              publishDenied = {
                success: false,
                statusCode: 403,
                message:
                  docResult.reason ??
                  `Access denied: publish on single "${slug}" is not permitted`,
              };
              throw new SinglePublishDeniedError();
            }
          }

          // Each locale's committed `_status` BEFORE the bulk flip below, so a
          // real draft->published transition can be told from a locale that was
          // already live. Read under the lock and inside the retry so it
          // reflects the state this publish actually overwrites.
          const priorCompanionStatuses =
            companion && companionPublishable
              ? await this.readPriorCompanionStatuses(
                  tx,
                  companion,
                  existingDoc.id,
                  slug
                )
              : new Map<string, string | null>();

          const publishNow = new Date();
          // The first-publication marker this write establishes, or undefined
          // when it records none. Carried out of the closure so the event
          // payload and the version snapshot — both built from the pre-update
          // row with the new status overlaid — report the marker this very
          // publication set, rather than reporting it absent.
          let firstPublishedAt: Date | undefined;

          if (hasMainStatus) {
            mainRowTransitioned = lockedStatus !== "published";
            const existingMarker = lockedRow.first_published_at;
            // Publish-all can find a Single in a mixed state: a draft main row
            // beside a translation that has been live since before this column
            // existed. The main row's own transition then reads as a first
            // publication when the document was already reachable, so the
            // question asked is document-level rather than row-level. No locale
            // is excluded — this write publishes all of them, so any already
            // published one predates it.
            const alreadyPublic =
              lockedStatus === "published" ||
              [...priorCompanionStatuses.values()].some(s => s === "published");
            // Only when the marker is still absent, which is what makes it the
            // FIRST publication rather than the latest: a republish after an
            // unpublish must not move it. A row published before this column
            // existed carries null precisely because its history was never
            // captured, so dating it today would report a publication that
            // never happened — which is what `alreadyPublic` prevents.
            if (existingMarker == null && !alreadyPublic) {
              firstPublishedAt = publishNow;
            }
            await tx.update(
              singleMeta.tableName,
              {
                status: "published",
                updated_at: publishNow,
                ...(firstPublishedAt
                  ? { first_published_at: firstPublishedAt }
                  : {}),
              },
              this.whereEq("id", existingDoc.id)
            );
          }

          if (companion && companionPublishable) {
            // Every stored translation moves in ONE statement, through the
            // adapter's typed update rather than an interpolated string, so the
            // dialect quoting and parameter binding are the adapter's problem
            // and not this module's.
            await tx.update(
              companion.companionTableName,
              { _status: "published" },
              this.whereEq("_parent", existingDoc.id)
            );
          }

          committedWrite = hasMainStatus || priorCompanionStatuses.size > 0;

          // The committed post-publish main row. Publishing mutates only the
          // status and the marker, so the locked row's other columns are
          // already the post-publish ones — overlay rather than taking a second
          // pooled connection while this transaction holds one, which would
          // deadlock a one-connection pool.
          const publishedRow: Record<string, unknown> = {
            ...lockedRow,
            ...(hasMainStatus ? { status: "published" } : {}),
            ...(hasMainStatus ? { updated_at: publishNow } : {}),
            ...(firstPublishedAt
              ? { first_published_at: firstPublishedAt }
              : {}),
          };

          if (singleMeta.versions?.enabled) {
            await this.capturePublishSnapshot(
              tx,
              slug,
              existingDoc.id,
              singleMeta.tableName,
              publishedRow,
              fieldConfigs,
              options.user,
              singleMeta.versions.maxPerDoc
            );
          }

          if (recordingEnabled) {
            eventRecorded = await this.recordPublishEvents(tx, {
              slug,
              entryId: existingDoc.id,
              tableName: singleMeta.tableName,
              fieldConfigs,
              companion,
              companionPublishable,
              lockedRow,
              publishedRow,
              hasMainStatus,
              mainRowTransitioned,
              priorCompanionStatuses,
              actor,
              onLocalePublished: locale => publishedLocales.push(locale),
            });
          } else {
            for (const [locale, prior] of priorCompanionStatuses) {
              if (prior !== "published") publishedLocales.push(locale);
            }
          }
        })
      );

      // The document was deleted out from under the publish: nothing was
      // written or recorded, so answer not-found rather than reporting success
      // for content that is gone.
      if (documentVanished) {
        return {
          success: false,
          statusCode: 404,
          message: `Single "${slug}" has no document to publish`,
        };
      }

      // A Single is consumed sitewide, so its one tag is the whole cascade.
      // Built whenever a row was written, including for a Single that opts out
      // of recording: a committed content write must still bust its ISR tag.
      const revalidationIntent: RevalidationIntent | undefined = committedWrite
        ? buildSingleRevalidationIntent(slug, readRevalidateConfig(singleMeta))
        : undefined;

      return {
        success: true,
        statusCode: 200,
        message: "All languages published.",
        data: { id: existingDoc.id, status: "published" },
        eventRecorded,
        committed: committedWrite,
        revalidationIntent,
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

    const components: Record<string, unknown> = {};
    if (this.fieldGroupDataService) {
      const populated = await this.fieldGroupDataService.populateComponentData({
        entry: { id: entryId },
        parentTable: tableName,
        fields: fieldConfigs,
        executor: tx.getDrizzle(),
        // Keep relationship/upload references as stored IDs rather than
        // expanding them: a snapshot records this document, and an expanded
        // related entry would embed a copy of somebody else's.
        depth: 0,
        // A component read failure must roll the publish back rather than
        // capture a version with silently-missing subtrees, which a later
        // restore would then write back as the document.
        strict: true,
      });
      for (const field of fieldConfigs) {
        if (!("name" in field) || !field.name) continue;
        if (populated[field.name] !== undefined) {
          components[field.name] = populated[field.name];
        }
      }
    }

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
      slug: string;
      entryId: string;
      tableName: string;
      fieldConfigs: FieldConfig[];
      companion: CompanionSchema | null;
      companionPublishable: boolean;
      lockedRow: Record<string, unknown>;
      publishedRow: Record<string, unknown>;
      hasMainStatus: boolean;
      mainRowTransitioned: boolean;
      priorCompanionStatuses: Map<string, string | null>;
      actor: ReturnType<typeof actorForWrite>;
      onLocalePublished: (locale: string) => void;
    }
  ): Promise<boolean> {
    const {
      slug,
      entryId,
      tableName,
      fieldConfigs,
      companion,
      companionPublishable,
      lockedRow,
      publishedRow,
      hasMainStatus,
      mainRowTransitioned,
      priorCompanionStatuses,
      actor,
      onLocalePublished,
    } = args;

    const defaultLocale = this.localization?.defaultLocale;
    const readCompanion = !!companion && companionPublishable;

    // The Single's field tree with component references expanded, so a
    // subscriber's field filter can address a component's own fields. Read on
    // the transaction, for the same reason every other read here is.
    const webhookFields = await expandComponentFields(
      fieldConfigs,
      async componentSlug =>
        this.fieldGroupDataService
          ? await this.fieldGroupDataService.getComponentFields(
              componentSlug,
              tx.getDrizzle()
            )
          : null
    );

    // The document-wide payload pair. On a localized Single the main row omits
    // translatable columns, so both sides are assembled at the DEFAULT locale —
    // the language an untagged event describes.
    const defaultCompanionValues =
      readCompanion && defaultLocale !== undefined
        ? await readCompanionLocaleValues(
            this.adapter,
            tx,
            companion,
            entryId,
            defaultLocale
          )
        : {};
    const buildDoc = (
      row: Record<string, unknown>,
      companionValues: Record<string, unknown>,
      localeStatus: string | undefined,
      payloadLocale: string | undefined
    ) =>
      buildSingleWebhookDoc(
        this.fieldGroupDataService,
        tx,
        entryId,
        tableName,
        row,
        fieldConfigs,
        companion,
        readCompanion,
        companionValues,
        payloadLocale,
        localeStatus
      );

    const publishedDocument = await buildDoc(
      publishedRow,
      defaultCompanionValues,
      undefined,
      defaultLocale
    );
    const previousDocument = await buildDoc(
      lockedRow,
      defaultCompanionValues,
      undefined,
      defaultLocale
    );

    const resource: WebhookResource = {
      kind: "single",
      slug,
      id: entryId,
    };

    let recorded = await recordMutationEvent(tx, {
      type: "single.updated",
      resource,
      data: publishedDocument,
      previous: previousDocument,
      fields: webhookFields,
      actor,
    });

    // Whether the default locale's own companion row transitions here. When it
    // does, the per-locale loop below emits the default language's transition
    // tagged with its locale, and the untagged main event would duplicate it.
    const defaultCompanionTransitions =
      defaultLocale !== undefined &&
      priorCompanionStatuses.has(defaultLocale) &&
      priorCompanionStatuses.get(defaultLocale) !== "published";

    if (hasMainStatus && mainRowTransitioned && !defaultCompanionTransitions) {
      const mainRecorded = await recordMutationEvent(tx, {
        type: "single.published",
        resource,
        data: publishedDocument,
        previous: previousDocument,
        fields: webhookFields,
        actor,
      });
      recorded = mainRecorded || recorded;
    }

    // Per-locale publish transitions. The bulk flip above moved every companion
    // locale in one statement, but a subscriber watching a single language
    // needs its own event — so each locale that actually transitioned gets one,
    // tagged with the locale and carrying that language's own prior status.
    //
    // Only locales the app still CONFIGURES get an event: a locale removed from
    // configuration can leave stale companion rows behind, and an event tagged
    // with a locale that normal reads and writes reject would mislead a
    // locale-routed consumer.
    const configuredLocales = new Set(
      this.localization?.locales.map(l => l.code) ?? []
    );
    for (const [locale, priorStatus] of priorCompanionStatuses) {
      if (configuredLocales.size > 0 && !configuredLocales.has(locale))
        continue;
      if (priorStatus === "published") continue;
      onLocalePublished(locale);

      // This locale's own before/after documents. Publishing changes only the
      // status, so the language's translatable values and its component
      // subtrees are identical on both sides — read once and used for both.
      const localeValues = companion
        ? await readCompanionLocaleValues(
            this.adapter,
            tx,
            companion,
            entryId,
            locale
          )
        : {};
      const localeData = await buildDoc(
        publishedRow,
        localeValues,
        "published",
        locale
      );
      const localePrevious = await buildDoc(
        lockedRow,
        localeValues,
        priorStatus ?? undefined,
        locale
      );
      const localeRecorded = await recordMutationEvent(tx, {
        type: "single.published",
        resource: { ...resource, locale },
        data: localeData,
        previous: localePrevious,
        fields: webhookFields,
        actor,
      });
      recorded = localeRecorded || recorded;
    }

    return recorded;
  }
}
