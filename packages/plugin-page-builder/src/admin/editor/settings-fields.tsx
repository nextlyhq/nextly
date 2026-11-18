"use client";

/**
 * Page settings' Fields tab: every field of the page that is not on General,
 * on another tab, or the field the builder is editing, drawn by the entry
 * form's own renderer in the collection's own layout, so a field a developer
 * adds to the collection appears here with no change to the builder, under
 * its own read and write rules, conditions and validation.
 *
 * Another top-level field the builder edits is a line with "Open in
 * builder" for it, never an editor inside the dialog.
 *
 * @module admin/editor/settings-fields
 */
import {
  navigateTo,
  useDocumentIdentity,
  useEntryFieldsLayout,
  useEntryFieldsPanel,
  type EntryContentField,
} from "@nextlyhq/plugin-sdk/admin";
import { Button } from "@nextlyhq/ui";
import { useMemo, type JSX, type ReactNode } from "react";

import { builderAddress } from "./builder-address";

/** What Fields draws, or null where nothing is left for it. */
export interface PageFields {
  /** The rest of the page's fields, as the form draws them, or null. */
  fields: ReactNode | null;
  /** The page's other fields the builder edits, each drawn as a line. */
  otherEditors: readonly EntryContentField[];
}

/**
 * The page's other top-level fields of the builder's own type: the field at
 * `fieldName` is the one being edited, and any other of its type is an
 * editor of its own. Only a top-level field has a type to compare here.
 */
function otherEditorsOf(
  contentFields: readonly EntryContentField[],
  fieldName: string
): EntryContentField[] {
  const own = contentFields.find(field => field.name === fieldName);
  if (own === undefined) return [];
  return contentFields.filter(
    field => field.type === own.type && field.name !== own.name
  );
}

/** What Fields draws for the page, or null where it would be empty. */
export function usePageFields(fieldName: string): PageFields | null {
  const layout = useEntryFieldsLayout();
  const contentFields = layout?.contentFields;
  const otherEditors = useMemo(
    () =>
      contentFields === undefined
        ? []
        : otherEditorsOf(contentFields, fieldName),
    [contentFields, fieldName]
  );
  const fields = useEntryFieldsPanel(fieldName, {
    presentation: "dialog",
    group: "content",
    leaveOut: otherEditors.map(field => field.name),
  });
  if (fields === null && otherEditors.length === 0) return null;
  return { fields, otherEditors };
}

/** The Fields tab's body. */
export function PageFieldsTab({ page }: { page: PageFields }): JSX.Element {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Every other field of this page, the same form as the entry page.
      </p>
      {page.fields}
      {page.otherEditors.map(field => (
        <OtherEditorLine key={field.name} field={field} />
      ))}
    </div>
  );
}

/**
 * Another field the builder edits: its label, and "Open in builder" for it,
 * which moves the builder to that field and keeps the page's unsaved
 * changes, as moving between the builder and the form does.
 */
function OtherEditorLine({ field }: { field: EntryContentField }): JSX.Element {
  const href = builderAddress(useDocumentIdentity(), field.name);
  const labelId = `settings-other-editor-${field.name}`;
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5"
      // Where "Show me" finds the field: its way in takes the focus.
      data-field={field.name}
    >
      <span id={labelId} className="text-sm font-medium">
        {field.label}
      </span>
      {"href" in href ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => navigateTo(href.href)}
        >
          Open in builder
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">
          {"unavailable" in href ? href.unavailable : "Save the page first."}
        </span>
      )}
    </div>
  );
}
