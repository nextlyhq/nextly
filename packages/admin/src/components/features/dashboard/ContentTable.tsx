"use client";

/**
 * The dashboard's Content card: one compact table of the collections and Singles the reader may
 * see, answered by `system:content` in the dashboard's batch.
 *
 * A collection's row is its label, linking to its list; its Entries; its Drafts, by the
 * collection list's own Draft filter and linking to that filtered list ("—" for a collection
 * without the Draft / Published lifecycle); Updated, the row's own last update as a relative time,
 * with who saved it on hover where that is known; and a + to a new entry, drawn only where the server said the reader may create. A
 * Single's row says "Single" across the two counts and offers Edit in place of +.
 *
 * The rows come in the server's order (latest update first, collections holding no entries last),
 * and the card draws as many as its body holds, from the query it was asked at its size. The
 * server counted those rows and no others, and named how many there are in all, which is the
 * footer's "View all (N)" to the content index.
 *
 * A zero is drawn muted, never as large as a count, and an empty collection's whole row is muted,
 * so the eye lands on the rows with something in them.
 *
 * @module components/features/dashboard/ContentTable
 */

import { Button } from "@nextlyhq/ui";
import { Plus } from "lucide-react";
import type { ListDensity } from "nextly/config";
import type { WidgetComponentProps } from "nextly/widget-result";
import type { JSX } from "react";

import { answerTotal } from "@admin/components/features/widgets/archetypes/tiered-rows";
import { FrameState } from "@admin/components/features/widgets/frame/card-state";
import { CardFigure } from "@admin/components/features/widgets/frame/figure";
import {
  TABLE_CLASS,
  TABLE_HEAD_ROW_CLASS,
  TABLE_HEADING_CLASS,
  TABLE_ROW_CLASS,
  TABLE_ROW_HEIGHT_CLASS,
} from "@admin/components/features/widgets/frame/geometry";
import {
  ListFooter,
  listFooter,
} from "@admin/components/features/widgets/frame/list-card";
import { useListCard } from "@admin/components/features/widgets/frame/list-slot";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import {
  describeActivityActor,
  formatRelativeTime,
} from "@admin/lib/dashboard";
import { cn } from "@admin/lib/utils";

/** When a row was last updated, and who saved it when the trail names them. */
interface ContentSave {
  at: string;
  /** Who saved it, as the activity feed names them; empty when nobody is named. */
  by: string;
}

/** One row of the table, read from the answer. */
type ContentRow =
  | {
      kind: "collection";
      slug: string;
      label: string;
      count: number;
      /** The drafts, or `null` for a collection without the Draft / Published lifecycle. */
      draft: number | null;
      canCreate: boolean;
      save?: ContentSave;
    }
  | { kind: "single"; slug: string; label: string; save?: ContentSave };

/** `value` when it is a non-empty string, so a number, null or "" reads as absent. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The row's last update, when the answer carries one this build can read. The date is the row's
 * own; who saved it is named only where the answer names them, and its absence never hides the
 * date.
 */
function saveOf(row: Record<string, unknown>): ContentSave | undefined {
  const at = text(row.updatedAt);
  if (at === undefined) return undefined;
  const userId = text(row.userId);
  if (userId === undefined) return { at, by: "" };
  // The feed's own naming, so a deleted account or an API key reads here as it does there.
  const by = describeActivityActor({
    userId,
    userName: text(row.userName) ?? null,
    userEmail: null,
    identityErasedAt: text(row.identityErasedAt) ?? null,
    actorType: text(row.actorType) ?? null,
  }).name;
  return { at, by };
}

/**
 * One row of the answer as the table draws it, or `undefined` for a row this build cannot read.
 * Read field by field, because a widget answer is JSON and its type says nothing at runtime.
 */
function contentRowOf(row: Record<string, unknown>): ContentRow | undefined {
  const slug = text(row.slug);
  const label = text(row.label);
  if (slug === undefined || label === undefined) return undefined;
  const save = saveOf(row);
  const saved = save === undefined ? {} : { save };
  if (row.kind === "single") return { kind: "single", slug, label, ...saved };
  if (row.kind !== "collection" || typeof row.count !== "number") {
    return undefined;
  }
  return {
    kind: "collection",
    slug,
    label,
    count: row.count,
    draft: typeof row.draft === "number" ? row.draft : null,
    // Only an explicit yes draws a +: the server decides, and anything else is a refusal.
    canCreate: row.canCreate === true,
    ...saved,
  };
}

/** A count, muted when it is zero. */
function Count({ value }: { value: number }): JSX.Element {
  return (
    <span
      data-zero={value === 0 ? "true" : undefined}
      className={value === 0 ? "text-muted-foreground" : "font-medium"}
    >
      <CardFigure value={value} />
    </span>
  );
}

/** A collection's Drafts cell: "—" without the lifecycle, else the count, linked when non-zero. */
function Drafts({
  slug,
  label,
  draft,
}: {
  slug: string;
  label: string;
  draft: number | null;
}): JSX.Element {
  if (draft === null) {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">No drafts</span>
      </span>
    );
  }
  if (draft === 0) return <Count value={0} />;
  // The list's own `?status=draft`, the filter these drafts were counted by.
  const href = `${buildRoute(ROUTES.COLLECTION_ENTRIES, { slug })}?${new URLSearchParams({ status: "draft" }).toString()}`;
  return (
    <Link
      href={href}
      aria-label={`${draft} drafts in ${label}`}
      className="font-medium text-foreground hover:underline"
    >
      <CardFigure value={draft} />
    </Link>
  );
}

