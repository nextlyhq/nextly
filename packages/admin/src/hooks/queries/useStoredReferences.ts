"use client";

/**
 * The document an editor edits, with every stored link kept.
 *
 * The edit page's populated read leaves out a related row or a media item the
 * editor may not read, or one that no longer exists, and the form saves the
 * whole document back. So the page also reads the document at depth 0, which
 * gives every link as stored, and edits the two merged: each link the editor
 * cannot see becomes a placeholder it can remove but not open
 * (`lib/form/stored-references`).
 *
 * The two reads are separate requests, so the merge is only made from a pair
 * that describes one version of the document. Until a pair settles, the last
 * merge is kept: while a save is in flight, or a read is refetching, one read
 * can be newer than the other, and a merge of the two would put back a link
 * the save just removed, and the form would be reset to it.
 *
 * @module hooks/queries/useStoredReferences
 */

import {
  useIsMutating,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { FieldConfig } from "nextly/config";
import { useEffect, useRef } from "react";

import { withStoredReferences } from "@admin/lib/form/stored-references";
import { entryApi, entryKeys } from "@admin/services/entryApi";
import { singleApi } from "@admin/services/singleApi";

import { singleDocumentKeys } from "./useSingles";

type Doc = Record<string, unknown>;

/**
 * The depth-0 read is keyed under the document's own detail key, so whatever
 * invalidates that document after a save refetches this read with it.
 */
const STORED_REFERENCES = "stored-references";

/** Which document, in which language and view, the editor is reading. */
interface ReadScope {
  locale?: string;
  fallbackLocale?: string;
  draft?: boolean;
}

/** A collection entry read at depth 0, as the edit page reads it otherwise. */
export function useStoredEntry({
  collectionSlug,
  entryId,
  locale,
  fallbackLocale,
  draft,
}: ReadScope & {
  collectionSlug?: string;
  entryId?: string;
}): UseQueryResult<Doc, Error> {
  return useQuery<Doc, Error>({
    queryKey: [
      ...entryKeys.detailScoped(collectionSlug ?? "", entryId ?? "", {
        locale,
        fallbackLocale,
        draft,
      }),
      STORED_REFERENCES,
    ],
    queryFn: async () => {
      if (!collectionSlug || !entryId) {
        throw new Error("Collection and entry ID are required");
      }
      return await entryApi.findByID(collectionSlug, entryId, {
        depth: 0,
        ...(locale ? { locale } : {}),
        ...(fallbackLocale ? { fallbackLocale } : {}),
        ...(draft !== undefined ? { draft } : {}),
      });
    },
    enabled: !!collectionSlug && !!entryId,
    staleTime: 60_000,
  });
}

/** A Single read at depth 0, as the Single editor reads it otherwise. */
export function useStoredSingleDocument(
  slug: string | undefined,
  { locale, fallbackLocale, draft }: ReadScope
): UseQueryResult<Doc, Error> {
  return useQuery<Doc, Error>({
    queryKey: [
      ...singleDocumentKeys.detail(slug ?? ""),
      {
        locale: locale ?? null,
        fallbackLocale: fallbackLocale ?? null,
        draft: draft ?? false,
      },
      STORED_REFERENCES,
    ],
    queryFn: async () => {
      if (!slug) throw new Error("Single slug is required");
      return await singleApi.getDocument(slug, {
        depth: 0,
        locale,
        fallbackLocale,
        draft,
      });
    },
    enabled: !!slug,
  });
}

/** The version a read describes. */
function versionOf(doc: Doc): string {
  const value = doc.updatedAt ?? doc.updated_at;
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return value instanceof Date ? value.toISOString() : "";
}

/** How many times reads that disagree are refetched before giving up. */
const MAX_RECONCILE_ATTEMPTS = 3;

interface Merge<T> {
  scope: string;
  populated: T;
  stored: Doc;
  fields: FieldConfig[];
  document: T;
}

export interface StoredReferencesResult<T> {
  /** The populated document with every stored link kept. */
  document: T | undefined;
  isLoading: boolean;
  error: Error | null;
}

/** The two reads, when both are in hand and nothing is about to replace either. */
interface SettledPair<T> {
  populated: T;
  stored: Doc;
  fields: FieldConfig[];
}

/**
 * The reads as a pair to merge, or `null` while either is missing or being
 * fetched, or a save is in flight: one of them is then about to change.
 */
function settledPair<T extends Doc>(
  fields: FieldConfig[] | undefined,
  populated: UseQueryResult<T, Error>,
  stored: UseQueryResult<Doc, Error>,
  saving: boolean
): SettledPair<T> | null {
  if (fields === undefined || saving) return null;
  if (populated.isFetching || stored.isFetching) return null;
  if (populated.data === undefined || stored.data === undefined) return null;
  return { populated: populated.data, stored: stored.data, fields };
}

/** Whether `merge` was made from exactly this pair, in this scope. */
function isMergeOf<T>(
  merge: Merge<T> | null,
  pair: SettledPair<T>,
  scope: string
): boolean {
  return (
    merge !== null &&
    merge.scope === scope &&
    merge.populated === pair.populated &&
    merge.stored === pair.stored &&
    merge.fields === pair.fields
  );
}

/**
 * Merges the populated read with the depth-0 read once both have settled on
 * the same version of the document.
 *
 * `scope` names the document and the view it is read in, such as its id and
 * language: a merge made for another scope is never returned for this one, so
 * switching language shows loading rather than the previous language's values.
 */
export function useWithStoredReferences<T extends Doc>({
  fields,
  populated,
  stored,
  scope,
}: {
  fields: FieldConfig[] | undefined;
  populated: UseQueryResult<T, Error>;
  stored: UseQueryResult<Doc, Error>;
  scope: string;
}): StoredReferencesResult<T> {
  const saving = useIsMutating() > 0;
  const last = useRef<Merge<T> | null>(null);
  const attempts = useRef(0);

  const pair = settledPair(fields, populated, stored, saving);
  const agree =
    pair !== null && versionOf(pair.populated) === versionOf(pair.stored);
  // A cached merge for exactly these inputs is reused, so the document keeps
  // its identity across renders and the form is not reset by a re-render.
  if (agree && !isMergeOf(last.current, pair, scope)) {
    last.current = {
      scope,
      ...pair,
      document: withStoredReferences(pair.fields, pair.populated, pair.stored),
    };
    attempts.current = 0;
  }

  // Settled reads of two versions: something changed the document between
  // them. Read both again rather than wait for a refetch nothing schedules.
  const disagree = pair !== null && !agree;
  const { refetch: refetchPopulated } = populated;
  const { refetch: refetchStored } = stored;
  useEffect(() => {
    if (!disagree || attempts.current >= MAX_RECONCILE_ATTEMPTS) return;
    attempts.current += 1;
    void refetchPopulated();
    void refetchStored();
  }, [disagree, refetchPopulated, refetchStored]);

  const document =
    last.current?.scope === scope ? last.current.document : undefined;
  // Still apart after every retry: the document keeps changing under the
  // editor. Saying so beats a form that never opens, or one merged from two
  // versions.
  const gaveUp =
    document === undefined &&
    disagree &&
    attempts.current >= MAX_RECONCILE_ATTEMPTS;
  const error =
    populated.error ??
    stored.error ??
    (gaveUp
      ? new Error(
          "This document kept changing while it loaded. Reload the page to edit it."
        )
      : null);
  return { document, isLoading: document === undefined && !error, error };
}
