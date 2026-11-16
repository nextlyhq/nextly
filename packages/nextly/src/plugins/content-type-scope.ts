/**
 * Which content types "every type except these" means.
 *
 * One answer for every place that offers a plugin the site's content types
 * without naming them: a field a plugin adds to each type, and anything else
 * that reads a scope. Named once so two readers never disagree about whether a
 * type made in the Schema Builder, a plugin's own collection or Nextly's users
 * table is included.
 *
 * @module plugins/content-type-scope
 */

import { isSystemResource } from "../schemas/_zod/rbac";

/** @experimental A kind of content type a scope can name. */
export type ContentTypeKind = "collection" | "single";

const CONTENT_TYPE_KINDS: ReadonlySet<string> = new Set<ContentTypeKind>([
  "collection",
  "single",
]);

/**
 * @experimental Every content type the site defines, of the kinds named,
 * except the ones listed by slug.
 *
 * "The site defines" means the types in its configuration and the ones made
 * in the Schema Builder, including types made after the scope was written.
 * Nextly's system types (users, media, …) are never included, and neither are
 * a plugin's own types, apart from a collection the plugin marks as holding
 * the site's content (`siteContent`), such as its pages.
 */
export interface ContentTypeScope {
  every: readonly ContentTypeKind[];
  except?: readonly string[];
}

/** @experimental A type as a scope judges it. */
export interface ContentTypeCandidate {
  slug: string;
  kind: ContentTypeKind | "fieldGroup";
  /** The plugin that contributed the type; absent for the site's own. */
  plugin?: string;
  /**
   * Whether the plugin that contributed the type marks it as holding the
   * site's content (`siteContent`), so scopes reach it as a type of the
   * site's own.
   */
  siteContent?: boolean;
}

/** @experimental Whether `value` is a {@link ContentTypeScope}. */
export function isContentTypeScope(value: unknown): value is ContentTypeScope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const { every, except } = value as { every?: unknown; except?: unknown };
  if (!Array.isArray(every) || every.length === 0) return false;
  if (!every.every(kind => CONTENT_TYPE_KINDS.has(kind as string))) {
    return false;
  }
  if (except === undefined) return true;
  return (
    Array.isArray(except) && except.every(slug => typeof slug === "string")
  );
}

/**
 * @experimental The types in `types` that `scope` reaches, in their order.
 */
export function typesReachedBy<T extends ContentTypeCandidate>(
  scope: ContentTypeScope,
  types: readonly T[]
): T[] {
  const kinds = new Set<string>(scope.every);
  const except = new Set(scope.except ?? []);
  return types.filter(
    type =>
      kinds.has(type.kind) &&
      (type.plugin === undefined || type.siteContent === true) &&
      !isSystemResource(type.slug) &&
      !except.has(type.slug)
  );
}
