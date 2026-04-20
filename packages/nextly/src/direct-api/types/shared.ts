/**
 * Shared Direct API Type Definitions
 *
 * Cross-cutting types used by all domain namespaces: generated-type resolution
 * helpers, the base `DirectAPIConfig`, and request/user context types.
 *
 * @packageDocumentation
 */

export type { PaginatedResponse } from "../../types/pagination";
export type {
  WhereFilter,
  QueryOperator,
  FieldCondition,
} from "../../services/collections/query-operators";
export type { RichTextOutputFormat } from "../../lib/rich-text-html";

/**
 * Interface augmented by generated types.
 *
 * Running `nextly generate:types` creates a `Config` interface mapping
 * collection and single slugs to their TypeScript types, then augments
 * this interface via module declaration:
 *
 * ```typescript
 * // In generated payload-types.ts:
 * declare module "@revnixhq/nextly" {
 *   export interface GeneratedTypes extends Config {}
 * }
 * ```
 *
 * When augmented, Direct API methods gain full type inference:
 * - Collection slugs are constrained to valid slugs
 * - Return types resolve to the correct document type
 * - Invalid slugs produce compile-time errors
 */
export interface GeneratedTypes {}

/**
 * Collection slug type.
 *
 * When generated types exist, this resolves to a union of valid collection
 * slug literals (e.g., `'posts' | 'users'`). Without generated types,
 * falls back to `string` for maximum flexibility.
 */
export type CollectionSlug = GeneratedTypes extends {
  collections: infer C;
}
  ? keyof C & string
  : string;

/**
 * Single/Global slug type.
 *
 * When generated types exist, this resolves to a union of valid single
 * slug literals (e.g., `'site-settings' | 'header'`). Without generated
 * types, falls back to `string`.
 */
export type SingleSlug = GeneratedTypes extends { singles: infer C }
  ? keyof C & string
  : string;

/**
 * Resolves the document type for a given collection slug.
 *
 * When generated types exist and the slug maps to a known collection,
 * returns the corresponding TypeScript interface. Otherwise returns
 * `Record<string, unknown>`.
 *
 * @typeParam TSlug - The collection slug string literal
 *
 * @example
 * ```typescript
 * // With generated types:
 * type PostDoc = DataFromCollectionSlug<'posts'>; // → Post interface
 *
 * // Without generated types:
 * type AnyDoc = DataFromCollectionSlug<string>; // → Record<string, unknown>
 * ```
 */
export type DataFromCollectionSlug<TSlug extends string> =
  GeneratedTypes extends { collections: infer C }
    ? TSlug extends keyof C
      ? C[TSlug]
      : Record<string, unknown>
    : Record<string, unknown>;

/**
 * Resolves the document type for a given single/global slug.
 *
 * @typeParam TSlug - The single slug string literal
 */
export type DataFromSingleSlug<TSlug extends string> = GeneratedTypes extends {
  singles: infer C;
}
  ? TSlug extends keyof C
    ? C[TSlug]
    : Record<string, unknown>
  : Record<string, unknown>;

/**
 * User context for access control when `overrideAccess` is false.
 *
 * This minimal interface provides the essential information needed
 * for access control decisions.
 */
export interface UserContext {
  /** Unique user identifier */
  id: string;
  /** User's role for role-based access control */
  role?: string;
}

/**
 * Request context passed through to services and hooks.
 *
 * Contains information about the current request, user, and
 * provides access to the Direct API instance within hooks.
 */
export interface RequestContext {
  /** Current user context (when authenticated) */
  user?: UserContext;
  /** Custom context data passed to hooks */
  context?: Record<string, unknown>;
  /** Locale for localized content */
  locale?: string;
  /** Fallback locale when requested locale data is missing */
  fallbackLocale?: string | false;
  /** Transaction context for database operations */
  transactionID?: string;
}

/**
 * Base configuration options shared across all Direct API operations.
 *
 * These options control access control, transactions, and response formatting.
 *
 * @example
 * ```typescript
 * // Bypass access control (default for Direct API)
 * await nextly.find({ collection: 'posts', overrideAccess: true });
 *
 * // Enforce access control with user context
 * await nextly.find({
 *   collection: 'posts',
 *   overrideAccess: false,
 *   user: { id: 'user-123', role: 'editor' },
 * });
 * ```
 */
