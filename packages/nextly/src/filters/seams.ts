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
 * @experimental One recipient of an email, and the line it is on.
 */
export interface EmailRecipient {
  address: string;
  kind: "to" | "cc" | "bcc";
}

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
   * every send a handler has seen so far; a list when it has several. Leaving
   * it out of a returned value keeps the recipients as they were.
   */
  to: string | string[];
  /**
   * @experimental Every recipient, `to`, `cc` and `bcc`, in that order.
   *
   * Read-only: derived from `to`, `cc` and `bcc` again after every handler, so
   * the next handler always reads the recipients as they now stand. Change
   * recipients through `to`, `cc` and `bcc`; a change made here is replaced.
   */
  recipients?: EmailRecipient[];
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
   * @experimental Every recipient of the message, `to`, `cc` and `bcc`, in
   * that order. Blind copies are included: an action that forwards this value
   * elsewhere discloses them, so treat it as the message's full address list.
   */
  recipients?: EmailRecipient[];
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
