"use client";

/**
 * The document's banners, directly under the document bar and across the
 * editor's full width, in one order on entries and Singles alike:
 *
 * 1. a strip about the whole document from the page, such as its scheduled
 *    release;
 * 2. the lock: a colleague editing, or the reader's read-only notice;
 * 3. the offer to recover unsaved work;
 * 4. the past version on screen, with its comparison.
 *
 * One component for both editors, so the order is decided once. Inside the
 * editor's scrolling area and after the sticky bar in it, so no banner can be
 * drawn underneath the bar.
 *
 * The past version's banner belongs to the version body, which also owns the
 * change navigation it shares with the fields, so it is drawn by that body
 * into the place this stack keeps for it rather than moved up here.
 *
 * @module components/features/entries/EntryForm/DocumentBanners
 */

import type { JSX, ReactNode } from "react";

import type { ViewedVersion } from "@admin/components/features/versions/document-history-context";
import type { UseAutosaveRecoveryResult } from "@admin/hooks/useAutosaveRecovery";

import { LiveDocumentRecoveryOffer } from "./AutosaveRecoveryBanner";
import { DocumentLockBanner } from "./DocumentLockBanner";
import type { DocumentLockSurface } from "./useDocumentLockSurface";

/**
 * How a card-shaped banner is drawn here: a full-width band with a rule under
 * it, its surface tone kept. The scheduled-release banner is already a band.
 */
const BAND = "rounded-none border-x-0 border-t-0 px-6";

export interface DocumentBannersProps {
  /** The page's strip about the whole document, drawn first. */
  documentBanner?: ReactNode;
  /** The editor's claim on the document, which says why it is held. */
  lock: Pick<DocumentLockSurface, "notice" | "takeOver" | "requestAccess">;
  /** The editor's recovery state. */
  recovery: UseAutosaveRecoveryResult;
  /** The past version on screen, or null while the live document is. */
  viewingVersion: ViewedVersion | null;
  /** Receives the element the past version's banner is drawn into. */
  versionBannerRef: (element: HTMLDivElement | null) => void;
}

export function DocumentBanners({
  documentBanner,
  lock,
  recovery,
  viewingVersion,
  versionBannerRef,
}: DocumentBannersProps): JSX.Element {
  return (
    <div data-testid="document-banners">
      {documentBanner}
      <DocumentLockBanner
        notice={lock.notice}
        onTakeOver={lock.takeOver}
        onRequestAccess={lock.requestAccess}
        className={BAND}
      />
      <LiveDocumentRecoveryOffer
        recovery={recovery}
        viewingVersion={viewingVersion}
        className={BAND}
      />
      {/* The version body draws the past version's banner here. Collapsed
        while there is none, so an empty band never shows. */}
      <div
        ref={versionBannerRef}
        className="border-b border-border bg-muted px-6 py-3 empty:hidden"
      />
    </div>
  );
}
