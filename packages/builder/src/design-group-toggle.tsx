/**
 * Small parts of the variables view, kept beside it: the button a Design
 * group's heading becomes when the group folds, the view's own search box
 * for a view no host searches for, what the view searches for, which groups
 * it lists, and its scrolling body.
 *
 * @module design-group-toggle
 */
import type { SiteTokenSet, TokenMode } from "@nextlyhq/blocks-engine";
import { Input } from "@nextlyhq/ui";
import { ChevronDown, Search } from "lucide-react";
import * as React from "react";

import { variableGroups, type VariableGroup } from "./tokens-studio";

/**
 * A Design group's heading as the button that folds it, with how many it
 * holds. Exported so every Design group folds the same way, the ones other
 * panels draw included.
 */
export function GroupToggle({
  heading,
  count,
  open,
  onToggle,
}: {
  heading: string;
  count: number;
  open: boolean;
  /** Absent while it cannot fold, as during a search. */
  onToggle: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="nx-vars__group-toggle"
      // Said as "Colours, 12", with the state its expanded flag gives.
      aria-label={`${heading}, ${count}`}
      aria-expanded={open}
      aria-disabled={onToggle === undefined ? true : undefined}
      onClick={onToggle}
    >
      <ChevronDown
        aria-hidden="true"
        size={14}
        className="nx-vars__group-chevron"
      />
      {/* A real space between heading and count, which the flex row does not
          draw: the words drawn stay apart, so the name holds them. */}
      <span className="nx-vars__group-label">{heading}</span>{" "}
      <span className="nx-vars__group-count">{count}</span>
    </button>
  );
}

/** A variables view's own search box, drawn only where no host searches for it. */
/** What the view's own search box is drawn from. */
interface OwnSearchProps {
  /** Whether it is drawn at all: not where a host keeps the search. */
  shown: boolean;
  query: string;
  onQuery: (query: string) => void;
}

export const OwnSearch: React.ForwardRefExoticComponent<
  OwnSearchProps & React.RefAttributes<HTMLInputElement>
> = React.forwardRef<HTMLInputElement, OwnSearchProps>(function OwnSearch(
  { shown, query, onQuery },
  ref
) {
  if (!shown) return null;
  return (
    <div className="nx-vars__search">
      <Search aria-hidden="true" size={16} />
      <Input
        ref={ref}
        type="search"
        aria-label="Search variables"
        placeholder="Search variables"
        value={query}
        onChange={event => onQuery(event.target.value)}
      />
    </div>
  );
});

/**
 * What the view searches for: the host's search where it keeps one, else
 * the view's own, with the needle both are matched by.
 */
export function useViewSearch(hostSearch: string | undefined): {
  query: string;
  needle: string;
  /** Whether a search is on. */
  searching: boolean;
  setQuery: (query: string) => void;
  /** Whether the view draws its own search box. */
  own: boolean;
} {
  const [ownQuery, setQuery] = React.useState("");
  const query = hostSearch ?? ownQuery;
  const needle = query.trim().toLowerCase();
  return {
    query,
    needle,
    searching: needle !== "",
    setQuery,
    own: hostSearch === undefined,
  };
}

/** The groups of the variables, narrowed to the ones this view lists. */
export function useListedGroups(
  tokens: SiteTokenSet | undefined,
  mode: TokenMode,
  listed: readonly VariableGroup[] | undefined
): ReturnType<typeof variableGroups> {
  return React.useMemo(
    () =>
      tokens === undefined
        ? []
        : variableGroups(tokens, mode).filter(
            group => listed === undefined || listed.includes(group.group)
          ),
    [tokens, mode, listed]
  );
}

/** A data attribute's value for a flag: present and empty, or absent. */
export function markOf(flag: boolean): "" | undefined {
  return flag ? "" : undefined;
}

/** The view's scrolling body: its notes, the header's reports, its groups. */
export function ViewBody({
  notes,
  overlays,
  adds,
  children,
}: {
  notes: React.ReactNode;
  overlays: React.ReactNode;
  /** The adds of groups hidden while empty, after the groups. */
  adds: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="nx-vars__body">
      {notes}
      {overlays}
      {children}
      {adds}
    </div>
  );
}
