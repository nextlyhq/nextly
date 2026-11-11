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
  type VisibleRow,
} from "@admin/lib/builder/outline/outline-model";
import { cn } from "@admin/lib/utils";

import { OutlineRowMenu, type OutlineActions } from "./OutlineRowMenu";

/** The width of one level of indent, in pixels. */
const INDENT = 20;

type Props = {
  row: VisibleRow;
  /** The plain name of the row's type. */
  typeName: string;
  /** What is wrong with the field, if anything. */
  error: string | undefined;
  selected: boolean;
  /** The row the tree's tab stop is on. */
  tabStop: boolean;
  /** May be dragged within its container. */
  draggable: boolean;
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

function OutlineRowView({
  row,
  typeName,
  error,
  selected,
  tabStop,
  draggable,
  onSelect,
  onToggle,
  registerRow,
  menuOpen,
  actions,
}: Props): JSX.Element {
  const { node, level, posinset, setsize, expanded, match } = row;
  const { field } = node;
  const sortable = useSortable({ id: node.id, disabled: !draggable });

  const what =
    node.container === "blocks" && node.blocks
      ? node.blocks.accepted === "all"
        ? "Blocks: every block accepted"
        : `Blocks: ${node.blocks.accepted} accepted`
      : null;

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
      <div
        role="treeitem"
        ref={element => registerRow(node.id, element)}
        id={`outline-row-${node.id}`}
        data-testid={`field-row-${field.name}`}
        data-path={node.path}
        aria-level={level}
        aria-posinset={posinset}
        aria-setsize={setsize}
        aria-expanded={expanded}
        aria-selected={selected}
        tabIndex={tabStop ? 0 : -1}
        onClick={() => onSelect(node.id)}
        className={cn(
          "flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border border-transparent py-1 pr-2 outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring",
          "hover:bg-accent/50",
          // Selected is told by a thick bar at its start as well as the fill,
          // so it does not rest on colour alone.
          // A hidden row is told by its Hidden badge, not by fading it,
          // which would take its text below the contrast it needs.
          selected && "border-l-4 border-l-primary bg-accent"
        )}
        style={{ paddingLeft: (level - 1) * INDENT + 4 }}
      >
        <span
          aria-hidden="true"
          onClick={event => {
            // Folding is the chevron's only job: it neither selects the row
            // nor opens the panel.
            event.stopPropagation();
            onToggle(node.path);
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground"
        >
          {expanded === undefined ? null : expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>
        <span
          className={cn(
            "truncate font-medium",
            match && "underline decoration-2 underline-offset-4"
          )}
        >
          {field.label || field.name || "Untitled field"}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {typeName}
        </span>
        {field.name && (
          <code className="shrink-0 text-xs text-muted-foreground">
            {field.name}
          </code>
        )}
        {what && <span className="text-xs text-muted-foreground">{what}</span>}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {field.validation?.required && <Badge>Required</Badge>}
          {field.advanced?.localized && <Badge>Translatable</Badge>}
          {field.admin?.hidden && <Badge>Hidden</Badge>}
          {field.admin?.condition && <Badge>Has a condition</Badge>}
          {node.readOnly && (
            <Badge>Locked · {describeReadOnly(node.readOnly)}</Badge>
          )}
          {node.container === "field-group" && <Badge>Shared</Badge>}
          {error && (
            <Badge tone="danger">
              <span title={error}>Has an error</span>
            </Badge>
          )}
        </span>
      </div>
      <OutlineRowMenu node={node} open={menuOpen} actions={actions} />
    </div>
  );
}

/**
 * Memoized by its props, so selecting one row, or typing in the find box,
 * redraws only the rows whose own props changed.
 */
export const OutlineRow = memo(OutlineRowView);
