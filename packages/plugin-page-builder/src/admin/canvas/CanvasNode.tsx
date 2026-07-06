"use client";

/**
 * Canvas rendering of the block tree (spec §9). Renders the SAME production block output
 * as the frontend (pixel parity), then augments each block element with a stable
 * `data-nx-id`, click-to-select, the selection class, per-block error isolation, and a
 * @dnd-kit draggable handle so it can be picked up.
 *
 * Drop targeting is parity-safe:
 *  - In normal block flow (containers, query-loop template) zero-height DropZones are
 *    interleaved between children — they add no layout box, so the output matches the
 *    frontend exactly.
 *  - Inside a GRID a between-child <div> would become an extra grid item and break the
 *    columns, so grid children render directly; each grid cell is an "insert-before"
 *    droppable and the grid itself is an "append" droppable (highlight, no layout box).
 *
 * The root container renders via `CanvasNode`; descendants render via `DraggableNode`.
 */
import { useDraggable, useDroppable } from "@dnd-kit/react";
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import { defaultBlockRegistry } from "../../core/registry";
import { nodeClass } from "../../core/style-compiler";
import type { BlockNode } from "../../core/types";
import { BlockErrorBoundary } from "../../render/ErrorBoundary";
import { dragSensors } from "../logic/dragSensors";
import { useEditor } from "../store/EditorProvider";

import { DropZone } from "./DropZone";

const BLOCK_TYPE = "nx-block";

/** Visual stand-in shown on the canvas for a block whose render() is empty (e.g. an
 *  Image with no source), so it stays visible and selectable at author time. */
const placeholderStyle = {
  padding: "14px 16px",
  fontSize: 13,
  color: "#6b7280",
  border: "1px dashed #cbd5e1",
  borderRadius: 6,
  textAlign: "center" as const,
  background: "#f8fafc",
};

/** Containers whose children lay out horizontally — no interleaved DropZones (parity). */
function isHorizontal(node: BlockNode): boolean {
  return node.type === "core/grid";
}

type RefCb = (el: Element | null) => void;
function mergeRefs(...refs: (RefCb | undefined)[]): RefCb {
  return el => {
    for (const r of refs) r?.(el);
  };
}

function classFor(
  node: BlockNode,
  selected: boolean,
  extra: (string | false | undefined)[] = []
): string {
  return [
    nodeClass(node.id),
    node.customClass,
    selected && "nx-pb-selected",
    ...extra,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Render a slot's children with drop targets (parity-safe per container type). */
function renderSlot(node: BlockNode, slotName: string): ReactNode {
  const children = node.slots?.[slotName] ?? [];
  if (children.length === 0) {
    return (
      <DropZone
        key="dz-empty"
        parentId={node.id}
        slot={slotName}
        index={0}
        empty
      />
    );
  }

  // Grid: render children directly (each an insert-before droppable). No between-divs.
  if (isHorizontal(node)) {
    return children.map((child, i) => (
      <DraggableNode
        key={child.id}
        node={child}
        parentId={node.id}
        slot={slotName}
        index={i}
        dropBeforeIndex={i}
      />
    ));
  }

  // Block flow: interleave zero-height DropZones (no layout impact → pixel parity).
  const out: ReactNode[] = [];
  children.forEach((child, i) => {
    out.push(
      <DropZone key={`dz-${i}`} parentId={node.id} slot={slotName} index={i} />
    );
    out.push(
      <DraggableNode
        key={child.id}
        node={child}
        parentId={node.id}
        slot={slotName}
        index={i}
      />
    );
  });
  out.push(
    <DropZone
      key={`dz-${children.length}`}
      parentId={node.id}
      slot={slotName}
      index={children.length}
    />
  );
  return out;
}

function buildSlots(node: BlockNode): Record<string, ReactNode> {
  const slots: Record<string, ReactNode> = {};
  if (node.slots) {
    for (const name of Object.keys(node.slots)) {
      slots[name] = renderSlot(node, name);
    }
  }
  return slots;
}

/** Root renderer — the page container, not itself draggable. */
export function CanvasNode({ node }: { node: BlockNode }): ReactNode {
  const { state } = useEditor();
  const def = defaultBlockRegistry.get(node.type);
  const selected = state.selectedId === node.id;
  const className = classFor(node, selected);

  if (!def) {
    return (
      <div
        data-nx-id={node.id}
        data-nx-unknown={node.type}
        className={className}
      />
    );
  }

  const element = def.render({
    props: node.props,
    node,
    slots: buildSlots(node),
    className,
  });
  if (!isValidElement(element)) {
    return (
      <div className={className} data-nx-id={node.id} style={placeholderStyle}>
        {def.label} — click to configure
      </div>
    );
  }
  return cloneElement(element as ReactElement<Record<string, unknown>>, {
    "data-nx-id": node.id,
  });
}

/** A draggable descendant node, optionally an insert-before / append drop target. */
function DraggableNode({
  node,
  parentId,
  slot,
  index,
  dropBeforeIndex,
}: {
  node: BlockNode;
  parentId: string;
  slot: string;
  index: number;
  /** When set (grid child), this element is also an "insert before" drop target. */
  dropBeforeIndex?: number;
}): ReactNode {
  const { state } = useEditor();
  const def = defaultBlockRegistry.get(node.type);
  const selected = state.selectedId === node.id;

  const { ref: dragRef, isDragging } = useDraggable({
    id: node.id,
    type: BLOCK_TYPE,
    data: { kind: "node", nodeId: node.id, parentId, slot, index },
    sensors: dragSensors,
  });

  // Grid child: "insert before me" target.
  const before = useDroppable({
    id: `before:${node.id}`,
    type: BLOCK_TYPE,
    accept: BLOCK_TYPE,
    disabled: dropBeforeIndex == null,
    data: { kind: "dropzone", parentId, slot, index: dropBeforeIndex ?? 0 },
  });

  // Grid itself: "append" target for its own default slot.
  const grid = isHorizontal(node);
  const appendIndex = node.slots?.default?.length ?? 0;
  const append = useDroppable({
    id: `append:${node.id}`,
    type: BLOCK_TYPE,
    accept: BLOCK_TYPE,
    disabled: !grid,
    data: {
      kind: "dropzone",
      parentId: node.id,
      slot: "default",
      index: appendIndex,
    },
  });

  const className = classFor(node, selected, [
    isDragging && "nx-pb-dragging",
    before.isDropTarget && "nx-pb-drop-before",
    append.isDropTarget && "nx-pb-drop-append",
  ]);

  const ref = mergeRefs(dragRef, before.ref, grid ? append.ref : undefined);

  if (!def) {
    return (
      <div
        ref={ref}
        data-nx-id={node.id}
        data-nx-unknown={node.type}
        className={className}
      />
    );
  }

  const element = def.render({
    props: node.props,
    node,
    slots: buildSlots(node),
    className,
  });
  if (!isValidElement(element)) {
    return (
      <div
        ref={ref}
        className={className}
        data-nx-id={node.id}
        style={placeholderStyle}
      >
        {def.label} — click to configure
      </div>
    );
  }

  const augmented = cloneElement(
    element as ReactElement<Record<string, unknown>>,
    { "data-nx-id": node.id, ref }
  );

  return (
    <BlockErrorBoundary
      fallback={
        <div
          ref={ref}
          data-nx-id={node.id}
          className={className}
          style={{
            padding: 8,
            fontSize: 12,
            color: "#b91c1c",
            border: "1px dashed #fca5a5",
            borderRadius: 6,
          }}
        >
          {def.label} failed to render.
        </div>
      }
    >
      {augmented}
    </BlockErrorBoundary>
  );
}
