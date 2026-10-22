"use client";

/**
 * A past version in the editor's own layout, each changed field marked.
 *
 * Changed fields are drawn with their change, as the comparison page draws
 * it, inside a marked card in the editor's order. Unchanged fields fold behind
 * one control and, shown, read through the editor's own renderer, so the
 * version reads as the page did. A changed field the form does not lay out
 * itself (the title, which the header draws) leads, so no change is out of
 * sight.
 *
 * @module components/features/versions/VersionChangesForm
 */

import type { FieldConfig } from "nextly/config";
import { Fragment } from "react";

import { ReadOnlyDocumentForm } from "@admin/components/features/entries/EntryForm/ReadOnlyDocumentForm";
import { cn } from "@admin/lib/utils";

import { FieldDiffNode } from "./diff/FieldDiffNode";
import { UnchangedFieldsToggle } from "./UnchangedFieldsToggle";
import type { NoChanges, VersionChanges } from "./version-changes";

/** What the editor says when no authored field changed. */
const NO_CHANGES_IN_EDITOR: Record<NoChanges, string> = {
  system: "Only system fields changed.",
  unseen: "No changes in the fields you can read.",
  identical: "No changes from the version before it.",
};

/** The DOM id of a changed field's card, so a move can bring it into view. */
export function changeAnchorId(name: string): string {
  return `version-change-${name}`;
}

/** One stretch of the form: a changed field, or a run of unchanged ones. */
type Stretch =
  | { kind: "changed"; name: string }
  | { kind: "unchanged"; fields: FieldConfig[] };

/** The form's fields split into changed ones and runs of unchanged ones. */
function stretchesOf(
  fields: readonly FieldConfig[],
  changes: VersionChanges
): Stretch[] {
  const stretches: Stretch[] = [];
  for (const field of fields) {
    const name =
      "name" in field && typeof field.name === "string"
        ? field.name
        : undefined;
    if (name !== undefined && changes.byField.has(name)) {
      stretches.push({ kind: "changed", name });
      continue;
    }
    const last = stretches.at(-1);
    if (last?.kind === "unchanged") last.fields.push(field);
    else stretches.push({ kind: "unchanged", fields: [field] });
  }
  return stretches;
}

export interface VersionChangesFormProps {
  /** The fields the editor lays out for this version, in its order. */
  fields: FieldConfig[];
  /** The version's own values, in the shape the form reads. */
  values: Record<string, unknown>;
  changes: VersionChanges;
  /** The changed fields in reading order (see `changeOrder`). */
  order: readonly string[];
  /** The current change's field name, drawn as current. */
  current: string | null;
  showUnchanged: boolean;
  onToggleUnchanged: () => void;
}

function ChangedField({
  name,
  changes,
  current,
}: {
  name: string;
  changes: VersionChanges;
  current: boolean;
}) {
  const node = changes.byField.get(name);
  if (node === undefined) return null;
  // A field gone from the schema carries only its name.
  const label = "label" in node ? node.label : node.name;
  return (
    // A bar on the leading edge and the status word in the row: the change is
    // carried by shape and words, never colour alone. Focusable so a move to
    // it puts a keyboard reader there too.
    <section
      id={changeAnchorId(name)}
      tabIndex={-1}
      aria-label={`${label}, changed`}
      className={cn(
        "rounded-lg border border-border border-l-4 border-l-foreground bg-card px-4 outline-none",
        current && "ring-2 ring-ring ring-offset-2 ring-offset-background"
      )}
    >
      <FieldDiffNode node={node} />
    </section>
  );
}

export function VersionChangesForm({
  fields,
  values,
  changes,
  order,
  current,
  showUnchanged,
  onToggleUnchanged,
}: VersionChangesFormProps) {
  const inLayout = new Set(
    fields.flatMap(field =>
      "name" in field && typeof field.name === "string" ? [field.name] : []
    )
  );
  const outside = order.filter(name => !inLayout.has(name));
  const stretches = stretchesOf(fields, changes);
  const unchangedCount = stretches.reduce(
    (count, stretch) =>
      stretch.kind === "unchanged" ? count + stretch.fields.length : count,
    0
  );

  return (
    <div className="flex flex-col gap-4">
      {outside.map(name => (
        <ChangedField
          key={name}
          name={name}
          changes={changes}
          current={current === name}
        />
      ))}
      {stretches.map((stretch, index) =>
        stretch.kind === "changed" ? (
          <ChangedField
            key={stretch.name}
            name={stretch.name}
            changes={changes}
            current={current === stretch.name}
          />
        ) : showUnchanged ? (
          <ReadOnlyDocumentForm
            key={`unchanged-${index}`}
            fields={stretch.fields}
            values={values}
            mode="edit"
          />
        ) : (
          <Fragment key={`unchanged-${index}`} />
        )
      )}
      {order.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {NO_CHANGES_IN_EDITOR[changes.whenNone]}
        </p>
      ) : null}
      <UnchangedFieldsToggle
        count={unchangedCount}
        shown={showUnchanged}
        onToggle={onToggleUnchanged}
      />
    </div>
  );
}
