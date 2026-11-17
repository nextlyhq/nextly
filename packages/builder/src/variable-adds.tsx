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
import type * as React from "react";

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
    rows: [
      { label: "Add spacing", options: [["spacing", "Spacing"]] },
      { label: "Add radius", options: [["radius", "Radius"]] },
      { label: "Add shadow", options: [["shadow", "Shadow"]] },
    ],
    empty: "No spacing, radii or shadows yet.",
  },
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

/** A group's add rows, at the end of its list. */
export function AddRows({
  group,
  onAdd,
}: {
  group: VariableGroup;
  onAdd: (what: NewVariable) => void;
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
  onAdd: (what: NewVariable) => void;
}): React.JSX.Element {
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
        onClick={() => onAdd(only[0])}
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
        <button type="button" className="nx-vars__add-row">
          {face}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="nx-vars__menu">
        {spec.options.map(([what, label]) => (
          <DropdownMenuItem key={what} onSelect={() => onAdd(what)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
