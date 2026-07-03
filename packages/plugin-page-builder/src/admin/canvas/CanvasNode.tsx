"use client";

/**
 * Canvas rendering of the block tree (spec §9). Uses the SAME production block render
 * (true WYSIWYG), augments the block's own element with a stable `data-nx-id`, click-to-
 * select, the selection class, per-block error isolation, and a @dnd-kit draggable handle
 * so it can be picked up. Between every pair of siblings (and inside empty containers) a
 * DropZone shows exactly where a dragged block will land.
 *
 * The root container renders via `CanvasNode`; descendants render via `DraggableNode`.
 */
import { useDraggable } from "@dnd-kit/react";
import {
  cloneElement,
  isValidElement,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { defaultBlockRegistry } from "../../core/registry";
import { nodeClass } from "../../core/style-compiler";
import type { BlockNode } from "../../core/types";
import { BlockErrorBoundary } from "../../render/ErrorBoundary";
import { useEditor } from "../store/EditorProvider";

import { DropZone } from "./DropZone";

const BLOCK_TYPE = "nx-block";

function classFor(
  node: BlockNode,
  selected: boolean,
  dragging = false
): string {
  return [
    nodeClass(node.id),
    node.customClass,
    selected && "nx-pb-selected",
    dragging && "nx-pb-dragging",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Render a slot's children interleaved with drop zones (empty → a single placeholder). */
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
  const { state, dispatch } = useEditor();
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

  const select = (e: MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: "SELECT", id: node.id });
  };

  const element = def.render({
    props: node.props,
    node,
    slots: buildSlots(node),
    className,
  });
  if (!isValidElement(element)) return element;
  return cloneElement(element as ReactElement<Record<string, unknown>>, {
    "data-nx-id": node.id,
    onClick: select,
  });
}

/** A draggable descendant node. */
function DraggableNode({
  node,
  parentId,
  slot,
  index,
}: {
  node: BlockNode;
  parentId: string;
  slot: string;
  index: number;
}): ReactNode {
  const { state, dispatch } = useEditor();
  const def = defaultBlockRegistry.get(node.type);
  const selected = state.selectedId === node.id;

  const { ref, isDragging } = useDraggable({
    id: node.id,
    type: BLOCK_TYPE,
    data: { kind: "node", nodeId: node.id, parentId, slot, index },
  });

  const className = classFor(node, selected, isDragging);

  const select = (e: MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: "SELECT", id: node.id });
  };

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
  if (!isValidElement(element)) return element;

  const augmented = cloneElement(
    element as ReactElement<Record<string, unknown>>,
    { "data-nx-id": node.id, onClick: select, ref }
  );

  return (
    <BlockErrorBoundary
      fallback={
        <div
          data-nx-id={node.id}
          className={className}
          style={{
            padding: 8,
            fontSize: 12,
            color: "#b91c1c",
            border: "1px dashed #fca5a5",
            borderRadius: 6,
          }}
          onClick={select}
        >
          {def.label} failed to render.
        </div>
      }
    >
      {augmented}
    </BlockErrorBoundary>
  );
}
