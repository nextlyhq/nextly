"use client";

/**
 * The review of one out-of-date field: what changed in its source since it was
 * translated, the translation as it stands, and what can be done about it.
 *
 * It is given everything it shows and reports every choice: it reads nothing,
 * saves nothing, and never changes the translation itself.
 *
 * @module components/features/translations/review/OutOfDateReview
 */

import { useMemo, type JSX, type ReactNode } from "react";

import { TextRuns } from "@admin/components/features/versions/diff/diff-primitives";
import { splitTextSegments } from "@admin/components/features/versions/diff/text-segment-sides";
import { Button } from "@admin/components/ui";
import type { LocaleMeta } from "@admin/hooks/useLocalization";
import type { TextSegment } from "@admin/services/versionApi";

import { changeInWords, diffSourceText } from "./source-text-diff";

/** A language as the review names it and sets its text. */
export type ReviewLanguage = Pick<LocaleMeta, "code" | "label" | "rtl">;

export interface OutOfDateReviewProps {
  /** The field's label, as the editor shows it. */
  fieldLabel: string;
  /** The source, as plain text. */
  source: {
    language: ReviewLanguage;
    /**
     * The text the translation was made from. `null` where it was not kept,
     * which is not the same as an empty text.
     */
    before: string | null;
    /** The text now. */
    after: string;
  };
  /** The translation as it stands, as plain text. */
  translation: {
    language: ReviewLanguage;
    text: string;
    /** The recorded origin of the value; absent where none is recorded. */
    origin?: string | undefined;
  };
  /** The translation still fits: mark it reviewed against the source now. */
  onKeepCurrent: () => void;
  /** Open the translation for editing. */
  onEdit: () => void;
  /** The person may read the translation but not change it: no actions. */
  readOnly?: boolean;
  /**
   * A choice is being saved: the review's own actions do nothing meanwhile.
   * The suggestion's are the caller's to hold back.
   */
  busy?: boolean;
  /**
   * Actions on a suggested translation, shown after the review's own. Absent,
   * nothing stands in their place.
   */
  suggestionActions?: ReactNode;
}

/** Whether a person edited the translation, from its recorded origin. */
const ORIGIN_SENTENCES: ReadonlyMap<string, string> = new Map([
  ["person", "Last edited by a person."],
  ["agent", "Written by an agent. Not edited by a person."],
  ["machine", "Machine translated. Not edited by a person."],
  ["integration", "Written by an integration. Not edited by a person."],
  ["import", "Imported. Not edited by a person."],
  ["copy", "Copied from another language. Not edited by a person."],
]);

/** Said of an origin that does not answer the question, or is not recorded. */
const ORIGIN_NOT_KNOWN = "It isn't known whether a person edited this.";

/**
 * A button that does nothing while a choice is saved keeps the keyboard's
 * place, which a disabled one would drop, and looks as a disabled one does.
 */
const INERT =
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:active:scale-100";

/** A whole text as one unmarked run, and an empty one as none. */
const unmarked = (text: string): TextSegment[] =>
  text === "" ? [] : [{ op: 0, text }];

/** One text in its own language and writing direction. */
function TextIn({
  language,
  segments,
}: {
  language: ReviewLanguage;
  segments: readonly TextSegment[];
}): JSX.Element {
  // Said rather than left blank: a blank space reads as a failed load.
  if (segments.length === 0) {
    return <p className="text-muted-foreground">Empty</p>;
  }
  return (
    <div lang={language.code} dir={language.rtl ? "rtl" : "ltr"}>
      <TextRuns segments={segments} />
    </div>
  );
}

/** One of the versions on show, under its name. */
function Version({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{name}</dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}

export function OutOfDateReview({
  fieldLabel,
  source,
  translation,
  onKeepCurrent,
  onEdit,
  readOnly = false,
  busy = false,
  suggestionActions,
}: OutOfDateReviewProps): JSX.Element {
  const { before, after } = source;
  const segments = useMemo(
    () => (before === null ? null : diffSourceText(before, after)),
    [before, after]
  );
  const sides = segments === null ? null : splitTextSegments(segments);

  return (
    <div
      role="group"
      aria-label={`Out of date: ${fieldLabel}`}
      className="@container flex flex-col gap-4"
    >
      {/* Stacked on a phone, side by side where there is room. */}
      <dl className="grid gap-4 @2xl:grid-cols-2">
        <Version name={`${source.language.label}, earlier version`}>
          {sides === null ? (
            <p className="text-muted-foreground">
              The earlier version isn&apos;t available.
            </p>
          ) : (
            <TextIn language={source.language} segments={sides.before} />
          )}
        </Version>
        <Version name={`${source.language.label} now`}>
          <TextIn
            language={source.language}
            segments={sides === null ? unmarked(after) : sides.after}
          />
        </Version>
      </dl>
      {segments !== null && (
        <p className="text-xs text-muted-foreground">
          {changeInWords(segments) ??
            "The wording is the same. Something else changed, such as formatting."}
        </p>
      )}
      <dl className="border-t border-border pt-4">
        <Version name={`Current ${translation.language.label} translation`}>
          <TextIn
            language={translation.language}
            segments={unmarked(translation.text)}
          />
        </Version>
      </dl>
      <p className="text-xs text-muted-foreground">
        {ORIGIN_SENTENCES.get(translation.origin ?? "") ?? ORIGIN_NOT_KNOWN}
      </p>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Named for the field: read out of context, a page of these would
              all say the same. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={INERT}
            aria-label={`Keep current: ${fieldLabel}`}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) onKeepCurrent();
            }}
          >
            Keep current
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={INERT}
            aria-label={`Edit: ${fieldLabel}`}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) onEdit();
            }}
          >
            Edit
          </Button>
          {suggestionActions}
        </div>
      )}
    </div>
  );
}
