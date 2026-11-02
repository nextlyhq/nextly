"use client";

/**
 * The dashboard's Content card: one compact table of the collections and Singles the reader may
 * see, drawn from the rows its `load` read from `system:content`. The frame drew loading, no
 * permission and error before this is reached.
 *
 * A collection's row is its name, linking to its list; its Entries; its Drafts, by the collection
 * list's own Draft filter and linking to that filtered list ("—" for a collection without the
 * Draft / Published lifecycle); Updated, its last change as a relative time, with who made it and
 * what they did on hover where that is known; and a + to a new entry, drawn only where the server
 * said the reader may create. A Single's row says "Single" across the two counts and offers Edit
 * where the reader may update it, or View where they may only read it, in place of +.
 *
 * How much the card draws follows its width:
 * - from a medium card up, the table, every column;
 * - a narrow medium card (`NARROW_TABLE_BELOW_PX`) keeps the table, every column, but draws
 *   Updated short ("5m") and each row's action smaller (+ as a smaller icon button named
 *   "Create Post", Edit or View in smaller type), so the name keeps its room and creating stays
 *   one click away on the row;
 * - a small card stacks each row, the name on its own line and the counts and Updated under it.
 *
 * The header's subtitle says how many collections and Singles the reader may see in all ("8
 * collections · 5 Singles"). The rows come in the server's order (latest update first, collections
 * holding no entries last), and the card draws as many as its body holds, by the rule its `load`
 * asked them by at its size, with no footer: the admin has no page listing the collections to link to
 * (`/admin/collections` only redirects to one collection's entries), and the subtitle already
 * says how many there are. The server counted the rows drawn and no others.
 *
 * Every row is the frame's list row height, in the table as in the stacked form, so the rows the
 * card's size is counted for (`rowsDrawn`) fill its body.
 *
 * A zero is drawn muted, never as large as a count, and an empty collection's whole row is muted,
 * so the eye lands on the rows with something in them.
 *
 * @module components/features/dashboard/ContentTable
 */

import { Button } from "@nextlyhq/ui";
import type { SizeTier } from "@nextlyhq/ui/format";
import { Plus } from "lucide-react";
import { CARD_FRAME_PX } from "nextly/card-geometry";
import { MAX_WIDGET_ROWS, type ListDensity } from "nextly/config";
import type { CoreListWidgetData } from "nextly/core-widget-data";
import type {
  ActivityEvent,
  DeclaredComponentProps,
} from "nextly/widget-result";
import { Fragment, useMemo, useState, type JSX, type ReactNode } from "react";

import { FrameState } from "@admin/components/features/widgets/frame/card-state";
import { CardFigure } from "@admin/components/features/widgets/frame/figure";
import {
  LIST_CLASS,
  LIST_ROW_HEIGHT_CLASS,
  TABLE_CLASS,
  TABLE_HEAD_ROW_CLASS,
  TABLE_HEADING_CLASS,
  TABLE_ROW_CLASS,
} from "@admin/components/features/widgets/frame/geometry";
import { useCardSubtitle } from "@admin/components/features/widgets/frame/header-subtitle";
import { useListCard } from "@admin/components/features/widgets/frame/list-card-hook";
import { useMeasuredWidth } from "@admin/components/shared/preview/useMeasuredWidth";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import {
  describeActivityActor,
  formatRelativeTime,
} from "@admin/lib/dashboard";
import { cn } from "@admin/lib/utils";

/**
 * Below this outer width a medium card's table is narrow: Updated is drawn short and each row's
 * action smaller.
 *
 * The columns beside the name take about 250 px at full width (Entries and Drafts with their
 * headings, Updated as "Mar 12, 2026", and the Edit button, each with its gap), and the card's
 * frame takes 34 px; under 450 px that leaves the name less than about 150 px, some 20
 * characters, which a collection's name often runs past. Narrow, Updated and the action give
 * back about 60 px of that. So a card on a phone (about 342 px) is
 * narrow, and the default half-width card on a desktop (516 px at 1440, 632 px at 1024) is not.
 * In the frame's own unit, the card's outer width, as its size tier (`tierForWidth`) is read.
 */
const NARROW_TABLE_BELOW_PX = 450;

/** What the card's frame draws on each side of its body: its border and its padding. */
const FRAME_SIDES_PX = 2 * (CARD_FRAME_PX.border + CARD_FRAME_PX.padding);

/**
 * The table's heading line, 14 px: the rows are the frame's 52 px list rows, and four of them
 * leave a 6 × 4 card's 222 px body 14 px, so the heading takes that and no row is lost to it.
 */
