"use client";

/**
 * The new-entity dialog's template: none, one of a few quick ones, or any from
 * "Browse all templates". A picked template lists the fields it adds; each
 * field it cannot add names the rule it breaks, with a way to leave it out,
 * and a field left out can be put back.
 *
 * @module components/features/schema-builder/new-entity/TemplateChoice
 */
import { Button, Label } from "@nextlyhq/ui";
import { type JSX, useState } from "react";

import { useFieldTypeLabel } from "@admin/lib/builder/field-type-label";
import type {
  OfferedTemplate,
  SchemaTemplateField,
} from "@admin/lib/builder/schema-templates";
import {
  templateFieldKey,
  type TemplateFailure,
} from "@admin/lib/builder/template-check";

import { sourceWords, TemplateGallery } from "./TemplateGallery";
import type { TemplatePick } from "./useTemplatePick";

/** One choice: a template, or none. */
function ChoiceRadio({
  ids,
  id,
  checked,
  title,
  detail,
  onChoose,
}: {
  ids: string;
  id: string;
  checked: boolean;
  title: string;
  detail: string;
  onChoose: () => void;
}): JSX.Element {
  const inputId = `${ids}-template-${id}`;
  return (
    <div className="flex items-start gap-2">
      <input
        type="radio"
        id={inputId}
        name={`${ids}-template`}
        checked={checked}
        onChange={onChoose}
        className="mt-1"
      />
      <label htmlFor={inputId} className="text-sm">
        {title}
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </label>
    </div>
  );
}

/** A template's fields, each with its key, as the check keys them. */
function placedFields(
  fields: readonly SchemaTemplateField[],
  parentKey: string | null = null
): { field: SchemaTemplateField; key: string }[] {
  return fields.flatMap((field, at) => {
    const key = templateFieldKey(parentKey, at);
    return [{ field, key }, ...placedFields(field.fields ?? [], key)];
  });
}

/** The picked template's fields: what each breaks, and leave out or put back. */
function PickedFields({
  ids,
  pick,
  picked,
}: {
  ids: string;
  pick: TemplatePick;
  picked: OfferedTemplate;
}): JSX.Element {
  const typeLabel = useFieldTypeLabel();
  const byKey = new Map<string, TemplateFailure[]>();
  for (const failure of pick.failures) {
    byKey.set(failure.key, [...(byKey.get(failure.key) ?? []), failure]);
  }
  return (
    <div
      role="group"
      aria-label={`Template: ${picked.template.name}`}
      className="space-y-1 rounded-md border border-border p-3"
    >
      <p className="text-xs text-muted-foreground">
        {sourceWords(picked)}: the fields it adds.
      </p>
      <ul className="space-y-1 text-sm">
        {placedFields(picked.template.fields).map(({ field, key }) => {
          const label = field.label || field.name;
          const failures = byKey.get(key) ?? [];
          const out = pick.leftOut.has(key);
          // A field is offered to be left out when it breaks a rule, and to be
          // put back once it is out.
          const offerToggle = out || failures.length > 0;
          const checkboxId = `${ids}-leave-out-${key}`;
          return (
            <li key={key}>
              <span className={out ? "text-muted-foreground line-through" : ""}>
                {label} · {typeLabel(field.type)}
              </span>
              {failures.map(failure => (
                <span
                  key={failure.rule}
                  className="block text-xs text-danger-text"
                >
                  {failure.message}
                </span>
              ))}
              {offerToggle && (
                <span className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    id={checkboxId}
                    checked={out}
                    onChange={() => pick.toggleLeftOut(key)}
                  />
                  <label htmlFor={checkboxId}>Leave out {label}</label>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function TemplateChoice({
  ids,
  pick,
}: {
  ids: string;
  pick: TemplatePick;
}): JSX.Element {
  const [browsing, setBrowsing] = useState(false);
  const { picked, quick } = pick;
  // A template picked from the gallery that is not among the quick ones is
  // shown as a choice of its own, checked.
  const choices =
    picked && !quick.includes(picked) ? [...quick, picked] : quick;
  return (
    <div className="space-y-2">
      <Label id={`${ids}-template-label`}>Template</Label>
      <div
        role="radiogroup"
        aria-labelledby={`${ids}-template-label`}
        className="space-y-1"
      >
        <ChoiceRadio
          ids={ids}
          id="none"
          checked={picked === null}
          title="No template"
          detail="Add fields yourself in the editor."
          onChoose={() => pick.pick(null)}
        />
        {choices.map(each => (
          <ChoiceRadio
            key={`${each.source ?? "built-in"}:${each.template.id}`}
            ids={ids}
            id={`${each.source ?? "built-in"}-${each.template.id}`}
            checked={picked === each}
            title={each.template.name}
            detail={each.template.description}
            onChoose={() => pick.pick(each)}
          />
        ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setBrowsing(true)}
      >
        Browse all templates
      </Button>
      {picked && <PickedFields ids={ids} pick={pick} picked={picked} />}
      {browsing && (
        <TemplateGallery
          templates={pick.templates}
          onUse={each => {
            pick.pick(each);
            setBrowsing(false);
          }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  );
}
