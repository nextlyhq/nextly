/**
 * Core filter seam constants and payload types (D63)
 *
 * Defines the named filter/action seams that Nextly exposes as stable extension
 * points. Plugins and application code register handlers against these names via
 * the {@link FilterRegistry}.
 *
 * @module filters/seams
 */

/** @experimental Payload threaded through `email.beforeSend` filter handlers (D63). */
export interface EmailPayloadFilterValue {
  to: string;
  from: string;
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

/** @experimental Payload for the `email.afterSend` action seam (D63). */
export interface EmailAfterSendValue {
  to: string;
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
