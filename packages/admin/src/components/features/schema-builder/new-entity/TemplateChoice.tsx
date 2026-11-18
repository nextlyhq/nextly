"use client";

/**
 * The new-entity dialog's template: none, one of a few quick ones, or any from
 * "Browse all templates". A picked template lists the fields it adds; each
 * field it cannot add names the rule it breaks; any field may be left out and
 * put back, and the fields inside one left out go with it.
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
import {
  needName,
  type NeedState,
  type TemplateNeeds,
} from "./useTemplateNeeds";
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

/** A template's field as listed: its key, as the check keys them. */
interface ListedField {
  field: SchemaTemplateField;
  key: string;
  /** The label of the container left out that takes this field with it, if one. */
  outWith: string | null;
}

/**
 * A template's fields, each with its key, and, inside a container left out,
 * the label of the outermost such container.
 */
function placedFields(
  fields: readonly SchemaTemplateField[],
  leftOut: ReadonlySet<string>,
  parentKey: string | null = null,
  outWith: string | null = null
): ListedField[] {
  return fields.flatMap((field, at) => {
    const key = templateFieldKey(parentKey, at);
    const inner =
      outWith ?? (leftOut.has(key) ? field.label || field.name : null);
    return [
      { field, key, outWith },
      ...placedFields(field.fields ?? [], leftOut, key, inner),
    ];
  });
}

/** The picked template's fields: what each breaks, and leave out or put back. */
function PickedFields({
  ids,
  pick,
  picked,
  needs,
}: {
  ids: string;
  pick: TemplatePick;
  picked: OfferedTemplate;
  needs: TemplateNeeds;
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
        {placedFields(picked.template.fields, pick.leftOut).map(
          ({ field, key, outWith }) => (
            <PickedField
              key={key}
              ids={ids}
              pick={pick}
              field={field}
              fieldKey={key}
              outWith={outWith}
              failures={byKey.get(key) ?? []}
              typeLabel={typeLabel}
            />
          )
        )}
      </ul>
      {needs.open.length > 0 && (
        <div className="space-y-1 pt-1">
          <p className="text-xs text-muted-foreground">
            It needs these to exist:
          </p>
          <ul className="space-y-1 text-xs">
            {needs.open.map(state => (
              <NeedRow key={state.key} ids={ids} needs={needs} state={state} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * One target the template needs and does not find: being checked, refused by
 * the server (so the field needing it must be left out), or missing, made too
 * unless the person says not.
 */
function NeedRow({
  ids,
  needs,
  state,
}: {
  ids: string;
  needs: TemplateNeeds;
  state: NeedState;
}): JSX.Element {
  const name = needName(state);
  if (state.status === "checking") {
    return <li className="text-muted-foreground">{`Checking the ${name}…`}</li>;
  }
  if (state.status === "unchecked") {
    return (
      <li className="text-danger-text">
        {`The ${name} could not be checked: ${state.refusal ?? ""}`}
      </li>
    );
  }
  if (state.status === "refused") {
    return (
      <li className="text-danger-text">
        {`The ${name} cannot be made: ${state.refusal ?? ""}`}
      </li>
    );
  }
  const checkboxId = `${ids}-make-too-${state.kind}-${state.address}`;
  return (
    <li className="flex items-center gap-1">
      <input
        type="checkbox"
        id={checkboxId}
        checked={needs.makesToo(state.key)}
        onChange={() => needs.toggleMakeToo(state.key)}
      />
      <label htmlFor={checkboxId}>{`Create the ${name} too`}</label>
    </li>
  );
}

/**
 * One of the picked template's fields: what it breaks, and leave out or put
 * back. A field inside a container left out goes with it: said so, and not
 * offered back on its own, since the container's own checkbox brings it back.
 */
function PickedField({
  ids,
  pick,
  field,
  fieldKey,
  outWith,
  failures,
  typeLabel,
}: {
  ids: string;
  pick: TemplatePick;
  field: SchemaTemplateField;
  fieldKey: string;
  outWith: string | null;
  failures: readonly TemplateFailure[];
  typeLabel: (type: string) => string;
}): JSX.Element {
  const label = field.label || field.name;
  const out = outWith !== null || pick.leftOut.has(fieldKey);
  const checkboxId = `${ids}-leave-out-${fieldKey}`;
  return (
    <li>
      <span className={out ? "text-muted-foreground line-through" : ""}>
        {label} · {typeLabel(field.type)}
      </span>
      {failures.map(failure => (
        <span key={failure.rule} className="block text-xs text-danger-text">
          {failure.message}
        </span>
      ))}
      {outWith !== null ? (
        <span className="block text-xs text-muted-foreground">
          Left out with {outWith}
        </span>
      ) : (
        <span className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            id={checkboxId}
            checked={out}
            onChange={() => pick.toggleLeftOut(fieldKey)}
          />
          <label htmlFor={checkboxId}>Leave out {label}</label>
        </span>
      )}
    </li>
  );
}

export function TemplateChoice({
  ids,
  pick,
  needs,
}: {
  ids: string;
  pick: TemplatePick;
  needs: TemplateNeeds;
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
      {picked && (
        <PickedFields ids={ids} pick={pick} picked={picked} needs={needs} />
      )}
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