export interface DirectAPIConfig {
  /**
   * Bypass access control checks.
   *
   * When `true` (default for Direct API), all access control is skipped.
   * Set to `false` to enforce collection, field, and row-level permissions.
   *
   * @default true
   */
  overrideAccess?: boolean;

  /**
   * User context for access control.
   *
   * Required when `overrideAccess` is `false`. Provides the user identity
   * and role for permission checks.
   */
  user?: UserContext;

  /**
   * Request context passed to hooks.
   *
   * Use this to pass custom data to hooks via `req.context`.
   */
  req?: RequestContext;

  /**
   * Custom context data passed to hooks.
   *
   * This data is accessible in hooks via `req.context`.
   * Useful for passing request-specific information.
   */
  context?: Record<string, unknown>;

  /**
   * Include hidden fields in the response.
   *
   * Hidden fields (defined with `hidden: true` in field config)
   * are normally excluded from responses. Set to `true` to include them.
   *
   * @default false
   */
  showHiddenFields?: boolean;

  /**
   * Return `null` instead of throwing errors for not-found scenarios.
   *
   * Applies to `findByID` and similar single-document operations.
   * When `true`, returns `null` if document not found.
   * When `false` (default), throws `NotFoundError`.
   *
   * @default false
   */
  disableErrors?: boolean;

  /**
   * Skip database transaction wrapping.
   *
   * By default, write operations are wrapped in transactions.
   * Set to `true` to disable transaction wrapping.
   *
   * @default false
   */
  disableTransaction?: boolean;

  /**
   * Locale for localized content.
   *
   * When set, returns content in the specified locale.
   */
  locale?: string;

  /**
   * Fallback locale when requested locale data is missing.
   *
   * Set to `false` to disable fallback behavior.
   */
  fallbackLocale?: string | false;

  /**
   * Relationship population depth.
   *
   * Controls how deeply to populate relationship and upload fields.
   * - `0`: No population (return IDs only)
   * - `1`: Populate direct relationships
   * - `2+`: Populate nested relationships
   *
   * @default 0
   */
  depth?: number;

  /**
   * Output format for rich text fields.
   *
   * Controls how rich text (Lexical JSON) fields are returned in responses.
   * - `"json"` (default): Return only the Lexical JSON structure
   * - `"html"`: Return only the HTML string
   * - `"both"`: Return an object with both `json` and `html` properties
   *
   * @default "json"
   *
   * @example
   * ```typescript
   * // Get rich text as both JSON and HTML
   * const posts = await nextly.find({
   *   collection: 'posts',
   *   richTextFormat: 'both',
   * });
   * // posts.docs[0].content => { json: {...}, html: "<p>...</p>" }
   *
   * // Get rich text as HTML only
   * const posts = await nextly.find({
   *   collection: 'posts',
   *   richTextFormat: 'html',
   * });
   * // posts.docs[0].content => "<p>...</p>"
   * ```
   */
  richTextFormat?: import("../../lib/rich-text-html").RichTextOutputFormat;

  /**
   * Ignore document locks.
   *
   * When `true` (default), operations proceed regardless of document locks.
   * Set to `false` to respect locks and fail if document is locked.
   *
   * @default true
   */
  overrideLock?: boolean;

  /**
   * Forms API configuration.
   *
   * Override the default collection slugs used by the form builder plugin.
   * Only relevant when using the `nextly.forms.*` namespace.
   *
   * @example
   * ```typescript
   * const nextly = new Nextly({
   *   forms: {
   *     collectionSlug: 'contact-forms',
   *     submissionCollectionSlug: 'contact-responses',
   *   },
   * });
   * ```
   */
  forms?: import("./forms").FormsConfig;
}

/**
 * Options for controlling relationship field population.
 *
 * Allows fine-grained control over which fields to populate
 * and how deeply to populate nested relationships.
 */
export interface PopulateOptions {
  /**
   * Whether to populate this field.
   *
   * Set to `false` to skip population for this field.
   */
  populate?: boolean;

  /**
   * Specific fields to select from the populated document.
   *
   * Use this to reduce response size by selecting only needed fields.
   */
  select?: Record<string, boolean>;

  /**
   * Maximum depth for nested relationship population.
   *
   * Overrides the global `depth` option for this specific field.
   */
  depth?: number;
}
