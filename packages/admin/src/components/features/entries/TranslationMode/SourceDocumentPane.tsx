"use client";

/**
 * The source-language half of translation mode.
 *
 * Renders the source document through the editor's own field components,
 * read-only, so whatever a field can draw the source shows. That is the whole
 * argument for the pane over the inline hint it supersedes: the hint could only
 * render a `string` or a `number` (`FieldWrapper.tsx`), so a translator working a
 * richText field, a relationship or a chips list had no source text on screen at
 * all — silently, because a field with nothing to show and a field whose type the
 * hint could not handle looked identical.
 *
 * ## Only the translatable fields
 *
 * The pane shows the fields the translator is working on, not the document. A
 * shared field holds the same value in both languages, so putting it here would
 * fill half the screen with a copy of what is already in the other pane, and
 * push the fields that DO differ off it.
 *
 * @module components/features/entries/TranslationMode/SourceDocumentPane
 */

import type { FieldConfig } from "nextly/config";

import { ReadOnlyDocumentForm } from "@admin/components/features/entries/EntryForm/ReadOnlyDocumentForm";

export interface SourcePaneDocument {
  /** The source language's code, for the pane's writing direction. */
  sourceLocale: string;
  /** Human label for the source language, as configured. */
  sourceLabel: string;
  /** Human label for the language being edited, for the mode bar. */
  targetLabel: string;
  /** Whether the source language is written right-to-left. */
  rtl: boolean;
  /** The translatable fields, in the document's own order. */
  fields: FieldConfig[];
  /** The source document's values, in the shape the form's inputs read. */
  values: Record<string, unknown>;
}

export function SourceDocumentPane({ source }: { source: SourcePaneDocument }) {
  return (
    <div
      // A SOLID token rather than an alpha tint of one. `text-muted-foreground`
      // is the foreground `bg-muted` is designed against, so the pair is one the
      // contrast suite checks by NAME; over `bg-muted/30` the same text is
      // measured against a computed blend instead. Both are covered — the ink
      // suite composites a translucent fill over its surface — so this is a
      // legibility-of-intent choice, not a contrast fix. The solid surface is
      // also what makes this half read as the one that cannot be edited.
      className="@container/content h-full overflow-y-auto bg-muted"
      // The pane's own direction, from the SOURCE language. Translation mode is
      // the one place two directions are on screen at once — an English source
      // beside an Arabic target — so direction cannot be a property of the
      // document the way `EntryLocaleContext.rtl` treats it.
      dir={source.rtl ? "rtl" : "ltr"}
    >
      <div className="flex items-center gap-2 border-b border-border px-6 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Source
        </span>
        <span className="text-sm font-medium text-foreground">
          {source.sourceLabel}
        </span>
      </div>
      <div className="px-6 py-4">
        {source.fields.length === 0 ? (
          // Said rather than left blank. A localized document whose translatable
          // set is empty is a real configuration — every field shared — and an
          // empty pane reads as a failed load.
          <p className="text-sm text-muted-foreground">
            This document has no translatable fields, so there is no source text
            to show.
          </p>
        ) : (
          <ReadOnlyDocumentForm fields={source.fields} values={source.values} />
        )}
      </div>
    </div>
  );
}
