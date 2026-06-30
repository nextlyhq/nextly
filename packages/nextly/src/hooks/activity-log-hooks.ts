/**
 * Activity Log Hooks
 *
 * Global `afterCreate`, `afterUpdate`, and `afterDelete` hooks that record
 * content mutations to the activity log via {@link ActivityLogService}.
 *
 * All writes are fire-and-forget — activity logging must never slow down
 * or break content operations. Errors are caught and logged, never re-thrown.
 *
 * @module hooks/activity-log-hooks
 * @since 1.0.0
 */

import { container } from "../di/container";
import type { NextlyServiceConfig } from "../di/register";
import { getNextlyLogger } from "../observability/logger";
import type { ActivityLogService } from "../services/dashboard/activity-log-service";

import type { HookRegistry } from "./hook-registry";
import type { HookContext } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Lazy-loaded state (built on first hook invocation)
// ─────────────────────────────────────────────────────────────────────────────

let activityLogService: ActivityLogService | null = null;
let hiddenCollections: Set<string> | null = null;
let useAsTitleMap: Map<string, string> | null = null;

/**
 * Get or lazily initialize the ActivityLogService from the DI container.
 */
function getActivityLogService(): ActivityLogService | null {
  if (activityLogService) return activityLogService;

  try {
    activityLogService =
      container.get<ActivityLogService>("activityLogService");
    return activityLogService;
  } catch {
    return null;
  }
}

/**
 * Build the set of hidden collection slugs from config.
 */
function getHiddenCollections(): Set<string> {
  if (hiddenCollections) return hiddenCollections;

  hiddenCollections = new Set<string>();

  try {
    const config = container.get<NextlyServiceConfig>("config");

    if (config.collections) {
      for (const col of config.collections) {
        if (col.admin?.hidden === true) {
          hiddenCollections.add(col.slug);
        }
      }
    }
  } catch {
    // Config not available yet — return empty set
  }

  return hiddenCollections;
}

/**
 * Build a map of collection slug → useAsTitle field name.
 */
