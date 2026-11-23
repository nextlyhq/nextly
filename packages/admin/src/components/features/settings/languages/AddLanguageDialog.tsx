"use client";

/**
 * Adding a language: its code, name, writing direction and fallback. It says
 * before anything is saved that no content changes and nothing is migrated,
 * since a language is added without touching the content already stored.
 */

import { Input, Label } from "@nextlyhq/ui";
import type React from "react";
import { useState } from "react";

import type { LanguageView } from "@admin/types/languages";

import {
  type LanguageDialogSave,
  LanguageFormDialog,
} from "./LanguageDialogParts";
import { LanguageFields, type LanguageFieldValues } from "./LanguageFields";

export interface AddLanguageDialogProps extends LanguageDialogSave {
  /** The site's active languages, any of which the new one may fall back to. */
  active: readonly LanguageView[];
}

export function AddLanguageDialog({
  active,
  ...save
}: AddLanguageDialogProps): React.JSX.Element {
  const [code, setCode] = useState("");
  const [values, setValues] = useState<LanguageFieldValues>({
    label: "",
    direction: "ltr",
    fallback: [],
  });
  const ready = code.trim() !== "" && values.label.trim() !== "";

  return (
    <LanguageFormDialog
      {...save}
      title="Add a language"
      description="Adding a language changes no content and nothing is migrated. From then on, every translatable field can be translated into it."
      change={
        ready
          ? {
              kind: "add",
              code: code.trim(),
              label: values.label.trim(),
              direction: values.direction,
              fallback: values.fallback,
            }
          : undefined
      }
      submitLabel="Add language"
      savingLabel="Adding…"
    >
      <div className="space-y-2">
        <Label htmlFor="add-language-code">Code</Label>
        <Input
          id="add-language-code"
          value={code}
          disabled={save.saving}
          autoComplete="off"
          spellCheck={false}
          aria-describedby="add-language-code-hint"
          onChange={event => setCode(event.target.value)}
        />
        <p
          id="add-language-code-hint"
          className="text-xs text-muted-foreground"
        >
          A language code such as fr or pt-BR.
        </p>
      </div>
      <LanguageFields
        idPrefix="add-language"
        values={values}
        onChange={setValues}
        fallbackChoices={active}
        languages={active}
        disabled={save.saving}
      />
    </LanguageFormDialog>
  );
}
