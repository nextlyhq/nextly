/**
 * How a variable is added from the Design panel: what each group's "+"
 * offers, the "+" itself (a button for one kind, a menu for several, with
 * its words beside it where no heading is), and an empty group's line.
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

/** What each group's "+" offers: one variable, or a short menu of kinds. */
export const ADDS: Readonly<
  Record<
    VariableGroup,
    { label: string; empty: string; options: readonly [NewVariable, string][] }
  >
> = {
  colours: {
    label: "Add colour",
    empty: "No colours yet.",
    options: [["colour", "Colour"]],
  },
  type: {
    label: "Add type size",
    empty: "No type sizes yet.",
    options: [["type size", "Type size"]],
  },
  spacing: {
    label: "Add spacing, radius or shadow",
    empty: "No spacing, radii or shadows yet.",
    options: [
      ["spacing", "Spacing"],
      ["radius", "Radius"],
      ["shadow", "Shadow"],
    ],
  },
  fonts: {
    label: "Add font or weight variable",
    empty: "No font or weight variables yet.",
    options: [
      ["fontFamily", "Font"],
      ["fontWeight", "Font weight"],
    ],
  },
  other: {
    label: "Add another variable",
    empty: "",
    options: [
      ["dimension", "Size"],
      ["number", "Number"],
      ["duration", "Duration"],
      ["custom", "Custom value"],
    ],
  },
};

/** An empty group's one line; an empty type scale offers its add here. */
export function EmptyGroup({
  group,
  text,
  readOnly,
  onAdd,
}: {
  group: VariableGroup;
  text: string;
  readOnly: boolean;
  onAdd: (what: NewVariable) => void;
}): React.JSX.Element {
  return (
    <p className="nx-vars__empty">
      {text}
      {group === "type" && !readOnly ? (
        <button
          type="button"
          className="nx-vars__link"
          onClick={() => onAdd("type size")}
        >
          Add type size
        </button>
      ) : null}
    </p>
  );
}

/** A group's "+": a button for one kind, a menu for several. */
export function AddButton({
  adds,
  onAdd,
  worded = false,
}: {
  adds: (typeof ADDS)[VariableGroup];
  onAdd: (what: NewVariable) => void;
  /** Its words shown beside the "+", for an add with no heading beside it. */
  worded?: boolean;
}): React.JSX.Element {
  const icon = <Plus aria-hidden="true" size={14} />;
  const face = worded ? (
    <>
      {icon}
      {adds.label}
    </>
  ) : (
    icon
  );
  const look = worded
    ? { className: "nx-vars__link nx-vars__worded-add" }
    : {
        className: "nx-vars__icon-button nx-vars__add",
        "aria-label": adds.label,
        title: adds.label,
      };
  const [only] = adds.options;
  if (adds.options.length === 1 && only !== undefined) {
    return (
      <button type="button" {...look} onClick={() => onAdd(only[0])}>
        {face}
      </button>
    );
  }
  return (
    // Not modal: a modal menu marks the editor around it aria-hidden while
    // its controls stay focusable (axe: aria-hidden-focus).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" {...look}>
          {face}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="nx-vars__menu">
        {adds.options.map(([what, label]) => (
          <DropdownMenuItem key={what} onSelect={() => onAdd(what)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
