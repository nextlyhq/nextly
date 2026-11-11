"use client";

/**
 * The settings drawer's own controls, for the settings it draws as the founder's drawer does
 * rather than as the entry editor's fields: a short choice as a row of choices (a list's Number
 * of entries, Row spacing), an on/off as a switch beside its label, a note's text with how many
 * characters remain, and the card's Width. Each is bound to the drawer's form by the setting's
 * name, as `FieldRenderer`'s fields are, so Save, Cancel and the section's Reset treat them
 * alike.
 *
 * @module components/features/widgets/edit/DrawerSettingControls
 */

import { Label, Switch, Textarea } from "@nextlyhq/ui";
import {
  textLength,
  type AnyWidgetSetting,
  type WidgetSetting,
} from "nextly/config";
import { Fragment, useId, type JSX, type ReactNode } from "react";
import { useController, useFormContext } from "react-hook-form";

import { cn } from "@admin/lib/utils";

import { widthChoiceName } from "../sizes";

import {
  descriptionParts,
  entriesChoices,
  type EntriesSetting,
} from "./drawer-choices";
import { SegmentedChoice, type SegmentedOption } from "./SegmentedChoice";

/** What the drawer says under a setting, its examples in backticks drawn as code. */
export function SettingDescription({
  id,
  text,
}: {
  id: string;
  text: string;
}): JSX.Element {
  return (
    <p id={id} className="text-xs text-muted-foreground">
      {descriptionParts(text).map((part, index) =>
        part.code ? (
          <code
            key={index}
            // In the text's own colour on the muted chip, so each example reads at 4.5:1.
            className="rounded bg-muted px-1 py-px font-mono text-[11.5px] text-foreground"
          >
            {part.text}
          </code>
        ) : (
          // Bare text, so the spaces around each example are kept where its words are read.
          <Fragment key={index}>{part.text}</Fragment>
        )
      )}
    </p>
  );
}

/** A labelled choice: its label, the control, and what the drawer says under it. */
function ChoiceField({
  labelId,
  label,
  hintId,
  hint,
  children,
}: {
  labelId: string;
  label: string;
  hintId: string;
  hint: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-sm font-medium text-foreground">
        {label}
      </span>
      {children}
      {hint === undefined ? null : (
        <SettingDescription id={hintId} text={hint} />
      )}
    </div>
  );
}

/** A setting's label, as the drawer names it. */
function labelOf(setting: AnyWidgetSetting): string {
  return setting.label ?? setting.name;
}

/** A setting's help, where it declares any. */
function hintOf(setting: AnyWidgetSetting): string | undefined {
  const text = setting.admin?.description;
  return text === undefined || text === "" ? undefined : text;
}

/**
 * A select setting drawn as a row of choices, its value the chosen option's, as the dropdown
 * stores it.
 */
export function SegmentedSettingControl({
  setting,
  options,
  disabled,
}: {
  setting: AnyWidgetSetting;
  options: readonly SegmentedOption[];
  disabled: boolean;
}): JSX.Element {
  const { field } = useController({ name: setting.name });
  const id = useId();
  const hint = hintOf(setting);
  return (
    <ChoiceField
      labelId={`${id}-label`}
      label={labelOf(setting)}
      hintId={`${id}-hint`}
      hint={hint}
    >
      <SegmentedChoice
        size="drawer"
        aria-labelledby={`${id}-label`}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        options={options}
        value={typeof field.value === "string" ? field.value : undefined}
        disabled={disabled}
        onSelect={field.onChange}
        data-testid={`setting-choice-${setting.name}`}
      />
    </ChoiceField>
  );
}

/**
 * A list's "Number of entries" as a choice of 5, 10 or 20, stored as the number it is. A value
 * the drawer opened on that is none of those (7, saved before) is offered beside them and shown
 * as chosen, so it is never changed unless the reader picks another (`entriesChoices`).
 */
export function EntriesSettingControl({
  setting,
  choices,
  disabled,
}: {
  setting: EntriesSetting;
  choices: readonly number[];
  disabled: boolean;
}): JSX.Element {
  const { field } = useController({ name: setting.name });
  const id = useId();
  const hint = hintOf(setting);
  return (
    <ChoiceField
      labelId={`${id}-label`}
      label={labelOf(setting)}
      hintId={`${id}-hint`}
      hint={hint}
    >
      <SegmentedChoice
        size="drawer"
        aria-labelledby={`${id}-label`}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        options={choices.map(choice => ({
          value: String(choice),
          label: String(choice),
        }))}
        value={
          typeof field.value === "number" ? String(field.value) : undefined
        }
        disabled={disabled}
        // Narrowed rather than asserted: only a number this control offered is chosen.
        onSelect={next => {
          const chosen = Number(next);
          if (choices.includes(chosen)) field.onChange(chosen);
        }}
        data-testid={`setting-choice-${setting.name}`}
      />
    </ChoiceField>
  );
}

