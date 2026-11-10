"use client";

/**
 * The components the contributions fixture's entries name, imported by the
 * generated component map as any plugin's are.
 *
 * Each draws a labelled region whose name and text say it is the fixture, so
 * the browser test finds it by name and reads the fixture's own words, never
 * the place's fallback: a component that failed to load fails the test
 * rather than passing on an empty slot. Drawn only with `--nx-*` tokens, so
 * light and dark come from the admin's theme.
 */
import type { JSX } from "react";

/** What a contribution at a place receives. */
interface PlaceProps {
  /** The ids the page is about. */
  context?: Record<string, unknown>;
  /** The entry the page shows, where it shows one. */
  entry?: { id?: unknown };
}

/** An id as the fixture shows it: a string or number as it is, else a mark. */
function shownId(id: unknown): string {
  return typeof id === "string" || typeof id === "number" ? String(id) : "?";
}

const REGION =
  "rounded-md border border-dashed border-border bg-card p-4 text-sm text-foreground";

/** A block, at any place that takes one; `gated` names the one behind a permission. */
export function FixtureBlock({
  gated = false,
}: PlaceProps & { gated?: boolean }): JSX.Element {
  const name = gated ? "Fixture gated block" : "Fixture block";
  return (
    <section role="region" aria-label={name} className={REGION}>
      {gated
        ? "Fixture gated block, drawn for a reader who may update posts."
        : "Fixture block, drawn by the contributions fixture."}
    </section>
  );
}

/** A gated block's component: the block, named as the gated one. */
export function FixtureGatedBlock(props: PlaceProps): JSX.Element {
  return <FixtureBlock {...props} gated />;
}

/** A list column's cell: the row's own title, so a cell drawn without its row shows nothing of it. */
export function FixtureCell({
  row,
}: {
  row?: { title?: unknown };
}): JSX.Element {
  return (
    <span
      role="region"
      aria-label="Fixture cell"
      className="text-sm text-foreground"
    >
      {typeof row?.title === "string" ? row.title : "?"}
    </span>
  );
}

/** A tab's body. */
export function FixtureTab(_: PlaceProps): JSX.Element {
  return (
    <section role="region" aria-label="Fixture tab" className={REGION}>
      Fixture tab, drawn by the contributions fixture.
    </section>
  );
}

/** A side panel section's body. */
export function FixtureSection(_: PlaceProps): JSX.Element {
  return (
    <section role="region" aria-label="Fixture section" className={REGION}>
      Fixture section, drawn by the contributions fixture.
    </section>
  );
}

/** What a row or bulk action opens: the rows it was run on, by collection and id. */
export function FixtureActionDialog({
  rows = [],
  onClose,
}: {
  rows?: ReadonlyArray<{ collection?: unknown; id?: unknown }>;
  onClose?: () => void;
}): JSX.Element {
  return (
    <section
      role="region"
      aria-label="Fixture action"
      className="space-y-3 text-sm text-foreground"
    >
      <p>
        Fixture action on{" "}
        {rows
          .map(row => `${shownId(row.collection)}/${shownId(row.id)}`)
          .join(", ")}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="rounded-md border border-border px-3 py-1.5 text-sm hover-subtle-row"
      >
        Close
      </button>
    </section>
  );
}

/** What takes a built-in block's place on the edit page it is scoped to. */
export function FixtureReplacement({ entry }: PlaceProps): JSX.Element {
  return (
    <section role="region" aria-label="Fixture replacement" className={REGION}>
      Fixture replacement of the editor, for {shownId(entry?.id)}.
    </section>
  );
}
