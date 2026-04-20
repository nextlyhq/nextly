/**
 * Database Lifecycle Hooks System - Type Definitions
 *
 * This module provides TypeScript type definitions for Nextly's hook system,
 * enabling developers to run custom logic before/after database operations.
 *
 * Inspired by modern CMS lifecycle hook patterns, adapted for Next.js 16
 * and designed as an NPM package consumable API.
 *
 * @example
 * ```typescript
 * import { registerHook } from '@revnixhq/nextly';
 *
 * // Hash password before creating user
 * registerHook('beforeCreate', 'users', async (context) => {
 *   if (context.data?.password) {
 *     context.data.password = await bcrypt.hash(context.data.password, 10);
 *   }
 *   return context.data;
 * });
 *
 * // Send welcome email after user creation
 * registerHook('afterCreate', 'users', async (context) => {
 *   await sendWelcomeEmail(context.data.email);
 * });
 * ```
 *
 * @module hooks/types
 * @since 1.0.0
 */

import type { Nextly } from "../direct-api/nextly";

/**
 * Available hook types for database lifecycle events.
 *
 * Hook execution order for a create operation:
 * 1. beforeOperation - Run before any operation (can modify args)
 * 2. beforeCreate - Run before validation and database insert
 * 3. afterCreate - Run after database insert completes
 *
 * Hook execution order for an update operation:
 * 1. beforeOperation - Run before any operation (can modify args)
 * 2. beforeUpdate - Run before validation and database update
 * 3. afterUpdate - Run after database update completes
 *
 * Hook execution order for a delete operation:
 * 1. beforeOperation - Run before any operation (can modify args)
 * 2. beforeDelete - Run before database delete
 * 3. afterDelete - Run after database delete completes
 *
 * Hook execution order for a read operation:
 * 1. beforeOperation - Run before any operation (can modify args)
 * 2. beforeRead - Run before database query
 * 3. afterRead - Run after database query completes
 */
export type HookType =
  | "beforeOperation"
  | "beforeCreate"
  | "afterCreate"
  | "beforeUpdate"
  | "afterUpdate"
  | "beforeDelete"
  | "afterDelete"
  | "beforeRead"
  | "afterRead";

/**
 * Context object passed to hook handlers containing operation metadata.
 *
 * The context provides all information needed for hooks to make decisions:
 * - Which collection is being operated on
 * - What operation is being performed
 * - The data being created/updated/deleted/read
 * - The user performing the operation (if authenticated)
 * - A shared context object for passing data between hooks
 *
 * @template T - Type of the data being operated on
 *
 * @example
 * ```typescript
 * // beforeCreate hook modifying data
 * const beforeCreateHook: HookHandler<User> = async (context) => {
 *   console.log(`Creating ${context.collection}`);
 *   console.log(`User: ${context.user?.id}`);
 *
 *   // Add auto-generated slug
 *   const modifiedData = {
 *     ...context.data,
 *     slug: slugify(context.data.title)
 *   };
 *
 *   // Store in shared context for afterCreate hook
 *   context.context.generatedSlug = true;
 *
 *   return modifiedData;
 * };
 *
 * // afterCreate hook reading shared context
 * const afterCreateHook: HookHandler<User> = async (context) => {
 *   if (context.context.generatedSlug) {
 *     console.log('Slug was auto-generated');
 *   }
 * };
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic default requires `any` for type-erased hook registry
export interface HookContext<T = any> {
  /**
   * Collection name (e.g., "posts", "users", "products")
   *
   * This is the slug/name of the collection being operated on.
   */
  collection: string;

  /**
   * Operation type being performed
   *
   * Determines which CRUD operation triggered this hook.
   */
  operation: "create" | "read" | "update" | "delete";

  /**
   * Data being created, updated, or read
   *
   * For `before*` hooks, modifying this data will affect what gets saved to the database.
   * For `after*` hooks, this contains the final data that was saved/retrieved.
   *
   * **Hook Behavior:**
   * - `beforeCreate`: Incoming data before validation (can be modified)
   * - `afterCreate`: Created record from database (read-only, for side effects)
   * - `beforeUpdate`: Incoming changes before validation (can be modified)
   * - `afterUpdate`: Updated record from database (read-only)
   * - `beforeDelete`: Record about to be deleted (read-only)
   * - `afterDelete`: Deleted record data (read-only)
   * - `beforeRead`: Query parameters (can be modified to filter)
   * - `afterRead`: Fetched records (can be modified for transformation)
   */
  data?: T;

  /**
   * Original data before changes (only for update operations)
   *
   * This allows update hooks to compare the old vs new state.
   *
   * @example
   * ```typescript
   * registerHook('afterUpdate', 'products', async (context) => {
   *   if (context.originalData.price !== context.data.price) {
   *     await logPriceChange(context.originalData.price, context.data.price);
   *   }
   * });
   * ```
   */
  originalData?: T;

  /**
   * User performing the operation (if authenticated)
   *
   * Contains user ID and any additional user data passed from the request.
   * This is `undefined` if the operation is performed without authentication.
   */
  user?: {
    id: string;
    email?: string;
    [key: string]: unknown;
  };

  /**
   * Shared context object for passing data between hooks
   *
   * This allows `before*` hooks to communicate with `after*` hooks
   * within the same request lifecycle.
   *
   * @example
   * ```typescript
   * // beforeCreate sets flag
   * registerHook('beforeCreate', 'posts', async (context) => {
   *   context.context.sendNotification = true;
   *   return context.data;
   * });
   *
   * // afterCreate reads flag
   * registerHook('afterCreate', 'posts', async (context) => {
   *   if (context.context.sendNotification) {
   *     await sendNewPostNotification(context.data);
   *   }
   * });
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shared context is a general-purpose key-value store
  context: Record<string, any>;

  /**
   * Request metadata and API access (optional)
   *
   * Contains HTTP request information if available (headers, query params)
   * and the Nextly Direct API instance for performing database operations
   * within hooks.
   *
   * **`req.nextly`** provides the same Direct API available via `getNextly()`,
   * allowing hooks to perform CRUD operations on other collections.
   * This allows hooks to perform CRUD operations on other collections.
   *
   * @example
   * ```typescript
   * registerHook('afterCreate', 'posts', async (context) => {
   *   // Access Direct API via req.nextly
   *   await context.req?.nextly?.create({
   *     collection: 'activity-logs',
   *     data: {
   *       action: 'post_created',
   *       postId: context.data.id,
   *     },
   *   });
   * });
   * ```
   */
  req?: {
    /** HTTP request headers */
    headers?: Record<string, string>;
    /** HTTP query parameters */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- query params have arbitrary shapes
    query?: Record<string, any>;
    /**
     * Nextly Direct API instance.
     *
     * Provides access to all Direct API operations (`find`, `create`, `update`,
     * `delete`, etc.) for performing database operations within hooks.
     *
     * Allows hooks to call the full Nextly API for cross-collection operations.
     */
    nextly?: Nextly;
  };
}