/** The choices a "Number of entries" offers, read against the value the drawer opened on. */
export function useEntriesChoices(setting: EntriesSetting): number[] {
  const { formState } = useFormContext<Record<string, unknown>>();
  return entriesChoices(setting, formState.defaultValues?.[setting.name]);
}

/** An on/off setting: its label, and a switch beside it at the row's end. */
export function SwitchSettingControl({
  setting,
  disabled,
}: {
  setting: Extract<WidgetSetting, { type: "checkbox" }>;
  disabled: boolean;
}): JSX.Element {
  const { field } = useController({ name: setting.name });
  const id = useId();
  const hint = hintOf(setting);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-sm font-medium">
          {labelOf(setting)}
        </Label>
        <Switch
          id={id}
          checked={field.value === true}
          disabled={disabled}
          onCheckedChange={field.onChange}
          aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        />
      </div>
      {hint === undefined ? null : (
        <SettingDescription id={`${id}-hint`} text={hint} />
      )}
    </div>
  );
}

/** How many characters a text has left under its bound, said as the drawer says it. */
export function charactersLeftText(left: number): string {
  const count = new Intl.NumberFormat("en").format(Math.abs(left));
  if (left >= 0)
    return `${count} ${left === 1 ? "character" : "characters"} left`;
  return `${count} ${left === -1 ? "character" : "characters"} over the limit`;
}

/**
 * A textarea setting, a Note's text: written in a monospaced face, as Markdown is, with what it
 * supports under it and, where it is bounded, how many characters remain, counted as the server
 * counts them (`textLength`). The bound is judged on Save (`overlongSetting`), not by the
 * textarea, whose own limit counts emoji as two.
 */
export function TextareaSettingControl({
  setting,
  disabled,
}: {
  setting: Extract<WidgetSetting, { type: "textarea" }>;
  disabled: boolean;
}): JSX.Element {
  const { field, fieldState } = useController({ name: setting.name });
  const id = useId();
  const hint = hintOf(setting);
  const value = typeof field.value === "string" ? field.value : "";
  const left =
    setting.maxLength === undefined
      ? undefined
      : setting.maxLength - textLength(value);
  const problem = fieldState.error?.message;
  const described = [
    hint === undefined ? null : `${id}-hint`,
    left === undefined ? null : `${id}-left`,
    problem === undefined ? null : `${id}-problem`,
  ]
    .filter(part => part !== null)
    .join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {labelOf(setting)}
      </Label>
      <Textarea
        id={id}
        ref={field.ref}
        name={field.name}
        value={value}
        disabled={disabled}
        onChange={event => field.onChange(event.target.value)}
        onBlur={field.onBlur}
        aria-invalid={problem === undefined ? undefined : true}
        aria-describedby={described === "" ? undefined : described}
        className="min-h-24 resize-y font-mono text-[12.5px] leading-5"
      />
      {left === undefined ? null : (
        <p
          id={`${id}-left`}
          className={cn(
            "text-xs tabular-nums",
            left < 0 ? "text-destructive" : "text-muted-foreground"
          )}
          data-testid={`setting-left-${setting.name}`}
        >
          {charactersLeftText(left)}
        </p>
      )}
      {hint === undefined ? null : (
        <SettingDescription id={`${id}-hint`} text={hint} />
      )}
      {problem === undefined ? null : (
        <p
          id={`${id}-problem`}
          role="alert"
          className="text-xs text-destructive"
        >
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * The card's Width: its widget's width choices in percent (`widthChoices`), the one it opened
 * on among them, and its bounds under it. Height is not a choice: a card is as tall as its
 * content.
 */
export function WidthControl({
  value,
  choices,
  minW,
  maxW,
  disabled,
  onSelect,
}: {
  value: number;
  choices: readonly number[];
  minW: number;
  maxW: number;
  disabled: boolean;
  onSelect: (w: number) => void;
}): JSX.Element {
  const id = useId();
  const bounds =
    minW === maxW
      ? `Always ${widthChoiceName(minW).label}.`
      : `From ${widthChoiceName(minW).label} to ${widthChoiceName(maxW).label}.`;
  return (
    <ChoiceField
      labelId={`${id}-label`}
      label="Width"
      hintId={`${id}-hint`}
      hint={`${bounds} Height follows the content.`}
    >
      <SegmentedChoice
        size="drawer"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        options={choices.map(choice => {
          const name = widthChoiceName(choice);
          return {
            value: String(choice),
            label: name.label,
            spoken: name.spoken,
          };
        })}
        value={String(value)}
        disabled={disabled}
        // Narrowed rather than asserted: only a width this control offered is chosen.
        onSelect={next => {
          const chosen = Number(next);
          if (choices.includes(chosen)) onSelect(chosen);
        }}
        data-testid="setting-width"
      />
    </ChoiceField>
  );
}
