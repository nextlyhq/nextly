/**
 * Which past version, if any, the document area is currently showing.
 *
 * The history panel lists versions and the editor renders them, and those are
 * different parts of the page — so the selection has to live above both. It is
 * carried here rather than lifted into `EntryForm`'s own state so the panel can
 * stay where it is, mounted from the document header, without either component
 * knowing how the other is arranged.
 *
 * The value is deliberately the whole snapshot rather than a version number.
 * A number would make the document area fetch what the panel has already
 * fetched — two readers of one question, disagreeing whenever one of them is
 * mid-flight.
 *
 * @module components/features/versions/document-history-context
 */

import { createContext, useContext } from "react";

import type { VersionMeta, VersionScope } from "@admin/services/versionApi";

import type { Predecessor } from "./version-pairing";

export interface ViewedVersion {
  versionNo: number;
  /**
   * The stored values, once they have arrived. `undefined` means the read is
   * still in flight — a distinct state from a version that holds nothing, and
   * one the document area has to show, because a click that changed nothing on
   * screen reads as a broken control.
   */
  snapshot: unknown;
  /** The locale it was captured in, when the document is localized. */
  locale: string | null;
  /**
   * The fields the read held back, by their full paths, a list row named by
   * its own index (`items.1.secret`). Empty while the read is in flight, and
   * for a reader who may read all of it.
   */
  withheld: readonly string[];
  /** True while the snapshot is being read. */
  isLoading: boolean;
  /** Set when the read failed, so the document says so rather than blanking. */
  error: Error | null;
  /** The document whose history this is, so its changes can be read. */
  scope: VersionScope;
  /**
   * What the version is compared with: the version before it in its own
   * language, as the panel pairs it. Changes are marked against this.
   */
  comparedWith: Predecessor;
  /** The version's name, time and author, once read; null until then. */
  about: VersionMeta | null;
}

/**
 * Restoring, offered by the panel that owns the mutation and its confirmation.
 *
 * Published rather than reimplemented beside the version: a second restore path
 * would be a second answer to "may this caller write, and what happens when
 * they do" — and the panel already holds the permission, the mutation and the
 * dialog that guards it.
 */
export interface RestoreAffordance {
  /** Whether this caller may write the document at all. */
  canRestore: boolean;
  /** Opens the panel's confirmation for the version currently on screen. */
  request: () => void;
  /**
   * Returns to the live document THROUGH the panel, so its own selection is
   * cleared with the shared one. Clearing only the shared state would leave a
   * row marked active for a version no longer on screen, with restore and
   * compare still aimed at it, and clicking that row again a no-op.
   */
  returnToCurrent: () => void;
  /**
   * Shows the history list again. Offered only where the panel is a page over
   * the document and so steps aside while a version is read; beside the
   * document the list never left the screen.
   */
  backToHistory?: () => void;
  /**
   * Opens the full comparison of the version on screen with the one before
   * it, offered where the panel stepped aside and so cannot offer it itself.
   */
  compare?: () => void;
  /**
   * Opens the full comparison of the version on screen with the newest in its
   * language, offered for the same reason as `compare`.
   */
  compareCurrent?: () => void;
}

export interface DocumentHistoryValue {
  /** The version on screen in place of the live document, or null for live. */
  viewing: ViewedVersion | null;
  setViewing: (viewing: ViewedVersion | null) => void;
  /** Present only while the history panel is mounted to provide it. */
  restore: RestoreAffordance | null;
  setRestore: (restore: RestoreAffordance | null) => void;
}

/**
 * Defaults to live with a setter that does nothing, so a document editor
 * rendered without the provider — an embedded editor, a preview, a test
 * harness — behaves exactly as it did before history existed rather than
 * throwing. Both full-page editors provide it through the shared host.
 */
export const DocumentHistoryContext = createContext<DocumentHistoryValue>({
  viewing: null,
  setViewing: () => {},
  restore: null,
  setRestore: () => {},
});

export function useDocumentHistory(): DocumentHistoryValue {
  return useContext(DocumentHistoryContext);
}
