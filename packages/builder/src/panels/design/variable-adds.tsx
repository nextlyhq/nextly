/**
 * How a variable is added from the Design panel: the add rows each list ends
 * with ("+ Add colour", "+ Add spacing"…), each adding one kind or, for the
 * other values, offering a short menu of kinds, and an empty group's line.
 * Kept beside the variables view, which draws them.
 *
 * @module variable-adds
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { Plus } from "lucide-react";
import * as React from "react";

import type { NewVariable, VariableGroup } from "./tokens-studio";

/** One add row: its words, and the kinds it adds (a menu for several). */
export interface AddRowSpec {
  readonly label: string;
  readonly options: readonly [NewVariable, string][];
}

/** What each group's list ends with, and what an empty group says. */
export const ADDS: Readonly<
  Record<VariableGroup, { rows: readonly AddRowSpec[]; empty: string }>
> = {
  colours: {
    rows: [{ label: "Add colour", options: [["colour", "Colour"]] }],
    empty: "No colours yet.",
  },
  type: {
    rows: [{ label: "Add type size", options: [["type size", "Type size"]] }],
    empty: "No type sizes yet.",
  },
  spacing: {
    rows: [{ label: "Add spacing", options: [["spacing", "Spacing"]] }],
    empty: "No spacing yet.",
  },
  radius: {
    rows: [{ label: "Add radius", options: [["radius", "Radius"]] }],
    empty: "No radii yet.",
  },
  shadows: {
    rows: [{ label: "Add shadow", options: [["shadow", "Shadow"]] }],
    empty: "No shadows yet.",
  },
  // The site's one content width, built in: nothing to add beside it.
  content: { rows: [], empty: "" },
  fonts: {
    rows: [
      { label: "Add font", options: [["fontFamily", "Font"]] },
      { label: "Add font weight", options: [["fontWeight", "Font weight"]] },
    ],
    empty: "No font or weight variables yet.",
  },
  other: {
    rows: [
      {
        label: "Add value",
        options: [
          ["dimension", "Size"],
          ["number", "Number"],
          ["duration", "Duration"],
          ["custom", "Custom value"],
        ],
      },
    ],
    empty: "",
  },
};

/** An empty group's one line, above its add rows. */
export function EmptyGroup({ text }: { text: string }): React.JSX.Element {
  return <p className="nx-vars__empty">{text}</p>;
}

/**
 * What an add row reports: the kind to add, and the add row's own button,
 * where focus goes back to when the new row is not drawn once its editor
 * closes. The button rather than whatever has focus: chosen from a menu,
 * focus is on an item that goes with the menu.
 */
export type OnAdd = (what: NewVariable, from: HTMLElement | null) => void;

/** A group's add rows, at the end of its list. */
export function AddRows({
  group,
  onAdd,
}: {
  group: VariableGroup;
  onAdd: OnAdd;
}): React.JSX.Element {
  return (
    <div className="nx-vars__add-rows">
      {ADDS[group].rows.map(spec => (
        <AddRow key={spec.label} spec={spec} onAdd={onAdd} />
      ))}
    </div>
  );
}

/** "+ Add colour": a button for one kind, a menu for several. */
function AddRow({
  spec,
  onAdd,
}: {
  spec: AddRowSpec;
  onAdd: OnAdd;
}): React.JSX.Element {
  const trigger = React.useRef<HTMLButtonElement>(null);
  const face = (
    <>
      <Plus aria-hidden="true" size={14} />
      {spec.label}
    </>
  );
  const [only] = spec.options;
  if (spec.options.length === 1 && only !== undefined) {
    return (
      <button
        type="button"
        className="nx-vars__add-row"
        onClick={event => onAdd(only[0], event.currentTarget)}
      >
        {face}
      </button>
    );
  }
  return (
    // Not modal: a modal menu marks the panel around it aria-hidden while
    // its rows stay focusable (axe: aria-hidden-focus).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button ref={trigger} type="button" className="nx-vars__add-row">
          {face}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="nx-vars__menu">
        {spec.options.map(([what, label]) => (
          <DropdownMenuItem
            key={what}
            onSelect={() => onAdd(what, trigger.current)}
          >
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
