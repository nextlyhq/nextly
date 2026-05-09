/**
 * Database Lifecycle Hooks System - Context Builder
 *
 * Utility functions for building HookContext objects from request data.
 * Provides a clean API for creating contexts with all necessary metadata.
 *
 * @module hooks/context-builder
 * @since 1.0.0
 */

import type { Nextly } from "../direct-api/nextly";

import type { HookContext } from "./types";

/**
 * Options for building a hook context
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic default requires `any` for type-erased hook registry
export interface BuildContextOptions<T = any> {
  /**
   * Collection name (e.g., "posts", "users")
   */
  collection: string;

  /**
   * Operation type
   */
  operation: "create" | "read" | "update" | "delete";

  /**
   * Data being operated on
   */
  data?: T;

  /**
   * Original data before changes (for update operations)
   */
  originalData?: T;

  /**
   * User ID performing the operation (if authenticated)
   */
  userId?: string;

  /**
   * Additional user data
   */
  user?: {
    id: string;
    email?: string;
    [key: string]: unknown;
  };

  /**
   * Shared context for passing data between hooks
   * If not provided, an empty object is created
   */
  context?: Record<string, unknown>;

  /**
   * Request metadata and API access (headers, query params, nextly instance)
   */
  req?: {
    headers?: Record<string, string>;
    query?: Record<string, unknown>;
    nextly?: Nextly;
  };
}

/**
 * Build a HookContext object from options
 *
 * Creates a standardized context object for hook execution.
 * Handles user extraction and context initialization.
 *
 * @template T - Type of the data being operated on
 * @param options - Context building options
 * @returns Complete HookContext object
 *
 * @example
 * ```typescript
 * // Simple context for create operation
 * const context = buildContext({
 *   collection: 'posts',
 *   operation: 'create',
 *   data: { title: 'My Post', content: '...' }
 * });
 *
 * // Context with user authentication
 * const context = buildContext({
 *   collection: 'posts',
 *   operation: 'update',
 *   data: updatedPost,
 *   originalData: existingPost,
 *   userId: 'user-123'
 * });
 *
 * // Context with full user object
 * const context = buildContext({
 *   collection: 'users',
 *   operation: 'create',
 *   data: newUser,
 *   user: { id: 'admin-1', email: 'admin@example.com', role: 'admin' }
 * });
 *
 * // Context with shared data
 * const sharedContext = { requestId: 'req-123', startTime: Date.now() };
 * const context = buildContext({
 *   collection: 'posts',
 *   operation: 'create',
 *   data: newPost,
 *   context: sharedContext
 * });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic default requires `any` for type-erased hook registry
export function buildContext<T = any>(
  options: BuildContextOptions<T>
): HookContext<T> {
  // Build user object from userId or provided user
  let user: HookContext["user"] | undefined;

  if (options.user) {
    user = options.user;
  } else if (options.userId) {
    user = { id: options.userId };
  }

  // Ensure context object exists (for sharing data between hooks)
  const context = options.context ?? {};

  return {
    collection: options.collection,
    operation: options.operation,
    data: options.data,
    originalData: options.originalData,
    user,
    context,
    req: options.req,
  };
}

/**
 * Merge additional data into an existing context
 *
 * Creates a new context with updated data while preserving
 * all other properties (user, context, req).
 *
 * Useful when passing modified data from one hook to another.
 *
 * @template T - Type of the data
 * @param baseContext - Existing context to merge into
 * @param newData - New data to merge
 * @returns New context with merged data
 *
 * @example
 * ```typescript
 * const originalContext = buildContext({
 *   collection: 'posts',
 *   operation: 'create',
 *   data: { title: 'My Post' }
 * });
 *
 * // Hook adds slug field
 * const modifiedData = { ...originalContext.data, slug: 'my-post' };
 * const newContext = mergeContext(originalContext, modifiedData);
 *
 * // newContext.data === { title: 'My Post', slug: 'my-post' }
 * // All other fields (user, context, req) are preserved
 * ```
 */
export function mergeContext<T>(
  baseContext: HookContext<T>,
  newData: T
): HookContext<T> {
  return {
    ...baseContext,
    data: newData,
  };
}

/**
 * Clone a context object
 *
 * Creates a deep copy of the context to prevent mutations
 * from affecting the original.
 *
 * @template T - Type of the data
 * @param context - Context to clone
 * @returns Cloned context
 *
 * @example
 * ```typescript
 * const original = buildContext({ ... });
 * const copy = cloneContext(original);
 *
 * // Modifications to copy don't affect original
 * copy.context.modified = true;
 * console.log(original.context.modified); // undefined
 * ```
 */
export function cloneContext<T>(context: HookContext<T>): HookContext<T> {
  return {
    collection: context.collection,
    operation: context.operation,
    data: context.data,
    originalData: context.originalData,
    user: context.user ? { ...context.user } : undefined,
    context: { ...context.context },
    req: context.req
      ? {
          headers: context.req.headers ? { ...context.req.headers } : undefined,
          query: context.req.query ? { ...context.req.query } : undefined,
          nextly: context.req.nextly, // Preserve singleton reference (not cloned)
        }
      : undefined,
  };
}
