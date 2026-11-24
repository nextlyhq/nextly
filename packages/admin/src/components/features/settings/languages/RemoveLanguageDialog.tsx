"use client";

/**
 * Removing a language, confirmed after saying what readers and editors lose
 * and that the content is kept: a removed language is hidden, not deleted, and
 * adding it again brings its content back.
 */

import type React from "react";

import type { LanguageView } from "@admin/types/languages";

import { itemsPhrase } from "./language-settings-model";
import {
  type LanguageDialogSave,
  LanguageConfirmDialog,
} from "./LanguageDialogParts";

export interface RemoveLanguageDialogProps extends LanguageDialogSave {
  language: LanguageView;
  /** How many items are stored in the language, when known. */
  content: number | undefined;
}

export function RemoveLanguageDialog({
  language,
  content,
  ...save
}: RemoveLanguageDialogProps): React.JSX.Element {
  const name = language.label;
  return (
    <LanguageConfirmDialog
      {...save}
      title={`Remove ${name}?`}
      change={{ kind: "remove", code: language.code }}
      confirmLabel={`Remove ${name}`}
      savingLabel="Removing…"
      variant="destructive"
    >
      <p>
        <span className="font-medium">Readers</span> can no longer read the site
        in {name}, and languages that fall back to {name} skip it.
      </p>
      <p>
        <span className="font-medium">Editors</span> can no longer write or
        translate content in {name}.
      </p>
      <p>
        <span className="font-medium">The content is kept.</span> Nothing
        written in {name} is deleted
        {content === undefined ? "" : ` (${itemsPhrase(content)})`}: adding{" "}
        {name} again brings it back.
      </p>
    </LanguageConfirmDialog>
  );
}
