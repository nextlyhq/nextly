"use client";

/**
 * History on the translation page: the language's versions and the shared
 * fields beside the page, a chosen version in place of the live text, and a
 * restore into the page as unsaved work.
 *
 * The panel, the version and the restore are the editor's own. The page saves
 * what a restore put in, or doesn't: nothing here writes the document.
 *
 * @module components/features/translations/history/TranslationHistory
 */

import { History } from "lucide-react";
import type { JSX, ReactNode } from "react";

import { WIDE_ONLY } from "@admin/components/features/entries/EntryForm/DocumentActionBar";
import { DocumentHistoryContext } from "@admin/components/features/versions/document-history-context";
import { useHistoryAddress } from "@admin/components/features/versions/history-address";
import { LazyVersionHistorySheet } from "@admin/components/features/versions/LazyVersionHistorySheet";
import { PastVersionActions } from "@admin/components/features/versions/PastVersionActions";
import { useVersionActions } from "@admin/components/features/versions/version-actions";
import { ViewedVersionBody } from "@admin/components/features/versions/viewed-version-host";
import { Button } from "@admin/components/ui";

import type { TranslationHistory } from "./useTranslationHistory";

export interface TranslationHistoryProviderProps {
  history: TranslationHistory;
  /** The code of the language the page writes, which the list opens on. */
  language: string;
  /** Whether the person may change the language's text. */
  canRestore: boolean;
  /** Whether the server refuses every write, as where the type was removed from code. */
  writesRefused: boolean;
  /** Whether a save is on its way, which a restore waits for. */
  isSaving: boolean;
  /** Whether the collection or Single has a publish lifecycle. */
  lifecycle: boolean;
  /** The retention limit, which the list states; absent where it is not known. */
  retention?: number | false;
  /** The page's header and body, which the version on screen is shared with. */
  children: ReactNode;
}

/** The version on screen, for the header and body below it, and the panel. */
export function TranslationHistoryProvider({
  history,
  language,
  canRestore,
  writesRefused,
  isSaving,
  lifecycle,
  retention,
  children,
}: TranslationHistoryProviderProps): JSX.Element {
  const { open, setOpen } = useHistoryAddress(history.offered);
  return (
    <DocumentHistoryContext.Provider value={history.host.documentHistory}>
      {children}
      {history.offered ? (
        <LazyVersionHistorySheet
          open={open}
          onOpenChange={setOpen}
          scope={history.scope}
          entityLocalized
          canRestore={canRestore && !writesRefused}
          writesRefused={writesRefused}
          restoreRefused={isSaving}
          lifecycle={lifecycle}
          editingLocale={language}
          {...(retention === undefined ? {} : { retention })}
        />
      ) : null}
    </DocumentHistoryContext.Provider>
  );
}

/**
 * The header's History, and the page's own actions beside it. While a past
 * version is on screen the version's own actions stand in their place: the
 * page's act on the live text, which is not what is being read.
 */
export function TranslationHistoryControls({
  history,
  actionsDisabled,
  children,
}: {
  history: TranslationHistory;
  /** Why no write may be offered now: a read-only page, or a save on its way. */
  actionsDisabled: boolean;
  /** The page's own actions, for the live text. */
  children: ReactNode;
}): JSX.Element {
  const { open, setOpen } = useHistoryAddress(history.offered);
  const versionActions = useVersionActions(actionsDisabled);
  return (
    <>
      {history.offered ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <History className="h-4 w-4" aria-hidden="true" />
          History
        </Button>
      ) : null}
      {versionActions === null ? (
        children
      ) : (
        // On a phone they are drawn in the version's own bar.
        <PastVersionActions
          versionActions={versionActions}
          buttonClassName={WIDE_ONLY}
        />
      )}
    </>
  );
}

/**
 * The page's content, or the version on screen in its place. The content stays
 * mounted beneath a version, so what was being written is there on return.
 */
export function TranslationHistoryBody({
  history,
  actionsDisabled,
  children,
}: {
  history: TranslationHistory;
  /** Why no write may be offered now: a read-only page, or a save on its way. */
  actionsDisabled: boolean;
  children: ReactNode;
}): JSX.Element {
  const { historicalValues } = history.host;
  const versionActions = useVersionActions(actionsDisabled);
  // Once the version is on screen: before that, it isn't known to be one this
  // language can take values from.
  const offersRestore =
    versionActions?.restore !== undefined && !versionActions.restoreDisabled;
  return (
    <>
      {/* Said before the list is opened: there, a shared field is shown and
          can't be chosen. */}
      {offersRestore ? (
        <p className="mb-4 text-sm text-muted-foreground">
          Shared fields are changed in the editor.
        </p>
      ) : null}
      <ViewedVersionBody
        fields={history.versionFields}
        {...(historicalValues === null ? {} : { values: historicalValues })}
        actionsDisabled={actionsDisabled}
      >
        {children}
      </ViewedVersionBody>
    </>
  );
}
