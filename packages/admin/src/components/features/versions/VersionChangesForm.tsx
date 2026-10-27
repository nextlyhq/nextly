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
import type { JSX } from "react";

import { ReadOnlyDocumentForm } from "@admin/components/features/entries/EntryForm/ReadOnlyDocumentForm";
import { addressableFieldsWithin } from "@admin/lib/plugins/document-view-registry";
import { cn } from "@admin/lib/utils";

import { FieldDiffNode } from "./diff/FieldDiffNode";
import { UnchangedFieldsToggle } from "./UnchangedFieldsToggle";
import type { NoChanges, VersionChanges } from "./version-changes";
import { useHoldsWithheld } from "./withheld-fields-context";

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

/**
 * One stretch of the form: a changed field, a field that holds something
 * held back from the reader, or a run of unchanged ones.
 */
type Stretch =
  | { kind: "changed"; name: string }
  | { kind: "withheld"; field: FieldConfig }
  | { kind: "unchanged"; fields: FieldConfig[] };

/**
 * The form's fields split into changed ones, held-back ones and runs of
 * unchanged ones. A held-back field is not a change the comparison can show,
 * but neither is it unchanged: whether it changed is exactly what the reader
 * may not learn, so it stands on its own rather than folding with the rest.
 */
function stretchesOf(
  fields: readonly FieldConfig[],
  changes: VersionChanges,
  holdsWithheld: (name: string) => boolean
): Stretch[] {
  const laidOut = laidOutByField(fields);
  const stretches: Stretch[] = [];
  for (const field of fields) {
    const name = nameOf(field);
    if (name !== undefined && changes.byField.has(name)) {
      stretches.push({ kind: "changed", name });
      continue;
    }
    const own = laidOut.get(field) ?? [];
    // An unnamed group is drawn without the changed fields it lays out,
    // folded or not: those are drawn once, as their marked change, where the
    // form draws a change it does not lay out itself. One left with nothing
    // to draw is not drawn.
    const changedInside = new Set(
      own.filter(
        inner => inner !== field && changes.byField.has(nameOf(inner) ?? "")
      )
    );
    const drawn =
      changedInside.size > 0 ? without(field, changedInside) : field;
    if (drawn === null) continue;
    if (own.some(inner => holdsWithheld(nameOf(inner) ?? ""))) {
      stretches.push({ kind: "withheld", field: drawn });
      continue;
    }
    const last = stretches.at(-1);
    if (last?.kind === "unchanged") last.fields.push(drawn);
    else stretches.push({ kind: "unchanged", fields: [drawn] });
  }
  return stretches;
}

/** A field's name, when it has one. */
function nameOf(field: FieldConfig): string | undefined {
  return "name" in field && typeof field.name === "string" && field.name !== ""
    ? field.name
    : undefined;
}

/**
 * Each field of the form with the fields it lays out at the document's own
 * level: itself, or an unnamed group's fields at any depth, which the read
 * and the comparison name without the group (`secret`, not `group.secret`).
 * One walk over the whole form, through the one that answers which fields a
 * document addresses at its own level, so a group that lays itself out is
 * walked once.
 */
function laidOutByField(
  fields: readonly FieldConfig[]
): ReadonlyMap<FieldConfig, FieldConfig[]> {
  const byField = new Map<FieldConfig, FieldConfig[]>();
  for (const { field, within } of addressableFieldsWithin(fields)) {
    const top = within[0] ?? field;
    const own = byField.get(top);
    if (own) own.push(field);
    else byField.set(top, [field]);
  }
  return byField;
}

/**
 * An unnamed group without the fields in `omit`, wherever it lays them out,
 * or `null` when that leaves it nothing to draw; any other field as it is.
 * The group keeps its heading and its own rules; its values still come from
 * the document, so a condition reading a field left out still reads it.
 * An unnamed group is recognised as the walk recognises one, and one already
 * open on its own path is left as it is rather than walked again.
 */
function without(
  field: FieldConfig,
  omit: ReadonlySet<FieldConfig>,
  open: ReadonlySet<FieldConfig> = new Set()
): FieldConfig | null {
  const inner = (field as { fields?: unknown }).fields;
  const unnamedGroup =
    field.type === "group" &&
    nameOf(field) === undefined &&
    Array.isArray(inner);
  if (!unnamedGroup || open.has(field)) return field;
  const path = new Set([...open, field]);
  const kept = (inner as FieldConfig[]).flatMap(child => {
    if (omit.has(child)) return [];
    const drawn = without(child, omit, path);
    return drawn === null ? [] : [drawn];
  });
  return kept.length === 0 ? null : { ...field, fields: kept };
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
}: VersionChangesFormProps): JSX.Element {
  const inLayout = new Set(
    fields.flatMap(field =>
      "name" in field && typeof field.name === "string" ? [field.name] : []
    )
  );
  const outside = order.filter(name => !inLayout.has(name));
  const stretches = stretchesOf(fields, changes, useHoldsWithheld());
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
        ) : stretch.kind === "withheld" ? (
          // Through the editor's own renderer, which says in the field's
          // place that it is hidden: always in view, whatever the fold.
          <ReadOnlyDocumentForm
            key={`withheld-${index}`}
            fields={[stretch.field]}
            values={values}
            mode="edit"
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
