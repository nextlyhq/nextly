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

import type { RBACAccessControlService } from "../../../domains/auth/services/rbac-access-control-service";
import type { HookRegistry } from "../../../hooks/hook-registry";
import type { CacheRevalidator } from "../../../revalidation/types";
import type { ComponentDataService } from "../../../services/components/component-data-service";
import { BaseService } from "../../../shared/base-service";
import type { Logger } from "../../../shared/types";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import type { WebhookFastDrainScheduler } from "../../webhooks/after-drain";
import type { WebhookRetentionRunner } from "../../webhooks/retention-runner";
import type {
  GetSingleOptions,
  SingleResult,
  UpdateSingleOptions,
} from "../types";

import { SingleMutationService } from "./single-mutation-service";
import { SingleQueryService } from "./single-query-service";
import type { SingleRegistryService } from "./single-registry-service";

// Re-export types so legacy imports from this module keep working.
export type {
  GetSingleOptions,
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

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    singleRegistryService: SingleRegistryService,
    hookRegistry: HookRegistry,
    componentDataService?: ComponentDataService,
    rbacAccessControlService?: RBACAccessControlService,
    // i18n: normalized localization config so a localized single resolves/writes
    // translatable fields via its companion `single_<slug>_locales` table.
    localization?: SanitizedLocalizationConfig,
    /**
     * Webhook-retention pass offered after a write that recorded an event, so a
     * frequently-written single trims old outbox rows without waiting for a
     * scheduled drain. Absent when webhook retention is not configured.
     */
    private readonly retentionRunner?: WebhookRetentionRunner,
    /**
     * Kicks an immediate, bounded drain after a write (via Next `after()`) so a
     * single's outbox rows are delivered without waiting for the scheduled
     * trigger. Shared with the collection write path; absent when webhooks were
     * never registered.
     */
    private readonly fastDrainScheduler?: WebhookFastDrainScheduler,
    /**
     * Flushes a single write's cache-revalidation intent post-commit. Shared
     * with the collection write path; a no-op when no cache adapter is present.
     */
    private readonly cacheRevalidator?: CacheRevalidator
  ) {
    super(adapter, logger);

    this.queryService = new SingleQueryService(
      adapter,
      logger,
      singleRegistryService,
      hookRegistry,
      componentDataService,
      rbacAccessControlService,
      localization
    );

    // The write path evaluates a Single's stored access rules; its own
    // stateless evaluator is created inside SingleMutationService.
    this.mutationService = new SingleMutationService(
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
  // Read Operations → SingleQueryService
  // ============================================================

  /**
   * Get a Single document by slug.
   *
   * If the document doesn't exist, it will be auto-created with default
   * field values.
   */
  get(slug: string, options?: GetSingleOptions): Promise<SingleResult> {
    return this.queryService.get(slug, options);
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
    const result = await this.mutationService.update(slug, data, options);
    // A successful update always appends an outbox event (single.updated, plus a
    // publish/unpublish transition), so kick the post-write side effects; a
    // rejected write (access/404) recorded nothing and skips them. A write that
    // committed its event but then failed a post-commit hook reports
    // `success:false` with `eventRecorded:true`, so key off either — otherwise a
    // committed event would miss its fast-drain and retention pass.
    if (result.success || result.eventRecorded === true) {
      await this.flushRevalidation(result);
      await this.afterWrite();
    }
    return result;
  }

  /**
   * Flush a committed single write's cache-revalidation intent through the
   * registered revalidator (a no-op when no cache adapter is present). Awaited so
   * an async revalidator is not left detached; absorbs its own failure so
   * revalidation never turns a committed write into an error.
   */
  private async flushRevalidation(result: SingleResult): Promise<void> {
    if (!this.cacheRevalidator || !result.revalidationIntent) return;
    try {
      await this.cacheRevalidator.flush([result.revalidationIntent]);
    } catch (error) {
      this.logger.error("Cache revalidation failed after a write", { error });
    }
  }

  /**
   * Post-write side effects run after a write that recorded an outbox event: the
   * drain fast path goes first so the `after()` callback is scheduled promptly
   * (it runs post-response, adding no latency), then a bounded retention pass.
   * Both absorb their own failures, so this never turns a successful save into an
   * error. `offer()` is synchronous — it only registers the post-response
   * callback — so it is not awaited; retention is awaited because a detached
   * promise may not survive a serverless response.
   */
  private async afterWrite(): Promise<void> {
    this.fastDrainScheduler?.offer();
    await this.retentionRunner?.maybeRun(
      SingleEntryService.WRITE_PATH_PRUNE_BATCHES
    );
  }

  /** Retention batches to attempt per write, matching the collection path. */
  private static readonly WRITE_PATH_PRUNE_BATCHES = 2;
}