/**
 * The Updated cell: the relative time, with who saved it and the exact instant in the admin's
 * time zone on hover; "—" when no save is known.
 */
function Updated({
  save,
  now,
}: {
  save: ContentSave | undefined;
  now: number;
}): JSX.Element {
  if (save === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  const instant = formatDateWithAdminTimezone(save.at, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return (
    <time
      dateTime={save.at}
      title={save.by === "" ? instant : `Saved by ${save.by}, ${instant}`}
      className="text-muted-foreground"
    >
      {formatRelativeTime(save.at, now)}
    </time>
  );
}

/** A row's one action: + to a new entry where the reader may create, or a Single's Edit. */
function RowAction({ row }: { row: ContentRow }): JSX.Element | null {
  if (row.kind === "single") {
    return (
      <Button asChild size="sm" variant="outline" className="h-7">
        <Link
          href={buildRoute(ROUTES.SINGLE_EDIT, { slug: row.slug })}
          aria-label={`Edit ${row.label}`}
        >
          Edit
        </Link>
      </Button>
    );
  }
  if (!row.canCreate) return null;
  return (
    <Button asChild size="icon" variant="outline" className="size-7">
      <Link
        href={buildRoute(ROUTES.COLLECTION_ENTRY_CREATE, { slug: row.slug })}
        aria-label={`New entry in ${row.label}`}
      >
        <Plus className="size-4" aria-hidden="true" />
      </Link>
    </Button>
  );
}

/** The table's rows: the label, Entries, Drafts, Updated and the row's action, in that order. */
function ContentRows({
  rows,
  density,
  now,
}: {
  rows: readonly ContentRow[];
  density: ListDensity;
  now: number;
}): JSX.Element {
  const numberCell = "w-px whitespace-nowrap pr-4 text-right align-middle";
  return (
    <table data-testid="content-table" className={TABLE_CLASS}>
      <thead>
        <tr className={TABLE_HEAD_ROW_CLASS}>
          <th
            scope="col"
            className={cn(TABLE_HEADING_CLASS, "w-full text-muted-foreground")}
          >
            Collection
          </th>
          {["Entries", "Drafts"].map(heading => (
            <th
              key={heading}
              scope="col"
              className={cn(
                TABLE_HEADING_CLASS,
                "w-px whitespace-nowrap text-right text-muted-foreground"
              )}
            >
              {heading}
            </th>
          ))}
          <th
            scope="col"
            className={cn(
              TABLE_HEADING_CLASS,
              "w-px whitespace-nowrap text-muted-foreground"
            )}
          >
            Updated
          </th>
          <th scope="col" className="w-px pb-1.5">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => {
          // A collection and a Single may share a slug, so the kind is part of the key.
          const key = `${row.kind}:${row.slug}`;
          const empty = row.kind === "collection" && row.count === 0;
          const href =
            row.kind === "single"
              ? buildRoute(ROUTES.SINGLE_EDIT, { slug: row.slug })
              : buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: row.slug });
          return (
            <tr
              key={key}
              data-testid="content-table-row"
              data-empty={empty ? "true" : undefined}
              className={cn(TABLE_ROW_CLASS, TABLE_ROW_HEIGHT_CLASS[density])}
            >
              {/* `max-w-0` lets the label shorten with "…" rather than push the columns. */}
              <td className="w-full max-w-0 pr-4 align-middle">
                <Link
                  href={href}
                  className={cn(
                    "block truncate hover:underline",
                    empty
                      ? "text-muted-foreground"
                      : "font-medium text-foreground"
                  )}
                >
                  {row.label}
                </Link>
              </td>
              {row.kind === "single" ? (
                <td
                  colSpan={2}
                  className={cn(numberCell, "text-muted-foreground")}
                >
                  Single
                </td>
              ) : (
                <>
                  <td className={numberCell}>
                    <Count value={row.count} />
                  </td>
                  <td className={numberCell}>
                    <Drafts
                      slug={row.slug}
                      label={row.label}
                      draft={row.draft}
                    />
                  </td>
                </>
              )}
              <td className="w-px whitespace-nowrap pr-4 align-middle">
                <Updated save={row.save} now={now} />
              </td>
              <td className="w-px whitespace-nowrap align-middle">
                <div className="flex justify-end">
                  <RowAction row={row} />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ContentTable(props: WidgetComponentProps): JSX.Element {
  const { drawn, density, now, read } = useListCard(props);
  if ("node" in read) return read.node;
  // A row this build cannot read is left out rather than drawn from guesses.
  const rows = read.list.items.flatMap(item => {
    const row = contentRowOf(item);
    return row === undefined ? [] : [row];
  });
  if (rows.length === 0) {
    return (
      <FrameState
        state={{
          kind: "empty",
          empty: {
            title: "No content to show",
            detail: "Collections and Singles you may read show here.",
          },
        }}
      />
    );
  }
  const shown = rows.slice(0, drawn);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ContentRows rows={shown} density={density} now={now} />
      {/* The content index, with how many there are in all when the table draws fewer. */}
      <ListFooter
        footer={listFooter(rows.length, shown.length, answerTotal(read.list))}
        href={ROUTES.COLLECTIONS}
      />
    </div>
  );
}

ContentTable.displayName = "ContentTable";
