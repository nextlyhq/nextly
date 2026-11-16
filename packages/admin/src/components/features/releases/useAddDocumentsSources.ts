"use client";

/**
 * The documents the Add documents picker lists: from every collection and
 * Single with a Draft/Published lifecycle that the reader may publish or
 * unpublish, narrowed by the picker's search, its collection filter and
 * "Has unpublished changes".
 *
 * There is no read across collections, so each collection in scope is read on
 * its own, its first page only, and the picker says which ones held more.
 * A Single is one document, read by its slug for the id a release names it by.
 *
 * @module components/features/releases/useAddDocumentsSources
 */

import { useQueries, useQuery } from "@tanstack/react-query";

import { entryTitleValue } from "@admin/components/features/entries/entry-title";
import { useEveryNavCollection } from "@admin/hooks/queries/useCollections";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { entryApi } from "@admin/services/entryApi";
import { singleApi } from "@admin/services/singleApi";

import type { PickerDocument } from "./add-documents";

/** The documents read from each collection at once. */
const DOCUMENTS_PER_SCOPE = 20;

/** A collection or Single the picker may list documents from. */
export interface PickerScope {
  kind: "collection" | "single";
  slug: string;
  /** The collection's plural name, or the Single's label. */
  label: string;
  useAsTitle?: string;
}

/** What the picker is narrowed by. */
export interface PickerFilters {
  search: string;
  /** A scope's slug, or `null` for every one. */
  scope: string | null;
  pendingOnly: boolean;
}

/**
 * Whether a collection or Single read says it has a Draft/Published
 * lifecycle. The reads carry `status`, which the admin's list types do not
 * declare, so it is narrowed here rather than cast.
 */
function hasLifecycle(value: object): boolean {
  return "status" in value && value.status === true;
}

/** A document's status, where its row gives a recognised one. */
function statusOf(value: unknown): PickerDocument["status"] {
  return value === "draft" || value === "published" ? value : null;
}

/**
 * The scopes the reader may add documents from: those with a lifecycle, since
 * a release publishes or unpublishes, and of those the ones the reader may
 * publish or unpublish, either being enough to list it.
 */
function usePickerScopes(enabled: boolean): {
  scopes: PickerScope[];
  isPending: boolean;
  isError: boolean;
} {
  const { can } = useCurrentUserPermissions();
  const mayAct = (slug: string) =>
    can(`publish-${slug}`) || can(`unpublish-${slug}`);
  const collections = useEveryNavCollection();
  const singles = useQuery({
    queryKey: ["release-picker", "singles"],
    queryFn: () => singleApi.list(),
    enabled,
  });
  const scopes: PickerScope[] = [
    ...(collections.data ?? [])
      .filter(each => hasLifecycle(each) && mayAct(each.name))
      .map(each => ({
        kind: "collection" as const,
        slug: each.name,
        label: each.labels?.plural ?? each.label ?? each.name,
        useAsTitle: each.admin?.useAsTitle,
      })),
    ...(singles.data ?? [])
      .filter(each => hasLifecycle(each) && mayAct(each.slug))
      .map(each => ({
        kind: "single" as const,
        slug: each.slug,
        label: each.label || each.slug,
      })),
  ];
  return {
    scopes,
    isPending: enabled && (collections.isPending || singles.isPending),
    isError: collections.isError || singles.isError,
  };
}

/** The picker's documents, as the reads in scope answer them. */
export function useAddDocumentsSources(
  filters: PickerFilters,
  enabled: boolean
): {
  scopes: PickerScope[];
  documents: PickerDocument[];
  /** Labels of the collections that held more than were listed. */
  truncated: string[];
  /**
   * Whether Singles are listed whatever their changes, because "Has unpublished changes" is on
   * and a Single's read does not say whether it has any.
   */
  singlesUnfiltered: boolean;
  isPending: boolean;
  isError: boolean;
} {
  const all = usePickerScopes(enabled);
  const inScope = all.scopes.filter(
    each => filters.scope === null || each.slug === filters.scope
  );
  const search = filters.search.trim();
  const collections = inScope.filter(each => each.kind === "collection");
  // A Single's read says nothing of unpublished changes, so with that filter on Singles are
  // still listed, unfiltered, and the picker says so rather than hiding them.
  const singles = inScope.filter(each => each.kind === "single");

  const collectionReads = useQueries({
    queries: collections.map(scope => ({
      queryKey: [
        "release-picker",
        "collection",
        scope.slug,
        search,
        filters.pendingOnly,
      ],
      queryFn: () =>
        entryApi.find(scope.slug, {
          ...(search === "" ? {} : { search }),
          ...(filters.pendingOnly ? { where: { _pendingChange: true } } : {}),
          limit: DOCUMENTS_PER_SCOPE,
          depth: 0,
        }),
      enabled,
    })),
  });
  const singleReads = useQueries({
    queries: singles.map(scope => ({
      queryKey: ["release-picker", "single", scope.slug],
      queryFn: () => singleApi.getDocument(scope.slug, { depth: 0 }),
      enabled,
    })),
  });

  const documents: PickerDocument[] = [];
  const truncated: string[] = [];
  collections.forEach((scope, i) => {
    const read = collectionReads[i]?.data;
    if (!read) return;
    for (const entry of read.items) {
      const row = entry as Record<string, unknown>;
      documents.push({
        scopeKind: "collection",
        scopeSlug: scope.slug,
        entryId: String(row.id),
        title: entryTitleValue(row, scope.useAsTitle) ?? "Untitled",
        scopeLabel: scope.label,
        status: statusOf(row.status),
      });
    }
    if (read.meta.hasNext) truncated.push(scope.label);
  });
  singles.forEach((scope, i) => {
    const read = singleReads[i]?.data;
    // A Single is named by its label, and a search matches that label.
    if (!read || !scope.label.toLowerCase().includes(search.toLowerCase())) {
      return;
    }
    documents.push({
      scopeKind: "single",
      scopeSlug: scope.slug,
      entryId: read.id,
      title: scope.label,
      scopeLabel: scope.label,
      status: statusOf(read.status),
    });
  });

  const reads = [...collectionReads, ...singleReads];
  return {
    scopes: all.scopes,
    documents,
    truncated,
    singlesUnfiltered: filters.pendingOnly && singles.length > 0,
    isPending: all.isPending || (enabled && reads.some(read => read.isPending)),
    isError: all.isError || reads.some(read => read.isError),
  };
}
