"use client";

/**
 * A note a reader writes on their own dashboard: Markdown, drawn read-only.
 *
 * The text is the placement's own setting, so it lives in the reader's layout
 * row and no one else sees it. It is drawn through `TextMarkdown`, the `text`
 * archetype's renderer: the rich-text stack's own nodes, no HTML string between
 * the Markdown and the page, and links held to `http`, `https` and `mailto`
 * (`safeHref`), so what a reader writes cannot run.
 *
 * Loaded lazily, as the `text` archetype loads it, so a dashboard with no note
 * pays nothing for the renderer.
 *
 * @module components/features/dashboard/NoteCard
 */

import type { WidgetComponentProps } from "nextly/widget-result";
import type React from "react";
import { lazy, Suspense } from "react";

import { CardEmpty } from "@admin/components/features/widgets/frame/states";

const TextMarkdown = lazy(() =>
  import("@admin/components/features/widgets/archetypes/TextMarkdown").then(
    mod => ({ default: mod.TextMarkdown })
  )
);

/** The note's text, or `""` for a note not written yet or a value that is not text. */
function noteText(settings: WidgetComponentProps["settings"]): string {
  const text = settings?.text;
  return typeof text === "string" ? text.trim() : "";
}

export const NoteCard: React.FC<WidgetComponentProps> = ({ settings }) => {
  const text = noteText(settings);
  if (text === "") {
    return (
      <CardEmpty
        title="An empty note"
        detail="Write it in the card's settings."
      />
    );
  }
  return (
    <Suspense
      fallback={
        <div
          data-testid="note-loading"
          aria-busy="true"
          className="h-16 animate-pulse rounded-md bg-muted"
        />
      }
    >
      {/* Keyed on the text: the renderer reads its content once, so an edited
          note draws afresh rather than keeping the text it first mounted with. */}
      <TextMarkdown key={text} content={text} />
    </Suspense>
  );
};

NoteCard.displayName = "NoteCard";
