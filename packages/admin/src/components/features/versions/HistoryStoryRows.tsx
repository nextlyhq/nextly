/**
 * The rows of the history story: a version, an event that is not a version,
 * and the mark where retention removed older versions.
 *
 * Each row leads with when and who, says what happened, and carries the
 * version number last and quiet. A shape beside it carries the kind, so colour
 * is never the only cue: a filled circle is a publish, a ring a save, a square
 * an event.
 *
 * @module components/features/versions/HistoryStoryRows
 */

import {
  Bot,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Cog,
  KeyRound,
  Pencil,
  Rocket,
  RotateCcw,
  User,
  UserRound,
} from "lucide-react";
import type { JSX } from "react";
import { useState } from "react";

import { cn } from "@admin/lib/utils";
import type {
  HistoryActorKind,
  VersionMeta,
  VersionScope,
} from "@admin/services/versionApi";

import type { StoryEvent, StoryRemoval, StoryVersion } from "./history-story";
import {
  eventActor,
  eventSentence,
  removedCount,
  timeOfDay,
  versionActor,
  type PartsLabel,
  type StoryActor,
} from "./history-story-text";
import type { Predecessor } from "./version-pairing";
import { VersionSummaryLine } from "./VersionSummaryLine";

/** The icon for each kind of actor; a person when none was recorded. */
const ACTOR_ICONS: Record<HistoryActorKind, typeof User> = {
  person: User,
  apiKey: KeyRound,
  principal: UserRound,
  release: Rocket,
  system: Cog,
  agent: Bot,
};

/** The shape a row's kind is drawn as. */
export type StoryShape = "publish" | "save" | "event";

/** The kind's shape on the timeline. Decorative: the row says it in words. */
export function StoryNode({ shape }: { shape: StoryShape }): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn(
        "relative z-[1] mt-3 ml-0.5 h-4 w-4 shrink-0 rounded-full bg-background",
        shape === "event" ? "text-muted-foreground" : "text-foreground"
      )}
    >
      {shape === "publish" ? (
        <circle cx="8" cy="8" r="5" fill="currentColor" />
      ) : shape === "save" ? (
        <circle
          cx="8"
          cy="8"
          r="4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
        />
      ) : (
        <rect
          x="4.5"
          y="4.5"
          width="7"
          height="7"
          rx="1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
        />
      )}
    </svg>
  );
}

/** Who or what did it, with an icon for the kind. */
export function StoryActorName({ actor }: { actor: StoryActor }): JSX.Element {
  const Icon = actor.kind ? ACTOR_ICONS[actor.kind] : User;
  const name =
    actor.kind === "release" ? `Release “${actor.name}”` : actor.name;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 truncate font-medium text-foreground">
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** The first line of a row: when, who, and the version number last. */
function RowLead({
  at,
  actor,
  versionNo,
}: {
  at: string;
  actor: StoryActor;
  versionNo?: number | null;
}) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      {/* Spaces between the parts, so the row's accessible name reads as
          words rather than running them together. */}
      <time
        dateTime={at}
        className="font-semibold tabular-nums text-foreground"
      >
        {timeOfDay(at)}
      </time>{" "}
      <StoryActorName actor={actor} />{" "}
      {typeof versionNo === "number" ? (
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          {/* Shown as "v3", read as "Version 3": the short form fits the row,
              and a screen reader is not left saying the letter. */}
          <span aria-hidden="true">v</span>
          <span className="sr-only">Version</span> {versionNo}
        </span>
      ) : null}
    </span>
  );
}

/** The tag a named or restored version carries. */
function VersionTag({ version }: { version: VersionMeta }) {
  if (version.label) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-foreground">
        <Bookmark className="h-3 w-3" aria-hidden />
        Named “{version.label}”
      </span>
    );
  }
  if (version.sourceVersionNo !== null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-foreground">
        <RotateCcw className="h-3 w-3" aria-hidden />
        Restored from v{version.sourceVersionNo}
      </span>
    );
  }
  return null;
}

export interface VersionStoryRowProps {
  scope: VersionScope;
  entry: Pick<StoryVersion, "version" | "parts" | "publish" | "folded">;
  /** The version this one is compared with, for its changed fields. */
  previous: (version: VersionMeta) => Predecessor;
  partsLabel: PartsLabel;
  /** Whether to read its changed fields now; a long list reads the top. */
  summarised: boolean;
  selected: number | null;
  onSelect: (versionNo: number) => void;
  onRename?: (versionNo: number) => void;
  nested?: boolean;
}

