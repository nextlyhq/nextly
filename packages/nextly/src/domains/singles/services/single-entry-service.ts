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
    // Cache revalidation AND the opportunistic retention pass both follow the
    // CONTENT write, not the webhook event: a committed write (even one that opts
    // out of recording) must still bust its ISR tags, and — since the write path
    // is the only prune trigger for installs with no webhook drain — must still
    // offer a retention pass. Keyed off the explicit `committed` flag, set the
    // moment a row is written independent of the opt-outs, so a Single with BOTH
    // `webhooks: false` and `revalidate: { disable: true }` whose post-commit hook
    // then throws (reporting `success:false`, no event, no intent) is still
    // covered. NOT keyed off `success`, which a no-op also reports.
    if (
      result.committed === true ||
      result.eventRecorded === true ||
      result.revalidationIntent != null
    ) {
      // The per-operation escape hatch skips cache revalidation (a CLI / seed /
      // bulk-import write); the retention pass still runs.
      if (options?.disableRevalidate !== true) {
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
    return result;
  }

  /**
   * Flush a committed single write's cache-revalidation intent through the
   * registered revalidator (a no-op when no cache adapter is present). Awaited so
   * an async revalidator is not left detached; absorbs its own failure so
   * revalidation never turns a committed write into an error.
   */
  private async flushRevalidation(result: SingleResult): Promise<void> {
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
