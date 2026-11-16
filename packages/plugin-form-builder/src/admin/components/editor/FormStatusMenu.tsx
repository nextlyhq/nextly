"use client";

/**
 * The form's status in the editor's bar: a chip that opens a menu of the three
 * states. Picking one is an unsaved change of the form, saved with the rest.
 *
 * @module admin/components/editor/FormStatusMenu
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { ChevronDown } from "lucide-react";
import type { JSX } from "react";

/** A form's stored status. */
export type FormStatus = "draft" | "published" | "closed";

/**
 * Each state as the editor names it, what it means for a visitor, and the
 * colour of its dot. "Live" for `published`: the word a person uses for a form
 * that is taking answers. Draft has no dot, as nothing is happening yet.
 */
const STATES: readonly {
  value: FormStatus;
  label: string;
  means: string;
  dot: string | null;
}[] = [
  {
    value: "published",
    label: "Live",
    means: "Accepting submissions",
    dot: "bg-success-solid",
  },
  {
    value: "closed",
    label: "Closed",
    means: "Shows the closed message",
    dot: "bg-muted-foreground",
  },
  { value: "draft", label: "Draft", means: "Not on the site yet", dot: null },
];

/** The state a stored value names; an unknown one reads as Draft. */
function stateOf(status: FormStatus): (typeof STATES)[number] {
  return STATES.find(state => state.value === status) ?? STATES[2];
}

/** A stored value a menu pick names, or `undefined` for anything else. */
function statusOf(value: string): FormStatus | undefined {
  return STATES.find(state => state.value === value)?.value;
}

export interface FormStatusMenuProps {
  /** The form's status, as edited. */
  status: FormStatus;
  /** A state was picked. */
  onChange: (status: FormStatus) => void;
  /** Nothing may change: a colleague holds the form, or a save is running. */
  disabled?: boolean;
}

export function FormStatusMenu({
  status,
  onChange,
  disabled = false,
}: FormStatusMenuProps): JSX.Element {
  const current = stateOf(status);
  return (
    // Not modal: a menu in the bar has no reason to hide the page from
    // assistive technology while it is open. Focus still moves into it, and
    // Escape or a click outside closes it.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        // Named by its state, so a screen reader hears "Status: Live, menu"
        // rather than a bare word with no hint of what it is.
        aria-label={`Status: ${current.label}`}
        disabled={disabled}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        {current.dot === null ? null : (
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full ${current.dot}`}
          />
        )}
        {current.label}
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuRadioGroup
          value={status}
          onValueChange={value => {
            const next = statusOf(value);
            if (next !== undefined && next !== status) onChange(next);
          }}
        >
          {STATES.map(state => (
            <DropdownMenuRadioItem
              key={state.value}
              value={state.value}
              className="items-start py-2"
            >
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{state.label}</span>
                <span className="text-xs text-muted-foreground">
                  {state.means}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
