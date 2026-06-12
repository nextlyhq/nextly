/**
 * Core filter seam constants and payload types (D63)
 *
 * Defines the named filter/action seams that Nextly exposes as stable extension
 * points. Plugins and application code register handlers against these names via
 * the {@link FilterRegistry}.
 *
 * @module filters/seams
 */

export interface EmailPayloadFilterValue {
  to: string;
  from: string;
  subject: string;
  html: string;
  plainText?: string;
  cc?: string[];
  bcc?: string[];
}
export interface EmailFilterContext {
  providerId?: string;
}

export interface NavCollectionItem {
  slug: string;
  labels?: { singular?: string; plural?: string };
  group?: string;
  order?: number;
  hidden?: boolean;
  [key: string]: unknown;
}
export interface NavFilterContext {
  userId: string;
}

export type ListQueryWhere = Record<string, unknown>;
export interface ListQueryFilterContext {
  collection: string;
  userId?: string;
  search?: string;
  limit?: number;
}

export const FilterSeams = {
  EmailBeforeSend: "email.beforeSend",
  EmailAfterSend: "email.afterSend",
  AdminNav: "admin.nav",
  CollectionsListQuery: "collections.listQuery",
} as const;
export type CoreFilterSeam = (typeof FilterSeams)[keyof typeof FilterSeams];
