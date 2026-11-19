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
import { tokenIdentity, type SiteTokenSet } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { keepsColour, type ColourFilter } from "./colour-usage";
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
  hidden,
}: {
  shown: readonly G[];
  /** The site's variables, whose change can make a colour used or unused. */
  tokens: SiteTokenSet | undefined;
  usage: VariableUsageHere | undefined;
  usedOnPage: ReadonlySet<string> | undefined;
  /** The row whose editor is open, listed whatever the filter. */
  openKey: string | null;
  /** The built-in colours the site hides, left out whatever the filter. */
  hidden?: ReadonlySet<string>;
}): { shown: readonly G[]; control: React.ReactNode } {
  const [filter, setFilter] = React.useState<ColourFilter>("all");
  const colours = shown.find(group => group.group === "colours");
  useCountsAfterChange(filter === "unused", usage, tokens);
  if (colours === undefined) return { shown, control: null };
  const stateOf = (entry: VariableEntry): UsageState =>
    usageState(usage?.reachOf(entry.row.identity));
  const keeps = (entry: VariableEntry): boolean =>
    entry.row.key === openKey ||
    (hidden?.has(entry.row.identity) !== true &&
      keepsColour(
        filter,
        stateOf(entry),
        usedOnPage?.has(entry.row.identity) === true
      ));
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

/** How long after a change of the variables the counts are read again. */
const RECOUNT_AFTER_MS = 800;

/**
 * Reads the colours' counts again a moment after the site's variables change,
 * once Unused is chosen: an edit that names a colour through another
 * variable, or stops naming it, changes whether it is used, and the counts
 * say so once the change is saved. A change made under another filter is
 * kept as owed, and read when Unused is chosen.
 */
function useCountsAfterChange(
  unused: boolean,
  usage: VariableUsageHere | undefined,
  tokens: SiteTokenSet | undefined
): void {
  const seen = React.useRef(tokens);
  const owed = React.useRef(false);
  const latest = React.useRef(usage);
  latest.current = usage;
  React.useEffect(() => {
    if (seen.current !== tokens) owed.current = true;
    seen.current = tokens;
    const read = latest.current;
    if (!unused || !owed.current || read === undefined) return undefined;
    // Every colour the site has, whatever a search lists now: a change can
    // name, or stop naming, one the search hides.
    const colours = (tokens?.tokens ?? [])
      .filter(token => token.kind === "color")
      .map(tokenIdentity);
    const timer = window.setTimeout(() => {
      owed.current = false;
      void read.readAgain(colours);
    }, RECOUNT_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [tokens, unused]);
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