function getUseAsTitleMap(): Map<string, string> {
  if (useAsTitleMap) return useAsTitleMap;

  useAsTitleMap = new Map<string, string>();

  try {
    const config = container.get<NextlyServiceConfig>("config");

    if (config.collections) {
      for (const col of config.collections) {
        if (col.admin?.useAsTitle) {
          useAsTitleMap.set(col.slug, col.admin.useAsTitle);
        }
      }
    }
  } catch {
    // Config not available yet — return empty map
  }

  return useAsTitleMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Title extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the entry title from hook context data.
 *
 * Priority:
 * 1. `admin.useAsTitle` field from collection config
 * 2. `title` field
 * 3. `name` field
 * 4. Entry ID as fallback
 */
function extractEntryTitle(
  collection: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- hook data has dynamic shape from arbitrary collections
  data: Record<string, any> | undefined,
  entryId: string | undefined
): string | undefined {
  if (!data) return entryId;

  // Check useAsTitle config
  const titleField = getUseAsTitleMap().get(collection);
  if (titleField && data[titleField] != null) {
    return String(data[titleField]);
  }

  // Common fallbacks
  if (data.title != null) return String(data.title);
  if (data.name != null) return String(data.name);

  return entryId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Guard helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether this hook invocation should be skipped.
 *
 * Skips:
 * - System-initiated operations (no user or user.id === 'system')
 * - Hidden collections (admin.hidden: true)
 */
function shouldSkip(context: HookContext): boolean {
  // No user or system user — skip
  if (!context.user?.id || context.user.id === "system") {
    return true;
  }

  // Hidden collection — skip
  if (getHiddenCollections().has(context.collection)) {
    return true;
  }

  return false;
}

/** Structured debug log for a fire-and-forget activity-log failure. */
function logActivityError(action: string, error: unknown): void {
  getNextlyLogger().error({
    scope: "activity-log",
    msg: `${action} logActivity failed`,
    error: error instanceof Error ? error.message : String(error),
  });
}

/** Best-effort display name from the loosely-typed hook user record. */
function resolveActorName(user: NonNullable<HookContext["user"]>): string {
  const value = user.name ?? user.firstName ?? user.email ?? "Unknown";
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- user.* are unknown via the index signature; coerce best-effort
  return String(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * afterCreate hook handler — logs a "create" activity.
 */
// eslint-disable-next-line @typescript-eslint/require-await
async function activityLogAfterCreateHandler(
  context: HookContext
): Promise<void> {
  try {
    if (shouldSkip(context)) return;

    const service = getActivityLogService();
    if (!service) return;

    const entryId = context.data?.id ? String(context.data.id) : undefined;
    const entryTitle = extractEntryTitle(
      context.collection,
      context.data,
      entryId
    );

    // Fire-and-forget — do NOT await
    service
      .logActivity({
        userId: context.user!.id,
        userName: resolveActorName(context.user!),
        userEmail: String(context.user!.email ?? ""),
        action: "create",
        collection: context.collection,
        entryId,
        entryTitle,
      })
      .catch((e: unknown) => logActivityError("afterCreate", e));
  } catch (err) {
    logActivityError("afterCreate", err);
  }
}

/**
 * afterUpdate hook handler — logs an "update" activity.
 */
// eslint-disable-next-line @typescript-eslint/require-await
async function activityLogAfterUpdateHandler(
  context: HookContext
): Promise<void> {
  try {
    if (shouldSkip(context)) return;

    const service = getActivityLogService();
    if (!service) return;

    const entryId = context.data?.id ? String(context.data.id) : undefined;
    const entryTitle = extractEntryTitle(
      context.collection,
      context.data,
      entryId
    );

    service
      .logActivity({
        userId: context.user!.id,
        userName: resolveActorName(context.user!),
        userEmail: String(context.user!.email ?? ""),
        action: "update",
        collection: context.collection,
        entryId,
        entryTitle,
      })
      .catch((e: unknown) => logActivityError("afterUpdate", e));
  } catch (err) {
    logActivityError("afterUpdate", err);
  }
}

/**
 * afterDelete hook handler — logs a "delete" activity.
 */
// eslint-disable-next-line @typescript-eslint/require-await
async function activityLogAfterDeleteHandler(
  context: HookContext
): Promise<void> {
  try {
    if (shouldSkip(context)) return;

    const service = getActivityLogService();
    if (!service) return;

    // For delete, data may be the deleted record or we might only have the ID
    const entryId = context.data?.id
      ? String(context.data.id)
      : context.context?.id
        ? String(context.context.id)
        : undefined;

    const entryTitle = extractEntryTitle(
      context.collection,
      context.data,
      entryId
    );

    service
      .logActivity({
        userId: context.user!.id,
        userName: resolveActorName(context.user!),
        userEmail: String(context.user!.email ?? ""),
        action: "delete",
        collection: context.collection,
        entryId,
        entryTitle,
      })
      .catch((e: unknown) => logActivityError("afterDelete", e));
  } catch (err) {
    logActivityError("afterDelete", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register global activity logging hooks with the hook registry.
 *
 * Registers three global (`'*'`) hooks:
 * - `afterCreate` — logs create actions
 * - `afterUpdate` — logs update actions
 * - `afterDelete` — logs delete actions
 *
 * Should be called AFTER all collection-specific hooks are registered
 * and AFTER `registerServices()` has been called (so the DI container
 * has `ActivityLogService` available).
 *
 * @param registry - The HookRegistry instance
 *
 * @example
 * ```typescript
 * import { getHookRegistry } from 'nextly/hooks';
 * import { registerActivityLogHooks } from 'nextly/hooks';
 *
 * const registry = getHookRegistry();
 * registerActivityLogHooks(registry);
 * ```
 */
export function registerActivityLogHooks(registry: HookRegistry): void {
  registry.register("afterCreate", "*", activityLogAfterCreateHandler);
  registry.register("afterUpdate", "*", activityLogAfterUpdateHandler);
  registry.register("afterDelete", "*", activityLogAfterDeleteHandler);
}
