"use client";

/**
 * The cells of the release list.
 *
 * Each one lays out what `release-list` and `release-time` say, so the wording
 * rules stay in functions a test can hold and these stay about arrangement.
 * The documents and owner cells are handed what the list read for the whole
 * page; no cell asks for anything of its own.
 *
 * The shared table draws these cells twice: in its table, and in a card per
 * row on a narrow screen, where each value sits right-aligned beside its
 * label. So a cell that lays out in rows or columns aligns to the end by
 * default and to the start from the table's `@md/table` width up, and its
 * lines may wrap only below that width, where the label beside them leaves
 * less room than a table column does.
 *
 * @module components/features/releases/ReleaseListCells
 */

import type { ReactNode } from "react";

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Globe,
  Pencil,
  XCircle,
} from "@admin/components/icons";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Progress,
  Skeleton,
} from "@admin/components/ui";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";
import { cn } from "@admin/lib/utils";
import type {
  Release,
  ReleaseListTab,
  ReleaseReadinessEntry,
} from "@admin/types/releases";

import { describeHidden } from "./release-hidden";
import {
  releaseOwnerView,
  describeDocuments,
  describeNeedFix,
  describeReadiness,
  RELEASE_ROW_STATUS,
  releaseWhenInstant,
  summariseReadiness,
  type ReleaseRowStatus,
} from "./release-list";
import { releaseTimeSentence, releaseTimeText } from "./release-time";

/** Each status's icon, drawn beside its word wherever a release's state is shown. */
const STATUS_ICON: Record<ReleaseRowStatus, typeof Clock> = {
  scheduled: Clock,
  overdue: AlertTriangle,
  stopped: AlertCircle,
  draft: Pencil,
  published: CheckCircle2,
  cancelled: XCircle,
};

/**
 * Where a release stands: an icon and a word, never a colour alone.
 */
export function ReleaseStatusBadge({ status }: { status: ReleaseRowStatus }) {
  const { label, variant } = RELEASE_ROW_STATUS[status];
  const Icon = STATUS_ICON[status];
  return (
    <Badge variant={variant} className="gap-1.5 whitespace-nowrap">
      <Icon className="size-3.5" aria-hidden />
      {label}
    </Badge>
  );
}

/**
 * Each status's tone, for a mark that is not a badge: the icon's colour, and
 * a bar a calendar chip draws down its edge. The word carries the state; the
 * colour only repeats it.
 */
export const RELEASE_STATUS_TONE: Record<
  ReleaseRowStatus,
  { bar: string; icon: string }
> = {
  scheduled: { bar: "bg-primary", icon: "text-primary" },
  overdue: {
    bar: "bg-warning-500",
    icon: "text-warning-600 dark:text-warning-400",
  },
  stopped: { bar: "bg-destructive", icon: "text-destructive" },
  published: {
    bar: "bg-success-500",
    icon: "text-success-600 dark:text-success-400",
  },
  draft: { bar: "bg-border", icon: "text-muted-foreground" },
  cancelled: { bar: "bg-muted-foreground/40", icon: "text-muted-foreground" },
};

/**
 * Where a release stands, as an icon in its tone and a word in the body's
 * muted text, for a place too small or too dense for a badge: a calendar
 * chip, a day's list. The word is drawn in a text colour rather than the
 * state's, so it reads at full contrast under any brand colour.
 */
export function ReleaseStatusMark({
  status,
  className,
  children,
}: {
  status: ReleaseRowStatus;
  className?: string;
  /** Drawn between the icon and the word, such as the time. */
  children?: ReactNode;
}) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1 text-muted-foreground",
        className
      )}
    >
      <Icon
        className={cn("size-3 shrink-0", RELEASE_STATUS_TONE[status].icon)}
        aria-hidden
      />
      {children}{" "}
      <span className="truncate">{RELEASE_ROW_STATUS[status].label}</span>
    </span>
  );
}

/**
 * The release's title, its description, and the single-document mark.
 *
 * The table wraps this cell in the row's link, and a link underlines what it
 * holds on hover. The description and the mark are inline-blocks so the
 * underline stays on the title, which is the part that names the link.
 */
export function ReleaseTitleCell({ release }: { release: Release }) {
  return (
    <span className="inline-block max-w-[26rem] align-top">
      <span className="text-sm font-medium text-foreground">
        {release.title}
      </span>
      {release.kind === "single" ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-px align-[1px] text-[11px] font-normal leading-4 text-muted-foreground">
          <FileText className="size-3" aria-hidden />
          Single document
        </span>
      ) : null}
      {release.description ? (
        <span className="mt-0.5 inline-block w-full truncate text-xs font-normal text-muted-foreground">
          {release.description}
        </span>
      ) : null}
    </span>
  );
}

/**
 * When a release runs, ran, was due or was started, for the tab being read.
 *
 * The reader's time first, then how far away it is, then, only where the
 * release was scheduled on a clock that reads differently, the time it was
 * scheduled for there.
 */
