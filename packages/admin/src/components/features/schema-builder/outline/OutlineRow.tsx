"use client";

/**
 * One row of the Builder's outline: a tree item naming the field (its label,
 * its type's plain name, its name), its badges, and, for a read-only row,
 * where it is defined.
 *
 * The tree item holds text only. Its handle and its "⋯" sit beside it, for a
 * pointer, outside the tree's semantics and its tab order: a control inside a
 * tree item is a control inside a control, and the keyboard reaches every
 * action through the tree's own keys and the settings panel instead.
 */
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { JSX, ReactNode } from "react";
import { memo } from "react";

import { ChevronDown, ChevronRight } from "@admin/components/icons";
import {
  describeReadOnly,
  type OutlineNode,
  type VisibleRow,
} from "@admin/lib/builder/outline/outline-model";
import { isPendingDelete } from "@admin/lib/builder/outline/pending-rows";
import type { RowMark } from "@admin/lib/builder/pending-changes";
import { cn } from "@admin/lib/utils";

import type { OutlineActions } from "./outline-types";
import { OutlineRowMenu } from "./OutlineRowMenu";
import { ROW_ID_PREFIX } from "./useTreeKeyDown";

/** The width of one level of indent, in pixels; a drag sideways by it changes level. */
export const INDENT = 20;