const HEADING_CLASS = cn(TABLE_HEADING_CLASS, "pb-0.5 leading-3");

/** How the card draws its rows at its size; see the module's note. */
type ContentForm = "table" | "narrow-table" | "stacked";

/** When a row was last changed, and who did what, when the trail names them. */
interface ContentSave {
  at: string;
  /** Who made the change, as the activity feed names them; empty when nobody is named. */
  by: string;
  /** What they did, where the answer says. */
  event?: ActivityEvent;
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
      /** What one entry is called ("Post"); the label where the answer does not say. */
      singular: string;
      save?: ContentSave;
    }
  | {
      kind: "single";
      slug: string;
      label: string;
      /** Whether the reader may update it; it opens read-only where they may not. */
      canUpdate: boolean;
      save?: ContentSave;
    };

/**
 * How the hover names the change, for each event the server may name: an event added to the
 * server's closed set fails to compile here until it has its words.
 */
const EVENT_WORDS = {
  created: "Created",
  saved: "Saved",
  published: "Published",
  unpublished: "Unpublished",
  deleted: "Deleted",
} as const satisfies Record<ActivityEvent, string>;

/** `value` when it is a non-empty string, so a number, null or "" reads as absent. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Whether `value` is one of the events the server names. */
function isActivityEvent(value: unknown): value is ActivityEvent {
  return typeof value === "string" && Object.hasOwn(EVENT_WORDS, value);
}

/**
 * The row's last change, when the answer carries one this build can read. The instant and the
 * name come from the same change on the server; who made it is named only where the answer
 * names them, and its absence never hides the date.
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
  const event = row.event;
  return isActivityEvent(event) ? { at, by, event } : { at, by };
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
  // Only an explicit yes offers a change: the server decides, and anything else is a refusal.
  if (row.kind === "single") {
    return {
      kind: "single",
      slug,
      label,
      canUpdate: row.canUpdate === true,
      ...saved,
    };
  }
  if (row.kind !== "collection" || typeof row.count !== "number") {
    return undefined;
  }
  return {
    kind: "collection",
    slug,
    label,
    singular: text(row.singularLabel) ?? label,
    count: row.count,
    draft: typeof row.draft === "number" ? row.draft : null,
    canCreate: row.canCreate === true,
    ...saved,
  };
}

/** "8 collections · 5 Singles", from how the answer's total divides; nothing it does not say. */
function contentSubtitle(
  totalByKind: Readonly<Record<string, number>> | undefined
): string | undefined {
  const parts = [
    counted(totalByKind?.collection, "collection", "collections"),
    counted(totalByKind?.single, "Single", "Singles"),
  ].filter(part => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/** "1 collection", "8 collections"; nothing for none, a kind the answer leaves out included. */
function counted(
  value: number | undefined,
  one: string,
  many: string
): string | undefined {
  if (value === undefined || value <= 0) return undefined;
  return `${value} ${value === 1 ? one : many}`;
}

/** The form a card draws at its tier and, where measured, its body's width. */
function formAt(tier: SizeTier, bodyWidth: number | null): ContentForm {
  if (tier === "small") return "stacked";
  if (tier === "large" || bodyWidth === null) return "table";
  return bodyWidth + FRAME_SIDES_PX < NARROW_TABLE_BELOW_PX
    ? "narrow-table"
    : "table";
}

/** Where a row's name leads: a collection's list, or a Single's editor. */
function rowHref(row: ContentRow): string {
  return row.kind === "single"
    ? buildRoute(ROUTES.SINGLE_EDIT, { slug: row.slug })
    : buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: row.slug });
}

/** Whether a row is a collection holding nothing, whose whole row is drawn muted. */
function isEmptyRow(row: ContentRow): boolean {
  return row.kind === "collection" && row.count === 0;
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

/** A collection's drafts: the count, linked to the list's Draft filter when it is not zero. */
function DraftCount({
  slug,
  label,
  draft,
}: {
  slug: string;
  label: string;
  draft: number;
}): JSX.Element {
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

/** A collection's Drafts cell: "—" without the lifecycle, else its drafts. */
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
  return <DraftCount slug={slug} label={label} draft={draft} />;
}

/** The hover's words for a change: what was done, by whom where named, and when exactly. */
function changeTitle(save: ContentSave, instant: string): string {
  if (save.by === "") return instant;
  return `${EVENT_WORDS[save.event ?? "saved"]} by ${save.by}, ${instant}`;
}

/**
 * A change's relative time, short in a narrow table, with who made it and the exact instant in
 * the admin's zone on hover.
 */
function UpdatedTime({
  save,
  now,
  short = false,
}: {
  save: ContentSave;
  now: number;
  short?: boolean;
}): JSX.Element {
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
      title={changeTitle(save, instant)}
      className="text-muted-foreground"
    >
      {formatRelativeTime(save.at, now, short ? "short" : "long")}
    </time>
  );
}

