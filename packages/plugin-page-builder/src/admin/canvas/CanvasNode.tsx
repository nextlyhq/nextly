"use client";

/**
 * Canvas rendering of one block (spec §9). Uses the SAME production block render (true
 * WYSIWYG — no wrapper div), then augments the block's own element with a stable
 * `data-nx-id` and a click-to-select handler, plus a selection outline class. Recurses
 * into slots.
 */
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
import { useEditor } from "../store/EditorProvider";

export function CanvasNode({ node }: { node: BlockNode }): ReactNode {
  const { state, dispatch } = useEditor();
  const def = defaultBlockRegistry.get(node.type);
  const selected = state.selectedId === node.id;
  const className = [
    nodeClass(node.id),
    node.customClass,
    selected && "nx-pb-selected",
  ]
    .filter(Boolean)
    .join(" ");

  if (!def) {
    return (
      <div
        data-nx-id={node.id}
        data-nx-unknown={node.type}
        className={className}
      />
    );
  }

  const slots: Record<string, ReactNode> = {};
  if (node.slots) {
    for (const [name, children] of Object.entries(node.slots)) {
      slots[name] = children.map(child => (
        <CanvasNode key={child.id} node={child} />
      ));
    }
  }

  const select = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: "SELECT", id: node.id });
  };

  const element = def.render({ props: node.props, node, slots, className });
  if (!isValidElement(element)) return element;

  return cloneElement(element as ReactElement<Record<string, unknown>>, {
    "data-nx-id": node.id,
    onClick: select,
  });
}
