/**
 * Database Lifecycle Hooks System - Hook Registry
 *
 * Centralized registry for managing and executing database lifecycle hooks.
 * Implements a singleton pattern with Map-based storage for efficient hook lookups.
 *
 * @module hooks/hook-registry
 * @since 1.0.0
 */

import { NextlyError } from "../errors/nextly-error";

import { normalizeHookError } from "./normalize-hook-error";
import { HOOK_TYPES } from "./types";
import type {
  BeforeOperationArgs,
  BeforeOperationContext,
  BeforeOperationHandler,
  HookContext,
  HookContextPhase,
  HookHandler,
  HookOwner,
  HookType,
} from "./types";

export type { HookOwner };

/**
 * The phases whose handlers exist for their effects, not to reshape data.
 *
 * These run after the write has already committed, so there is nothing left for
 * a return value to change. Honouring one would mean a second handler is shown
 * whatever the first happened to return instead of the row that was persisted,
 * and returning the result of a side-effect call -- a logger, a fetch, a cache
 * write -- is an easy accident to make.
 *
 * `afterRead` is deliberately absent: it reshapes the response by design, and
 * the read paths consume what it returns.
 */
/**
 * A side-effect hook that threw after the write had already committed.
 *
 * Reported rather than raised: the row is durable and this phase cannot change
 * it, so failing the operation would tell a caller its write did not happen and
 * invite a retry that writes it twice.
 */
/**
 * A registered handler and who owns it.
 *
 * Provenance is stored per REGISTRATION rather than per function, because the
 * same function can legitimately be registered more than once -- listed twice
 * in one array, or shared between two phases -- and those registrations can
 * have different owners.
 */
interface RegisteredHook<H> {
  handler: H;
  owner: HookOwner;
}

/**
 * One owner's registrations for one collection, taken so they can be restored.
 *
 * `beforeOperation` is held apart from the rest because its handlers take the
 * operation's args rather than a document, and the two signatures are not
 * interchangeable.
 */
export interface OwnedHookCapture {
  collection: string;
  owner: HookOwner;
  byPhase: Array<{ hookType: HookContextPhase; handlers: HookHandler[] }>;
  beforeOperation: BeforeOperationHandler[];
}

export interface SideEffectHookFailure {
  /** The phase whose handler threw. */
  phase: HookType;
  /** The collection or single the operation was for. */
  collection: string;
  /** The normalized error, with its type and context preserved. */
  error: NextlyError;
}

const SIDE_EFFECT_HOOK_TYPES: ReadonlySet<HookType> = new Set([
  "afterCreate",
  "afterUpdate",
  "afterDelete",
]);

/**
 * Whether a phase runs AFTER the write has committed.
 *
 * Shared by every executor so the two cannot disagree about which phases may
 * fail an operation: a stored hook and a code-registered one in the same phase
 * have to behave identically.
 */
export function isSideEffectHookType(hookType: HookType): boolean {
  return SIDE_EFFECT_HOOK_TYPES.has(hookType);
}

/**
 * Global hook registry singleton
 *
 * Manages registration and execution of database lifecycle hooks.
 * Supports collection-specific hooks and global wildcard hooks.
 *
 * **Features:**
 * - Collection-specific hooks: Register hooks for individual collections
 * - Global wildcard hooks: Register hooks for all collections using `*`
 * - Series execution: Hooks run in registration order (FIFO)
 * - Data transformation: `before*` hooks can modify data
 * - Side effects: `after*` hooks run for side effects only
 * - Performance optimization: `hasHooks()` check to skip execution
 *
 * **Usage:**
 * ```typescript
 * import { getHookRegistry } from 'nextly/hooks';
 *
 * const registry = getHookRegistry();
 *
 * // Register a hook
 * registry.register('beforeCreate', 'posts', async (context) => {
 *   return { ...context.data, slug: slugify(context.data.title) };
 * });
 *
 * // Execute hooks
 * const modifiedData = await registry.execute('beforeCreate', {
 *   collection: 'posts',
 *   operation: 'create',
 *   data: { title: 'My Post' },
 *   context: {}
 * });
 * ```
 *
 * @class HookRegistry
 */
