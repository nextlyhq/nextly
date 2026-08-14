"use client";

/**
 * The block library (spec §9). Lists every registered block grouped by category, with a
 * search box and collapsible categories. Each entry is BOTH a @dnd-kit draggable source
 * (drag into the canvas) AND an "Insert" button (click / keyboard-accessible path). Where an
 * insert lands is decided by `planInsert`, which applies the same drop rules a drag does.
 */
import { useDraggable } from "@dnd-kit/react";
import { useMemo, useState } from "react";

import { defaultBlockRegistry } from "../../core/registry";
import { type BlockDefinition } from "../../core/types";
import { blockIcon, ChevronDown, ChevronRight, Search } from "../icons";
import { dragSensors } from "../logic/dragSensors";
import { planInsert } from "../logic/insertPlan";
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

  // Resolved for the CURRENT selection, so the button reflects where this block would actually
  // land — and reports that there is nowhere rather than adding it somewhere the author has to
  // go looking for. `null` is the same verdict a refused drag reaches, from the same rule.
  const target = planInsert(
    state.document.root,
    state.selectedId,
    def.type,
    defaultBlockRegistry
  );

  const insert = () => {
    if (!target) return;
    dispatch({
      type: "ADD",
      parentId: target.parentId,
      slot: target.slot,
      nodeType: def.type,
      index: target.index,
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
        disabled={!target}
        aria-label={`Insert ${def.label}`}
        title={
          target
            ? undefined
            : `${def.label} is not allowed inside the selected block or anything around it`
        }
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
