"use client";

/**
 * Recently edited: the entries and Singles most recently saved, newest first,
 * one row each, every row a link to its document.
 *
 * Drawn from the card's own slot, which the dashboard batch fills from
 * `system:recent-edits`. A custom card rather than the generic list, because a
 * row here is a link and five facts, where the list draws a label and one line
 * of detail and links nothing.
 *
 * By the card's own width: small lists the titles alone; medium and large add
 * a line under each with its collection, who saved it, when, and its status.
 * It draws at most the "Number of items" its reader chose, and says more exist
 * when the answer holds the one row more the batch asked for, as core's other
 * lists do.
 *
 * @module components/features/dashboard/RecentlyEdited
 */

import type { WidgetComponentProps } from "nextly/widget-result";
import type React from "react";

import { MoreExist } from "@admin/components/features/widgets/archetypes/more-exist";
import { FrameState } from "@admin/components/features/widgets/frame/card-state";
import {
  LIST_CLASS,
  LIST_DETAIL_CLASS,
  LIST_LABEL_CLASS,
  LIST_ROW_CLASS,
} from "@admin/components/features/widgets/frame/geometry";
import { useListCard } from "@admin/components/features/widgets/frame/list-slot";
import { Link } from "@admin/components/ui/link";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { formatRelativeTime } from "@admin/lib/dashboard";
import { cn } from "@admin/lib/utils";

import {
  noEditsText,
  recentEditRows,
  type RecentEditRow,
} from "./recently-edited-model";

/**
 * One document's row. The title is the link; an untitled document is listed
 * as "Untitled", muted so it reads as a stand-in rather than a document named
 * that.
 */
const EditRow: React.FC<{
  edit: RecentEditRow;
  detailed: boolean;
  now: number;
}> = ({ edit, detailed, now }) => {
  // What leads the detail line, before when it was saved: whichever of the
  // collection and the saver the row has.
  const lead = [edit.collection, edit.savedBy].filter(Boolean).join(" · ");
  return (
    <li data-testid="recent-edit" className={LIST_ROW_CLASS}>
      <Link
        href={edit.href}
        className={cn(
          LIST_LABEL_CLASS,
          "font-medium hover:underline",
          edit.untitled ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {edit.title}
      </Link>
      {detailed && (
        <span className={cn(LIST_DETAIL_CLASS, "text-muted-foreground")}>
          {lead !== "" && `${lead} · `}
          {/*
          The relative time is the line's; the absolute instant, in the
          admin's time zone, is the element's title and its `dateTime`, so the
          exact moment is a hover away and machine-readable either way.
        */}
          <time
            dateTime={edit.savedAt}
            title={formatDateWithAdminTimezone(edit.savedAt, {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZoneName: "short",
            })}
          >
            {formatRelativeTime(edit.savedAt, now)}
          </time>
          {edit.status !== undefined && ` · ${edit.status}`}
        </span>
      )}
    </li>
  );
};

export const RecentlyEdited: React.FC<WidgetComponentProps> = props => {
  const { tier, drawn, now, read } = useListCard(props);
  const { query } = props;
  if ("node" in read) return read.node;
  // A row this build cannot read is left out rather than drawn from guesses.
  const edits = recentEditRows(read.list);
  if (edits.length === 0) {
    return (
      <FrameState
        state={{
          kind: "empty",
          empty: {
            title: noEditsText(read.list),
            detail: "Entries and Singles people save show here.",
          },
        }}
      />
    );
  }
  return (
    <div className="space-y-2">
      <ul data-testid="recently-edited" className={LIST_CLASS}>
        {edits.slice(0, drawn).map(edit => (
          <EditRow
            key={edit.key}
            edit={edit}
            detailed={tier !== "small"}
            now={now}
          />
        ))}
      </ul>
      {read.list.items.length > drawn && <MoreExist query={query} />}
    </div>
  );
};

RecentlyEdited.displayName = "RecentlyEdited";
