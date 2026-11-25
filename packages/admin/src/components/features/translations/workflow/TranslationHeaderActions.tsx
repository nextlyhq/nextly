"use client";

/**
 * The translation page's actions on its language: the one that leads, and what
 * stands beside it, drawn by the editor's own action bar.
 *
 * Where a workflow holds the language, its next step leads, or Publish held
 * with the reason; where none does, the bar is the one a language without a
 * workflow has. Why a step was refused is the page's to say, beside the work:
 * the bar is one row.
 *
 * @module components/features/translations/workflow/TranslationHeaderActions
 */

import type { JSX } from "react";

import { reviewStepActionId } from "@admin/components/features/entries/EntryForm/document-actions";
import {
  DocumentActionBar,
  type ActionBinding,
  type NarrowMenuItem,
} from "@admin/components/features/entries/EntryForm/DocumentActionBar";
import { NOTHING_CHANGED_REASON } from "@admin/components/features/entries/EntryForm/useDocumentActionBindings";

import {
  translationActions,
  type TranslationActionFacts,
} from "./translation-actions";
import type { TranslationReview } from "./useTranslationReview";

export interface TranslationHeaderActionsProps {
  facts: Omit<TranslationActionFacts, "review">;
  review: TranslationReview;
  /** Whether a save or a publish of the language is on its way. */
  isSaving: boolean;
  onSave: () => void;
  /** Publish the language, saying first what its readers will see. */
  onPublish: () => void;
  /** Why the language can't be published at this moment, beyond its review. */
  publishReason?: string | undefined;
  /** The page's own rows, on the main button's menu after the model's. */
  rows?: readonly NarrowMenuItem[];
}

const NO_ROWS: readonly NarrowMenuItem[] = [];

/** Why a control waits while the page stores the language. */
const SAVING_REASON = "Saving…";

/** A control's binding, with the reason it waits where it does. */
function bindingOf(
  onSelect: () => void,
  disabledReason: string | undefined
): ActionBinding {
  return disabledReason === undefined
    ? { onSelect }
    : { onSelect, disabledReason };
}

export function TranslationHeaderActions({
  facts,
  review,
  isSaving,
  onSave,
  onPublish,
  publishReason,
  rows = NO_ROWS,
}: TranslationHeaderActionsProps): JSX.Element {
  const { binding, dialog } = review;
  const busy = isSaving ? SAVING_REASON : undefined;
  const bindings: Record<string, ActionBinding> = {
    save: bindingOf(
      onSave,
      busy ?? (facts.isDirty ? undefined : NOTHING_CHANGED_REASON)
    ),
    publish: bindingOf(onPublish, busy ?? publishReason),
  };
  for (const { name } of binding?.state.steps ?? []) {
    bindings[reviewStepActionId(name)] = bindingOf(() => {
      void binding?.takeStep(name);
    }, busy);
  }

  return (
    <>
      <DocumentActionBar
        actions={translationActions({ ...facts, review: binding?.state })}
        bindings={bindings}
        mainMenuItems={rows}
        pending={isSaving}
      />
      {dialog}
    </>
  );
}
