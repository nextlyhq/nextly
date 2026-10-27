"use client";

/**
 * The frame both document editors are drawn in: the document bar, the banners
 * under it, then the row holding the field column and the document panel.
 *
 * The bar and the banners span the whole row, panel included, so they are
 * drawn here ABOVE the row rather than inside the field column, which the
 * content measure caps. All three share one parent so the bar's stickiness
 * holds for the editor's whole height.
 *
 * @module components/features/entries/EntryForm/DocumentEditorLayout
 */

import type { JSX, ReactNode } from "react";

/**
 * How the document panel's inner column sticks: under the bar (3.25rem, the
 * bar's one-row height) rather than beneath it, and as tall as the window
 * less the admin's top bar (4rem) and the document bar. Shared by both
 * editors' panels so they line up with the one bar both draw.
 */
export const DOCUMENT_PANEL_STICKY =
  "@4xl/content:sticky @4xl/content:top-13 @4xl/content:h-[calc(100vh-7.25rem)]";

export interface DocumentEditorLayoutProps {
  /** The document bar. */
  bar: ReactNode;
  /** The banners, drawn directly under the bar. */
  banners: ReactNode;
  /** Anything else the whole editor says before its fields (a form's errors). */
  notices?: ReactNode;
  /** The field column and the document panel, laid out side by side. */
  children: ReactNode;
}

export function DocumentEditorLayout({
  bar,
  banners,
  notices,
  children,
}: DocumentEditorLayoutProps): JSX.Element {
  return (
    // Vertical only: from `@4xl` the editor cancels the page's `py-8`, so the
    // bar reaches the top of the scroll area and the panel the bottom. The
    // floor is the window less the admin's top bar.
    <div className="flex flex-col @4xl/content:-my-8 @4xl/content:min-h-[calc(100vh-4rem)]">
      {bar}
      {banners}
      {notices}
      <div className="flex flex-1 flex-col items-stretch @4xl/content:flex-row">
        {children}
      </div>
    </div>
  );
}
