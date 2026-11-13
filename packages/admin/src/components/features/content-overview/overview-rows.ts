/**
 * What each row of the Content overview says beyond its name, read in ONE
 * request for the whole page: `GET /api/dashboard/content` answers every
 * collection's and Single's row for the reader, counted on the server through
 * the access-enforced count, so the page costs the same request whether the
 * site has three collections or three hundred.
 *
 * - A collection's entries, its drafts (the list's Draft filter, none without
 *   the Draft / Published lifecycle) and its last edit.
 * - A Single's last edit, and who made it, as the activity trail names them.
 *
 * The answer is JSON from the server, so each row is read through a schema
 * and a row this build cannot read is left out rather than trusted: its
 * cells then say they have nothing, as a row the answer lacks does.
 *
 * @module components/features/content-overview/overview-rows
 */
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { protectedApi } from "@admin/lib/api/protectedApi";
import { describeActivityActor } from "@admin/lib/dashboard";
import type { ApiCollection } from "@admin/types/entities";

/**
 * Where the overview's rows are read, and the cache entry they are kept under:
 * under the dashboard's key, so a write to an entry, which refreshes the
 * dashboard (`hooks/queries/entry-cache`), refreshes the overview's figures
 * with it.
 */
const CONTENT_OVERVIEW_PATH = "/dashboard/content";
const CONTENT_OVERVIEW_KEY = ["dashboard", "content-overview"] as const;

/** How long the rows are reused before they are asked for again. */
const ROWS_STALE_MS = 30_000;

const optionalText = z.string().min(1).optional().catch(undefined);

/** One row of the answer, as far as the overview reads it. */
const rowSchema = z.object({
  kind: z.enum(["collection", "single"]),
  slug: z.string().min(1),
  count: z.number().int().nonnegative().optional().catch(undefined),
  draft: z.number().int().nonnegative().nullable().optional().catch(undefined),
  updatedAt: optionalText,
  userId: optionalText,
  userName: optionalText,
  actorType: optionalText,
  identityErasedAt: optionalText,
});

type OverviewRow = z.infer<typeof rowSchema>;

/** A row's place in the answer: a collection and a Single may share a slug. */
function rowKey(kind: OverviewRow["kind"], slug: string): string {
  return `${kind}:${slug}`;
}

async function fetchOverviewRows(): Promise<ReadonlyMap<string, OverviewRow>> {
  const body = await protectedApi.get<{ rows?: unknown }>(
    CONTENT_OVERVIEW_PATH
  );
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const byKey = new Map<string, OverviewRow>();
  for (const candidate of rows) {
    const parsed = rowSchema.safeParse(candidate);
    if (parsed.success) {
      byKey.set(rowKey(parsed.data.kind, parsed.data.slug), parsed.data);
    }
  }
  return byKey;
}

/** The page's rows, one request shared by every cell that reads them. */
function useOverviewRow(
  kind: OverviewRow["kind"],
  slug: string
): { isPending: boolean; row: OverviewRow | undefined } {
  const rows = useQuery({
    queryKey: CONTENT_OVERVIEW_KEY,
    queryFn: fetchOverviewRows,
    staleTime: ROWS_STALE_MS,
  });
  return { isPending: rows.isPending, row: rows.data?.get(rowKey(kind, slug)) };
}

/** A collection's row: its entries, its drafts, and when it was last edited. */
interface CollectionRowStats {
  total: number;
  /** The drafts, or `null` for a collection without the Draft / Published lifecycle. */
  drafts: number | null;
  /** The last edit to any of its entries, or `null` with none. */
  lastEdited: string | null;
}

export function useCollectionRowStats(collection: ApiCollection): {
  isPending: boolean;
  data: CollectionRowStats | undefined;
} {
  const { isPending, row } = useOverviewRow("collection", collection.name);
  return {
    isPending,
    data:
      row?.count === undefined
        ? undefined
        : {
            total: row.count,
            drafts: row.draft ?? null,
            lastEdited: row.updatedAt ?? null,
          },
  };
}

/** A Single's last edit, and who made it where the trail names them. */
interface SingleLastEdit {
  at: string;
  /** Who made it, as the activity feed names them; absent when nobody is named. */
  by: string | undefined;
}

export function useSingleLastEdit(slug: string): {
  isPending: boolean;
  data: SingleLastEdit | undefined;
} {
  const { isPending, row } = useOverviewRow("single", slug);
  if (row?.updatedAt === undefined) return { isPending, data: undefined };
  // The feed's own naming, so an API key or a removed account reads here as
  // it reads on the dashboard.
  const by =
    row.userId === undefined
      ? undefined
      : describeActivityActor({
          userId: row.userId,
          userName: row.userName ?? null,
          userEmail: null,
          identityErasedAt: row.identityErasedAt ?? null,
          actorType: row.actorType ?? null,
        }).name;
  return { isPending, data: { at: row.updatedAt, by } };
}
