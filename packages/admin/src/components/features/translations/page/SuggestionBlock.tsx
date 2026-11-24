"use client";

/**
 * A suggested translation of one field, beside the field it is for.
 *
 * It only offers: the field changes when the translator chooses, and never
 * because a suggestion arrived. Drawn as nothing where there is none, so a
 * field row places it without asking whether it has one.
 *
 * @module components/features/translations/page/SuggestionBlock
 */

import type { FieldConfig } from "nextly/config";
import type { JSX } from "react";

import { FieldValue } from "@admin/components/features/versions/value-display/FieldValueDisplay";
import { Button } from "@admin/components/ui";

import { directionOf, type ValueLanguage } from "./useValueLanguage";

/** A suggested value for one field, in the stored shape of its type. */
export interface FieldSuggestion {
  value: unknown;
}

/** What the translator may do with a suggestion. */
export interface SuggestionChoices {
  /** Put it in the field as it is. */
  onUse: () => void;
  /** Put it in the field and go on writing there. */
  onEdit: () => void;
  onDismiss: () => void;
}

export interface SuggestionBlockProps {
  field: FieldConfig;
  fieldLabel: string;
  suggestion: FieldSuggestion | undefined;
  /** The language it is written in. */
  language: ValueLanguage;
  /** Absent where the reader may not change the field. */
  choices: SuggestionChoices | undefined;
}

export function SuggestionBlock({
  field,
  fieldLabel,
  suggestion,
  language,
  choices,
}: SuggestionBlockProps): JSX.Element | null {
  if (suggestion === undefined) return null;
  return (
    <div
      role="group"
      aria-label={`Suggestion for ${fieldLabel}`}
      className="mt-3 rounded-md border border-border bg-muted/50 p-3"
    >
      <p className="text-xs font-medium text-muted-foreground">Suggestion</p>
      <div
        lang={language.code}
        dir={directionOf(language)}
        className="mt-1 text-sm break-words"
      >
        <FieldValue field={field} value={suggestion.value} />
      </div>
      {choices === undefined ? null : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`Use the suggestion for ${fieldLabel}`}
            onClick={choices.onUse}
          >
            Use
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`Edit the suggestion for ${fieldLabel}`}
            onClick={choices.onEdit}
          >
            Edit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Dismiss the suggestion for ${fieldLabel}`}
            onClick={choices.onDismiss}
          >
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