type Props = {
  row: VisibleRow;
  /** The plain name of the row's type. */
  typeName: string;
  /** What is wrong with the field, if anything. */
  error: string | undefined;
  selected: boolean;
  /** The row the tree's tab stop is on. */
  tabStop: boolean;
  /** May be dragged, and moved by key: the rule judges where to. */
  draggable: boolean;
  /** The element naming the keys that move a field, for a row that may move. */
  movesDescribedBy?: string;
  onSelect: (id: string) => void;
  onToggle: (path: string) => void;
  registerRow: (id: string, element: HTMLElement | null) => void;
  /** Whether the row's menu is open; it opens from its "⋯" or by key. */
  menuOpen: boolean;
  /** What the row's menu can do; the same object for every row. */
  actions: OutlineActions;
};

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "danger";
}): JSX.Element {
  return (
    <span
      className={cn(
        "rounded-sm border px-1.5 py-0.5 text-xs leading-none",
        tone === "danger"
          ? "border-destructive text-destructive"
          : "border-border text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}

/**
 * What a blocks field accepts, in words, as its policy says it: any block when
 * it names none, no block for an empty list, else the blocks and patterns it
 * names, the first few of them.
 */
function blocksPolicy(allow: readonly string[] | undefined): string {
  if (allow === undefined) return "Blocks: any block";
  if (allow.length === 0) return "Blocks: none accepted";
  const shown = allow.slice(0, 3).join(", ");
  const more = allow.length - 3;
  return more > 0 ? `Blocks: ${shown} and ${more} more` : `Blocks: ${shown}`;
}

/**
 * Why a field-group field shows fewer fields than it uses: still loading, not
 * readable, gone, or using itself. Said in the row, so an incomplete outline
 * is never taken for the whole schema.
 */
function fieldGroupNote(
  fieldGroup: NonNullable<OutlineNode["fieldGroup"]>
): string | null {
  const names = fieldGroup.missing.join(", ");
  switch (fieldGroup.unavailable) {
    case "loading":
      return "Loading its fields…";
    case "failed":
      return `Its fields could not be loaded (${names})`;
    case "not-found":
      return `No field group named ${names}`;
    default:
      return fieldGroup.cycle ? "Uses itself; shown once" : null;
  }
}

/** Why the blocks a field accepts are not shown yet, when they are not. */
const BLOCKS_UNAVAILABLE: Record<
  NonNullable<NonNullable<OutlineNode["blocks"]>["unavailable"]>,
  string
> = {
  loading: "loading its blocks…",
  failed: "its blocks could not be loaded",
  unavailable: "block details need the Page Builder plugin",
};

/**
 * A blocks field's note: its policy, then why its blocks are not shown, or
 * the entries that admit no registered block. Said in the row, so a field
 * showing no blocks is never taken for one accepting none.
 */
function blocksNote(blocks: NonNullable<OutlineNode["blocks"]>): string {
  const policy = blocksPolicy(blocks.allow);
  if (blocks.unavailable) {
    return `${policy} (${BLOCKS_UNAVAILABLE[blocks.unavailable]})`;
  }
  return blocks.unmatched
    ? `${policy} (no registered block matches ${blocks.unmatched.join(", ")})`
    : policy;
}

/** What a row says beside its name, if anything. */
function rowNote(node: OutlineNode): string | null {
  if (node.blocks) return blocksNote(node.blocks);
  return node.fieldGroup ? fieldGroupNote(node.fieldGroup) : null;
}

/**
 * A field-group field's badge: shared, and in how many places, when that is
 * known. The count is of fields, as the field-group list counts them.
 */
function sharedText(node: OutlineNode): string {
  const usedIn = node.usedIn;
  if (usedIn === undefined || usedIn === null) return "Shared";
  return `Shared · used in ${usedIn} ${usedIn === 1 ? "place" : "places"}`;
}

/** The badges a row carries, in a fixed order; told in words, not colour. */
function RowBadges({
  node,
  error,
}: {
  node: OutlineNode;
  error: string | undefined;
}): JSX.Element {
  const { field } = node;
  const marks: { show: unknown; text: string }[] = [
    { show: field.validation?.required, text: "Required" },
    { show: node.translatable, text: "Translatable" },
    { show: field.admin?.hidden, text: "Hidden" },
    { show: field.admin?.condition, text: "Has a condition" },
    {
      show: node.readOnly,
      text: node.readOnly ? `Locked · ${describeReadOnly(node.readOnly)}` : "",
    },
    // What is pending on the row until the save: one mark per kind.
    ...(node.pending?.marks ?? []).map(pending => ({
      show: true,
      text: pendingMarkText(pending, node.pending?.inside),
    })),
    {
      // A field using field groups, and each field group a field accepting
      // several offers: both are shared, each with its own count when known.
      show:
        node.container === "field-group" ||
        node.container === "field-group-entry",
      text: sharedText(node),
    },
  ];
  return (
    <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
      {marks
        .filter(mark => Boolean(mark.show))
        .map(mark => (
          <Badge key={mark.text}>{mark.text}</Badge>
        ))}
      {error && (
        <Badge tone="danger">
          <span title={error}>Has an error</span>
        </Badge>
      )}
    </span>
  );
}

/** A pending mark's words: a deleted container says how many go with it. */
function pendingMarkText(mark: RowMark, inside: number | undefined): string {
  switch (mark) {
    case "new":
      return "New";
    case "changed":
      return "Changed";
    case "moved":
      return "Moved";
    case "deleted":
      return inside
        ? `Deleted · ${inside} ${inside === 1 ? "field" : "fields"} inside`
        : "Deleted";
  }
}

/** The chevron that folds a container; nothing for a row that holds none. */
function FoldChevron({
  expanded,
  onToggle,
}: {
  expanded: boolean | undefined;
  onToggle: () => void;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      onClick={event => {
        // Folding is the chevron's only job: it neither selects the row nor
        // opens the panel.
        event.stopPropagation();
        onToggle();
      }}
      className="flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground"
    >
      {expanded === true && <ChevronDown className="h-4 w-4" />}
      {expanded === false && <ChevronRight className="h-4 w-4" />}
    </span>
  );
}

/** The handle a pointer drags a field by; nothing to the keyboard. */
function DragHandle({
  draggable,
  sortable,
}: {
  draggable: boolean;
  sortable: ReturnType<typeof useSortable>;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      ref={sortable.setActivatorNodeRef}
      {...(draggable ? sortable.listeners : {})}
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground",
        draggable ? "cursor-grab" : "invisible"
      )}
    >
      ⋮⋮
    </span>
  );
}

/** The row as a tree item: text and badges only, no control inside it. */
function RowItem({
  row,
  typeName,
  error,
  selected,
  tabStop,
  onSelect,
  onToggle,
  registerRow,
  draggable,
  movesDescribedBy,
}: Pick<
  Props,
  | "row"
  | "typeName"
  | "error"
  | "selected"
  | "tabStop"
  | "onSelect"
  | "onToggle"
  | "registerRow"
  | "draggable"
  | "movesDescribedBy"
>): JSX.Element {
  const { node, level, expanded, match } = row;
  const { field } = node;
  const what = rowNote(node);
  return (
    <div
      role="treeitem"
      ref={element => registerRow(node.id, element)}
      id={`${ROW_ID_PREFIX}${node.id}`}
      data-testid={`field-row-${field.name}`}
      data-path={node.path}
      aria-level={level}
      aria-posinset={row.posinset}
      aria-setsize={row.setsize}
      aria-expanded={expanded}
      aria-selected={selected}
      aria-describedby={draggable ? movesDescribedBy : undefined}
      tabIndex={tabStop ? 0 : -1}
      onClick={() => onSelect(node.id)}
      className={cn(
        "flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border border-transparent py-1 pr-2 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        "hover:bg-accent/50",
        // Selected is told by a thick bar at its start as well as the fill,
        // so it does not rest on colour alone. A hidden row is told by its
        // Hidden badge, not by fading it, which would take its text below the
        // contrast it needs.
        selected && "border-l-4 border-l-primary bg-accent"
      )}
      style={{ paddingLeft: (level - 1) * INDENT + 4 }}
    >
      <FoldChevron expanded={expanded} onToggle={() => onToggle(node.path)} />
      <span
        className={cn(
          "truncate font-medium",
          match && "underline decoration-2 underline-offset-4"
        )}
      >
        {field.label || field.name || "Untitled field"}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{typeName}</span>
      {field.name && (
        <code className="shrink-0 text-xs text-muted-foreground">
          {field.name}
        </code>
      )}
      {what && <span className="text-xs text-muted-foreground">{what}</span>}
      <RowBadges node={node} error={error} />
    </div>
  );
}

function OutlineRowView(props: Props): JSX.Element {
  const { row, draggable, menuOpen, actions } = props;
  const sortable = useSortable({ id: row.node.id, disabled: !draggable });
  return (
    <div
      role="none"
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={cn(
        "group flex items-center gap-1 rounded-md",
        sortable.isDragging && "opacity-60"
      )}
    >
      <DragHandle draggable={draggable} sortable={sortable} />
      <RowItem {...props} />
      {/* A deleted row offers nothing to do to it until it is back. */}
      {!isPendingDelete(row.node) && (
        <OutlineRowMenu node={row.node} open={menuOpen} actions={actions} />
      )}
    </div>
  );
}

/**
 * Memoized by its props, so selecting one row, or typing in the find box,
 * redraws only the rows whose own props changed.
 */
export const OutlineRow = memo(OutlineRowView);
