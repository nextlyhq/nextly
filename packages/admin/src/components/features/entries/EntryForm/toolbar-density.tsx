"use client";

/**
 * toolbar-density — how the document toolbar gives up width as it narrows.
 *
 * The header row holds a title that should grow and a cluster of actions that
 * should not shrink. With nothing yielding, the title is simply whatever is
 * left: measured on `main`, it came to `row - 598px`, which is 34px at a
 * 1280-wide window and 0 at 900. The document's own name, in the field an
 * author types it into, disappeared before any action did.
 *
 * So the actions yield first, in priority order — the standard toolbar answer:
 * a label drops to its icon before the control drops out, and the primary
 * action never gives up anything.
 *
 * Two properties make this safe to do in CSS alone:
 *
 * - The query is on the TOOLBAR'S OWN width, not the viewport and not the
 *   content column. Those disagree here — the rail is 320px wide and hides at
 *   its own breakpoint, so one viewport width produces two different row
 *   widths. Only the row knows how much room the row has.
 * - A collapsed label becomes `sr-only` rather than being removed, so the
 *   control keeps its accessible name. The button reads identically to a screen
 *   reader at every width; only the pixels go.
 *
 * @module components/features/entries/EntryForm/toolbar-density
 */

import type { ReactNode } from "react";

import { cn } from "@admin/lib/utils";

/**
 * Marks an element as the toolbar whose width the labels below respond to.
 *
 * Exported rather than written inline so the container and the queries against
 * it cannot drift apart: a renamed container with the labels left behind fails
 * silently, because a container query with no matching container simply never
 * matches and every label stays at full width.
 */
export const TOOLBAR_CONTAINER = "@container/toolbar";

/**
 * How early a label gives up its width.
 *
 * - `secondary` — supporting actions (preview, share a link). First to go,
 *   because they are the ones an author is least often reaching for while
 *   typing a title.
 * - `lifecycle` — publish and unpublish. Held longer: these change what readers
 *   can see, so their words are worth more room than a preview's.
 *
 * The primary action (Save / Create) is deliberately absent. It never collapses
 * at any width — a toolbar that hides the thing it exists for has optimised the
 * wrong side.
 */
export type ToolbarLabelPriority = "secondary" | "lifecycle";

/**
 * Thresholds are the ROW'S OUTER width, and the arbitrary values are the reason
 * this note exists rather than a tidy `@max-3xl`.
 *
 * The container is declared on the header's sticky wrapper, which has no
 * padding of its own, so a query against it measures the row's full width. The
 * rows carry `px-6` themselves — they must, because the language row's top
 * border has to span the header rather than sit inset — so the space actually
 * available to the title and the actions is 48px less than what the query sees.
 *
 * These numbers therefore carry that 48px explicitly. They were chosen by
 * measuring the widest cluster the editor builds — a localized, publishable,
 * previewable entry — and requiring the title to keep its floor without the row
 * overflowing:
 *
 *   cluster + title-floor + padding + gap <= row
 *
 * A round `3rem`-smaller threshold reads tidier and is wrong by exactly the
 * padding: at a 792px row it leaves the labels at full width, the title pinned
 * to its 10rem floor, and the row with no slack at all.
 */
const COLLAPSE_AT: Record<ToolbarLabelPriority, string> = {
  // 48rem of usable width + 3rem of padding.
  secondary: "@max-[51rem]/toolbar:sr-only",
  // 42rem of usable width + 3rem of padding.
  lifecycle: "@max-[45rem]/toolbar:sr-only",
};

export interface ToolbarLabelProps {
  priority: ToolbarLabelPriority;
  children: ReactNode;
  className?: string;
}

/**
 * A control's words, which step aside for its icon when the toolbar is tight.
 *
 * Wrap the TEXT, never the icon: the icon is what remains, and a control that
 * collapses to nothing has been hidden rather than condensed. Give any button
 * using this a `title` too, so a sighted reader can still name it once the
 * label is only spoken.
 */
export function ToolbarLabel({
  priority,
  children,
  className,
}: ToolbarLabelProps) {
  return (
    <span className={cn(COLLAPSE_AT[priority], className)}>{children}</span>
  );
}
