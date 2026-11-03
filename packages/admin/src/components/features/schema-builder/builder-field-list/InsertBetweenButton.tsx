// The "+" between two rows of the field list, at the top level or inside a
// container: it opens the field picker for a field before the lower row. It
// stays visible rather than appearing on hover, so touch users see it too.
import type { JSX } from "react";

import { Plus } from "@admin/components/icons";
import { fieldSubject } from "@admin/lib/builder/builder-announcements";

import type { BuilderField } from "../types";

type Props = {
  /** The lower row's first field, which the button names as where the field goes. */
  before: BuilderField;
  onClick: () => void;
};

export function InsertBetweenButton({ before, onClick }: Props): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="h-px flex-1 bg-border" />
      <button
        type="button"
        // Named by the field it goes before, as the Builder names a field
        // everywhere it is spoken.
        aria-label={`Add a field before ${fieldSubject(before)}`}
        onClick={onClick}
        // 24 px, the smallest touch target WCAG 2.2 sets out.
        className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
