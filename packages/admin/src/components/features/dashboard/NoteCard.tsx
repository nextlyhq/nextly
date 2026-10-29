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
 * Core/note is a declared widget: its `load` answers the text, the frame draws
 * every state but ready (an unwritten note is empty by its declaration's
 * `isEmpty`, with its declared message), and this component draws only the
 * text it is handed.
 *
 * Loaded lazily, as the `text` archetype loads it, so a dashboard with no note
 * pays nothing for the renderer.
 *
 * @module components/features/dashboard/NoteCard
 */

import type { DeclaredComponentProps } from "nextly/widget-result";
import type React from "react";
import { lazy, Suspense } from "react";

const TextMarkdown = lazy(() =>
  import("@admin/components/features/widgets/archetypes/TextMarkdown").then(
    mod => ({ default: mod.TextMarkdown })
  )
);

/**
 * The note's text as its `load` answered it, or `""` for an answer that holds
 * none. Not trimmed: leading spaces are Markdown (four of them make a code
 * block).
 */
function noteText(data: unknown): string {
  const text =
    typeof data === "object" && data !== null
      ? (data as { text?: unknown }).text
      : undefined;
  return typeof text === "string" ? text : "";
}

export const NoteCard: React.FC<DeclaredComponentProps> = ({ data }) => {
  const text = noteText(data);
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
