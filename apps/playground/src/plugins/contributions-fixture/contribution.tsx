"use client";

/**
 * The one component every contribution in this fixture names, imported by the
 * generated component map as any plugin's would be.
 *
 * Drawn two ways. At a place (a block, a tab, a side panel section) it is
 * handed the place's context, and the entry where the page shows one. Opened
 * by a row or bulk action, it is handed the rows and a way to close. It says
 * which, and every word names it a fixture, so nothing reads as product.
 */
import type { JSX } from "react";

interface FixtureContributionProps {
  /** At a place: the ids the page is about. */
  context?: Record<string, unknown>;
  /** At a place that shows one entry: that entry, as this reader read it. */
  entry?: { id?: unknown };
  /** Opened by an action: the rows it acts on. */
  rows?: ReadonlyArray<{ id?: unknown }>;
  /** Opened by an action: closes the dialog. */
  onClose?: () => void;
}

/** An id as the fixture shows it: a string or number as it is, else a mark. */
function shownId(id: unknown): string {
  return typeof id === "string" || typeof id === "number" ? String(id) : "?";
}

export function FixtureContribution({
  context,
  entry,
  rows,
  onClose,
}: FixtureContributionProps): JSX.Element {
  if (rows !== undefined) {
    return (
      <div className="space-y-3 text-sm">
        <p>
          Fixture: {rows.length} {rows.length === 1 ? "row" : "rows"} (
          {rows.map(row => shownId(row.id)).join(", ")})
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover-subtle-row"
        >
          Close
        </button>
      </div>
    );
  }
  return (
    <div
      data-testid="contributions-fixture"
      className="rounded-md border border-dashed border-border bg-card p-4 text-sm text-muted-foreground"
    >
      Fixture contribution
      {entry?.id !== undefined ? ` for ${shownId(entry.id)}` : ""}
      {context !== undefined ? ` · ${Object.keys(context).join(", ")}` : ""}
    </div>
  );
}
