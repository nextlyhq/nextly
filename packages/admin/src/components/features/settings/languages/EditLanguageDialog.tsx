"use client";

/**
 * Renaming a language, and changing its writing direction and fallback. Its
 * code is what content is stored under, so it is shown and not changed. Only
 * what was changed is sent.
 */

import type React from "react";
import { useState } from "react";

import type { LanguageChange, LanguageView } from "@admin/types/languages";

import {
  type LanguageDialogSave,
  LanguageFormDialog,
} from "./LanguageDialogParts";
import { LanguageFields, type LanguageFieldValues } from "./LanguageFields";

export interface EditLanguageDialogProps extends LanguageDialogSave {
  language: LanguageView;
  /** The site's active languages. */
  active: readonly LanguageView[];
}

export function EditLanguageDialog({
  language,
  active,
  ...save
}: EditLanguageDialogProps): React.JSX.Element {
  const [values, setValues] = useState<LanguageFieldValues>({
    label: language.label,
    direction: language.direction,
    fallback: language.fallback,
  });
  const label = values.label.trim();
  const fallbackChanged =
    values.fallback.join(" ") !== language.fallback.join(" ");
  const change: LanguageChange = {
    kind: "update",
    code: language.code,
    ...(label !== language.label ? { label } : {}),
    ...(values.direction !== language.direction
      ? { direction: values.direction }
      : {}),
    ...(fallbackChanged ? { fallback: values.fallback } : {}),
  };
  const changed =
    label !== "" && Object.keys(change).length > ["kind", "code"].length;

  return (
    <LanguageFormDialog
      {...save}
      title={`Edit ${language.label}`}
      description={
        <>
          Content is stored under the code{" "}
          <code className="font-mono">{language.code}</code>, which stays as it
          is.
        </>
      }
      change={changed ? change : undefined}
      submitLabel="Save"
      savingLabel="Saving…"
    >
      <LanguageFields
        idPrefix={`edit-language-${language.code}`}
        values={values}
        onChange={setValues}
        fallbackChoices={active.filter(other => other.code !== language.code)}
        languages={active}
        disabled={save.saving}
      />
    </LanguageFormDialog>
  );
}
