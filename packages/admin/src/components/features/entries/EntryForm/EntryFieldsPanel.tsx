/**
 * The entry's other fields, drawn for a surface that covers the form.
 *
 * A takeover field — the page builder is the one that ships — fills the window,
 * so every other field on the document becomes unreachable without leaving the
 * editor and losing its undo history. This is what that surface offers back.
 *
 * It draws through `EntryFormContent`, the same component the form body uses,
 * rather than laying fields out itself. How a field is rendered is the entry
 * form's contract, and a second renderer here would be a copy that drifts —
 * silently, because both would look correct.
 *
 * The two groups are LABELLED rather than concatenated. A document's identity
 * and the fields a collection happens to declare answer to different things,
 * and the surveyed editors agree on presenting them apart: Webflow's page
 * settings open on name and slug before SEO and custom code, and the block
 * editor's document sidebar keeps status and permalink above the taxonomies.
 * Run together, a slug lands between two relations in an order the author has
 * no way to anticipate.
 *
 * @module components/entries/EntryForm/EntryFieldsPanel
 */

import { FormSection } from "@nextlyhq/ui";
import type { FieldConfig } from "nextly/config";
import type * as React from "react";

import { computeFieldsBeside } from "@admin/lib/builder/takeoverLayout";

import { EntryFormContent } from "./EntryFormContent";

export interface EntryFieldsPanelProps {
  /** The document's identity — title, slug. */
  page: FieldConfig[];
  /** Everything else the collection declares. */
  content: FieldConfig[];
  /** Whether the surrounding form is mid-submit. */
  disabled?: boolean;
  /** Form mode, which write-only fields adjust their affordances for. */
  mode?: "create" | "edit";
}

/**
 * Draws whichever groups have fields, and nothing for a group that has none.
 *
 * An EMPTY group is omitted rather than drawn with a heading over blank space:
 * a labelled region containing nothing reads as a control that has failed,
 * which is the same thing the panel as a whole is withheld to avoid. Whether
 * to offer the panel at all is decided before this renders — see
 * `renderEntryFields` in `EntryForm` — so this component is never asked to draw
 * two empty groups.
 */
export function EntryFieldsPanel({
  page,
  content,
  disabled,
  mode,
}: EntryFieldsPanelProps) {
  return (
    <div className="space-y-4 p-4">
      {page.length === 0 ? null : (
        <FormSection
          label="Page"
          description="How this document is identified and addressed."
        >
          <EntryFormContent fields={page} disabled={disabled} mode={mode} />
        </FormSection>
      )}
      {content.length === 0 ? null : (
        <FormSection label="Fields">
          <EntryFormContent fields={content} disabled={disabled} mode={mode} />
        </FormSection>
      )}
    </div>
  );
}

/**
 * The panel for one asking field, or NULL when it would have nothing in it.
 *
 * The whole decision in one place, because it is one decision. A caller reads
 * the answer twice — once to decide whether to offer a region and once to fill
 * it — and those must not be able to disagree; returning an element that
 * happens to render nothing is what reserved width to display blankness.
 *
 * Named and exported rather than inlined into the form's callback so the rule
 * can be exercised without standing up an entire `EntryForm`. What that leaves
 * uncovered is the form CALLING this, which no test reaches today because
 * nothing renders `EntryForm` at all.
 */
export function fieldsBesidePanel(
  allFields: FieldConfig[],
  excludePath: string,
  options: { disabled?: boolean; mode?: "create" | "edit" } = {}
): React.ReactNode | null {
  const beside = computeFieldsBeside(allFields, excludePath);
  if (beside.page.length === 0 && beside.content.length === 0) return null;
  return (
    <EntryFieldsPanel
      page={beside.page}
      content={beside.content}
      disabled={options.disabled}
      mode={options.mode}
    />
  );
}
