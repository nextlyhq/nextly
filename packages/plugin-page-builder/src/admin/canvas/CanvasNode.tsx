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
import { documentKey, nodeClass } from "../../core/style-compiler";
import type { BlockNode } from "../../core/types";
import { BlockErrorBoundary } from "../../render/ErrorBoundary";
import { QUERY_LOOP_TYPE } from "../../render/query/types";
import { dragSensors } from "../logic/dragSensors";
import { useEditor } from "../store/EditorProvider";

import { QueryLoopSamplePreview } from "./CanvasQueryLoop";
import { DropZone } from "./DropZone";

const BLOCK_TYPE = "nx-block";

/** Visual stand-in shown on the canvas for a block whose render() is empty (e.g. an
 *  Image with no source), so it stays visible and selectable at author time. */
const placeholderStyle = {
  padding: "14px 16px",
  fontSize: 13,
  color: "var(--nx-pb-ed-muted-foreground)",
  border: "1px dashed var(--nx-pb-ed-border-strong)",
  borderRadius: 6,
  textAlign: "center" as const,
  background: "var(--nx-pb-ed-muted)",
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
  extra: (string | false | undefined)[] = [],
  // The document's map, so the preview markup carries the class the compiled
  // stylesheet targets even where two node ids hash alike.
  classes?: ReadonlyMap<string, string>
): string {
  return [
    // Composed the same way the compiler names a document node. The map is keyed by
    // `documentKey(id)` so a library node reached through `core/ref` cannot share an entry with a
    // document node of the same id — reading it by the bare id always misses, and the preview
    // silently falls back to the undisambiguated class while the compiled sheet targets the
    // suffixed one.
    classes?.get(documentKey(node.id)) ?? nodeClass(node.id),
    node.customClass,
    selected && "nx-pb-selected",
    ...extra,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Render a slot's children with drop targets (parity-safe per container type). */
function renderSlot(
  node: BlockNode,
  slotName: string,
  ownerPath: readonly string[]
): ReactNode {
  const children = node.slots?.[slotName] ?? [];
  if (children.length === 0) {
    return (
      <DropZone
        key="dz-empty"
        parentId={node.id}
        ownerPath={ownerPath}
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
        parentPath={ownerPath}
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
      <DropZone
        key={`dz-${i}`}
        parentId={node.id}
        ownerPath={ownerPath}
        slot={slotName}
        index={i}
      />
    );
    out.push(
      <DraggableNode
        key={child.id}
        node={child}
        parentId={node.id}
        parentPath={ownerPath}
        slot={slotName}
        index={i}
      />
    );
  });
  out.push(
    <DropZone
      key={`dz-${children.length}`}
      parentId={node.id}
      ownerPath={ownerPath}
      slot={slotName}
      index={children.length}
    />
  );
  return out;
}

function buildSlots(
  node: BlockNode,
  ownerPath: readonly string[]
): Record<string, ReactNode> {
  const slots: Record<string, ReactNode> = {};
  if (node.slots) {
    for (const name of Object.keys(node.slots)) {
      slots[name] = renderSlot(node, name, ownerPath);
    }
  }
  return slots;
}

/** Root renderer — the page container, not itself draggable. */
export function CanvasNode({ node }: { node: BlockNode }): ReactNode {
  const { state, remotePatterns, nodeClasses } = useEditor();
  const def = defaultBlockRegistry.get(node.type);
  const selected = state.selectedId === node.id;
  const className = classFor(node, selected, [], nodeClasses);

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
    slots: buildSlots(node, [node.id]),
    className,
    // The canvas renders the same blocks the published page does, so it has to
    // hand them the same allowlist. Without it every block falls back to an
    // empty one and the preview hides images the page will show.
    remotePatterns,
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
  parentPath,
  slot,
  index,
  dropBeforeIndex,
}: {
  node: BlockNode;
  parentId: string;
  /** Root-first ids of the PARENT and its ancestors, the parent last. */
  parentPath: readonly string[];
  slot: string;
  index: number;
  /** When set (grid child), this element is also an "insert before" drop target. */
  dropBeforeIndex?: number;
}): ReactNode {
  const { state, remotePatterns, nodeClasses } = useEditor();
  const def = defaultBlockRegistry.get(node.type);
  const selected = state.selectedId === node.id;

  // This node's own root-first path. Derived once so the two droppables below
  // and the recursive slot render cannot disagree about where this node sits.
  const selfPath = [...parentPath, node.id];

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
    data: {
      kind: "dropzone",
      parentId,
      ownerPath: parentPath,
      slot,
      index: dropBeforeIndex ?? 0,
    },
    // Owned by the PARENT, though it is registered on this node's own element
    // (see the merged ref below). Its priority is therefore the parent's, which
    // is what lets this node's own zones outrank it while the pointer is
    // inside this node.
    collisionPriority: parentPath.length,
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
      ownerPath: selfPath,
      slot: "default",
      index: appendIndex,
    },
    // Owned by THIS node rather than its parent, so one level deeper than the
    // `before` target above. Both sit on the same element; only the priority
    // separates which slot a drop at this point belongs to.
    collisionPriority: selfPath.length,
  });

  const className = classFor(
    node,
    selected,
    [
      isDragging && "nx-pb-dragging",
      before.isDropTarget && "nx-pb-drop-before",
      append.isDropTarget && "nx-pb-drop-append",
    ],
    nodeClasses
  );

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
    slots: buildSlots(node, selfPath),
    className,
    // The canvas renders the same blocks the published page does, so it has to
    // hand them the same allowlist. Without it every block falls back to an
    // empty one and the preview hides images the page will show.
    remotePatterns,
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

  // The Query Loop keeps its editable template, and we APPEND a read-only sample-data
  // preview after it so the author sees how the template maps to real entries (spec §5).
  const el = element as ReactElement<Record<string, unknown>>;
  const augmented =
    node.type === QUERY_LOOP_TYPE
      ? cloneElement(
          el,
          { "data-nx-id": node.id, ref },
          (el.props as { children?: ReactNode }).children,
          <QueryLoopSamplePreview key="__nx-sample" node={node} />
        )
      : cloneElement(el, { "data-nx-id": node.id, ref });

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
            color: "var(--nx-pb-ed-destructive)",
            border:
              "1px dashed color-mix(in srgb, var(--nx-pb-ed-destructive) 50%, transparent)",
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