/**
 * A row's one action: + to a new entry where the reader may create, or a Single's Edit where
 * they may update it and View where they may only read it. Edit and View open the same page,
 * which is read-only for a reader who may not update. In a narrow table each is drawn smaller,
 * the + an icon named for the entry it creates ("Create Post"), so the name keeps its room.
 */
function RowAction({
  row,
  narrow = false,
}: {
  row: ContentRow;
  narrow?: boolean;
}): JSX.Element | null {
  if (row.kind === "single") {
    const verb = row.canUpdate ? "Edit" : "View";
    return (
      <Button
        asChild
        size="sm"
        variant="outline"
        className={narrow ? "h-6 px-2 text-xs" : "h-7"}
      >
        <Link
          href={buildRoute(ROUTES.SINGLE_EDIT, { slug: row.slug })}
          aria-label={`${verb} ${row.label}`}
        >
          {verb}
        </Link>
      </Button>
    );
  }
  if (!row.canCreate) return null;
  return (
    <Button
      asChild
      size="icon"
      variant="outline"
      className={narrow ? "size-6" : "size-7"}
    >
      <Link
        href={buildRoute(ROUTES.COLLECTION_ENTRY_CREATE, { slug: row.slug })}
        aria-label={
          narrow ? `Create ${row.singular}` : `New entry in ${row.label}`
        }
      >
        <Plus className={narrow ? "size-3.5" : "size-4"} aria-hidden="true" />
      </Link>
    </Button>
  );
}

/** A row's name, linking to its list or Single, muted for an empty collection. */
function RowName({
  row,
  className,
}: {
  row: ContentRow;
  className?: string;
}): JSX.Element {
  return (
    <Link
      href={rowHref(row)}
      className={cn(
        "block truncate hover:underline",
        isEmptyRow(row)
          ? "text-muted-foreground"
          : "font-medium text-foreground",
        className
      )}
    >
      {row.label}
    </Link>
  );
}

/** The table's heading row: Name, Entries, Drafts, Updated, and the actions. */
function ContentHeadings(): JSX.Element {
  return (
    <thead>
      <tr className={TABLE_HEAD_ROW_CLASS}>
        <th
          scope="col"
          className={cn(HEADING_CLASS, "w-full text-muted-foreground")}
        >
          Name
        </th>
        {["Entries", "Drafts"].map(heading => (
          <th
            key={heading}
            scope="col"
            className={cn(
              HEADING_CLASS,
              "w-px whitespace-nowrap text-right text-muted-foreground"
            )}
          >
            {heading}
          </th>
        ))}
        <th
          scope="col"
          className={cn(
            HEADING_CLASS,
            "w-px whitespace-nowrap text-muted-foreground"
          )}
        >
          Updated
        </th>
        <th scope="col" className="w-px pb-0.5">
          <span className="sr-only">Actions</span>
        </th>
      </tr>
    </thead>
  );
}

/** A row's two count cells, or "Single" across both, centred so it reads as standing in for them. */
function CountCells({ row }: { row: ContentRow }): JSX.Element {
  const numberCell = "w-px whitespace-nowrap pr-4 text-right align-middle";
  if (row.kind === "single") {
    return (
      <td
        colSpan={2}
        className="w-px whitespace-nowrap pr-4 text-center align-middle text-muted-foreground"
      >
        Single
      </td>
    );
  }
  return (
    <>
      <td className={numberCell}>
        <Count value={row.count} />
      </td>
      <td className={numberCell}>
        <Drafts slug={row.slug} label={row.label} draft={row.draft} />
      </td>
    </>
  );
}

/**
 * The table: Name, Entries, Drafts, Updated and the action, narrow with Updated short and the
 * action smaller. Each row is the frame's list row height.
 */
