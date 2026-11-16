/**
 * Two small parts of the variables view, kept beside it: the button a Design
 * group's heading becomes when the group folds, and the view's own search
 * box, for a view no host searches for.
 *
 * @module design-group-toggle
 */
import { Input } from "@nextlyhq/ui";
import { ChevronDown, Search } from "lucide-react";
import * as React from "react";

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
      <span className="nx-vars__group-label">{heading}</span>
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