/**
 * Turn whatever a hook threw into the error the boundary should see.
 *
 * A hook that rejects its input does so deliberately, and says how: a
 * validation error carries field issues, a forbidden one carries a status.
 * Rebuilding it as a generic error throws all of that away and the boundary
 * answers 500, so a hook enforcing a rule reports a server fault instead of
 * the rule.
 *
 * Anything else really is unexpected. The original is kept as `cause` rather
 * than flattened into a message, so its stack survives, and the hook and
 * collection travel in log context where they are useful without being
 * disclosed to the caller.
 */
export class HookRegistry {
  /**
   * Internal storage for hooks
   *
   * Key format: `${hookType}:${collection}`
   * Examples: "beforeCreate:posts", "afterUpdate:users", "beforeCreate:*"
   *
   * Wildcard key "*" matches all collections.
   */
  private hooks: Map<string, RegisteredHook<HookHandler>[]> = new Map();

  /**
   * `beforeOperation` handlers, kept apart from the rest.
   *
   * Every other phase receives a `HookContext` and reshapes `data`;
   * `beforeOperation` receives a `BeforeOperationContext` and reshapes `args`.
   * Those are different function types, so storing them together would mean
   * recovering the real one with a cast on the way out -- and a cast is exactly
   * what let a handler be declared against the wrong context in the first place.
   */
  private beforeOperationHooks: Map<
    string,
    RegisteredHook<BeforeOperationHandler>[]
  > = new Map();

  /** Append to a handler list, creating it on first use. */
  // (helpers below operate on RegisteredHook entries)
  private pushHandler<H>(
    store: Map<string, RegisteredHook<H>[]>,
    key: string,
    handler: RegisteredHook<H>
  ) {
    const existing = store.get(key);
    if (existing) {
      existing.push(handler);
      return;
    }
    store.set(key, [handler]);
  }

  /** Remove one handler by identity, dropping the list once it is empty. */
  private removeHandler<H>(
    store: Map<string, RegisteredHook<H>[]>,
    key: string,
    handler: H,
    owner: HookOwner
  ) {
    const handlers = store.get(key);
    if (!handlers) return;

    // Matched on the handler AND its owner: a caller unregisters the function
    // it registered and does not know which entry wraps it, but the same
    // function can be registered by more than one owner -- a plugin's exported
    // handler that the app also lists in its config. Matching on identity alone
    // takes the first entry, so a plugin's `off` would remove the config's
    // registration and leave its own running, and a later config reload would
    // then preserve the very handler the plugin asked to remove.
    const index = handlers.findIndex(
      e => e.handler === handler && e.owner === owner
    );
    if (index > -1) {
      handlers.splice(index, 1);
    }

    // Clean up empty arrays to avoid memory leaks
    if (handlers.length === 0) {
      store.delete(key);
    }
  }

  /**
   * Register a hook for a specific collection and hook type
   *
   * Hooks are executed in the order they are registered (FIFO).
   * Multiple hooks can be registered for the same hook type and collection.
   *
   * @param hookType - Type of hook (beforeCreate, afterCreate, etc.)
   * @param collection - Collection name or '*' for global hooks
   * @param handler - Hook function to execute
   *
   * @example
   * ```typescript
   * const registry = getHookRegistry();
   *
   * // Collection-specific hook
   * registry.register('beforeCreate', 'users', async (context) => {
   *   context.data.password = await bcrypt.hash(context.data.password, 10);
   *   return context.data;
   * });
   *
   * // Global hook (runs for all collections)
   * registry.register('afterCreate', '*', async (context) => {
   *   console.log(`Created ${context.collection}:`, context.data.id);
   * });
   * ```
   */
  register(
    hookType: HookContextPhase,
    collection: string,
    handler: HookHandler,
    // Defaults to the app's own config, which is what an unannotated caller is.
    // A plugin passes its own name so a config reload can replace config-owned
    // handlers without deleting the plugin's.
    owner: HookOwner = "code"
  ): void {
    // The type already excludes `beforeOperation`, but JavaScript callers and
    // untypechecked code do not see that. Storing it here would put the handler
    // where `executeBeforeOperation` never looks, so it would simply never run
    // -- a silent no-op is worse than a loud refusal.
    this.rejectBeforeOperation(hookType, "register", "registerBeforeOperation");
    this.pushHandler(this.hooks, this.makeKey(hookType, collection), {
      handler,
      owner,
    });
  }

