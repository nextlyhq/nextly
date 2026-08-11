/**
 * Shared Direct API Type Definitions
 *
 * Cross-cutting types used by all domain namespaces: generated-type resolution
 * helpers, the base `DirectAPIConfig`, and request/user context types.
 *
 * @packageDocumentation
 */

import type { PaginationMeta } from "../../api/response-shapes";
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import type { HookWarning } from "../../hooks/side-effect-warnings";
import type { RichTextOutputFormat } from "../../lib/rich-text-html";

import type { FormsConfig } from "./forms";

// (`{ items, meta }`) so the in-process Direct API speaks the same envelope
// as the wire API. The legacy `PaginatedResponse` (Payload's `{ docs,
// totalDocs, ... }`) is still re-exported for callers that have not yet
// migrated, but the Direct API itself no longer returns that shape.
export type { PaginatedResponse } from "../../types/pagination";
// PaginationMeta is the canonical pagination metadata object used by both
// here so consumers can `import { PaginationMeta } from "nextly"`
// without reaching into `api/response-shapes`.
export type { PaginationMeta } from "../../api/response-shapes";
export type {
  WhereFilter,
  QueryOperator,
  FieldCondition,
} from "../../services/collections/query-operators";
export type { RichTextOutputFormat } from "../../lib/rich-text-html";

/**
 * Canonical Direct API list-response shape.
 *
 * Phase 4 alignment: in-process find() / namespace.find() calls return
 * `{ items, meta }` (matching the wire API's `respondList` envelope) so
 * callers see the same shape regardless of transport.
 *
 * Migrate from the legacy `{ docs, totalDocs, ... }` shape:
 * - `result.docs`         -> `result.items`
 * - `result.totalDocs`    -> `result.meta.total`
 * - `result.hasNextPage`  -> `result.meta.hasNext`
 * - `result.hasPrevPage`  -> `result.meta.hasPrev`
 *
 * @typeParam T - Element type for each item in the list
 */
export interface ListResult<T> {
  /** Page of items for the current query slice. */
  items: T[];
  /** Pagination metadata. */
  meta: PaginationMeta;
}

/**
 * Canonical Direct API mutation-response shape.
 *
 * Phase 4 alignment: create/update/delete return `{ message, item }`
 * (matching the wire API's `respondMutation` envelope). The `message` is a
 * server-authored toast string callers can surface verbatim; `item` is the
 * affected document (or a minimal `{ id }` shape for deletes).
 *
 * @typeParam T - Item type returned by the mutation
 */
export interface MutationResult<T> {
  /** Human-readable status message (e.g. "Post created."). */
  message: string;
  /** The affected item. */
  item: T;
  /**
   * Side effects that failed after the write committed, when any did.
   *
   * A post-commit hook cannot un-save the row, so the operation reports
   * success and the failure travels beside it. Absent when every hook
   * succeeded, so an ordinary result is unchanged.
   *
   * Mirrors the `warnings` field on the wire API's mutation envelope, so the
   * same failure is equally visible whether the caller came through REST or
   * called the Direct API in-process.
   */
  warnings?: HookWarning[];
}

/**
 * Interface augmented by generated types.
 *
 * Running `nextly generate:types` creates a `Config` interface mapping
 * collection and single slugs to their TypeScript types, then augments
 * this interface via module declaration:
 *
 * ```typescript
 * // In generated payload-types.ts:
 * declare module "nextly" {
 *   export interface GeneratedTypes extends Config {}
 * }
 * ```
 *
 * When augmented, Direct API methods gain full type inference:
 * - Collection slugs are constrained to valid slugs
 * - Return types resolve to the correct document type
 * - Invalid slugs produce compile-time errors
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
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
 * Single slug type.
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
export type DataFromCollectionSlugFrom<
  TGenerated,
  TSlug extends string,
> = TGenerated extends { collections: infer C }
  ? TSlug extends keyof C
    ? C[TSlug]
    : Record<string, unknown>
  : Record<string, unknown>;

export type DataFromCollectionSlug<TSlug extends string> =
  DataFromCollectionSlugFrom<GeneratedTypes, TSlug>;

/**
 * Resolves the document type for a given single/global slug.
 *
 * @typeParam TSlug - The single slug string literal
 */
