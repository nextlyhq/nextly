/**
 * Input Sanitization Hook
 *
 * Factory that produces a `beforeChange` hook handler running
 * `sanitizeEntryData()` on incoming create/update data. The returned
 * handler is intended to be registered as a global wildcard hook on
 * both `beforeCreate` and `beforeUpdate` (see Subtask 2.2.3).
 *
 * **Opt-out mechanisms:**
 * - Global: `defineConfig({ security: { sanitization: { enabled: false } } })`
 * - Per-collection/single: `sanitize: false` in the code-first config
 *
 * @module hooks/sanitization-hooks
 * @since 1.0.0
 */

import { container } from "../di/container";
import type { NextlyServiceConfig } from "../di/register";
import type { FieldGroupRegistryService } from "../domains/field-groups/services/field-group-registry-service";
import type { FieldDefinition } from "../schemas/dynamic-collections";
import type { SanitizationConfigInput } from "../schemas/security-config";
import type { CollectionRegistryService } from "../services/collections/collection-registry-service";
import {
  attachFieldGroupChildren,
  sanitizeEntryData,
} from "../services/security/sanitization-service";

import type { HookHandler, HookContext } from "./types";

/**
 * Create a sanitization hook handler for `beforeCreate` / `beforeUpdate`.
 *
 * The factory captures the global sanitization config at init time.
 * If `enabled` is explicitly `false`, a no-op handler is returned so
 * there is zero per-request overhead.
 *
 * Otherwise the handler:
 * 1. Skips collections/singles that set `sanitize: false` in code-first config
 * 2. Retrieves the collection's field definitions from the registry
 * 3. Attaches each field group's referenced child definitions (a registry
 *    lookup on the caller's executor), so the descent reaches the group's
 *    nested text and not only the parent row's own fields
 * 4. Calls `sanitizeEntryData()` which mutates `context.data` in place
 * 5. Returns `context.data` so the hook pipeline carries the sanitized version
 *
 * @param sanitizationConfig - From `defineConfig({ security: { sanitization } })`
 * @returns A {@link HookHandler} to register on `beforeCreate` and `beforeUpdate` with `'*'`
 *
 * @example
 * ```typescript
 * const handler = createSanitizationHook(config.security?.sanitization);
 * registry.register('beforeCreate', '*', handler);
 * registry.register('beforeUpdate', '*', handler);
 * ```
 */
export function createSanitizationHook(
  sanitizationConfig?: SanitizationConfigInput
): HookHandler {
  // Global kill-switch — return no-op when explicitly disabled
  if (sanitizationConfig?.enabled === false) {
    return () => {};
  }

  // Lazily-built Set of collection/single slugs that opted out via
  // `sanitize: false` in their code-first config.  Built on first
  // hook execution (DI container is guaranteed to be ready by then).
  let optOutSlugs: Set<string> | null = null;

  function getOptOutSlugs(): Set<string> {
    if (optOutSlugs) return optOutSlugs;

    optOutSlugs = new Set<string>();

    try {
      const config = container.get<NextlyServiceConfig>("config");

      if (config.collections) {
        for (const col of config.collections) {
          if (col.sanitize === false) {
            optOutSlugs.add(col.slug);
          }
        }
      }

      if (config.singles) {
        for (const single of config.singles) {
          if (single.sanitize === false) {
            optOutSlugs.add(single.slug);
          }
        }
      }
    } catch {
      // DI container not ready — treat as no opt-outs
    }

    return optOutSlugs;
  }

  /**
   * Attach each field group's referenced child definitions, best-effort.
   *
   * A stored field-group definition is a leaf reference by slug: its child
   * definitions live behind a registry lookup, not on the field itself, so
   * the descent can only reach the group's nested text once they are
   * attached. Resolved on the caller's executor — this hook fires inside
   * entry-write transactions, and a pooled read here would wait for a
   * connection that transaction is holding. A per-request cache keeps one
   * lookup per referenced slug; a failure leaves that group's top-level text
   * sanitized and its subtree as written, which must never fail the save it
   * rides on.
   */
  async function attachFieldGroupChildFields(
    fields: FieldDefinition[],
    executor: unknown
  ): Promise<FieldDefinition[]> {
    let fieldGroupRegistry: FieldGroupRegistryService;
    try {
      fieldGroupRegistry = container.get<FieldGroupRegistryService>(
        "fieldGroupRegistryService"
      );
    } catch {
      // Registry unavailable — sanitize the top level with the raw definitions.
      return fields;
    }
    const cache = new Map<string, FieldDefinition[] | undefined>();
    return attachFieldGroupChildren(fields, async slug => {
      const cached = cache.get(slug);
      if (cached !== undefined || cache.has(slug)) {
        return cached;
      }
      try {
        const meta = await fieldGroupRegistry.getComponentBySlug(
          slug,
          executor
        );
        const children =
          meta && Array.isArray(meta.fields)
            ? (meta.fields as FieldDefinition[])
            : undefined;
        cache.set(slug, children);
        return children;
      } catch {
        cache.set(slug, undefined);
        return undefined;
      }
    });
  }

  return async (context: HookContext) => {
    // Nothing to sanitize
    if (!context.data || typeof context.data !== "object") return;

    // Per-collection / per-single opt-out
    if (getOptOutSlugs().has(context.collection)) return;

    // Retrieve field definitions from the collection registry
    let fields: FieldDefinition[] | null = null;
    try {
      const registryService = container.get<CollectionRegistryService>(
        "collectionRegistryService"
      );
      // Run on the caller's transaction executor when the hook fires inside a
      // transaction, so this metadata read does not take a second pooled
      // connection while that transaction holds the only one (small/exhausted
      // pool deadlock). Falls back to the pool outside a transaction.
      const collection = await registryService.getCollectionBySlug(
        context.collection,
        context.executor
      );
      if (!collection) return;

      fields =
        typeof collection.fields === "string"
          ? JSON.parse(collection.fields)
          : (collection.fields as FieldDefinition[]);
    } catch {
      // Registry unavailable or collection not found — skip silently
      return;
    }

    if (!fields || fields.length === 0) return;

    fields = await attachFieldGroupChildFields(fields, context.executor);

    // Mutates context.data in place
    sanitizeEntryData(
      context.data as Record<string, unknown>,
      fields,
      sanitizationConfig
    );

    return context.data;
  };
}
