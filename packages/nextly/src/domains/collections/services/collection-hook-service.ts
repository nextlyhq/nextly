/**
 * CollectionHookService — Hook context building for collection entry operations.
 *
 * Extracted from CollectionEntryService (6,490-line god file) as a leaf dependency
 * with no deps on other new split services.
 *
 * Responsibilities:
 * - Build HookContext for code-registered hooks
 * - Build PrebuiltHookContext for UI-configured stored hooks
 * - Resolve Nextly Direct API instance for hook contexts
 * - Extract stored hook configurations from collection metadata
 */

import {
  buildContext,
  type BuildContextOptions,
} from "@nextly/hooks/context-builder";
import type { HookRegistry } from "@nextly/hooks/hook-registry";
import type { PrebuiltHookContext } from "@nextly/hooks/prebuilt";
import { StoredHookExecutor } from "@nextly/hooks/stored-hook-executor";
import type { HookContext } from "@nextly/hooks/types";
import type { StoredHookConfig } from "@nextly/schemas/dynamic-collections/types";

import { container } from "../../../di/container";
import type { Nextly as NextlyDirectAPI } from "../../../direct-api/nextly";

import type { UserContext } from "./collection-types";

/**
 * Parameters for querying field uniqueness in the database.
 * Used by stored hooks to validate field uniqueness constraints.
 */
export interface QueryDatabaseParams {
  collection: string;
  field: string;
  value: unknown;
  caseInsensitive?: boolean;
  excludeId?: string;
}

export class CollectionHookService {
  readonly storedHookExecutor: StoredHookExecutor;

  constructor(readonly hookRegistry: HookRegistry) {
    this.storedHookExecutor = new StoredHookExecutor();
  }

  /**
   * Resolve the Nextly Direct API instance for hook contexts.
   *
   * Returns the Nextly instance from the DI container if available,
   * or undefined if not yet initialized.
   */
  resolveNextlyForHooks(): unknown {
    if (container.has("nextlyDirectAPI")) {
      try {
        return container.get("nextlyDirectAPI");
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Build a HookContext with the Nextly Direct API instance attached to `req.nextly`.
   *
   * Wrapper around `buildContext()` that automatically injects the Nextly
   * instance into the `req` property of the hook context.
   */
  buildHookContext<T>(options: BuildContextOptions<T>): HookContext<T> {
    return buildContext({
      ...options,
      req: {
        ...options.req,
        nextly: this.resolveNextlyForHooks() as NextlyDirectAPI | undefined,
      },
    });
  }

  /**
   * Build a PrebuiltHookContext from HookContext components.
   *
   * PrebuiltHookContext extends HookContext with explicit operation type
   * and database query function for uniqueness validation.
   *
   * @param queryDatabase - Function to check field uniqueness (injected by caller)
   */
  buildPrebuiltHookContext(
    collectionName: string,
    operation: "create" | "read" | "update" | "delete",
    data: unknown,
    queryDatabase: (params: QueryDatabaseParams) => Promise<boolean>,
    user?: UserContext,
    sharedContext: Record<string, unknown> = {}
  ): PrebuiltHookContext {
    return {
      collection: collectionName,
      operation,
      data,
      user: user ? { id: user.id, email: user.email } : undefined,
      context: sharedContext,
      req: {
        nextly: this.resolveNextlyForHooks() as NextlyDirectAPI | undefined,
      },
      queryDatabase: async params => {
        return queryDatabase({
          collection: params.collection,
          field: params.field,
          value: params.value,
          caseInsensitive: params.caseInsensitive || false,
          excludeId: params.excludeId,
        });
      },
    };
  }

  /**
   * Extract stored hooks from a collection record.
   *
   * Stored hooks are configured via the Admin UI and stored in the
   * `hooks` JSONB column. Returns empty array if no hooks are configured.
   */
  getStoredHooks(collection: Record<string, unknown>): StoredHookConfig[] {
    // Try direct property first (new format from unified schema)
    if (Array.isArray(collection.hooks)) {
      return collection.hooks as StoredHookConfig[];
    }

    // Fall back to schemaDefinition (legacy format)
    const schemaDef = collection.schemaDefinition as
      | Record<string, unknown>
      | undefined;
    if (Array.isArray(schemaDef?.hooks)) {
      return schemaDef.hooks as StoredHookConfig[];
    }

    return [];
  }
}