/**
 * Hook handler function signature
 *
 * Hook handlers can be synchronous or asynchronous (Promise-based).
 * They receive a `HookContext` and can optionally return modified data.
 *
 * **Return Value Behavior:**
 * - For `before*` hooks: Return value replaces `context.data` for next hook
 * - For `after*` hooks: Return value is ignored (use for side effects only)
 *
 * **Error Handling:**
 * - Throwing an error will abort the operation and rollback the transaction
 * - The error message will be returned to the client
 *
 * @template T - Type of the data being operated on
 *
 * @param context - Hook context with operation metadata
 * @returns Modified data (for before hooks) or void (for after hooks)
 *
 * @example
 * ```typescript
 * // Synchronous hook (beforeCreate)
 * const addTimestamp: HookHandler<Post> = (context) => {
 *   return {
 *     ...context.data,
 *     publishedAt: new Date()
 *   };
 * };
 *
 * // Asynchronous hook (afterCreate)
 * const notifyWebhook: HookHandler<Post> = async (context) => {
 *   await fetch('https://webhook.example.com', {
 *     method: 'POST',
 *     body: JSON.stringify(context.data)
 *   });
 *   // No return value needed for after hooks
 * };
 *
 * // Error handling (beforeCreate)
 * const validatePrice: HookHandler<Product> = (context) => {
 *   if (context.data.price < 0) {
 *     throw new Error('Price cannot be negative');
 *   }
 *   return context.data;
 * };
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic default requires `any` for type-erased hook registry
export type HookHandler<T = any> = (
  context: HookContext<T>
) => Promise<T | void> | T | void;

/**
 * Hook registration options (for future extensibility)
 *
 * Reserved for future features like:
 * - Hook priority/ordering
 * - Conditional execution
 * - Hook middleware
 */
export interface HookOptions {
  /**
   * Hook priority (higher runs first)
   * @default 0
   * @future Reserved for future implementation
   */
  priority?: number;

  /**
   * Condition function to determine if hook should run
   * @future Reserved for future implementation
   */
  condition?: (context: HookContext) => boolean;
}

/**
 * Operation types supported by beforeOperation hook
 *
 * These map to the CRUD operations that can trigger hooks.
 */
export type OperationType = "create" | "read" | "update" | "delete";

