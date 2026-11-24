"use client";

/**
 * One field of a document being translated: its source beside the value being
 * written, or the value alone where it has no source and is written as original
 * content.
 *
 * The source comes first in the document, so a screen too narrow for two
 * columns stacks it above what is written from it, and a keyboard meets it
 * first. The value being written is the form's own control for the field, with
 * its label, help and error.
 *
 * @module components/features/translations/page/TranslationFieldRow
 */

import type { JSX } from "react";
import { useWatch } from "react-hook-form";

import {
  conditionSourcePath,
  effectiveFieldGate,
  fieldAdminGates,
  OPEN_GATE,
} from "@admin/components/features/entries/fields/field-admin-gates";
import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";
import { FieldValue } from "@admin/components/features/versions/value-display/FieldValueDisplay";
import { Badge } from "@admin/components/ui";
import { cn } from "@admin/lib/utils";

import { SourcePicker } from "./SourcePicker";
import {
  SuggestionBlock,
  type FieldSuggestion,
  type SuggestionChoices,
} from "./SuggestionBlock";
import type { TranslationField } from "./translation-fields";
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
  suggestion?: FieldSuggestion;
  suggestionChoices?: SuggestionChoices;
}

/** The text the translator works from. */
function SourceColumn({
  translated,
  source,
  labelOf,
  onSourceChange,
}: Pick<
  TranslationFieldRowProps,
  "translated" | "labelOf" | "onSourceChange"
> & { source: FieldSource }): JSX.Element {
  return (
    <div className="min-w-0" data-slot="translation-source">
      <div className="mb-2 flex min-h-8 items-center">
        <SourcePicker
          fieldLabel={translated.label}
          sources={source.eligible}
          source={source.language.code}
          labelOf={labelOf}
          onChange={onSourceChange}
        />
      </div>
      <div
        lang={source.language.code}
        dir={directionOf(source.language)}
        className="text-sm break-words"
      >
        <FieldValue field={translated.field} value={source.value} />
      </div>
    </div>
  );
}

export function TranslationFieldRow({
  translated,
  target,
  source,
  labelOf,
  onSourceChange,
  outOfDate,
  readOnly,
  suggestion,
  suggestionChoices,
}: TranslationFieldRowProps): JSX.Element | null {
  const markValue = useValueLanguage(target);
  // The form's own decision about the field, so one its condition leaves out
  // is left out with its source.
  const condition = conditionSourcePath(
    fieldAdminGates(translated.field).condition,
    ""
  );
  const conditionValue: unknown = useWatch({
    name: condition ?? "",
    disabled: condition === undefined,
  });
  const gate = effectiveFieldGate(
    translated.field,
    { ...OPEN_GATE, readOnly },
    conditionValue
  );
  if (!gate.shown) return null;
  return (
    <div
      role="group"
      aria-label={translated.label}
      data-slot="translation-field"
      className={cn(
        "grid grid-cols-1 gap-4 border-b border-border py-6 first:pt-0 last:border-b-0",
        source !== undefined && "md:grid-cols-2 md:gap-8"
      )}
    >
      {source === undefined ? null : (
        <SourceColumn
          translated={translated}
          source={source}
          labelOf={labelOf}
          onSourceChange={onSourceChange}
        />
      )}
      <div className="min-w-0" data-slot="translation-target">
        <div className="mb-2 flex min-h-8 flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{target.label}</span>
          {outOfDate ? <Badge variant="warning">Out of date</Badge> : null}
        </div>
        {source === undefined ? (
          <p className="mb-2 text-sm text-muted-foreground">
            No other language has this published and up to date, so it is
            written here as original {target.label}.
          </p>
        ) : null}
        <div ref={markValue}>
          <FieldRenderer
            field={translated.field}
            mode="edit"
            readOnly={gate.readOnly}
          />
        </div>
        <SuggestionBlock
          field={translated.field}
          fieldLabel={translated.label}
          suggestion={suggestion}
          language={target}
          choices={
            gate.readOnly || gate.disabled ? undefined : suggestionChoices
          }
        />
      </div>
    </div>
  );
}