export function ReleaseWhenCell({
  release,
  tab,
  readerZone,
  now,
}: {
  release: Release;
  tab: ReleaseListTab;
  readerZone: string;
  now: number;
}) {
  const instant = releaseWhenInstant(release, tab);
  // The scheduled zone belongs to the scheduled instant only. A draft's
  // creation time or a run's finish was never "scheduled" anywhere.
  const scheduledZone =
    tab === "upcoming" || tab === "attention" ? release.timezone : null;
  const text = releaseTimeText(instant, { readerZone, scheduledZone, now });
  if (!text) {
    return <span className="text-sm text-muted-foreground">Not scheduled</span>;
  }
  return (
    <span
      className="flex flex-col items-end gap-0.5 @md/table:min-w-[11rem] @md/table:items-start"
      title={releaseTimeSentence(text)}
    >
      <span className="text-sm @md/table:whitespace-nowrap tabular-nums text-foreground">
        {text.local}
        {text.scheduled ? (
          <span className="text-muted-foreground"> your time</span>
        ) : null}
      </span>
      <span className="text-xs text-muted-foreground">{text.relative}</span>
      {text.scheduled ? (
        <span className="flex flex-wrap items-center justify-end gap-1 @md/table:justify-start @md/table:whitespace-nowrap text-xs text-muted-foreground">
          <Globe className="size-3 shrink-0" aria-hidden />
          {text.scheduled.text} {text.scheduled.zone}
          <span className="whitespace-nowrap">(as scheduled)</span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * What the page's one readiness read says about one row.
 *
 * Handed in rather than asked for here: the list reads the readiness of the
 * whole page in one request, and a cell that asked for its own would put a
 * request per row back.
 */
export type ReleaseRowReadiness =
  | { status: "pending" }
  | { status: "failed" }
  | { status: "known"; entry: ReleaseReadinessEntry | undefined };

/**
 * How many documents a release holds, what it does with them, and, until it
 * has run, how many are ready.
 *
 * The counts come on the row from the list itself. Readiness is shown only
 * where it means something: a release that ran or was cancelled has nothing
 * left to get ready.
 */
export function ReleaseDocumentsCell({
  release,
  tab,
  readiness,
}: {
  release: Release;
  tab: ReleaseListTab;
  readiness: ReleaseRowReadiness;
}) {
  const counts = release.memberCounts;
  if (counts === undefined) {
    return (
      <span className="text-sm text-muted-foreground">
        Documents unavailable
      </span>
    );
  }
  if (counts.total === 0) {
    return (
      <span className="text-sm text-muted-foreground">No documents yet</span>
    );
  }

  const { count, tail } = describeDocuments(
    counts,
    release.state === "published" ? "ran" : "ahead"
  );

  return (
    <span className="flex flex-col items-end gap-1 @md/table:min-w-[11rem] @md/table:items-start">
      <span className="text-sm @md/table:whitespace-nowrap text-foreground">
        {count}
        {/* A cancelled release did nothing, so it is not described as doing
            anything; its count alone says what it held. */}
        {release.state === "cancelled" ? null : (
          <span className="text-muted-foreground">{tail}</span>
        )}
      </span>
      {tab === "done" ? null : (
        <ReadinessLine total={counts.total} readiness={readiness} />
      )}
    </span>
  );
}

function ReadinessLine({
  total,
  readiness,
}: {
  total: number;
  readiness: ReleaseRowReadiness;
}) {
  if (readiness.status === "pending") {
    return <Skeleton className="h-2.5 w-24" aria-busy="true" />;
  }
  const entry = readiness.status === "known" ? readiness.entry : undefined;
  if (entry === undefined) {
    return (
      <span className="text-xs text-muted-foreground">Could not check</span>
    );
  }
  // A release holding more documents than a release may now hold is left
  // unchecked by the page's read, and checked in full on its own page.
  if (!entry.checked) {
    return <span className="text-xs text-muted-foreground">Open to check</span>;
  }
  const summary = summariseReadiness(total, entry);
  const label = describeReadiness(summary);
  const hidden = describeHidden(entry.hidden);
  return (
    <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs @md/table:flex-nowrap @md/table:justify-start @md/table:whitespace-nowrap">
      <Progress
        value={summary.ready}
        max={summary.total}
        variant="success"
        className="h-1.5 w-14 shrink-0"
        aria-label={`${summary.ready} of ${summary.total} documents ready`}
      />
      <span className="text-muted-foreground">{label}</span>
      {summary.needFix > 0 ? (
        <span className="flex items-center gap-1 font-medium text-destructive">
          <AlertCircle className="size-3" aria-hidden />
          {describeNeedFix(summary.needFix)}
        </span>
      ) : null}
      {/* Quiet, beside the count it is part of: the reader is told how many
          documents they cannot open and where, never which. */}
      {hidden ? <span className="text-muted-foreground">{hidden}</span> : null}
    </span>
  );
}

/** Initials for an avatar: the first letters of the first two words. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map(word => word.charAt(0).toUpperCase());
  return letters.join("") || "?";
}

const OWNER_ROW = "flex items-center justify-end gap-2 @md/table:justify-start";

export function ReleaseOwnerCell({ release }: { release: Release }) {
  // The session the admin already holds: no request of its own.
  const { user: me } = useDashboardUser();
  const owner = releaseOwnerView({
    createdBy: release.createdBy,
    owner: release.owner,
    me,
  });
  const known = owner.kind === "known";
  return (
    <span className={OWNER_ROW} title={known ? owner.name : undefined}>
      <Avatar className="size-7">
        {known && owner.image ? <AvatarImage src={owner.image} alt="" /> : null}
        <AvatarFallback className="bg-muted text-[11px] font-medium text-foreground">
          {known ? initialsOf(owner.name) : "?"}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          "max-w-[9rem] truncate text-sm",
          known ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {owner.label}
      </span>
    </span>
  );
}
