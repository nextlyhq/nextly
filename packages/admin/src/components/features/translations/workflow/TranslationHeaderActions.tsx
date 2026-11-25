"use client";

/**
 * The translation page's actions on its language: the one that leads, and what
 * stands beside it, drawn by the editor's own action bar.
 *
 * Where a workflow holds the language, its next step leads, or Publish held
 * with the reason; where none does, the bar is the one a language without a
 * workflow has.
 *
 * @module components/features/translations/workflow/TranslationHeaderActions
 */

import type { JSX } from "react";

import { reviewStepActionId } from "@admin/components/features/entries/EntryForm/document-actions";
import {
  DocumentActionBar,
  type ActionBinding,
} from "@admin/components/features/entries/EntryForm/DocumentActionBar";
import { NOTHING_CHANGED_REASON } from "@admin/components/features/entries/EntryForm/useDocumentActionBindings";
import { StepRefusalNote } from "@admin/components/features/entries/review/StepRefusalNote";

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
}

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
}: TranslationHeaderActionsProps): JSX.Element {
  const { binding, refusal, clearRefusal, dialog } = review;
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
    <div className="flex min-w-0 max-w-full flex-col items-end">
      <DocumentActionBar
        actions={translationActions({ ...facts, review: binding?.state })}
        bindings={bindings}
        pending={isSaving}
      />
      <StepRefusalNote refusal={refusal} onDismiss={clearRefusal} />
      {dialog}
    </div>
  );
}
