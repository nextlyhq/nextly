"use client";

/**
 * The block library (spec §9). Lists every registered block grouped by category, with a
 * search box and collapsible categories. Each entry is BOTH a @dnd-kit draggable source
 * (drag into the canvas) AND an "Insert" button (click / keyboard-accessible path). Inserts
 * land in the selected container's default slot, else at the end of the page root.
 */
import { useDraggable } from "@dnd-kit/react";
import { useMemo, useState } from "react";

import { defaultBlockRegistry } from "../../core/registry";
import { findNode } from "../../core/tree";
import { DEFAULT_SLOT, type BlockDefinition } from "../../core/types";
import { blockIcon, ChevronDown, ChevronRight, Search } from "../icons";
import { dragSensors } from "../logic/dragSensors";
import { useEditor } from "../store/EditorProvider";

const CATEGORY_ORDER = [
  "layout",
  "basic",
  "media",
  "content",
  "dynamic",
  "utility",
];

function LibraryItem({ def }: { def: BlockDefinition }) {
  const { state, dispatch } = useEditor();
  const { ref, isDragging } = useDraggable({
    id: `lib:${def.type}`,
    type: "nx-block",
    data: { kind: "library", blockType: def.type },
    sensors: dragSensors,
  });
  const Icon = blockIcon(def.icon);

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
      className="nx-pb-lib-item"
      data-dragging={isDragging || undefined}
      title={`Drag ${def.label} onto the canvas`}
    >
      <Icon aria-hidden />
      <span className="nx-pb-lib-item-label">{def.label}</span>
      <button
        type="button"
        className="nx-pb-lib-item-insert"
        onClick={insert}
        aria-label={`Insert ${def.label}`}
      >
        Insert
      </button>
    </div>
  );
}

function Category({ name, defs }: { name: string; defs: BlockDefinition[] }) {
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="nx-pb-lib-cat">
      <button
        type="button"
        className="nx-pb-lib-cat-btn"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Chevron aria-hidden />
        {name}
      </button>
      {open ? (
        <div className="nx-pb-lib-grid">
          {defs.map(def => (
            <LibraryItem key={def.type} def={def} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function BlockLibrary() {
  const [query, setQuery] = useState("");

  const categories = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byCategory = new Map<string, BlockDefinition[]>();
    for (const def of defaultBlockRegistry.all()) {
      if (q && !def.label.toLowerCase().includes(q)) continue;
      const list = byCategory.get(def.category) ?? [];
      list.push(def);
      byCategory.set(def.category, list);
    }
    return [...byCategory.keys()]
      .sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b))
      .map(name => ({ name, defs: byCategory.get(name)! }));
  }, [query]);

  return (
    <div>
      <div className="nx-pb-pane-header">Blocks</div>
      <div className="nx-pb-lib-search">
        <Search aria-hidden />
        <input
          type="search"
          value={query}
          placeholder="Search blocks"
          aria-label="Search blocks"
          onChange={e => setQuery(e.target.value)}
        />
      </div>
      {categories.length === 0 ? (
        <div className="nx-pb-lib-empty">No blocks match “{query}”.</div>
      ) : (
        categories.map(({ name, defs }) => (
          // Remount per query so a filtered category always shows expanded.
          <Category
            key={`${name}:${query ? "q" : ""}`}
            name={name}
            defs={defs}
          />
        ))
      )}
    </div>
  );
}
