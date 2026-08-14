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
 *  - Inside a slot whose children are laid out by flex or grid, a between-child <div> would
 *    become a cell of that layout — taking a gap and shifting everything after it — so those
 *    children render directly; each child is an "insert-before" droppable and the container
 *    itself is an "append" droppable (highlight, no layout box). Which slots those are is
 *    declared by `childLayout` on the slot, not decided here.
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

import { declaredSlotsOf } from "../../core/block-structure";
import { defaultBlockRegistry } from "../../core/registry";
import { documentKey, nodeClass } from "../../core/style-compiler";
import { DEFAULT_SLOT, type BlockNode } from "../../core/types";
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

/**
 * Whether a slot's children are laid out by a flex or grid container.
 *
 * Read from the slot's own declaration rather than matched against a list of type names here:
 * every block that lays its children out that way needs the same treatment, and a name test only
 * covers the ones whoever wrote it happened to think of. The registry is asked first because a
 * caller-supplied definition is the whole answer about its own slots; structure answers where no
 * definition is registered, which is the state the config and server paths run in.
 */
export function slotIsFormatted(node: BlockNode, slotName: string): boolean {
  const def = defaultBlockRegistry.get(node.type);
  const slots = def ? def.slots : declaredSlotsOf(node.type);
  return slots?.find(s => s.name === slotName)?.childLayout === "formatted";
}

/** Every slot this node declares whose children it lays out formatted. */
function formattedSlotsOf(node: BlockNode): string[] {
  const def = defaultBlockRegistry.get(node.type);
  const slots = def ? def.slots : declaredSlotsOf(node.type);
  return (slots ?? [])
    .filter(spec => spec.childLayout === "formatted")
    .map(spec => spec.name);
}

/**
 * The slot an "append into me" drop target should add to, or `null` for none.
 *
 * A formatted slot renders no trailing drop zone — an element after its children would become a
 * cell of its layout — so reaching the end of one needs a target on the container itself. Which
 * slot that is has to be DERIVED, because a container may declare a formatted slot under any name;
 * naming `default` here would leave a custom container's `items` slot reachable for insert-before
 * and unreachable for append.
 *
 * Two conditions return `null`, and both are about one element being unable to carry two intents:
 *
 * - the node is itself a child of a formatted slot, so this element already holds the "insert
 *   before me" target. Two droppables on one element share a rectangle and a priority, so the one
 *   registered first takes every collision, and registering a second states a capability the canvas
 *   does not have.
 * - the node declares MORE THAN ONE formatted slot, which is the same collision between two
 *   appends. Nothing on the element distinguishes which slot a pointer means.
 *
 * The honest consequence in both cases: no target for "append after the last child". Reaching it
 * needs the intents separated by REGION rather than by element, which is drop-zone geometry rather
 * than a flag.
 */
export function appendTargetSlot(
  node: BlockNode,
  isChildOfFormattedSlot: boolean
): string | null {
  if (isChildOfFormattedSlot) return null;
  const formatted = formattedSlotsOf(node);
  return formatted.length === 1 ? formatted[0] : null;
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

  // A flex or grid slot: render children directly, each its own insert-before droppable. A
  // between-child div would become a cell of that layout and shift everything after it.
  if (slotIsFormatted(node, slotName)) {
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
  const { state, remotePatterns, nodeClasses } = useEditor();
  const def = defaultBlockRegistry.get(node.type);
  const selected = state.selectedId === node.id;

  // The root gets an append target on the same terms a descendant does. A formatted slot draws no
  // trailing drop zone, and the root is rendered here rather than by `DraggableNode` — so a
  // document whose ROOT is a Columns row or a Row had insert-before targets and no way to reach
  // the end of it. Never a child of anything, so the collision the flag guards cannot arise.
  const appendSlot = appendTargetSlot(node, false);
  const append = useDroppable({
    id: `append:${node.id}`,
    type: BLOCK_TYPE,
    accept: BLOCK_TYPE,
    disabled: appendSlot === null,
    data: {
      kind: "dropzone",
      parentId: node.id,
      slot: appendSlot ?? DEFAULT_SLOT,
      index: appendSlot ? (node.slots?.[appendSlot]?.length ?? 0) : 0,
    },
  });
  const rootRef = appendSlot ? append.ref : undefined;
  const className = classFor(
    node,
    selected,
    [append.isDropTarget && "nx-pb-drop-append"],
    nodeClasses
  );

  if (!def) {
    return (
      <div
        ref={rootRef}
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
    // The canvas renders the same blocks the published page does, so it has to
    // hand them the same allowlist. Without it every block falls back to an
    // empty one and the preview hides images the page will show.
    remotePatterns,
  });
  if (!isValidElement(element)) {
    return (
      <div
        ref={rootRef}
        className={className}
        data-nx-id={node.id}
        style={placeholderStyle}
      >
        {def.label} — click to configure
      </div>
    );
  }
  return cloneElement(element as ReactElement<Record<string, unknown>>, {
    "data-nx-id": node.id,
    ...(rootRef ? { ref: rootRef } : {}),
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
  /** When set (a child of a formatted slot), this element is also an "insert before" target. */
  dropBeforeIndex?: number;
}): ReactNode {
  const { state, remotePatterns, nodeClasses } = useEditor();
  const def = defaultBlockRegistry.get(node.type);
  const selected = state.selectedId === node.id;

  const { ref: dragRef, isDragging } = useDraggable({
    id: node.id,
    type: BLOCK_TYPE,
    data: { kind: "node", nodeId: node.id, parentId, slot, index },
    sensors: dragSensors,
  });

  // A child of a formatted slot: "insert before me" target.
  const before = useDroppable({
    id: `before:${node.id}`,
    type: BLOCK_TYPE,
    accept: BLOCK_TYPE,
    disabled: dropBeforeIndex == null,
    data: { kind: "dropzone", parentId, slot, index: dropBeforeIndex ?? 0 },
  });

  // A formatted container itself: "append" target for the formatted slot it declares, since that
  // slot draws no trailing DropZone. `dropBeforeIndex` being set means this element already
  // carries the parent's "insert before" target, which is one of the cases the rule excludes.
  const appendSlot = appendTargetSlot(node, dropBeforeIndex != null);
  const appendIndex = appendSlot ? (node.slots?.[appendSlot]?.length ?? 0) : 0;
  const append = useDroppable({
    id: `append:${node.id}`,
    type: BLOCK_TYPE,
    accept: BLOCK_TYPE,
    disabled: appendSlot === null,
    data: {
      kind: "dropzone",
      parentId: node.id,
      slot: appendSlot ?? DEFAULT_SLOT,
      index: appendIndex,
    },
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

  const ref = mergeRefs(
    dragRef,
    before.ref,
    appendSlot ? append.ref : undefined
  );

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