/** One version, with the saves it shipped folded under it. */
export function VersionStoryRow(props: VersionStoryRowProps): JSX.Element {
  const { entry, selected, onSelect, onRename, nested = false } = props;
  const { version } = entry;
  const versionNo = version.versionNo ?? 0;
  const active = selected === versionNo;
  return (
    <div className="group relative grid grid-cols-[20px_minmax(0,1fr)] gap-x-1">
      <StoryNode shape={entry.publish ? "publish" : "save"} />
      <div className="flex min-w-0 items-start">
        <button
          type="button"
          aria-current={active ? "true" : undefined}
          onClick={() => onSelect(versionNo)}
          className={cn(
            "grid w-full min-w-0 gap-0.5 rounded-md px-2.5 py-2 text-left text-[13px] leading-[18px] hover:bg-accent/60",
            active && "bg-accent shadow-[inset_2px_0_0_var(--nx-foreground)]"
          )}
        >
          <VersionRowBody {...props} />
        </button>
        {onRename && !nested ? (
          <RenameButton versionNo={versionNo} onRename={onRename} />
        ) : null}
      </div>
      {entry.folded.length > 0 ? <FoldedSaves {...props} /> : null}
    </div>
  );
}

/** What a version row says: when and who, its tag, a publish, its fields. */
function VersionRowBody({
  scope,
  entry,
  previous,
  partsLabel,
  summarised,
}: VersionStoryRowProps) {
  const { version } = entry;
  return (
    <>
      <RowLead
        at={version.createdAt}
        actor={versionActor(version)}
        versionNo={version.versionNo}
      />{" "}
      <VersionTag version={version} />{" "}
      {entry.publish ? (
        <span className="font-medium text-foreground">
          {`Published ${partsLabel(entry.parts)}`.trim()}
        </span>
      ) : null}{" "}
      <VersionSummaryLine
        scope={scope}
        versionNo={version.versionNo ?? 0}
        previous={previous(version)}
        enabled={summarised}
      />
    </>
  );
}

/** Naming a version, shown beside its row on hover or focus. */
function RenameButton({
  versionNo,
  onRename,
}: {
  versionNo: number;
  onRename: (versionNo: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onRename(versionNo)}
      aria-label={`Name version ${versionNo}`}
      className="mt-1.5 shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
    >
      <Pencil className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

/** The saves a publish shipped, folded under it until asked for. */
function FoldedSaves(props: VersionStoryRowProps) {
  const [open, setOpen] = useState(false);
  const shipped = props.entry.folded;
  return (
    <div className="col-start-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="mb-1 ml-1.5 inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" aria-hidden />
        ) : (
          <ChevronRight className="h-3 w-3" aria-hidden />
        )}
        {shipped.length} {shipped.length === 1 ? "save" : "saves"} in this
        publish
      </button>
      {open ? (
        <ol className="ml-1 border-l border-dashed border-border pl-2">
          {shipped.map(save => (
            <li key={save.id}>
              <VersionStoryRow
                {...props}
                entry={{ version: save, parts: [], publish: false, folded: [] }}
                nested
              />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** An event that is not itself a version: a withdrawal, a discarded draft. */
export function EventStoryRow({
  entry,
  partsLabel,
}: {
  entry: StoryEvent;
  partsLabel: PartsLabel;
}): JSX.Element {
  const { event } = entry;
  return (
    <div className="relative grid grid-cols-[20px_minmax(0,1fr)] gap-x-1">
      <StoryNode shape="event" />
      <div className="grid min-w-0 gap-0.5 px-2.5 py-2 text-[13px] leading-[18px]">
        <RowLead at={event.occurredAt} actor={eventActor(event)} />
        <span className="text-muted-foreground">
          {eventSentence(event, partsLabel)}
          {event.note ? ` · “${event.note}”` : ""}
        </span>
      </div>
    </div>
  );
}

/** Where retention removed older versions. */
export function RemovalMark({ entry }: { entry: StoryRemoval }): JSX.Element {
  const count = removedCount(entry.event);
  return (
    <div className="my-2 ml-5 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
      {count === null
        ? "Older versions removed by retention"
        : `${count} older ${count === 1 ? "version" : "versions"} removed by retention`}
      {" · "}
      <time dateTime={entry.at}>{timeOfDay(entry.at)}</time>
    </div>
  );
}
