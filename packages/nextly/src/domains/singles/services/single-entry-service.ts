/**
 * Single Entry Service
 *
 * Thin facade that preserves the original SingleEntryService public API
 * while delegating to the split query and mutation services. This keeps
 * every existing caller (API routes, DI container, direct API, CLI)
 * working unchanged
 *
 * See:
 * - {@link SingleQueryService} — read operations (get, auto-create, expansion)
 * - {@link SingleMutationService} — write operations (update, hook mutation flow)
 *
 * @module domains/singles/services/single-entry-service
 * @since 1.0.0
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  everyLanguageOf,
  readLanguagesFor,
  withRuleLanguage,
  writeAsNamedLanguagesFor,
  writeLanguagesFor,
} from "../../../auth/access/rule-language";
import type { RBACAccessControlService } from "../../../domains/auth/services/rbac-access-control-service";
import type { RetentionRunner } from "../../../domains/retention/runner";
import type { HookRegistry } from "../../../hooks/hook-registry";
import type { CacheRevalidator } from "../../../revalidation/types";
import type { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import { BaseService } from "../../../shared/base-service";
import type { Logger } from "../../../shared/types";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import {
  type LocalizationSource,
  localizationNow,
} from "../../i18n/localization-source";
import { releaseVisibilityFor } from "../../releases/release-visibility";
import type { WebhookFastDrainScheduler } from "../../webhooks/after-drain";
import type {
  GetSingleOptions,
  PublishAllSingleLocalesOptions,
  SingleResult,
  UpdateSingleOptions,
} from "../types";

import { SingleMutationService } from "./single-mutation-service";
import {
  SinglePublishAllService,
  type PublishAllSingleResult,
} from "./single-publish-all";
import { SingleQueryService } from "./single-query-service";
import type { SingleRegistryService } from "./single-registry-service";

// Re-export types so legacy imports from this module keep working.
export type {
  GetSingleOptions,
  PublishAllSingleLocalesOptions,
  UpdateSingleOptions,
  UserContext,
  SingleResult,
  SingleDocument,
} from "../types";

/**
 * Single Entry Service facade.
 *
 * Constructs a {@link SingleQueryService} and {@link SingleMutationService}
 * from the provided dependencies and delegates every public method. The
 * constructor signature mirrors the pre-decomposition god file so DI
 * registration and tests do not need to change.
 */
export class SingleEntryService extends BaseService {
  private readonly queryService: SingleQueryService;
  private readonly mutationService: SingleMutationService;
  private readonly publishAllService: SinglePublishAllService;

