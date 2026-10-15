/**
 * Core filter seam constants and payload types (D63)
 *
 * Defines the named filter/action seams that Nextly exposes as stable extension
 * points. Plugins and application code register handlers against these names via
 * the {@link FilterRegistry}.
 *
 * @module filters/seams
 */

/**
 * @experimental Payload threaded through `email.beforeSend` filter handlers (D63).
 *
 * The whole envelope of the send. A value a handler changes is the value sent,
 * and the result is checked again before any provider is contacted: a send left
 * with no valid `to`, more `to` addresses than the provider takes, or a changed
 * recipient on a send that names a person, is refused.
 */
export interface EmailPayloadFilterValue {
  /**
   * The recipient as one string when the send has one `to` address, which is
   * every send a handler written before `toList` existed has seen; a list when
   * it has several.
   */
  to: string | string[];
  /**
   * @experimental Every `to` address, as a list whatever shape `to` has.
   *
   * Change either `to` or `toList` to change the recipients. When a handler
   * changes `to`, `to` is used; otherwise a changed `toList` is.
   */
  toList?: string[];
  from: string;
  /** @experimental The Reply-To address, when the send has one. */
  replyTo?: string;
  subject: string;
  html: string;
  /** Plain-text alternative body (multipart). Auto-generated from `html` when the caller omits it. */
  text?: string;
  cc?: string[];
  bcc?: string[];
}

/** @experimental Context passed to `email.beforeSend` filter handlers (D63). */
export interface EmailFilterContext {
  providerId?: string;
}

/**
 * @experimental Payload for the `email.afterSend` action seam (D63).
 *
 * Runs once for each message handed to the provider. A send to several people
 * through a provider that takes one `to` per message is several messages, and
 * each has its own outcome and message id.
 */
export interface EmailAfterSendValue {
  /** One string for a message to one `to` address, as before; a list when several. */
  to: string | string[];
  /**
   * @experimental Every `to` address of the message, as a list. Copied
   * addresses are deliberately absent: a blind copy is not an action's to see.
   */
  toList?: string[];
  subject: string;
  success: boolean;
  messageId?: string;
}

/** @experimental Item shape threaded through `admin.nav` filter handlers (D63). */
export interface NavCollectionItem {
  slug: string;
  labels?: { singular?: string; plural?: string };
  group?: string;
  order?: number;
  hidden?: boolean;
  [key: string]: unknown;
}

/** @experimental Context passed to `admin.nav` filter handlers (D63). */
export interface NavFilterContext {
  userId: string;
}

/** @experimental WHERE clause shape threaded through `collections.listQuery` filter handlers (D63). */
export type ListQueryWhere = Record<string, unknown>;

/** @experimental Context passed to `collections.listQuery` filter handlers (D63). */
export interface ListQueryFilterContext {
  collection: string;
  userId?: string;
  search?: string;
  limit?: number;
}

/** @experimental Named seam constants for all built-in Nextly filter/action extension points (D63). */
export const FilterSeams = {
  EmailBeforeSend: "email.beforeSend",
  EmailAfterSend: "email.afterSend",
  AdminNav: "admin.nav",
  CollectionsListQuery: "collections.listQuery",
} as const;

/** @experimental Union of all built-in Nextly filter/action seam names (D63). */
export type CoreFilterSeam = (typeof FilterSeams)[keyof typeof FilterSeams];