export type DataFromSingleSlugFrom<
  TGenerated,
  TSlug extends string,
> = TGenerated extends { singles: infer C }
  ? TSlug extends keyof C
    ? C[TSlug]
    : Record<string, unknown>
  : Record<string, unknown>;

export type DataFromSingleSlug<TSlug extends string> = DataFromSingleSlugFrom<
  GeneratedTypes,
  TSlug
>;

/**
 * The timestamp fields every entity carries, whatever its own fields are.
 *
 * Used as the in-process shape for a project whose generated types predate
 * `collectionDateFields`: the built-in timestamps are true of every collection,
 * so they can be named without consulting the schema.
 */
type BuiltInDateField = "createdAt" | "updatedAt";

/**
 * A document as it exists inside the running process, given the fields the
 * database returns as `Date`.
 *
 * The generated interfaces describe the WIRE: `routeHandler` formats every REST
 * response, so a timestamp really is a string by the time a browser sees it. In
 * process there is no such step and a timestamp column arrives as the `Date` the
 * driver decoded, so the two shapes differ in exactly those fields.
 *
 * Homomorphic on purpose: `?` and `readonly` are carried over, so an optional
 * `publishedAt?: string` stays optional rather than becoming required.
 *
 * TOP LEVEL ONLY. A relationship field is typed `string | Related`, and at a
 * depth that populates it the related row carries decoded `Date`s while that
 * `Related` interface still spells them as strings. Reaching into it needs the
 * generated types to record which fields are relations and to what, which this
 * mapping has no way to know from the document type alone. A date nested in a
 * field group or repeater needs nothing: those are stored as JSON, so their
 * dates really are strings in process too.
 */
export type InProcessRow<TData, TDateField extends PropertyKey> = {
  [K in keyof TData]: K extends TDateField ? InProcessDate<TData[K]> : TData[K];
};

/**
 * What a timestamp column hands back, given how the generated type spells the
 * field it belongs to.
 *
 * A date that the schema requires is always a `Date`. An OPTIONAL one is
 * `Date | null`, and the `null` is not decoration: codegen writes `?` exactly
 * when a field is not required, a field that is not required has a nullable
 * column, and a nullable timestamp column reads back as `null` -- the same
 * answer on PostgreSQL, MySQL and SQLite, with the key present on the row.
 *
 * So `undefined` is the one value a full read never produces and `null` is the
 * one it always produces for an unset date. `?` is still carried over by the
 * mapping above, because a projected read can leave the key off entirely; what
 * matters here is that `null` can no longer be narrowed away. A caller who
 * checks `!== undefined` and then calls a `Date` method is the failure this
 * exists to make impossible.
 *
 * A source type that already states its own `null` keeps it, so this stays
 * correct if the generated interfaces start spelling nullability themselves.
 */
type InProcessDate<TValue> = [undefined] extends [TValue]
  ? Date | null | Extract<TValue, undefined>
  : Date | Extract<TValue, null>;

/**
 * The `Date`-backed field names of a collection, as codegen recorded them.
 *
 * Falls back to the built-in timestamps when a project has no generated types,
 * or has types generated before this map existed — the fields that are always
 * right, rather than none at all.
 *
 * The key here MUST match the one `TypeGenerator` emits into `Config`. If the
 * two drift, this conditional silently takes the fallback branch and a `date`
 * field goes back to being typed as a string — no compile error anywhere, just
 * a row type that is wrong again. Pinned by
 * `__tests__/generated-config-contract.test.ts`.
 */
type DateFieldsOfCollectionFrom<
  TGenerated,
  TSlug extends string,
> = TGenerated extends { collectionDateFields: infer D }
  ? TSlug extends keyof D
    ? Extract<D[TSlug], PropertyKey>
    : BuiltInDateField
  : BuiltInDateField;

/**
 * The `Date`-backed field names of a single.
 *
 * Falls back to NOTHING rather than to the built-in timestamps, unlike
 * {@link DateFieldsOfCollectionFrom}. A single is read through a deserializer
 * that normalizes its system timestamps to ISO strings, so `updatedAt` is a
 * string here and naming it would be the one guess that is always wrong. Only
 * a single's own date fields are decoded, and those are known only from the
 * generated map.
 */