  /**
   * Refuse `beforeOperation` on a method that cannot honour it, naming the one
   * that can.
   */
  private rejectBeforeOperation(
    hookType: HookType,
    method: string,
    replacement: string
  ): void {
    if (hookType !== "beforeOperation") return;

    throw NextlyError.invalidInput({
      message: `Use ${replacement}() for a beforeOperation hook: its handler receives the operation's args rather than a document, so it is stored and executed separately from the other phases. "beforeOperation" cannot be passed to ${method}().`,
      logContext: { hookType, method, replacement },
    });
  }

  /**
   * Register a `beforeOperation` hook.
   *
   * Separate from {@link register} because the handler signature is different:
   * it is handed the operation's `args` -- the data, id or where clause the
   * operation is about to use -- and returning a modified set replaces them.
   * Handlers for every other phase receive `data` instead, and the two are not
   * interchangeable.
   *
   * @param collection - Collection name or '*' for global hooks
   * @param handler - Hook function to execute
   */
  registerBeforeOperation<T = unknown>(
    collection: string,
    handler: BeforeOperationHandler<T>,
    owner: HookOwner = "code"
  ): void {
    this.pushHandler(
      this.beforeOperationHooks,
      this.makeKey("beforeOperation", collection),
      { handler: handler as BeforeOperationHandler, owner }
    );
  }

  /**
   * Unregister a specific hook
   *
   * Removes the exact handler function from the registry.
   * Useful for cleanup when hooks are no longer needed.
   *
   * @param hookType - Type of hook
   * @param collection - Collection name or '*'
   * @param handler - The exact handler function to remove
   *
   * @example
   * ```typescript
   * const myHook = async (context) => { ... };
   *
   * registry.register('beforeCreate', 'posts', myHook);
   * // Later...
   * registry.unregister('beforeCreate', 'posts', myHook);
   * ```
   */
  unregister(
    hookType: HookContextPhase,
    collection: string,
    handler: HookHandler,
    // Removal is scoped to the caller's own registrations, so unregistering
    // reaches only what that owner registered.
    owner: HookOwner = "code"
  ): void {
    this.rejectBeforeOperation(
      hookType,
      "unregister",
      "unregisterBeforeOperation"
    );
    this.removeHandler(
      this.hooks,
      this.makeKey(hookType, collection),
      handler,
      owner
    );
  }

  /**
   * Unregister a specific `beforeOperation` hook, the counterpart to
   * {@link registerBeforeOperation}.
   *
   * @param collection - Collection name or '*'
   * @param handler - The exact handler function to remove
   */
  unregisterBeforeOperation<T = unknown>(
    collection: string,
    handler: BeforeOperationHandler<T>,
    owner: HookOwner = "code"
  ): void {
    this.removeHandler(
      this.beforeOperationHooks,
      this.makeKey("beforeOperation", collection),
      handler as BeforeOperationHandler,
      owner
    );
  }

  /**
   * Unregister all hooks for a specific collection
   *
   * Removes all hooks associated with a collection.
   * Useful when a collection is deleted or during testing cleanup.
   *
   * @param collection - Collection name or '*' for global hooks
   *
   * @example
   * ```typescript
   * // Remove all hooks for 'posts' collection
   * registry.clearCollection('posts');
   *
   * // Remove all global hooks
   * registry.clearCollection('*');
   * ```
   */
  /**
   * Remove only the handlers a given owner registered for a collection.
   *
   * A config reload has to replace the app's own handlers while leaving a
   * plugin's alone: a plugin can register directly into a collection's
   * namespace -- the form builder does exactly that on `forms` -- so clearing
   * the namespace wholesale deletes contributions the reload knows nothing
   * about and cannot put back. Singles registration documents the same hazard
   * and avoids it by never clearing at all, which trades a wipe for a leak.
   *
   * Reaches both stores, because `beforeOperation` lives apart and a partial
   * clear would leave one phase of a reloaded collection stale.
   */
  clearCollectionOwnedBy(collection: string, owner: HookOwner): void {
    for (const hookType of HOOK_TYPES) {
      const key = this.makeKey(hookType, collection);
      const store: Map<string, RegisteredHook<unknown>[]> =
        hookType === "beforeOperation"
          ? (this.beforeOperationHooks as Map<
              string,
              RegisteredHook<unknown>[]
            >)
          : (this.hooks as Map<string, RegisteredHook<unknown>[]>);

      const entries = store.get(key);
      if (!entries) continue;

      const kept = entries.filter(e => e.owner !== owner);
      if (kept.length === 0) store.delete(key);
      else store.set(key, kept);
    }
  }

