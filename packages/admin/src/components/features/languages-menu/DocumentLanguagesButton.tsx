"use client";

/**
 * DocumentLanguagesButton: the Languages button as an editor mounts it for a translated document,
 * an entry and a Single alike, given what its form knows about it and the language on screen.
 *
 * @module components/features/languages-menu/DocumentLanguagesButton
 */

import type { JSX } from "react";

import type { DocumentPanelMode } from "@admin/components/features/entries/EntryForm/document-panel-mode";
import { translateAddress } from "@admin/components/features/entries/publish-parts/out-of-date";
import { useLanguageReviewStages } from "@admin/components/features/entries/review/useLanguageReviewStages";
import { barFolds } from "@admin/components/layout/header/bar-fold";
import { useTopBarWidth } from "@admin/components/layout/header/TopBarPlaces";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { useLocalization } from "@admin/hooks/useLocalization";
import { useSearchParams } from "@admin/hooks/useSearchParams";
import { READ_SETTINGS } from "@admin/lib/permissions/system-policy";
import type { ReleaseDocumentRef } from "@admin/types/releases";

import {
  currentLanguageOf,
  documentLanguagesOf,
  editAddress,
  keepingQuery,
  languagesHeldReason,
  type LanguagesHold,
} from "./document-languages";
import { languagesMenuModel } from "./languages-menu-model";
import { LanguagesButton } from "./LanguagesButton";

export interface DocumentLanguagesButtonProps {
  /** The document, as the editor read it. */
  document: unknown;
  /** The document, as its review is kept for. */
  reviewed: ReleaseDocumentRef;
  /** Whether it has a Draft / Published lifecycle. */
  hasStatus: boolean;
  /** The editor's own address, which the rows' addresses add a language to. */
  editorPath: string;
  /** The language on screen; undefined is the default one. */
  locale: string | undefined;
  /** Whether the language on screen is being translated, its source beside it. */
  translating: boolean;
  /** What holds the language on screen. */
  hold: LanguagesHold;
  /** Whether the person may change the language on screen now. */
  canEdit: boolean;
  /**
   * Opens the choice of which languages to publish. Absent where the person may not publish, or
   * not at this moment.
   */
  onPublishOthers: (() => void) | undefined;
  /** How the document panel sits: as a sheet, on a phone, the bar keeps icons alone. */
  panelMode: DocumentPanelMode;
}

export function DocumentLanguagesButton({
  document,
  reviewed,
  hasStatus,
  editorPath,
  locale,
  translating,
  hold,
  canEdit,
  onPublishOthers,
  panelMode,
}: DocumentLanguagesButtonProps): JSX.Element | null {
  const { locales, defaultLocale } = useLocalization();
  const { hasPermission } = useCurrentUserPermissions();
  const barWidth = useTopBarWidth();
  const query = useSearchParams();
  const heldReason = languagesHeldReason(hold);
  const stages = useLanguageReviewStages(reviewed);
  return (
    <LanguagesButton
      model={languagesMenuModel({
        languages: locales,
        defaultLanguage: defaultLocale,
        ...documentLanguagesOf(document, hasStatus),
      })}
      translateHref={code =>
        keepingQuery(translateAddress(editorPath, code, defaultLocale), query)
      }
      editHref={keepingQuery(editAddress(editorPath, defaultLocale), query)}
      canEdit={canEdit}
      currentLanguage={currentLanguageOf({
        locale,
        defaultLanguage: defaultLocale,
        translating,
      })}
      stages={stages}
      heldReason={heldReason}
      // Publishing is held with everything else that acts on the live document.
      onPublishOthers={heldReason === undefined ? onPublishOthers : undefined}
      canManageLanguages={hasPermission(READ_SETTINGS)}
      iconOnly={panelMode === "sheet" || barFolds(barWidth)}
    />
  );
}
