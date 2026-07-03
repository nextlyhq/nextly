"use client";

/**
 * The block library (spec §9). Lists every registered block grouped by category. Each
 * entry is BOTH a @dnd-kit draggable source (drag into the canvas) AND an "Insert" button
 * (click-to-insert) — the button is the keyboard-accessible, always-reliable path, while
 * drag is the pointer affordance. Inserts land in the selected container's default slot,
 * else at the end of the page root.
 */
import { useDraggable } from "@dnd-kit/react";

import { defaultBlockRegistry } from "../../core/registry";
import { findNode } from "../../core/tree";
import { DEFAULT_SLOT, type BlockDefinition } from "../../core/types";
import { useEditor } from "../store/EditorProvider";

const CATEGORY_ORDER = ["basic", "layout", "media", "dynamic"];

function LibraryItem({ def }: { def: BlockDefinition }) {
  const { state, dispatch } = useEditor();
  const { ref, isDragging } = useDraggable({
    id: `lib:${def.type}`,
    type: "nx-block",
    data: { kind: "library", blockType: def.type },
  });

  const insert = () => {
    const root = state.document.root;
    const selected = state.selectedId
      ? findNode(root, state.selectedId)
      : undefined;
    const container =
      selected && defaultBlockRegistry.get(selected.type)?.isContainer
        ? selected
        : root;
    const slot = DEFAULT_SLOT;
    const index = container.slots?.[slot]?.length ?? 0;
    dispatch({
      type: "ADD",
      parentId: container.id,
      slot,
      nodeType: def.type,
      index,
    });
  };

  return (
    <div
      ref={ref}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 6,
        padding: "6px 8px",
        marginBottom: 4,
        border: "1px solid #e5e7eb",
        borderRadius: 6,
        background: "#fff",
        cursor: "grab",
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <span style={{ fontSize: 13 }}>{def.label}</span>
      <button
        type="button"
        onClick={insert}
        aria-label={`Insert ${def.label}`}
        style={{
          fontSize: 11,
          padding: "2px 8px",
          border: "1px solid #d1d5db",
          borderRadius: 4,
          background: "#f9fafb",
          cursor: "pointer",
        }}
      >
        Insert
      </button>
    </div>
  );
}

export function BlockLibrary() {
  const defs = defaultBlockRegistry.all();
  const byCategory = new Map<string, BlockDefinition[]>();
  for (const def of defs) {
    const list = byCategory.get(def.category) ?? [];
    list.push(def);
    byCategory.set(def.category, list);
  }
  const categories = [...byCategory.keys()].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b)
  );

  return (
    <div>
      {categories.map(cat => (
        <div key={cat} style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              color: "#9ca3af",
              marginBottom: 4,
            }}
          >
            {cat}
          </div>
          {byCategory.get(cat)!.map(def => (
            <LibraryItem key={def.type} def={def} />
          ))}
        </div>
      ))}
    </div>
  );
}