  /**
   * Take a copy of everything one owner has registered for a collection.
   *
   * For a caller that is about to replace those registrations and may have to
   * put the originals back -- a config reload applies the new config's handlers
   * before it knows whether the reload will land, and an abandoned reload must
   * leave the process running exactly the handlers it was running before.
   *
   * Only that owner's registrations travel in the copy, so restoring cannot
   * disturb anything registered by anyone else in the meantime.
   */
  captureCollectionOwnedBy(
    collection: string,
    owner: HookOwner
  ): OwnedHookCapture {
    const byPhase: OwnedHookCapture["byPhase"] = [];
    for (const hookType of HOOK_TYPES) {
      if (hookType === "beforeOperation") continue;
      const entries = this.hooks.get(this.makeKey(hookType, collection));
      if (!entries) continue;
      const handlers = entries
        .filter(e => e.owner === owner)
        .map(e => e.handler);
      if (handlers.length > 0) byPhase.push({ hookType, handlers });
    }

    const beforeOperation = (
      this.beforeOperationHooks.get(
        this.makeKey("beforeOperation", collection)
      ) ?? []
    )
      .filter(e => e.owner === owner)
      .map(e => e.handler);

    return { collection, owner, byPhase, beforeOperation };
  }

  /**
   * Put a {@link captureCollectionOwnedBy} copy back, discarding whatever that
   * owner has registered since.
   *
   * Re-registering rather than splicing the old entries back in place, so the
   * restored handlers sit where a fresh registration would put them -- which is
   * where they sat originally, since that is how they got there.
   */
  restoreCollectionOwnedBy(capture: OwnedHookCapture): void {
    this.clearCollectionOwnedBy(capture.collection, capture.owner);

    for (const { hookType, handlers } of capture.byPhase) {
      for (const handler of handlers) {
        this.register(hookType, capture.collection, handler, capture.owner);
      }
    }
    for (const handler of capture.beforeOperation) {
      this.registerBeforeOperation(capture.collection, handler, capture.owner);
    }
  }

  clearCollection(collection: string): void {
    // Iterated from the list the HookType union is built from. A local array
    // annotated `HookType[]` type-checks while missing a phase, so a phase
    // added later went on being registered and never cleared -- which makes
    // re-registration append a second copy of every handler.
    for (const hookType of HOOK_TYPES) {
      const key = this.makeKey(hookType, collection);
      this.hooks.delete(key);
    }

    // `beforeOperation` lives in its own store, so clearing a collection has to
    // reach both or a cleared collection keeps running its operation hooks.
    this.beforeOperationHooks.delete(
      this.makeKey("beforeOperation", collection)
    );
  }

  /**
   * Clear all hooks from the registry
   *
   * Removes all registered hooks for all collections.
   * Primarily used for testing cleanup.
   *
   * @example
   * ```typescript
   * // In test cleanup
   * afterEach(() => {
   *   registry.clear();
   * });
   * ```
   */
  clear(): void {
    this.hooks.clear();
    this.beforeOperationHooks.clear();
  }

