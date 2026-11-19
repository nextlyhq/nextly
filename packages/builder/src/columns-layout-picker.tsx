"use client";

/**
 * The Columns chooser drawn on the canvas when a Columns row is first added:
 * the row's layout tiles, the same six the Content tab offers, and Skip,
 * which keeps the two equal columns it was added with.
 *
 * A pick writes what the Content tab's tile writes (`planLayout`), joined to
 * the insert as one step, so one undo still takes the whole row away. The
 * tiles are one tab stop: the arrows, Home and End move between them, Enter
 * or Space picks, and Escape skips.
 *
 * @module columns-layout-picker
 */
import { findNode } from "@nextlyhq/blocks-engine";
import { Button } from "@nextlyhq/ui";
import * as React from "react";

import { COLUMNS_LAYOUTS, planLayout } from "./columns-layout";
import type { EditorState } from "./editor-state";
import type { FirstAdd } from "./first-add";
import {
  ColumnsLayoutGlyph,
  ROW_OWN,
} from "./inspector/content/columns-layout-field";

/** The chooser's words. */
export const COLUMNS_PICKER_WORDS = {
  title: "Choose a layout",
  skip: "Skip",
} as const;

/** The tile a key moves to from `from`, or `undefined` for any other key. */
function movedTo(key: string, from: number, count: number): number | undefined {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (from + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (from - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}

export interface ColumnsLayoutPickerProps {
  readonly editor: EditorState;
  /** The step holding the row just added. */
  readonly firstAdd: FirstAdd;
  /**
   * Called once the author has picked or skipped, so the canvas can hand
   * focus back to where it was.
   */
  readonly onDone?: () => void;
}

/** "Choose a layout": the six tiles and Skip, for the row just added. */
export function ColumnsLayoutPicker({
  editor,
  firstAdd,
  onDone,
}: ColumnsLayoutPickerProps): React.JSX.Element | null {
  const titleId = React.useId();
  const [stop, setStop] = React.useState(0);
  const tiles = React.useRef<(HTMLButtonElement | null)[]>([]);
  const row = findNode(editor.document.nodes, firstAdd.nodeId);
  if (row === undefined) return null;

  const pick = (key: string) => {
    const plan = planLayout(row, key, ROW_OWN);
    // A tile a new row cannot lay out (none today: it holds only empty
    // columns) leaves the row as it was added.
    if (plan.ok) firstAdd.choose(plan.ops);
    else firstAdd.skip();
    onDone?.();
  };
  const skip = () => {
    firstAdd.skip();
    onDone?.();
  };

  return (
    <div
      className="nx-first-add__body"
      role="group"
      aria-labelledby={titleId}
      onKeyDown={event => {
        if (event.key !== "Escape") return;
        // Skip, and kept here: the canvas's own Escape would also move the
        // selection to the row's parent.
        event.preventDefault();
        event.stopPropagation();
        skip();
      }}
    >
      <p className="nx-first-add__title" id={titleId}>
        {COLUMNS_PICKER_WORDS.title}
      </p>
      <div className="nx-columns-layout__tiles nx-first-add__tiles">
        {COLUMNS_LAYOUTS.map((layout, index) => (
          <button
            key={layout.key}
            ref={element => {
              tiles.current[index] = element;
            }}
            type="button"
            className="nx-columns-layout__tile"
            data-layout={layout.key}
            tabIndex={index === stop ? 0 : -1}
            onFocus={() => setStop(index)}
            onKeyDown={event => {
              const next = movedTo(event.key, index, COLUMNS_LAYOUTS.length);
              if (next === undefined) return;
              event.preventDefault();
              setStop(next);
              tiles.current[next]?.focus();
            }}
            onClick={() => pick(layout.key)}
          >
            <ColumnsLayoutGlyph layout={layout} />
            <span>{layout.label}</span>
          </button>
        ))}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="nx-first-add__skip"
        onClick={skip}
      >
        {COLUMNS_PICKER_WORDS.skip}
      </Button>
    </div>
  );
}
