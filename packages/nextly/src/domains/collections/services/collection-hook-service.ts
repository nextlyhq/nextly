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
  // Transaction-bound executor so a stored hook's uniqueness read (the built-in
  // unique-validation hook) runs on the caller's transaction connection instead
  // of the pool when the write is inside a transaction; defaults to the pool.
  executor?: unknown;
}

/**
 * Fold a `beforeChange` handler's return value into the document being written.
 *
 * A handler that returns nothing has mutated `data` in place and there is
 * nothing to fold. One that returns its own object owns what is in it, so keys
 * it left out are removed rather than merged back -- otherwise a handler could
 * never drop a field, which is the contract the pre-validation phase already
 * has. `undefined` values are treated the same way as an absent key by the
 * write paths, so they are carried through as given.
 */
function applyBeforeChangeResult(
  data: Record<string, unknown>,
  returned: unknown
): void {
  if (!returned || typeof returned !== "object" || returned === data) return;
  const replacement = returned as Record<string, unknown>;
  for (const key of Object.keys(data)) {
    if (!(key in replacement)) delete data[key];
  }
  Object.assign(data, replacement);
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
    sharedContext: Record<string, unknown> = {},
    // Transaction-bound executor forwarded onto the context when the hook runs
    // inside a caller-owned transaction, so DB-reading hooks stay on the
    // transaction's connection (see HookContext.executor). Omitted otherwise.
    executor?: unknown
  ): PrebuiltHookContext {
    return {
      collection: collectionName,
      operation,
      data,
      user: user ? { id: user.id, email: user.email } : undefined,
      context: sharedContext,
      executor,
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
          // Forward the context's transaction executor so the uniqueness read
          // stays on the caller's transaction connection inside a transaction.
          executor,
        });
      },
    };
  }

  /**
   * Run the `beforeChange` phase over the data a write is about to persist.
   *
   * Called from every write path immediately before that path's field-level
   * `beforeChange` hooks, which is the point the validation gate has just been
   * passed. Collection-level handlers run first, then stored ones -- the same
   * order the pre-validation phase uses, so the two read alike.
   *
   * The result is applied ONTO `data` rather than returned. A handler returning
   * its own object still replaces the document -- keys it dropped are dropped --
   * but the object identity is preserved, because every caller has already
   * handed this object to slug generation, write access and validation, and
   * some hold it in a closure. Reassigning at six call sites is where that goes
   * wrong quietly.
   */
  async runBeforeChange(options: {
    collection: string;
    operation: "create" | "update";
    data: Record<string, unknown>;
    storedHooks: StoredHookConfig[];
    queryDatabase: (params: QueryDatabaseParams) => Promise<boolean>;
    user?: UserContext;
    sharedContext?: Record<string, unknown>;
    executor?: unknown;
  }): Promise<void> {
    const { collection, operation, data, storedHooks } = options;
    const sharedContext = options.sharedContext ?? {};

    const fromCode = await this.hookRegistry.execute(
      "beforeChange",
      this.buildHookContext({
        collection,
        operation,
        data,
        user: options.user,
        context: sharedContext,
      })
    );
    applyBeforeChangeResult(data, fromCode);

    const fromStored = await this.storedHookExecutor.execute(
      "beforeChange",
      storedHooks,
      this.buildPrebuiltHookContext(
        collection,
        operation,
        data,
        options.queryDatabase,
        options.user,
        sharedContext,
        options.executor
      )
    );
    applyBeforeChangeResult(data, fromStored.data);
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