type DateFieldsOfSingleFrom<
  TGenerated,
  TSlug extends string,
> = TGenerated extends { singleDateFields: infer D }
  ? TSlug extends keyof D
    ? Extract<D[TSlug], PropertyKey>
    : never
  : never;

/**
 * Resolves the in-process document type for a collection slug — what the Direct
 * API hands back, as opposed to what the REST API serializes.
 *
 * Factored through a `From` generic for the same reason the field-group types
 * are: a test asserting against a locally re-declared copy of the conditional
 * would pass even when this alias reads the wrong key, which is the failure
 * being guarded.
 *
 * The document and its date fields are resolved inside ONE conditional on
 * `TSlug`, which distributes, so a union of slugs pairs each document with its
 * own date fields. Resolving the two separately and combining them afterwards
 * would union the date sets first, and a field one collection stores as text
 * would be typed `Date` because a different collection happens to store a date
 * under that name.
 *
 * @typeParam TSlug - The collection slug string literal
 *
 * @example
 * ```typescript
 * const post = await nextly.findByID({ collection: "posts", id });
 * post?.createdAt.getTime(); // a Date in process
 *
 * type Wire = DataFromCollectionSlug<"posts">;
 * // Wire["createdAt"] is a string: the REST response is formatted text.
 * ```
 */
export type RowFromCollectionSlugFrom<
  TGenerated,
  TSlug extends string,
> = TGenerated extends { collections: infer C }
  ? TSlug extends keyof C
    ? InProcessRow<C[TSlug], DateFieldsOfCollectionFrom<TGenerated, TSlug>>
    : Record<string, unknown>
  : Record<string, unknown>;

export type RowFromCollectionSlug<TSlug extends string> =
  RowFromCollectionSlugFrom<GeneratedTypes, TSlug>;

/**
 * Resolves the in-process document type for a single slug.
 *
 * @typeParam TSlug - The single slug string literal
 */
export type RowFromSingleSlugFrom<
  TGenerated,
  TSlug extends string,
> = TGenerated extends { singles: infer C }
  ? TSlug extends keyof C
    ? InProcessRow<C[TSlug], DateFieldsOfSingleFrom<TGenerated, TSlug>>
    : Record<string, unknown>
  : Record<string, unknown>;

export type RowFromSingleSlug<TSlug extends string> = RowFromSingleSlugFrom<
  GeneratedTypes,
  TSlug
>;

/**
 * User context for access control when `overrideAccess` is false.
 *
 * Carries the identity an access rule decides on. `id` and `role` are the
 * canonical fields; anything else you attach is passed through to the rule
 * untouched, so a `custom` rule can decide on a claim of your own (a tenant, a
 * plan, an entitlement) the same way it can over HTTP.
 */
export interface UserContext {
  /** Unique user identifier */
  id: string;
  /** User's primary role for role-based access control */
  role?: string;
  /** Full authorized role set, for rules that decide on more than one role. */
  roles?: string[];
  /** Any further claims your rules read. */
  [claim: string]: unknown;
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
   * The authenticated caller's own scope, when it is an API key.
   *
   * Distinct from `user`, which says WHO the caller is. This says what KIND of
   * caller it is and which grants the key itself carries. A scoped key is
   * authorized on its own stamped permissions, not its owner's, so without this
   * an update-only key issued by a reader-plus-publisher is judged by the
   * owner's grants and reads what it was never given.
   *
   * Leave unset for session and system callers; they resolve grants normally.
   */
  actor?: AuthenticatedScope;

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
   * // posts.items[0].content => { json: {...}, html: "<p>...</p>" }
   *
   * // Get rich text as HTML only
   * const posts = await nextly.find({
   *   collection: 'posts',
   *   richTextFormat: 'html',
   * });
   * // posts.items[0].content => "<p>...</p>"
   * ```
   */
  richTextFormat?: RichTextOutputFormat;

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
  forms?: FormsConfig;
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