  /** The site's languages as they are now: the source may be the language registry. */
  private get localization(): SanitizedLocalizationConfig | undefined {
    return localizationNow(this.localizationSource);
  }

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    singleRegistryService: SingleRegistryService,
    hookRegistry: HookRegistry,
    fieldGroupDataService?: FieldGroupDataService,
    rbacAccessControlService?: RBACAccessControlService,
    // i18n: normalized localization config so a localized single resolves/writes
    // translatable fields via its companion `single_<slug>_locales` table.
    // Kept here too: every operation runs inside `withRuleLanguage` with the
    // languages it involves, so each rule it asks is told them. A read is told
    // its language and the ones it falls back to, a write the language it
    // writes, and an operation on the whole Single every language.
    private readonly localizationSource?: LocalizationSource,
    /**
     * Retention passes offered after a write, so a frequently-written single
     * trims what it fills without waiting for a scheduled drain. The shared
     * runner carries both — the webhook outbox and the audit trails — each on
     * its own window and its own gate, and decides which are configured.
     *
     * Absent only when NEITHER has anything to prune: an install with webhook
     * retention off and audit retention on still gets a runner. A construction
     * site forwarding one policy and not the other leaves that domain unpruned
     * rather than failing, so both belong here.
     */
    private readonly retentionRunner?: RetentionRunner,
    /**
     * Kicks an immediate, bounded drain after a write (via Next `after()`) so a
     * single's outbox rows are delivered without waiting for the scheduled
     * trigger. Shared with the collection write path; absent when webhooks were
     * never registered.
     */
    private readonly fastDrainScheduler?: WebhookFastDrainScheduler,
    /**
     * Resolves the cache revalidator that flushes a single write's revalidation
     * intent post-commit. Shared with the collection write path. A resolver (not
     * the instance) so it is read at flush time: this service is constructed
     * during boot, before a Next cache adapter registers, and an eager capture
     * would memoize the no-op default. Returns undefined when no adapter present.
     */
    private readonly resolveCacheRevalidator?: () =>
      | CacheRevalidator
      | undefined
  ) {
    super(adapter, logger);

    // What a due release makes visible. Built once and shared, so the cheap
    // check's memo is shared too — a cache per read would reload the earliest
    // scheduled instant on every request and lose the point of having one.
    const releaseVisibility = releaseVisibilityFor(adapter);

    this.queryService = new SingleQueryService(
      adapter,
      logger,
      singleRegistryService,
      hookRegistry,
      fieldGroupDataService,
      rbacAccessControlService,
      localizationSource,
      releaseVisibility,
      // The write's own judgement, asked when a read shows a pending change to
      // a caller who may publish and not update. Read when a read asks it,
      // after the mutation service below exists.
      args => this.mutationService.workingDraftPromotionRefused(args)
    );

    this.mutationService = new SingleMutationService(
      adapter,
      logger,
      singleRegistryService,
      hookRegistry,
      fieldGroupDataService,
      rbacAccessControlService,
      localizationSource
    );

    // Publishing every language is its own write path — no caller content, no
    // write locale, one status across every companion row — so it gets its own
    // service rather than a further method on the update path.
    this.publishAllService = new SinglePublishAllService(
      adapter,
      logger,
      singleRegistryService,
      fieldGroupDataService,
      rbacAccessControlService,
      localizationSource,
      // Publishing every language promotes every language's pending change,
      // and judging one before it is promoted means reading: the stored
      // snapshot in its logical shape, and the live document of the language
      // it belongs to. The read service is the one that answers both, and
      // this path is built here where it already exists.
      this.queryService
    );
  }

  // ============================================================
  // Read Operations → SingleQueryService
  // ============================================================

  /**
   * Get a Single document by slug.
   *
   * If the document doesn't exist, it will be auto-created with default
   * field values.
   */
  get(slug: string, options?: GetSingleOptions): Promise<SingleResult> {
    return withRuleLanguage(
      readLanguagesFor(
        this.localization,
        options?.locale,
        options?.fallbackLocale,
        options
      ),
      () => this.queryService.get(slug, options)
    );
  }

  // ============================================================
  // Write Operations → SingleMutationService
  // ============================================================

  /**
   * Update a Single document by slug.
   *
   * If the document doesn't exist, it will be auto-created first,
   * then updated with the provided data.
   */
  async update(
    slug: string,
    data: Record<string, unknown>,
    options?: UpdateSingleOptions
  ): Promise<SingleResult> {
    const result = await withRuleLanguage(
      writeLanguagesFor(this.localization, options?.locale),
      () => this.mutationService.update(slug, data, options)
    );
    await this.afterWrite(result, options?.disableRevalidate === true);
    return result;
  }

  /**
   * Remove a Single's pending working-draft sidecar for one language.
   *
   * Deliberately without the post-write plumbing `update` and
   * `publishAllLocales` carry. Those flush cache tags and offer a retention pass
   * because they changed the LIVE document; a discard removes an unpublished
   * sidecar and leaves the live row byte-identical, so there is nothing for a
   * reader's cache to be stale about and no new version to prune.
   */
  async discardWorkingDraft(
    params: Parameters<SingleMutationService["discardWorkingDraft"]>[0]
  ): Promise<void> {
    await this.discardWorkingDraftCounted(params);
  }

  /**
   * {@link discardWorkingDraft}, answering how many drafts it removed, counted
   * by the delete made under the Single's lock. A separate method so the
   * published `discardWorkingDraft` keeps its contract.
   */
  async discardWorkingDraftCounted(
    params: Parameters<SingleMutationService["discardWorkingDraft"]>[0]
  ): Promise<number> {
    // The draft is deleted under the language as named, so one the site no
    // longer configures is told every language, not the default.
    return withRuleLanguage(
      writeAsNamedLanguagesFor(this.localization, params.locale ?? undefined),
      () => this.mutationService.discardWorkingDraft(params)
    );
  }

  /**
   * Bring a language's pending change up to date with the shared values
   * someone else published since it began. See the mutation service.
   *
   * @experimental
   */
  async takeLiveSharedValues(
    params: Parameters<SingleMutationService["takeLiveSharedValues"]>[0]
  ): ReturnType<SingleMutationService["takeLiveSharedValues"]> {
    // A write to one language's change: its rules see that language, as a
    // save of it does.
    return withRuleLanguage(
      writeLanguagesFor(this.localization, params.locale ?? undefined),
      () => this.mutationService.takeLiveSharedValues(params)
    );
  }

  /**
   * What a release's publish of this Single would be refused with by
   * validation, judged without writing. See the mutation service.
   *
   * @experimental
   */
  async releasePublishIssues(
    params: Parameters<SingleMutationService["releasePublishIssues"]>[0]
  ): ReturnType<SingleMutationService["releasePublishIssues"]> {
    return withRuleLanguage(everyLanguageOf(this.localization), () =>
      this.mutationService.releasePublishIssues(params)
    );
  }

  /**
   * The Single's document as a release would put it live, never creating its
   * row. See the mutation service.
   *
   * @experimental
   */
  async releaseGoingLiveDocument(
    params: Parameters<SingleMutationService["releaseGoingLiveDocument"]>[0]
  ): ReturnType<SingleMutationService["releaseGoingLiveDocument"]> {
    return this.mutationService.releaseGoingLiveDocument(params);
  }

  /**
   * The languages whose unreleased work a release's document-wide write of
   * this Single would be refused over. See the mutation service.
   *
   * @experimental
   */
  async releaseHeldDraftLocales(
    params: Parameters<SingleMutationService["releaseHeldDraftLocales"]>[0]
  ): ReturnType<SingleMutationService["releaseHeldDraftLocales"]> {
    return withRuleLanguage(everyLanguageOf(this.localization), () =>
      this.mutationService.releaseHeldDraftLocales(params)
    );
  }

  /**
   * Publish every language of a Single at once.
   *
   * The main row's status and every companion `_status` move in one
   * transaction, so the document is never observable half-live. Carries the
   * same post-write plumbing as an update, because it is the same kind of
   * event: a committed content write with an outbox record and a cache tag.
   */
  async publishAllLocales(
    slug: string,
    options?: PublishAllSingleLocalesOptions
  ): Promise<SingleResult<PublishAllSingleResult>> {
    const result = await withRuleLanguage(
      everyLanguageOf(this.localization),
      () => this.publishAllService.publishAllLocales(slug, options)
    );
    await this.afterWrite(result, options?.disableRevalidate === true);
    return result;
  }

  /**
   * The side effects every committed Single write owes, whatever produced it.
   *
   * Cache revalidation AND the opportunistic retention pass both follow the
   * CONTENT write, not the webhook event: a committed write (even one that opts
   * out of recording) must still bust its ISR tags, and — since the write path
   * is the only prune trigger for installs with no webhook drain — must still
   * offer a retention pass. Keyed off the explicit `committed` flag, set the
   * moment a row is written independent of the opt-outs, so a Single with BOTH
   * `webhooks: false` and `revalidate: { disable: true }` whose post-commit hook
   * then throws (reporting `success:false`, no event, no intent) is still
   * covered. NOT keyed off `success`, which a no-op also reports.
   */
  private async afterWrite(
    result: SingleResult<unknown>,
    disableRevalidate: boolean
  ): Promise<void> {
    // A write inside an enclosing SQLite transaction is a savepoint it can
    // still undo, so all of this waits for that commit there.
    await this.afterCommit(() =>
      this.runPostWriteEffects(result, disableRevalidate)
    );
  }

  /** The post-write side effects {@link afterWrite} runs once durable. */
  private async runPostWriteEffects(
    result: SingleResult<unknown>,
    disableRevalidate: boolean
  ): Promise<void> {
    if (
      result.committed === true ||
      result.eventRecorded === true ||
      result.revalidationIntent != null
    ) {
      // The per-operation escape hatch skips cache revalidation (a CLI / seed /
      // bulk-import write); the retention pass still runs.
      if (!disableRevalidate) {
        await this.flushRevalidation(result);
      }
      await this.retentionRunner?.maybeRun(
        SingleEntryService.WRITE_PATH_PRUNE_BATCHES
      );
    }
    // The fast drain, by contrast, only matters when an outbox event was
    // actually recorded. A successful opted-out write (`webhooks: false`)
    // records nothing, so scheduling it would only drain unrelated pending
    // events — gate strictly on `eventRecorded`.
    if (result.eventRecorded === true) {
      this.fastDrainScheduler?.offer();
    }
  }

  /**
   * Flush a committed single write's cache-revalidation intent through the
   * registered revalidator (a no-op when no cache adapter is present). Awaited so
   * an async revalidator is not left detached; absorbs its own failure so
   * revalidation never turns a committed write into an error.
   */
  private async flushRevalidation(
    result: SingleResult<unknown>
  ): Promise<void> {
    if (!result.revalidationIntent) return;
    // Resolve at flush time so a Next cache adapter registered after this
    // service was constructed (at request time, well after boot) is honored.
    const revalidator = this.resolveCacheRevalidator?.();
    if (!revalidator) return;
    try {
      await revalidator.flush([result.revalidationIntent]);
    } catch (error) {
      this.logger.error("Cache revalidation failed after a write", { error });
    }
  }

  /** Retention batches to attempt per write, matching the collection path. */
  private static readonly WRITE_PATH_PRUNE_BATCHES = 2;
}
