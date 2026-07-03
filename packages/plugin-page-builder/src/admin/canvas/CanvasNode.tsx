"use client";

/**
 * Canvas rendering of the block tree (spec §9). Uses the SAME production block render
 * (true WYSIWYG — no wrapper div), then augments the block's own element with a stable
 * `data-nx-id`, a click-to-select handler, the selection class, per-block error isolation,
 * and — for non-root nodes — a @dnd-kit sortable ref so it can be dragged/reordered.
 *
 * The root container is rendered by `CanvasNode`; its descendants render through
 * `SortableNode`, which carries the drag/drop position context.
 */
import { useSortable } from "@dnd-kit/react/sortable";
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

const BLOCK_TYPE = "nx-block";

function classFor(node: BlockNode, selected: boolean): string {
  return [nodeClass(node.id), node.customClass, selected && "nx-pb-selected"]
    .filter(Boolean)
    .join(" ");
}

/** Build the rendered slot children, each wrapped as a SortableNode. */
function renderSlots(node: BlockNode): Record<string, ReactNode> {
  const slots: Record<string, ReactNode> = {};
  if (!node.slots) return slots;
  for (const [name, children] of Object.entries(node.slots)) {
    slots[name] = children.map((child, index) => (
      <SortableNode
        key={child.id}
        node={child}
        parentId={node.id}
        slot={name}
        index={index}
      />
    ));
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
    slots: renderSlots(node),
    className,
  });
  if (!isValidElement(element)) return element;
  return cloneElement(element as ReactElement<Record<string, unknown>>, {
    "data-nx-id": node.id,
    onClick: select,
  });
}

/** A draggable/sortable descendant node. */
function SortableNode({
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
  const className = classFor(node, selected);

  const { ref } = useSortable({
    id: node.id,
    index,
    group: `${parentId}:${slot}`,
    type: BLOCK_TYPE,
    accept: BLOCK_TYPE,
    data: { kind: "node", nodeId: node.id, parentId, slot, index },
  });

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
    slots: renderSlots(node),
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
