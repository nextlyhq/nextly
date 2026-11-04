/**
 * A select drawn as the admin's menu: a button naming the current choice, and
 * a menu of radio items. Used where Fonts offers one of a short list (a
 * weight, a category), so no native select is ever drawn.
 *
 * @module font-choice-menu
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { ChevronDown } from "lucide-react";
import type * as React from "react";

export interface ChoiceMenuProps<V extends string> {
  /** What the control is, said before its value: "Weight", "Category". */
  readonly label: string;
  readonly value: V;
  readonly options: ReadonlyArray<readonly [V, string]>;
  readonly onChange: (value: V) => void;
  readonly disabled?: boolean;
  readonly id?: string;
}

export function ChoiceMenu<V extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  id,
}: ChoiceMenuProps<V>): React.JSX.Element {
  const shown = options.find(([option]) => option === value)?.[1] ?? value;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          id={id}
          className="nx-fonts__choice"
          aria-label={`${label}, ${shown}`}
        >
          <span className="nx-fonts__choice-value">{shown}</span>
          <ChevronDown aria-hidden="true" size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="nx-vars__menu">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={next => {
            const picked = options.find(([option]) => option === next);
            if (picked !== undefined) onChange(picked[0]);
          }}
        >
          {options.map(([option, words]) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {words}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
