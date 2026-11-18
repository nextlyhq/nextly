// Basics-tab fields for the BuilderSettingsModal. Renders only the fields
// listed in the per-kind config, so the tab is config-driven rather than
// branching per entity kind.
//
// The slug auto-derives from the singular name on each keystroke, and stops
// once a NON-EMPTY `values.slug` differs from the slug that name would derive.
// Empty counts as automatic, so clearing the field resumes derivation instead
// of pinning it to the empty string. The override is recomputed from the values
// rather than recorded — there is no flag to keep in step, and editing the slug
// back to the derived form resumes tracking too, which is what someone
// correcting a typo expects. The slug's case is per kind (kebab for Singles,
// snake for the others), decided with the rest of the derivation in
// `lib/builder/entity-names`, which the new-entity dialog shares.
import { Input, Label, Textarea } from "@nextlyhq/ui";
import { textLength } from "nextly/config";
import { type JSX, useId } from "react";

import { usePluginFieldTypeEntries } from "@admin/components/field-ui";
import { namesFollowingName } from "@admin/lib/builder/entity-names";
import {
  hasStartingFieldChoice,
  startingFieldChoices,
} from "@admin/lib/builder/starting-field";
import { cn } from "@admin/lib/utils";

import type { BasicsField, BuilderKind } from "../builder-config";
import type { BuilderSettingsValues } from "../BuilderSettingsModal";

import { IconPicker } from "./IconPicker";
import { SlugInput } from "./SlugInput";

type Props = {
  fields: readonly BasicsField[];
  kind: BuilderKind;
  values: BuilderSettingsValues;
  onChange: (next: BuilderSettingsValues) => void;
  /** False once the entity exists: its slug addresses rows that already
   *  live under it, so no save can move it. */
  slugEditable?: boolean;
  /**
   * What the address is for, said under it and read with it: why a saved one
   * is fixed, or what the check says of an unsaved one; a refusal is drawn as
   * an error.
   */
  slugNote?: { text: string; refused: boolean };
};

export function BasicsTab({
  fields,
  kind,
  values,
  onChange,
  slugEditable = true,
  slugNote,
}: Props): JSX.Element {
  const noteId = useId();
  const set = <K extends keyof BuilderSettingsValues>(
    key: K,
    value: BuilderSettingsValues[K]
  ) => onChange({ ...values, [key]: value });

  // Both layout branches below render this identical pair; only the grid
  // around them differs per kind, so the fields themselves are built once.
  const slugField = fields.includes("slug") && (
    <div className="space-y-1">
      <Label>Slug</Label>
      <SlugInput
        singular={values.singularName}
        value={values.slug}
        onChange={next => set("slug", next)}
        readOnly={!slugEditable}
        describedBy={slugNote ? noteId : undefined}
      />
      {slugNote && (
        <p
          id={noteId}
          // A live region: an unsaved address's check answers after typing
          // stops, so its answer is announced when it arrives.
          role="status"
          aria-live="polite"
          className={
            slugNote.refused
              ? "text-xs text-danger-text"
              : "text-xs text-muted-foreground"
          }
        >
          {slugNote.text}
        </p>
      )}
    </div>
  );

  const iconField = fields.includes("icon") && (
    <div className="space-y-1">
      <Label>Icon</Label>
      <IconPicker value={values.icon} onChange={next => set("icon", next)} />
    </div>
  );

  // The slug and plural follow the singular name until each holds a value of
  // its own; empty, or equal to what the old name derived, still follows. The
  // derivation is shared with the new-entity dialog (`namesFollowingName`), so
  // the two derive alike.
  // A fixed address does not follow: once saved, renaming the entity keeps
  // its address, as nothing that refers to it moves.
  const setSingular = (singular: string) => {
    const follows = namesFollowingName(kind, values, singular);
    onChange({
      ...values,
      ...follows,
      ...(slugEditable ? {} : { slug: values.slug }),
    });
  };

  // Built once for both layout branches below, like the slug and icon. Marked
  // required: every kind's settings save refuses an empty name ("Name is
  // required" in each builder page's schema). The plural is optional here —
  // a blank one falls back to the derived form — and the slug cannot change
  // once saved, so the name is the only field this tab requires.
  const singularField = fields.includes("singularName") && (
    <div className="space-y-1">
      <Label htmlFor="singularName">
        Singular name
        <RequiredMark />
      </Label>
      <Input
        id="singularName"
        required
        value={values.singularName}
        onChange={e => setSingular(e.target.value)}
      />
    </div>
  );

  const hasPlural = fields.includes("pluralName");

  return (
    <div className="space-y-4 py-2">
      {/* A kind with no plural name (singles, components) has three basics
          rather than four, and they flow through the same two-column grid: at
          `sm` and wider, singular and slug share the first row and the icon
          wraps onto a second. Collections have four and fill a 2x2 —
          singular with plural, slug with icon. Both collapse to one column
          below `sm`. */}
      {!hasPlural &&
        (fields.includes("singularName") ||
          fields.includes("slug") ||
          fields.includes("icon")) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {singularField}
            {slugField}
            {iconField}
          </div>
        )}

      {hasPlural &&
        (fields.includes("singularName") || fields.includes("pluralName")) && (
          // Why: collections -- singular + plural visually paired in a
          // 50/50 row per feedback Section 1. Collapses to stacked on
          // mobile.
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {singularField}

            {fields.includes("pluralName") && (
              <div className="space-y-1">
                <Label htmlFor="pluralName">Plural name</Label>
                <Input
                  id="pluralName"
                  value={values.pluralName ?? ""}
                  onChange={e => set("pluralName", e.target.value)}
                />
              </div>
            )}
          </div>
        )}

      {hasPlural && (fields.includes("slug") || fields.includes("icon")) && (
        // Why: collections -- slug + icon paired in their own 50/50
        // row. Description (full-width) renders below.
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {slugField}
          {iconField}
        </div>
      )}

      {fields.includes("description") && (
        <DescriptionField
          id="description"
          value={values.description ?? ""}
          onChange={next => set("description", next)}
        />
      )}

      {fields.includes("startingField") && (
        <StartingFieldChoice
          value={values.startingFieldType}
          onChange={next => set("startingFieldType", next)}
        />
      )}
    </div>
  );
}

