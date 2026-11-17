"use client";

/**
 * The Colours tab's usage filter: "All", "Unused" and "Used on this page",
 * as pills above the colour list, "All" by default.
 *
 * "Unused" lists only what the site's count has shown unused, and says
 * "Counting usage…" while the count is not whole rather than guess; "Used on
 * this page" lists what the open page and its components use, as the host
 * reads them from the editor's document, so it follows unsaved edits.
 *
 * @module colour-usage-filter
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { keepsColour, namedBySite, type ColourFilter } from "./colour-usage";
import type { VariableEntry, VariableGroup } from "./tokens-studio";
import { usageState, type UsageState } from "./variable-usage";
import type { VariableUsageHere } from "./variable-usage-view";

/** The choices, in the order they are offered. */
const CHOICES: readonly { value: ColourFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unused", label: "Unused" },
  { value: "page", label: "Used on this page" },
];

interface Listed {
  readonly group: VariableGroup;
  readonly heading: string;
  readonly entries: readonly VariableEntry[];
}

/**
 * The groups with the colours narrowed to the filter, and the filter to
 * draw above them; nothing to draw where the view lists no colours.
 */
export function useColourFilter<G extends Listed>({
  shown,
  tokens,
  usage,
  usedOnPage,
  openKey,
}: {
  shown: readonly G[];
  tokens: SiteTokenSet | undefined;
  usage: VariableUsageHere | undefined;
  usedOnPage: ReadonlySet<string> | undefined;
  /** The row whose editor is open, listed whatever the filter. */
  openKey: string | null;
}): { shown: readonly G[]; control: React.ReactNode } {
  const [filter, setFilter] = React.useState<ColourFilter>("all");
  const named = React.useMemo(() => namedBySite(tokens), [tokens]);
  const colours = shown.find(group => group.group === "colours");
  if (colours === undefined) return { shown, control: null };
  const stateOf = (entry: VariableEntry): UsageState =>
    usageState(
      usage?.reachOf(entry.row.identity),
      named.has(entry.row.identity)
    );
  const keeps = (entry: VariableEntry): boolean =>
    entry.row.key === openKey ||
    keepsColour(
      filter,
      stateOf(entry),
      usedOnPage?.has(entry.row.identity) === true
    );
  const counting =
    filter === "unused" &&
    colours.entries.some(entry => stateOf(entry) === "counting");
  return {
    shown: shown.map(group =>
      group === colours
        ? { ...group, entries: group.entries.filter(keeps) }
        : group
    ),
    control: (
      <ColourUsageFilter
        value={filter}
        onChange={setFilter}
        counting={counting}
      />
    ),
  };
}

/** The pills, a radio group the arrow keys move through, and its note. */
function ColourUsageFilter({
  value,
  onChange,
  counting,
}: {
  value: ColourFilter;
  onChange: (value: ColourFilter) => void;
  counting: boolean;
}): React.JSX.Element {
  const buttons = React.useRef(new Map<ColourFilter, HTMLButtonElement>());
  const move = (by: -1 | 1): void => {
    const at = CHOICES.findIndex(choice => choice.value === value);
    const next = CHOICES[(at + by + CHOICES.length) % CHOICES.length];
    if (next === undefined) return;
    onChange(next.value);
    buttons.current.get(next.value)?.focus();
  };
  return (
    <div className="nx-usage-filter">
      <div
        className="nx-usage-filter__choices"
        role="radiogroup"
        aria-label="Show colours"
        onKeyDown={event => {
          const by = arrowStep(event.key);
          if (by === undefined) return;
          event.preventDefault();
          move(by);
        }}
      >
        {CHOICES.map(choice => (
          <button
            key={choice.value}
            ref={button => {
              if (button === null) buttons.current.delete(choice.value);
              else buttons.current.set(choice.value, button);
            }}
            type="button"
            role="radio"
            className="nx-usage-filter__choice"
            aria-checked={choice.value === value}
            // One stop in the tab order, on the choice made.
            tabIndex={choice.value === value ? 0 : -1}
            onClick={() => onChange(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {counting ? (
        <p className="nx-usage-filter__note" role="status">
          Counting usage…
        </p>
      ) : null}
    </div>
  );
}

/** Which way an arrow key moves through the choices, or none. */
function arrowStep(key: string): -1 | 1 | undefined {
  if (key === "ArrowRight" || key === "ArrowDown") return 1;
  return key === "ArrowLeft" || key === "ArrowUp" ? -1 : undefined;
}
