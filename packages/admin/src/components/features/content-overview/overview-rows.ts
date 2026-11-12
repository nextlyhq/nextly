/**
 * What each row of the Content overview says beyond its name, read through
 * the same requests the admin's own pages make, so a row's numbers are the
 * numbers its page holds.
 *
 * - A collection's entries and its last edit: its list read, one entry long,
 *   newest edit first. Its total is the total the list shows.
 * - Its drafts: the list's Draft filter, counted, for a collection with the
 *   Draft / Published lifecycle; a collection without it has none to count.
 * - A Single's last edit, and who made it: its document's newest event, from
 *   the record its history reads.
 *
 * Each row asks for its own, so a row is drawn as soon as its answer is in,
 * and the cells of one row share one request.
 *
 * @module components/features/content-overview/overview-rows
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  eventActor,
  type StoryActor,
} from "@admin/components/features/versions/history-story-text";
import { entryApi } from "@admin/services/entryApi";
import { versionApi } from "@admin/services/versionApi";
import type { ApiCollection } from "@admin/types/entities";

/** How long a row's figures are reused before they are asked for again. */
const ROW_STALE_MS = 30_000;

/** A collection's row: its entries, its drafts, and when it was last edited. */
interface CollectionRowStats {
  total: number;
  /** The drafts, or `null` for a collection without the Draft / Published lifecycle. */
  drafts: number | null;
  /** The newest edit to any of its entries, or `null` with none. */
  lastEdited: string | null;
}

/** The list's own Draft filter, which the drafts link opens. */
const DRAFT_FILTER = { status: { equals: "draft" } };

export function useCollectionRowStats(
  collection: ApiCollection
): UseQueryResult<CollectionRowStats> {
  const slug = collection.name;
  const hasLifecycle = collection.status === true;
  return useQuery({
    queryKey: ["content-overview", "collection", slug, hasLifecycle],
    queryFn: async (): Promise<CollectionRowStats> => {
      const [newest, drafts] = await Promise.all([
        entryApi.find(slug, { limit: 1, sort: "-updatedAt", depth: 0 }),
        hasLifecycle
          ? entryApi.count(slug, { where: DRAFT_FILTER })
          : Promise.resolve(null),
      ]);
      const updatedAt = newest.items[0]?.updatedAt;
      return {
        total: newest.meta.total,
        drafts: drafts === null ? null : drafts.totalDocs,
        lastEdited: typeof updatedAt === "string" ? updatedAt : null,
      };
    },
    staleTime: ROW_STALE_MS,
  });
}

/** A Single's last edit, and who or what made it. */
interface SingleLastEdit {
  at: string;
  by: StoryActor;
}

export function useSingleLastEdit(
  slug: string
): UseQueryResult<SingleLastEdit | null> {
  return useQuery({
    queryKey: ["content-overview", "single", slug],
    queryFn: async (): Promise<SingleLastEdit | null> => {
      // A Single's address carries no document id: the server finds its one
      // document by the slug, so none is sent.
      const events = await versionApi.events(
        { kind: "single", slug, documentId: "" },
        { limit: 1 }
      );
      const newest = events.items[0];
      return newest === undefined
        ? null
        : { at: newest.occurredAt, by: eventActor(newest) };
    },
    staleTime: ROW_STALE_MS,
    // A Single never edited, or one whose record the server keeps from this
    // reader, says so in its row; asking again would not change that.
    retry: false,
  });
}