  /**
   * Execute all registered hooks for a given type and collection
   *
   * Hooks run in series (one after another) in registration order.
   * Global wildcard hooks (*) execute BEFORE collection-specific hooks.
   *
   * **Execution Order:**
   * 1. Global hooks (registered with '*')
   * 2. Collection-specific hooks
   *
   * **Data Flow:**
   * - For `before*` hooks: Each hook can modify data, which is passed to the next hook
   * - For the after-write hooks in {@link SIDE_EFFECT_HOOK_TYPES}: return values
   *   are ignored, so every handler and the caller see the persisted row
   * - For `afterRead`: the return reshapes the response and is passed on
   *
   * **Error Handling:**
   * - If any hook throws an error, execution stops immediately
   * - The error is propagated to the caller (usually CollectionsHandler)
   * - This will cause the database transaction to rollback
   *
   * @template T - Type of the data being operated on
   * @param hookType - Type of hook to execute
   * @param context - Hook context with operation metadata
   * @returns Modified data (for before hooks) or void
   * @throws Error if any hook fails
   *
   * @example
   * ```typescript
   * // beforeCreate hook modifies data
   * const modifiedData = await registry.execute('beforeCreate', {
   *   collection: 'posts',
   *   operation: 'create',
   *   data: { title: 'My Post' },
   *   context: {}
   * });
   *
   * // afterCreate hook runs side effects
   * await registry.execute('afterCreate', {
   *   collection: 'posts',
   *   operation: 'create',
   *   data: createdPost,
   *   context: sharedContext
   * });
   * ```
   */
  async execute<T>(
    hookType: HookContextPhase,
    context: HookContext<T>,
    options?: {
      /**
       * Called for each side-effect handler that throws, so the caller can
       * report it alongside the successful write. Omitting it does not make
       * the failure silent -- it is logged either way.
       */
      onSideEffectError?: (failure: SideEffectHookFailure) => void;
    }
  ): Promise<T | void> {
    // `beforeOperation` handlers live in the other store and take a different
    // context, so this method cannot run them. Reaching here with that phase
    // would return `context.data` having executed nothing, which reads as "no
    // hooks are registered" rather than "this is the wrong method".
    this.rejectBeforeOperation(hookType, "execute", "executeBeforeOperation");

    // Get hooks for specific collection + global hooks
    const specificKey = this.makeKey(hookType, context.collection);
    const globalKey = this.makeKey(hookType, "*");

    const globalHandlers = (this.hooks.get(globalKey) ?? []).map(
      e => e.handler
    );
    const specificHandlers = (this.hooks.get(specificKey) ?? []).map(
      e => e.handler
    );

    // Global hooks run first, then collection-specific hooks
    const allHandlers = [...globalHandlers, ...specificHandlers];

    // If no hooks registered, return early (optimization)
    if (allHandlers.length === 0) {
      return context.data;
    }

    let data = context.data;

    // A side-effect phase runs after the write has committed, so a return value
    // has nothing left to change: the row stays the persisted one for every
    // later handler and for the caller.
    const isSideEffectPhase = SIDE_EFFECT_HOOK_TYPES.has(hookType);

    // Execute hooks in series (FIFO order)
    for (const handler of allHandlers) {
      try {
        // Pass current data to hook
        const result = await handler({ ...context, data });

        // If hook returns data (including null), use it for next hook
        // If hook returns undefined, keep current data unchanged
        // This allows before* hooks to intentionally set null values
        // while after* hooks can skip returning (undefined) for side effects
        if (!isSideEffectPhase && result !== undefined) {
          data = result;
        }
      } catch (error: unknown) {
        const normalized = normalizeHookError(
          error,
          hookType,
          context.collection
        );
        // A transforming phase runs before the write, so raising is how it
        // refuses one -- that is the whole point of `before*`.
        if (!isSideEffectPhase) throw normalized;

        // A side-effect phase runs after the write committed. Raising here
        // would report a durable row as a failure and invite a retry that
        // writes it a second time, so the failure is reported instead.
        //
        // The remaining handlers still run: they are independent side effects,
        // and letting the first failure cancel the rest turns one broken hook
        // into several silently skipped ones.
        // Logged here because nothing above this frame will: the operation
        // reports success, so a side effect that vanished without a trace is
        // exactly the failure this has to avoid.
        console.error(
          `Hook "${hookType}" failed for "${context.collection}" after the write committed:`,
          normalized
        );
        // `normalizeHookError` rethrows a typed error untouched and wraps an
        // untyped one, so this is a NextlyError in practice; the guard is what
        // makes that a fact rather than an assumption.
        options?.onSideEffectError?.({
          phase: hookType,
          collection: context.collection,
          error: NextlyError.is(normalized)
            ? normalized
            : NextlyError.internal({
                logContext: { hookType, collection: context.collection },
              }),
        });
      }
    }

    return data;
  }

