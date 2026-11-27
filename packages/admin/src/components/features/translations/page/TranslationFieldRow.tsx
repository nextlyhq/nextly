"use client";

/**
 * One field of a document being translated: its source beside the value being
 * written, or the value alone where it has no source and is written as original
 * content.
 *
 * The source comes first in the document, so a screen too narrow for two
 * columns stacks it above what is written from it, and a keyboard meets it
 * first. The value being written is the form's own control for the field, with
 * its label, help and error; the source draws the same label at the same
 * height, so the two values start in line.
 *
 * @module components/features/translations/page/TranslationFieldRow
 */

import { useRef, type JSX, type ReactNode } from "react";
import { useWatch } from "react-hook-form";

import {
  conditionSourcePath,
  effectiveFieldGate,
  fieldAdminGates,
  OPEN_GATE,
  type FieldGate,
} from "@admin/components/features/entries/fields/field-admin-gates";
import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";
import { FieldValue } from "@admin/components/features/versions/value-display/FieldValueDisplay";
import { fieldLabel } from "@admin/lib/field-label";
import { cn } from "@admin/lib/utils";

import { OutOfDateMark } from "./OutOfDateMark";
import { SourcePicker } from "./SourcePicker";
import {
  SuggestionBlock,
  type FieldSuggestion,
  type SuggestionChoices,
} from "./SuggestionBlock";
import type { TranslationField } from "./translation-fields";
import { CardRow, useCards } from "./TranslationCards";
import { directionOf, useValueLanguage } from "./useValueLanguage";

/** A language as the page names and draws it. */
export interface TranslationLanguage {
  code: string;
  label: string;
  rtl: boolean;
}

/** Where a field is translated from: the language shown, and the others it could be. */
export interface FieldSource {
  language: TranslationLanguage;
  value: unknown;
  /** Every language the field can be translated from, the shown one among them. */
  eligible: readonly string[];
}

export interface TranslationFieldRowProps {
  translated: TranslationField;
  /** The language being written. */
  target: TranslationLanguage;
  /** Absent where the field has none: it is written as original content. */
  source: FieldSource | undefined;
  labelOf: (code: string) => string;
  onSourceChange: (code: string) => void;
  /** Whether the source changed since the value on screen was made from it. */
  outOfDate: boolean;
  /** Whether the reader may only look. */
  readOnly: boolean;
  /** The path of the row or group the field sits in; none at the top. */
  basePath?: string;
  /** What the field inherits from what it sits in. */
  inherited?: FieldGate;
  suggestion?: FieldSuggestion;
  suggestionChoices?: SuggestionChoices;
  /** What is drawn under an out-of-date field, about its source's change. */
  review?: (row: FieldRowState) => ReactNode;
}

/** The row, as what is drawn under its field is told of it. */
export interface FieldRowState {
  /** Whether this field may only be looked at. */
  readOnly: boolean;
  /** Takes the keyboard to the field's control. */
  focusField: () => void;
}

/** What a person can write in, of the controls a field draws. */
const CONTROL =
  'input:not([type="hidden"]), textarea, select, [contenteditable="true"], [role="combobox"]';

/** What the form's own label of the field says. */
function formLabel({ field }: TranslationField): string {
  const label = "label" in field ? field.label : undefined;
  return fieldLabel({
    name: "name" in field ? field.name : undefined,
    label: typeof label === "string" ? label : undefined,
  });
}

/** The text the translator works from. */
function SourceHalf({
  translated,
  source,
  labelOf,
  onSourceChange,
  outOfDate,
}: Pick<
  TranslationFieldRowProps,
  "translated" | "labelOf" | "onSourceChange" | "outOfDate"
> & { source: FieldSource }): JSX.Element {
  const cards = useCards();
  // Its card is headed with the page's source: another is named here, and a
  // choice is offered where there is one.
  const offers = source.eligible.length > 1;
  const named = source.language.code !== cards.source;
  return (
    <div className="grid gap-2">
      <span
        className={cn(
          "text-sm leading-none font-medium",
          (offers || named) && "pr-32"
        )}
      >
        {formLabel(translated)}
      </span>
      {offers || named ? (
        // Out of the label's line, which the translation's is in line with.
        <div className="absolute -top-1.5 right-0 @xl/cards:top-1.5">
          <SourcePicker
            fieldLabel={translated.label}
            sources={source.eligible}
            source={source.language.code}
            labelOf={labelOf}
            onChange={onSourceChange}
          />
        </div>
      ) : null}
      <div
        lang={source.language.code}
        dir={directionOf(source.language)}
        data-slot="translation-source-value"
        className={cn(
          "min-h-9 rounded-md border px-3 py-2 text-sm break-words",
          outOfDate
            ? "border-warning-border bg-warning-surface"
            : "border-border"
        )}
      >
        <FieldValue field={translated.field} value={source.value} />
      </div>
    </div>
  );
}

/** The form's own decision about the field, so one left out takes its source along. */
function useFieldGate({
  translated,
  basePath = "",
  inherited = OPEN_GATE,
  readOnly,
}: TranslationFieldRowProps): FieldGate {
  const condition = conditionSourcePath(
    fieldAdminGates(translated.field).condition,
    basePath
  );
  const conditionValue: unknown = useWatch({
    name: condition ?? "",
    disabled: condition === undefined,
  });
  return effectiveFieldGate(
    translated.field,
    { ...inherited, readOnly: readOnly || inherited.readOnly },
    conditionValue
  );
}

/** What is written: the form's control, and what there is to say of it. */
function TargetHalf({
  translated,
  target,
  source,
  outOfDate,
  basePath = "",
  suggestion,
  suggestionChoices,
  review,
  gate,
}: TranslationFieldRowProps & { gate: FieldGate }): JSX.Element {
  const markValue = useValueLanguage(target);
  const controls = useRef<HTMLDivElement>(null);
  const locked = gate.readOnly || gate.disabled;
  return (
    <>
      {outOfDate ? (
        <div className="absolute -top-1 right-0 @xl/cards:top-2">
          <OutOfDateMark />
        </div>
      ) : null}
      <div ref={controls}>
        <div
          ref={markValue}
          // The mark sits at the end of the label's line, so a long label
          // wraps before it.
          className={cn(outOfDate && "[&_label]:pr-28")}
        >
          <FieldRenderer
            field={translated.field}
            basePath={basePath}
            mode="edit"
            readOnly={gate.readOnly}
          />
        </div>
      </div>
      {outOfDate
        ? review?.({
            readOnly: locked,
            focusField: () =>
              controls.current?.querySelector<HTMLElement>(CONTROL)?.focus(),
          })
        : null}
      {source === undefined ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No other language has this published and up to date, so it is written
          here as original {target.label}.
        </p>
      ) : null}
      <SuggestionBlock
        field={translated.field}
        fieldLabel={translated.label}
        suggestion={suggestion}
        language={target}
        choices={locked ? undefined : suggestionChoices}
      />
    </>
  );
}

export function TranslationFieldRow(
  props: TranslationFieldRowProps
): JSX.Element | null {
  const { translated, target, source } = props;
  const gate = useFieldGate(props);
  if (!gate.shown) return null;
  return (
    <div
      role="group"
      aria-label={translated.label}
      data-slot="translation-field"
    >
      <CardRow
        sourceLabel={source?.language.label}
        targetLabel={target.label}
        {...(source === undefined
          ? {}
          : { source: <SourceHalf {...props} source={source} /> })}
        target={<TargetHalf {...props} gate={gate} />}
      />
    </div>
  );
}
