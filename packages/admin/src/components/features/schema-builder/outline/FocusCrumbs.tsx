"use client";

/**
 * The breadcrumb Focus draws above the outline: the top level, each container down to the focused
 * one, and Exit focus. A crumb above the focused container goes back to its level. Every crumb,
 * the focused one included, is a place a dragged field can be dropped: the field goes to the end
 * of that level, judged by the move rule as any other move is. A container above that Focus
 * cannot show (a field group, changed in its own editor) is named but not a way back or a place.
 */
import {
  pointerWithin,
  rectIntersection,
  useDroppable,
  type CollisionDetection,
} from "@dnd-kit/core";
import { Button } from "@nextlyhq/ui";
import type { JSX } from "react";

import type { FieldInsertPosition } from "@admin/lib/builder/insert-field";
import { canFocus } from "@admin/lib/builder/outline/focus-view";
import type { OutlineNode } from "@admin/lib/builder/outline/outline-model";

const CRUMB_PREFIX = "focus-crumb:";
const TOP_LEVEL = "top";

/** The drop id of a crumb: a container's, or the top level's for null. */
function crumbDropId(containerId: string | null): string {
  return `${CRUMB_PREFIX}${containerId ?? TOP_LEVEL}`;
}

/** The place a drop on a crumb names, or null for a drop id that is no crumb's. */
export function crumbTargetOf(dropId: string): FieldInsertPosition | null {
  if (!dropId.startsWith(CRUMB_PREFIX)) return null;
  const id = dropId.slice(CRUMB_PREFIX.length);
  return id === TOP_LEVEL ? {} : { parentFieldId: id };
}

/**
 * The place a drag in the outline is over. A crumb is small and sits right beside the next, so it
 * is the place only while the pointer is on it, never because the dragged row, which is far wider,
 * overlaps it most; anywhere else, the rows are judged by overlap as dnd-kit does by default.
 */
export const crumbsByPointer: CollisionDetection = args => {
  const onCrumb = pointerWithin(args).find(
    each => crumbTargetOf(String(each.id)) !== null
  );
  if (onCrumb) return [onCrumb];
  return rectIntersection({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      each => crumbTargetOf(String(each.id)) === null
    ),
  });
};

function crumbName(node: OutlineNode): string {
  return node.field.label || node.field.name || "Untitled";
}

/**
 * A crumb as a place to drop: its drop id, and what a drag over it is called aloud, since a
 * crumb is no field the drag's sentences could name.
 */
function useCrumbDrop(containerId: string | null, label: string) {
  return useDroppable({
    id: crumbDropId(containerId),
    data: { spoken: `${label}, in the breadcrumb` },
  });
}

/**
 * A crumb's ink: the muted text the page's own breadcrumb trail uses, darkening on hover. Not
 * the primary colour, which a site's branding sets and so is not sure to be readable on the
 * Builder's canvas.
 */
const CRUMB_INK =
  "text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline";

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
  const { setNodeRef, isOver } = useCrumbDrop(containerId, label);
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onGo}
      className={`rounded-sm px-1 ${CRUMB_INK} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        isOver ? "ring-2 ring-primary" : ""
      }`}
    >
      {label}
    </button>
  );
}

/** The focused container's crumb: where the outline is, and a place to drop at its end. */
function CurrentCrumb({ node }: { node: OutlineNode }): JSX.Element {
  const label = crumbName(node);
  const { setNodeRef, isOver } = useCrumbDrop(node.id, label);
  return (
    <span
      ref={setNodeRef}
      aria-current="location"
      className={`rounded-sm px-1 font-medium text-foreground ${
        isOver ? "ring-2 ring-primary" : ""
      }`}
    >
      {label}
    </span>
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
              {canFocus(crumb) ? (
                <CrumbButton
                  containerId={crumb.id}
                  label={crumbName(crumb)}
                  onGo={() => onGo(crumb.id)}
                />
              ) : (
                <span className="px-1 text-muted-foreground">
                  {crumbName(crumb)}
                </span>
              )}
            </li>
          ))}
          <li className={SEPARATED}>
            <CurrentCrumb node={focused} />
          </li>
        </ol>
      </nav>
      <Button variant="outline" size="sm" onClick={onExit}>
        Exit focus
      </Button>
    </div>
  );
}