  /**
   * Execute beforeOperation hooks for a collection
   *
   * beforeOperation hooks run BEFORE operation-specific hooks (beforeCreate, etc.)
   * and can modify operation arguments or throw to abort the operation.
   *
   * **Execution Order:**
   * 1. Global beforeOperation hooks (registered with '*')
   * 2. Collection-specific beforeOperation hooks
   * 3. Then operation-specific hooks (beforeCreate, beforeUpdate, etc.)
   *
   * **Args Flow:**
   * - Each hook can modify args (data, id, where), which is passed to the next hook
   * - If hook returns undefined/void, args remain unchanged
   * - If hook throws, operation is aborted
   *
   * **Use Cases:**
   * - Global logging/auditing of all operations
   * - Rate limiting across all operations
   * - Global validation or normalization
   * - Modifying operation arguments before they reach specific hooks
   *
   * @template T - Type of the data being operated on
   * @param context - BeforeOperation context with operation metadata and args
   * @returns Modified args or void (if no modification)
   * @throws Error if any hook fails
   *
   * @example
   * ```typescript
   * // Global logging for all operations
   * registry.registerBeforeOperation('*', async (context) => {
   *   console.log(`[${context.operation}] ${context.collection}`, context.args);
   * });
   *
   * // Execute beforeOperation hooks
   * const modifiedArgs = await registry.executeBeforeOperation({
   *   collection: 'posts',
   *   operation: 'create',
   *   args: { data: { title: 'My Post' } },
   *   context: {}
   * });
   *
   * // Use modifiedArgs.data for the actual create operation
   * ```
   */
  async executeBeforeOperation<T>(
    context: BeforeOperationContext<T>
  ): Promise<BeforeOperationArgs<T> | void> {
    // Get hooks for specific collection + global hooks
    const specificKey = this.makeKey("beforeOperation", context.collection);
    const globalKey = this.makeKey("beforeOperation", "*");

    const globalHandlers = (this.beforeOperationHooks.get(globalKey) ?? []).map(
      e => e.handler as BeforeOperationHandler<T>
    );
    const specificHandlers = (
      this.beforeOperationHooks.get(specificKey) ?? []
    ).map(e => e.handler as BeforeOperationHandler<T>);

    // Global hooks run first, then collection-specific hooks
    const allHandlers: BeforeOperationHandler<T>[] = [
      ...globalHandlers,
      ...specificHandlers,
    ];

    // If no hooks registered, return early (optimization)
    if (allHandlers.length === 0) {
      return context.args;
    }

    let args = context.args;

    // Execute hooks in series (FIFO order)
    for (const handler of allHandlers) {
      try {
        // Pass current args to hook
        const result = await handler({ ...context, args });

        // If hook returns args, use it for next hook
        // If hook returns undefined/void, keep current args unchanged
        if (result !== undefined) {
          args = result;
        }
      } catch (error: unknown) {
        throw normalizeHookError(error, "beforeOperation", context.collection);
      }
    }

    return args;
  }

  /**
   * Check if any hooks are registered for a given type/collection
   *
   * Performance optimization: Allows callers to skip hook execution
   * if no hooks are registered, avoiding unnecessary overhead.
   *
   * @param hookType - Type of hook to check
   * @param collection - Collection name
   * @returns True if hooks are registered (global or specific)
   *
   * @example
   * ```typescript
   * if (registry.hasHooks('beforeCreate', 'posts')) {
   *   const modifiedData = await registry.execute('beforeCreate', context);
   * }
   * ```
   */
  hasHooks(hookType: HookType, collection: string): boolean {
    return (
      this.countAt(hookType, collection) > 0 || this.countAt(hookType, "*") > 0
    );
  }

