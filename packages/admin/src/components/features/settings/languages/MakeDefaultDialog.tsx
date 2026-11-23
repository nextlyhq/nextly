"use client";

/**
 * Making another language the default, confirmed after reading what the
 * server says the change touches: how much content each language holds, and
 * whether the current default has unpublished changes, which the server
 * refuses the change over. The change rewrites no content: each translated
 * value keeps its record of the language it was made from, and only values
 * written in the new default from then on count as written originally. The
 * dialog says so, rather than promising anything about the content beyond it.
 */

import { Alert, AlertDescription, Button, Skeleton } from "@nextlyhq/ui";
import type React from "react";

import { useDefaultChangePreview } from "@admin/hooks/queries/useLanguageSettings";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import type {
  DefaultChangeSummary,
  LanguageView,
} from "@admin/types/languages";

import { itemsPhrase, languageName } from "./language-settings-model";
import {
  type LanguageDialogSave,
  LanguageConfirmDialog,
} from "./LanguageDialogParts";

export interface MakeDefaultDialogProps extends LanguageDialogSave {
  language: LanguageView;
  /** The site's active languages, in order. */
  active: readonly LanguageView[];
}

export function MakeDefaultDialog({
  language,
  active,
  ...save
}: MakeDefaultDialogProps): React.JSX.Element {
  const preview = useDefaultChangePreview(language.code);
  const summary = preview.data;
  const to = language.label;
  // Confirmed only from a summary read now: not while it is being read again,
  // when what is shown may be a summary from before, nor after a read failed.
  const readNow = !preview.isFetching && !preview.error;

  return (
    <LanguageConfirmDialog
      {...save}
      title={`Make ${to} the default?`}
      change={
        summary && readNow && summary.pendingInCurrentDefault === 0
          ? { kind: "setDefault", code: language.code, confirmed: true }
          : undefined
      }
      confirmLabel={`Make ${to} the default`}
      savingLabel="Changing…"
      variant="primary"
    >
      {preview.error ? (
        <PreviewError
          error={preview.error}
          onRetry={() => {
            void preview.refetch();
          }}
        />
      ) : summary ? (
        <ChangeSummary
          summary={summary}
          from={languageName(active, summary.from)}
          to={to}
          active={active}
        />
      ) : (
        <div className="space-y-2" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      )}
    </LanguageConfirmDialog>
  );
}

/** The summary could not be read; it can be asked again. */
function PreviewError({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <p role="alert">
        {apiErrorMessage(error, "What this change touches could not be read.")}
      </p>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

interface ChangeSummaryProps {
  summary: DefaultChangeSummary;
  /** The current default's name. */
  from: string;
  /** The new default's name. */
  to: string;
  active: readonly LanguageView[];
}

/** What the change does, from the server's summary, said before it is confirmed. */
function ChangeSummary({
  summary,
  from,
  to,
  active,
}: ChangeSummaryProps): React.JSX.Element {
  const pending = summary.pendingInCurrentDefault;
  return (
    <>
      <p>
        {to} becomes the language content is edited in, and the one readers get
        when they ask for no language. {from} stays a language of the site.
      </p>
      <p>
        <span className="font-medium">Translations keep their records.</span>{" "}
        Each translated value still records the language it was made from,{" "}
        {`${to}'s translations from ${from} included`}, and counts as out of
        date when that language&apos;s text changes. What is written in {to}{" "}
        from now on counts as written originally in {to}.
      </p>
      <div>
        <p className="font-medium">Content in each language</p>
        <ul className="mt-1 space-y-0.5">
          {active.map(each => (
            <li key={each.code}>
              {each.label}:{" "}
              {itemsPhrase(summary.translationsPerLanguage[each.code] ?? 0)}
            </li>
          ))}
        </ul>
      </div>
      {pending > 0 && (
        <Alert variant="warning" role="alert">
          <AlertDescription>
            {from} has {pending} unpublished{" "}
            {pending === 1 ? "change" : "changes"}. Publish or discard{" "}
            {pending === 1 ? "it" : "them"} before making another language the
            default.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
