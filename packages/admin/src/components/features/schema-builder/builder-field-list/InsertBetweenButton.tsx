// The "+" between two rows of the field list, at the top level or inside a
// container: it opens the field picker for a field before the lower row. It
// stays visible rather than appearing on hover, so touch users see it too.
import type { JSX } from "react";

import { Plus } from "@admin/components/icons";

type Props = {
  /** The lower row's label, which the button names as where the field goes. */
  beforeLabel: string;
  onClick: () => void;
};

export function InsertBetweenButton({
  beforeLabel,
  onClick,
}: Props): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="h-px flex-1 bg-border" />
      <button
        type="button"
        aria-label={`Add a field before ${beforeLabel}`}
        title={`Add a field before ${beforeLabel}`}
        onClick={onClick}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="h-3 w-3" />
      </button>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