  /**
   * How many handlers one key holds, in whichever store owns that phase.
   *
   * Introspection stays whole-registry -- a caller asking whether a phase has
   * hooks means every phase, including `beforeOperation` -- so the split in
   * storage must not become a split in what can be counted.
   */
  private countAt(hookType: HookType, collection: string): number {
    const key = this.makeKey(hookType, collection);
    if (hookType === "beforeOperation") {
      return this.beforeOperationHooks.get(key)?.length ?? 0;
    }
    return this.hooks.get(key)?.length ?? 0;
  }

  /**
   * Get count of registered hooks for a specific type/collection
   *
   * Useful for debugging and monitoring.
   *
   * @param hookType - Type of hook
   * @param collection - Collection name or '*'
   * @returns Number of registered hooks
   *
   * @example
   * ```typescript
   * const count = registry.getHookCount('beforeCreate', 'posts');
   * console.log(`${count} beforeCreate hooks registered for posts`);
   * ```
   */
  getHookCount(hookType: HookType, collection: string): number {
    return this.countAt(hookType, collection);
  }

  /**
   * Get all registered hooks (for debugging/introspection)
   *
   * Returns a snapshot of all registered hooks.
   * Useful for debugging and testing.
   *
   * Excludes `beforeOperation`, whose handlers take a different context and are
   * stored separately -- see {@link getAllBeforeOperation}.
   *
   * @returns Map of hook keys to handler arrays
   * @internal
   */
  getAll(): Map<string, HookHandler[]> {
    // Copied, and unwrapped to bare handlers: provenance is a registry concern
    // and this snapshot is for debugging what will run.
    return new Map(
      [...this.hooks].map(([key, entries]) => [
        key,
        entries.map(e => e.handler),
      ])
    );
  }

  /**
   * Snapshot of the registered `beforeOperation` hooks, the counterpart to
   * {@link getAll}.
   *
   * @returns Map of hook keys to handler arrays
   * @internal
   */
  getAllBeforeOperation(): Map<string, BeforeOperationHandler[]> {
    return new Map(
      [...this.beforeOperationHooks].map(([key, entries]) => [
        key,
        entries.map(e => e.handler),
      ])
    );
  }

  /**
   * Generate storage key for hook type + collection
   * @private
   */
  private makeKey(hookType: HookType, collection: string): string {
    return `${hookType}:${collection}`;
  }
}

/**
 * Global singleton instance of HookRegistry
 *
 * Immediately initialized to prevent race conditions in concurrent environments.
 * This ensures true singleton behavior without lazy initialization checks.
 */
// Use globalThis to survive ESM module duplication in Next.js/Turbopack.
// Without this, each re-evaluation creates a new registry, causing hooks
// registered during registerServices() to be lost.
const globalForHooks = globalThis as unknown as {
  __nextly_hookRegistry?: HookRegistry;
};

if (!globalForHooks.__nextly_hookRegistry) {
  globalForHooks.__nextly_hookRegistry = new HookRegistry();
}

const globalRegistry: HookRegistry = globalForHooks.__nextly_hookRegistry;

/**
 * Get the global hook registry singleton
 *
 * Always use this function to access the registry to ensure
 * a single instance is shared across the application.
 *
 * @returns Global HookRegistry instance
 *
 * @example
 * ```typescript
 * import { getHookRegistry } from 'nextly/hooks';
 *
 * const registry = getHookRegistry();
 * registry.register('beforeCreate', 'posts', myHook);
 * ```
 */
export function getHookRegistry(): HookRegistry {
  return globalRegistry;
}

/**
 * Clear every hook from the global registry.
 *
 * Called when services shut down or are cleared, because the registry outlives
 * the DI container: handlers are registered from config on each init, so a
 * registry left populated would hand a second instance in the same process a
 * duplicate of every handler plus the dead instance's own.
 *
 * @internal
 * @example
 * ```typescript
 * // In test cleanup
 * afterEach(() => {
 *   resetHookRegistry();
 * });
 * ```
 */
export function resetHookRegistry(): void {
  globalRegistry.clear();
}
