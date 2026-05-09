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
import type { FieldDefinition } from "../schemas/dynamic-collections";
import type { SanitizationConfigInput } from "../schemas/security-config";
import type { CollectionRegistryService } from "../services/collections/collection-registry-service";
import { sanitizeEntryData } from "../services/security/sanitization-service";

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
 * 3. Calls `sanitizeEntryData()` which mutates `context.data` in place
 * 4. Returns `context.data` so the hook pipeline carries the sanitized version
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
      const collection = await registryService.getCollectionBySlug(
        context.collection
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

    // Mutates context.data in place
    sanitizeEntryData(
      context.data as Record<string, unknown>,
      fields,
      sanitizationConfig
    );

    return context.data;
  };
}