/**
 * Arguments object for beforeOperation hook
 *
 * Contains the operation arguments that can be modified by the hook.
 * Different operations use different argument properties:
 *
 * - **create**: Uses `data` (the document to create)
 * - **read**: Uses `id` (single read) or `where` (query)
 * - **update**: Uses `id` and `data` (the document changes)
 * - **delete**: Uses `id` (the document to delete)
 *
 * @template T - Type of the data being operated on
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic default requires `any` for type-erased hook registry
export interface BeforeOperationArgs<T = any> {
  /**
   * Data being created or updated
   *
   * For create: The full document to create
   * For update: The partial document with changes
   */
  data?: T;

  /**
   * ID of the document being operated on
   *
   * For read (single): The document ID to fetch
   * For update: The document ID to update
   * For delete: The document ID to delete
   */
  id?: string;

  /**
   * Query filter for read operations
   *
   * Used for listing/querying multiple documents.
   * Format follows Nextly Where query syntax.
   */
  where?: Record<string, unknown>;
}

/**
 * Context object passed to beforeOperation hooks
 *
 * The beforeOperation hook runs BEFORE any operation-specific hooks,
 * allowing you to modify operation arguments or execute side-effects
 * that run before an operation begins.
 *
 * **Use Cases:**
 * - Global logging/auditing of all operations
 * - Rate limiting across all operations
 * - Global validation or normalization
 * - Modifying operation arguments before they reach specific hooks
 *
 * **Execution Order:**
 * 1. beforeOperation (this hook)
 * 2. beforeCreate/beforeRead/beforeUpdate/beforeDelete
 * 3. Database operation
 * 4. afterCreate/afterRead/afterUpdate/afterDelete
 *
 * @template T - Type of the data being operated on
 *
 * @example
 * ```typescript
 * import { registerHook } from '@revnixhq/nextly';
 *
 * // Global logging for all operations
 * registerHook('beforeOperation', '*', async (context) => {
 *   console.log(`[${context.operation}] ${context.collection}`, context.args);
 * });
 *
 * // Modify operation arguments
 * registerHook('beforeOperation', 'posts', async (context) => {
 *   if (context.operation === 'create' && context.args.data) {
 *     return {
 *       ...context.args,
 *       data: { ...context.args.data, source: 'api' }
 *     };
 *   }
 *   return context.args;
 * });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic default requires `any` for type-erased hook registry
export interface BeforeOperationContext<T = any> {
  /**
   * Collection name (e.g., "posts", "users", "products")
   *
   * This is the slug/name of the collection being operated on.
   */
  collection: string;

  /**
   * Operation type being performed
   *
   * Determines which CRUD operation is about to run.
   */
  operation: OperationType;

  /**
   * Operation arguments that can be modified
   *
   * Contains the data, id, or where clause depending on the operation.
   * Returning modified args from the handler will affect the operation.
   */
  args: BeforeOperationArgs<T>;

  /**
   * User performing the operation (if authenticated)
   *
   * Contains user ID and any additional user data passed from the request.
   * This is `undefined` if the operation is performed without authentication.
   */
  user?: HookContext["user"];

  /**
   * Request metadata and API access (optional)
   *
   * Contains HTTP request information and the Nextly Direct API instance.
   * See {@link HookContext.req} for details.
   */
  req?: HookContext["req"];

  /**
   * Shared context object for passing data between hooks
   *
   * This allows beforeOperation to pass data to operation-specific hooks.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shared context is a general-purpose key-value store
  context: Record<string, any>;
}

/**
 * Handler function for beforeOperation hooks
 *
 * The beforeOperation handler can:
 * 1. Execute side-effects (logging, validation) and return void
 * 2. Modify operation arguments by returning modified args
 * 3. Throw an error to abort the operation
 *
 * **Return Value Behavior:**
 * - Return `void` or `undefined`: No modification, continue with original args
 * - Return modified `args`: Use the returned args for the operation
 * - Throw an error: Abort the operation
 *
 * @template T - Type of the data being operated on
 *
 * @param context - beforeOperation context with operation metadata and args
 * @returns Modified args object, or void for side effects only
 *
 * @example
 * ```typescript
 * // Side effect only (logging)
 * const logOperation: BeforeOperationHandler = async (context) => {
 *   console.log(`Operation: ${context.operation} on ${context.collection}`);
 *   // No return = original args unchanged
 * };
 *
 * // Modify args (add field to data)
 * const addTimestamp: BeforeOperationHandler<Post> = async (context) => {
 *   if (context.operation === 'create' && context.args.data) {
 *     return {
 *       ...context.args,
 *       data: { ...context.args.data, operationTimestamp: new Date() }
 *     };
 *   }
 *   return context.args;
 * };
 *
 * // Abort operation (throw error)
 * const rateLimit: BeforeOperationHandler = async (context) => {
 *   if (await isRateLimited(context.user?.id)) {
 *     throw new Error('Rate limit exceeded');
 *   }
 * };
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic default requires `any` for type-erased hook registry
export type BeforeOperationHandler<T = any> = (
  context: BeforeOperationContext<T>
) =>
  | void
  | Promise<void>
  | BeforeOperationArgs<T>
  | Promise<BeforeOperationArgs<T>>;
