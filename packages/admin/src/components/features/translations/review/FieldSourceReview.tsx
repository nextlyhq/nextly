"use client";

/**
 * The review of an out-of-date field, where the field is translated: closed
 * until it is asked for, then what changed in the source, the translation as
 * it stands, and what can be done about it.
 *
 * It shows the stored translation, so once the translator has changed the
 * field there is nothing to keep: the save says what the text is now.
 *
 * @module components/features/translations/review/FieldSourceReview
 */

import { useId, useState, type JSX } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";

import { ChevronDown, ChevronRight } from "@admin/components/icons";
import { Button } from "@admin/components/ui";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import type { TranslatedDocument } from "@admin/lib/navigation/translation-address";
import type { SourceChange } from "@admin/services/sourceReviewApi";

import { fieldText } from "./field-text";
import { OutOfDateReview, type ReviewLanguage } from "./OutOfDateReview";
import { useSourceReview, type SourceReview } from "./useSourceReview";

export interface FieldSourceReviewProps {
  document: TranslatedDocument;
  /** The field, by its name in the form and by its label. */
  field: { name: string; label: string };
  /** The language being written. */
  target: ReviewLanguage;
  /** Any of the site's languages, or one no longer among them by its code. */
  languageOf: (code: string) => ReviewLanguage;
  /** Where the translation came from, as recorded. */
  origin: string | undefined;
  /** Whether the reader may only look at this field. */
  readOnly: boolean;
  /** The page is storing the language: nothing else is. */
  isSaving: boolean;
  /** Takes the keyboard to the field's control. */
  focusField: () => void;
  /** Reads the document again. */
  reload: () => Promise<unknown>;
}

/** Why there are no two versions to set side by side; undefined where there are. */
function nothingToCompare(change: SourceChange): string | undefined {
  if (change.sourceLocale === undefined) {
    return "This was written in its own language, so it has no source to compare with.";
  }
  if (!change.available && change.reason === "source-language-removed") {
    return `This was translated from a language the site no longer has (${change.sourceLocale}).`;
  }
  return undefined;
}

/** What the review says while there is nothing to compare yet. */
function ReviewState({ review }: { review: SourceReview }): JSX.Element {
  if (review.error !== null) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-sm text-destructive">
          {apiErrorMessage(review.error, "What changed couldn't be loaded.")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={review.retry}
        >
          Try again
        </Button>
      </div>
    );
  }
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Loading what changed…
    </p>
  );
}

/** The versions side by side, with what can be done about them. */
function Comparison({
  change,
  review,
  shown,
}: {
  change: SourceChange & { sourceLocale: string };
  review: SourceReview;
  shown: FieldSourceReviewProps;
}): JSX.Element {
  const { name, label } = shown.field;
  const { control, getFieldState } = useFormContext();
  const formState = useFormState({ control, name, exact: true });
  const value: unknown = useWatch({ control, name });
  const changed = getFieldState(name, formState).isDirty;
  // Stored, whatever is being typed over it.
  const stored: unknown = formState.defaultValues?.[name];
  return (
    <>
      <OutOfDateReview
        fieldLabel={label}
        source={{
          language: shown.languageOf(change.sourceLocale),
          before: change.available ? fieldText(change.before) : null,
          after: fieldText(change.after),
        }}
        translation={{
          language: shown.target,
          text: fieldText(changed ? stored : value),
          origin: shown.origin,
        }}
        onKeepCurrent={review.keep}
        onEdit={shown.focusField}
        readOnly={shown.readOnly || changed}
        busy={review.isKeeping || shown.isSaving}
      />
      {changed && !shown.readOnly ? (
        <p className="mt-3 text-xs text-muted-foreground">
          You&apos;ve changed this translation. Saving it marks it up to date.
        </p>
      ) : null}
    </>
  );
}

export function FieldSourceReview(props: FieldSourceReviewProps): JSX.Element {
  const { document, field, target, focusField, reload } = props;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const review = useSourceReview({
    document,
    locale: target.code,
    field: field.name,
    fieldLabel: field.label,
    open,
    onKept: async () => {
      // The review goes with the mark: the keyboard is left on the field.
      focusField();
      await reload();
    },
  });
  const { change } = review;
  const unsaid = change === undefined ? undefined : nothingToCompare(change);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="mt-2" data-slot="translation-review">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`What changed: ${field.label}`}
        onClick={() => setOpen(!open)}
      >
        <Chevron className="h-4 w-4" aria-hidden />
        What changed
      </Button>
      <div
        id={panelId}
        hidden={!open}
        className="mt-2 rounded-md border border-border bg-muted/30 p-4"
      >
        {!open ? null : change === undefined ? (
          <ReviewState review={review} />
        ) : unsaid !== undefined || change.sourceLocale === undefined ? (
          <p className="text-sm text-muted-foreground">{unsaid}</p>
        ) : (
          <Comparison
            change={{ ...change, sourceLocale: change.sourceLocale }}
            review={review}
            shown={props}
          />
        )}
      </div>
    </div>
  );
}
