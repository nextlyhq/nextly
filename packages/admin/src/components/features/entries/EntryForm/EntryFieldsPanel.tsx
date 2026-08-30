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
import { PublicUrlChangeNotice } from "./PublicUrlChangeNotice";

export interface EntryFieldsPanelProps {
  /** The document's identity — title, slug. */
  page: FieldConfig[];
  /** Everything else the collection declares. */
  content: FieldConfig[];
  /** Whether the surrounding form is mid-submit. */
  disabled?: boolean;
  /** Form mode, which write-only fields adjust their affordances for. */
  mode?: "create" | "edit";
  /**
   * The slug field's name, when this panel is offering one and the document
   * has a public address. Absent means no warning is warranted.
   */
  slugName?: string;
}

/**
 * Stop a keystroke in this panel from submitting the form behind it.
 *
 * These inputs are mounted inside the entry's own `<form>`, so pressing Enter
 * in a single-line field is an implicit submission. A takeover surface holds
 * its work privately and writes it back on the way out — the page builder says
 * so in as many words — and nothing in the form's contract lets it be asked to
 * flush first. An implicit submit therefore saves the value the field held
 * BEFORE the editor opened, and in create mode the navigation that follows
 * unmounts the editor and takes the unwritten work with it.
 *
 * Refusing the keystroke rather than teaching the form to flush, deliberately:
 * a flush-before-submit contract is a real change to how every surface commits
 * and is not something to introduce from a settings panel. This closes the way
 * IN that this panel opened; the wider gap is unchanged and still applies to
 * any save started from a button or a palette.
 *
 * Scoped to what actually submits implicitly. A textarea takes Enter as a
 * newline, and a control that has opened a listbox or a menu is using Enter to
 * choose — intercepting either would break the field to protect the form.
 */
function blockImplicitSubmit(event: React.KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== "Enter" || event.shiftKey) return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.tagName !== "INPUT") return;
  if (target.getAttribute("aria-expanded") === "true") return;
  event.preventDefault();
}

/**
 * Draws whichever groups have fields, and nothing for a group that has none.
 *
 * An EMPTY group is omitted rather than drawn with a heading over blank space:
 * a labelled region containing nothing reads as a control that has failed,
 * which is the same thing the panel as a whole is withheld to avoid. Whether
 * to offer the panel at all is decided before this renders — see
 * `fieldsBesidePanel` below — so this component is never asked to draw two
 * empty groups.
 */
export function EntryFieldsPanel({
  page,
  content,
  disabled,
  mode,
  slugName,
}: EntryFieldsPanelProps) {
  return (
    <div className="space-y-4 p-4" onKeyDown={blockImplicitSubmit}>
      {page.length === 0 ? null : (
        <FormSection
          label="Page"
          description="How this document is identified and addressed."
        >
          <EntryFormContent fields={page} disabled={disabled} mode={mode} />
          {/*
            The same warning the meta strip carries, for the same reason and in
            the only other place the slug is editable. This editor covers the
            strip that would otherwise show it, so without this the one surface
            that hides the notice is also a surface that can rewrite a live
            address and save it.
          */}
          {slugName === undefined ? null : (
            <PublicUrlChangeNotice
              slugName={slugName}
              active
              className="mt-3 block"
            />
          )}
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
  options: {
    disabled?: boolean;
    mode?: "create" | "edit";
    /**
     * The current values of every field a condition watches. Without them a
     * field whose condition is false is counted here and renders nothing,
     * which offers the panel and draws a heading over blank space.
     */
    values?: Record<string, unknown>;
    /** Whether the document has a public address the slug decides. */
    hasPublicAddress?: boolean;
  } = {}
): React.ReactNode | null {
  const beside = computeFieldsBeside(allFields, excludePath, options.values);
  if (beside.page.length === 0 && beside.content.length === 0) return null;
  // Warned about only where the slug is actually offered AND the document has
  // an address to break: a notice on a document nobody can reach is noise, and
  // one beside a field this panel is not showing points at nothing.
  const slug = beside.page.find(f => f.name === "slug");
  return (
    <EntryFieldsPanel
      page={beside.page}
      content={beside.content}
      disabled={options.disabled}
      mode={options.mode}
      slugName={
        options.hasPublicAddress === true && slug !== undefined
          ? (slug.name ?? "slug")
          : undefined
      }
    />
  );
}