function ContentTableForm({
  rows,
  density,
  now,
  narrow,
}: {
  rows: readonly ContentRow[];
  density: ListDensity;
  now: number;
  narrow: boolean;
}): JSX.Element {
  return (
    <table
      data-testid="content-table"
      data-narrow={narrow ? "true" : undefined}
      className={TABLE_CLASS}
    >
      <ContentHeadings />
      <tbody>
        {rows.map(row => (
          // A collection and a Single may share a slug, so the kind is part of the key.
          <tr
            key={`${row.kind}:${row.slug}`}
            data-testid="content-table-row"
            data-empty={isEmptyRow(row) ? "true" : undefined}
            className={cn(TABLE_ROW_CLASS, LIST_ROW_HEIGHT_CLASS[density])}
          >
            {/* `max-w-0` lets the label shorten with "…" rather than push the columns. */}
            <td className="w-full max-w-0 pr-4 align-middle">
              <RowName row={row} />
            </td>
            <CountCells row={row} />
            <td className="w-px whitespace-nowrap pr-4 align-middle">
              {row.save === undefined ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <UpdatedTime save={row.save} now={now} short={narrow} />
              )}
            </td>
            <td className="w-px whitespace-nowrap align-middle">
              <div className="flex justify-end">
                <RowAction row={row} narrow={narrow} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A stacked row's detail line, in the table's column order: the entries and the drafts, or
 * "Single" in their place, then Updated. A collection without the lifecycle has no drafts to
 * name, and a row with no known change no time.
 */
function rowDetails(row: ContentRow, now: number): ReactNode[] {
  const updated =
    row.save === undefined
      ? []
      : [<UpdatedTime key="updated" save={row.save} now={now} />];
  if (row.kind === "single") return ["Single", ...updated];
  const entries = (
    <Fragment key="entries">
      <Count value={row.count} /> {row.count === 1 ? "entry" : "entries"}
    </Fragment>
  );
  const drafts =
    row.draft === null
      ? []
      : [
          <Fragment key="drafts">
            <DraftCount slug={row.slug} label={row.label} draft={row.draft} />{" "}
            {row.draft === 1 ? "draft" : "drafts"}
          </Fragment>,
        ];
  return [entries, ...drafts, ...updated];
}

/**
 * The small card's form: one row per item at the frame's list row height, the name on the first
 * line and the details on the second (after the name, on one line, when compact).
 */
function ContentListForm({
  rows,
  density,
  now,
}: {
  rows: readonly ContentRow[];
  density: ListDensity;
  now: number;
}): JSX.Element {
  const compact = density === "compact";
  return (
    <ul data-testid="content-list" className={LIST_CLASS}>
      {rows.map(row => (
        <li
          key={`${row.kind}:${row.slug}`}
          data-testid="content-table-row"
          data-empty={isEmptyRow(row) ? "true" : undefined}
          className={cn(
            "flex min-w-0 items-center gap-2",
            LIST_ROW_HEIGHT_CLASS[density]
          )}
        >
          <div
            className={cn(
              "flex min-w-0 flex-1",
              compact ? "items-baseline gap-2" : "flex-col justify-center"
            )}
          >
            <RowName row={row} className="text-sm" />
            <span
              data-testid="content-row-details"
              className="truncate text-xs text-muted-foreground"
            >
              {rowDetails(row, now).map((detail, index) => (
                // The position, because the line is replaced whole and holds no state.
                <Fragment key={index}>
                  {index > 0 && " · "}
                  {detail}
                </Fragment>
              ))}
            </span>
          </div>
          <RowAction row={row} />
        </li>
      ))}
    </ul>
  );
}

/** What the Content card is handed: its declaration's props, with the rows its `load` read. */
export type ContentTableProps = Omit<DeclaredComponentProps, "data"> & {
  data: CoreListWidgetData;
};

export function ContentTable({ data }: ContentTableProps): JSX.Element {
  // At most the ten a list draws: the card offers no "Number of items", and its `load` asked the
  // rows its size holds up to that.
  const { tier, drawn, density, now } = useListCard(MAX_WIDGET_ROWS);
  // The body's own width, measured by the frame's hook once the rows are drawn: held as state,
  // so the measurement starts when the element appears rather than at the first render.
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const bodyRef = useMemo(() => ({ current: body }), [body]);
  const bodyWidth = useMeasuredWidth(bodyRef);
  useCardSubtitle(contentSubtitle(data.totalByKind));
  // A row this build cannot read is left out rather than drawn from guesses.
  const rows = data.items.flatMap(item => {
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
  const form = formAt(tier, bodyWidth);
  return (
    <div ref={setBody} data-form={form} className="min-w-0">
      {form === "stacked" ? (
        <ContentListForm rows={shown} density={density} now={now} />
      ) : (
        <ContentTableForm
          rows={shown}
          density={density}
          now={now}
          narrow={form === "narrow-table"}
        />
      )}
    </div>
  );
}

ContentTable.displayName = "ContentTable";
