"use client";

/**
 * The breadcrumb Focus draws above the outline: the top level, each container down to the focused
 * one, and Exit focus. A crumb above the focused container goes back to its level, and is a place
 * a dragged field can be dropped: the field goes to the end of that level, judged by the move rule
 * as any other move is.
 */
import { useDroppable } from "@dnd-kit/core";
import { Button } from "@nextlyhq/ui";
import type { JSX } from "react";

import type { FieldInsertPosition } from "@admin/lib/builder/insert-field";
import type { OutlineNode } from "@admin/lib/builder/outline/outline-model";

const CRUMB_PREFIX = "focus-crumb:";
const TOP_LEVEL = "top";

/** The drop id of a crumb: a container's, or the top level's for null. */
export function crumbDropId(containerId: string | null): string {
  return `${CRUMB_PREFIX}${containerId ?? TOP_LEVEL}`;
}

/** The place a drop on a crumb names, or null for a drop id that is no crumb's. */
export function crumbTargetOf(dropId: string): FieldInsertPosition | null {
  if (!dropId.startsWith(CRUMB_PREFIX)) return null;
  const id = dropId.slice(CRUMB_PREFIX.length);
  return id === TOP_LEVEL ? {} : { parentFieldId: id };
}

function crumbName(node: OutlineNode): string {
  return node.field.label || node.field.name || "Untitled";
}

/** Separators are drawn, not read: each crumb's text is its name alone. */
const SEPARATED =
  "flex items-center before:mx-1 before:text-muted-foreground before:content-['›'] first:before:content-none";

function CrumbButton({
  containerId,
  label,
  onGo,
}: {
  containerId: string | null;
  label: string;
  onGo: () => void;
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: crumbDropId(containerId),
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onGo}
      className={`rounded-sm px-1 text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        isOver ? "ring-2 ring-primary" : ""
      }`}
    >
      {label}
    </button>
  );
}

export function FocusCrumbs({
  crumbs,
  onGo,
  onExit,
}: {
  /** From the top level's first container down to the focused one. */
  crumbs: readonly OutlineNode[];
  /** Go back to a crumb's level: a container's id, or null for the top level. */
  onGo: (containerId: string | null) => void;
  onExit: () => void;
}): JSX.Element {
  const above = crumbs.slice(0, -1);
  const focused = crumbs[crumbs.length - 1];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <nav aria-label="Focus">
        <ol className="flex flex-wrap items-center text-sm">
          <li className={SEPARATED}>
            <CrumbButton
              containerId={null}
              label="All fields"
              onGo={() => onGo(null)}
            />
          </li>
          {above.map(crumb => (
            <li key={crumb.id} className={SEPARATED}>
              <CrumbButton
                containerId={crumb.id}
                label={crumbName(crumb)}
                onGo={() => onGo(crumb.id)}
              />
            </li>
          ))}
          <li className={SEPARATED}>
            <span aria-current="location" className="px-1 font-medium">
              {crumbName(focused)}
            </span>
          </li>
        </ol>
      </nav>
      <Button variant="outline" size="sm" onClick={onExit}>
        Exit focus
      </Button>
    </div>
  );
}