/**
 * How this entity is edited, asked while it is being created.
 *
 * Renders nothing when no plugin contributes a field type for this surface: the
 * remaining option is the default, and a control offering one answer asks a
 * question that has already been settled.
 *
 * Radio rather than a select. The options differ in what they DO rather than in
 * a value being picked from a list, each carries a sentence explaining it, and
 * both need to be readable at once for the choice to be an informed one — a
 * select hides every option but the chosen one behind a click.
 */
function StartingFieldChoice({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}) {
  const pluginEntries = usePluginFieldTypeEntries("entries");
  const choices = startingFieldChoices(pluginEntries);
  if (!hasStartingFieldChoice(choices)) return null;

  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium leading-none">
        How is this edited?
      </legend>
      <p className="text-sm text-muted-foreground">
        You can change this later by adding or removing fields.
      </p>
      <div className="grid gap-2 pt-1">
        {choices.map(choice => {
          const id = `starting-field-${choice.type ?? "none"}`;
          const checked = (value ?? null) === choice.type;
          return (
            <label
              key={id}
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                checked
                  ? "border-primary bg-accent"
                  : "border-border hover:bg-accent/50"
              )}
            >
              <input
                type="radio"
                id={id}
                name="starting-field"
                className="mt-1 accent-[color:var(--nx-primary)]"
                checked={checked}
                // `undefined` rather than null: the value is optional on the
                // form shape, and writing null would send a key the create
                // payload has no meaning for.
                onChange={() => onChange(choice.type ?? undefined)}
              />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium text-foreground">
                  {choice.label}
                </span>
                {choice.hint !== "" && (
                  <span className="block text-sm text-muted-foreground">
                    {choice.hint}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * The asterisk after the label of a field the dialog will not go on without.
 *
 * Drawn the way the entry form draws it (`FieldWrapper`), so a required field
 * looks the same in the builder as in the content it shapes. Hidden from
 * assistive technology: the input's own `required` says it there, and a
 * spoken "star" after the name would only repeat it less clearly. Shared with
 * the new-entity dialog.
 */
export function RequiredMark(): JSX.Element {
  return (
    <span className="text-danger-text ml-1" aria-hidden="true">
      *
    </span>
  );
}

/**
 * How long a collection's, Single's or field group's description may be when
 * it is written in the builder: 255, the limit the admin's other descriptions
 * keep (roles and permissions). A description is a sentence or two under the
 * entity's name on its entries page, not a place for documentation.
 *
 * 🔴 Judged by the builder's dialogs only. The API and the column take any
 * length, so a description set in code, or saved before this limit, still
 * loads and still shows — the dialogs say it is over and hold the save until
 * it is shortened, rather than cutting it.
 */
export const DESCRIPTION_MAX_LENGTH = 255;

/**
 * Whether a description is longer than the builder accepts, counted as a
 * person counts it (`textLength`, in code points) so an emoji or a letter
 * outside the BMP is one character, not the two UTF-16 units
 * `String.length` would say.
 */
export function descriptionTooLong(description: string | undefined): boolean {
  return textLength(description ?? "") > DESCRIPTION_MAX_LENGTH;
}

/**
 * The description box of this tab and of the new-entity dialog, with how much
 * of the limit it uses said beneath it.
 *
 * Not capped with `maxLength`: a browser cuts pasted text at the cap without a
 * word, and a description longer than the limit that was saved before it, or
 * set in code, would sit there with nothing saying why it cannot grow. The
 * count is shown instead, and past the limit the field says so and the dialog
 * holds its save (`descriptionTooLong`).
 */
export function DescriptionField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
}): JSX.Element {
  const over = textLength(value) > DESCRIPTION_MAX_LENGTH;
  const countId = `${id}-count`;
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Description</Label>
      <Textarea
        id={id}
        rows={2}
        value={value}
        aria-invalid={over}
        aria-describedby={over ? `${errorId} ${countId}` : countId}
        onChange={e => onChange(e.target.value)}
      />
      <div className="flex items-start justify-between gap-2 text-xs">
        {/* In the error text colour the form messages use, which reads at
            4.5:1 in both schemes. An alert, as the panel's bound problem is,
            so crossing the limit is announced as the message appears rather
            than only when the box is read again — and never per keystroke,
            for the message mounts only on that crossing. */}
        {over ? (
          <p id={errorId} role="alert" className="text-danger-text">
            Keep the description to {DESCRIPTION_MAX_LENGTH} characters or
            fewer.
          </p>
        ) : (
          <span />
        )}
        <p
          id={countId}
          className={cn(
            "shrink-0 tabular-nums",
            over ? "text-danger-text" : "text-muted-foreground"
          )}
        >
          {textLength(value)}/{DESCRIPTION_MAX_LENGTH}
        </p>
      </div>
    </div>
  );
}
