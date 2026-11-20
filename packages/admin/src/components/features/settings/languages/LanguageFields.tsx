"use client";

/**
 * A language's name, writing direction and fallback, as the add and edit
 * dialogs ask them. The fallback is chosen as one language or none: a longer
 * list, which the API allows, is shown as it stands and left unchanged.
 */

import {
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import type React from "react";

import type { LanguageDirection, LanguageView } from "@admin/types/languages";

import { directionLabel, fallbackPhrase } from "./language-settings-model";

/** The select's value for "no fallback": Radix refuses an empty value. */
const NO_FALLBACK = "none";

export interface LanguageFieldValues {
  label: string;
  direction: LanguageDirection;
  /** The fallback list as it will be sent. */
  fallback: string[];
}

export interface LanguageFieldsProps {
  /** A prefix for the controls' ids, unique on the page. */
  idPrefix: string;
  values: LanguageFieldValues;
  onChange: (values: LanguageFieldValues) => void;
  /** The languages a fallback may name: the site's active ones but this one. */
  fallbackChoices: readonly LanguageView[];
  /** Every language, to name the codes in a fallback list. */
  languages: readonly LanguageView[];
  disabled: boolean;
}

export function LanguageFields({
  idPrefix,
  values,
  onChange,
  fallbackChoices,
  languages,
  disabled,
}: LanguageFieldsProps): React.JSX.Element {
  const set = (next: Partial<LanguageFieldValues>) =>
    onChange({ ...values, ...next });
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input
          id={`${idPrefix}-name`}
          value={values.label}
          disabled={disabled}
          autoComplete="off"
          onChange={event => set({ label: event.target.value })}
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Writing direction</legend>
        <RadioGroup
          value={values.direction}
          onValueChange={value =>
            set({ direction: value === "rtl" ? "rtl" : "ltr" })
          }
          disabled={disabled}
          className="flex flex-wrap gap-4"
        >
          {(["ltr", "rtl"] as const).map(direction => (
            <div key={direction} className="flex items-center gap-2">
              <RadioGroupItem
                id={`${idPrefix}-${direction}`}
                value={direction}
              />
              <Label htmlFor={`${idPrefix}-${direction}`}>
                {directionLabel(direction)}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>
      <div className="space-y-2">
        {values.fallback.length > 1 ? (
          <p className="text-sm">
            <span className="font-medium">Falls back to </span>
            {fallbackPhrase(languages, values.fallback)}
          </p>
        ) : (
          <Label htmlFor={`${idPrefix}-fallback`}>Falls back to</Label>
        )}
        {values.fallback.length <= 1 && (
          <Select
            value={values.fallback[0] ?? NO_FALLBACK}
            onValueChange={value =>
              set({ fallback: value === NO_FALLBACK ? [] : [value] })
            }
            disabled={disabled}
          >
            <SelectTrigger
              id={`${idPrefix}-fallback`}
              aria-describedby={`${idPrefix}-fallback-hint`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_FALLBACK}>None</SelectItem>
              {fallbackChoices.map(language => (
                <SelectItem key={language.code} value={language.code}>
                  {language.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p
          id={`${idPrefix}-fallback-hint`}
          className="text-xs text-muted-foreground"
        >
          A field with no value in this language shows the fallback&apos;s value
          instead.
        </p>
      </div>
    </>
  );
}
