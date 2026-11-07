"use client";

/**
 * The entry a template is previewed with, handed by the host to whatever in
 * the editor reads it: the canvas's notes, and the inspector's.
 *
 * A template draws every entry of its collection, so while one is edited the
 * host previews it with a real entry, chosen beside the canvas. This is that
 * entry as the editor knows it: its values as the person editing reads them,
 * drafts included, its published values as a visitor reads them, and the
 * fields a visitor may read. Where no entry can be previewed, it says so
 * instead. Outside a template there is no previewed entry at all, and the
 * hook answers `undefined`.
 *
 * A context rather than a member of `ContentServices`, for the reason the
 * visitor-unreadable context gives: the services are one object per language
 * and person, while this answer changes whenever the author previews another
 * entry.
 *
 * @module previewed-entry
 */

import type { BindingFieldShape } from "@nextlyhq/blocks-engine";
import { createContext, useContext, type ReactNode } from "react";

/**
 * The entry a template is previewed with, or why there is none.
 *
 * - `entry`: an entry of the template's collection. `editorValues` are what
 *   the person editing reads, a waiting working draft included;
 *   `publicValues` are the published entry as an anonymous visitor reads it,
 *   or `null` where the visitor may not read it (a draft never published,
 *   or a collection the public may not read); `fields` are the collection's
 *   fields as a visitor may read them.
 * - `none`: no entry to preview. `reason` says why as far as the person may
 *   know it: `empty` when there is no entry they may read, which reads the
 *   same whether the collection holds none or holds only entries they may
 *   not read; `loading` while the first answer is on its way; `unavailable`
 *   when the entry could not be read.
 *
 * @experimental Settles when collection templates ship.
 */
export type PreviewedEntry =
  | {
      readonly kind: "entry";
      /** The template's collection. */
      readonly collection: string;
      readonly id: string;
      readonly title: string;
      readonly publicValues: Readonly<Record<string, unknown>> | null;
      readonly editorValues: Readonly<Record<string, unknown>>;
      readonly fields: readonly BindingFieldShape[];
    }
  | {
      readonly kind: "none";
      readonly reason: "empty" | "loading" | "unavailable";
    };

/**
 * The keys that preview the next and the previous entry of a template's
 * collection: Shift with the block-move chord, so the two read as related
 * and never collide (a chord's modifiers are matched exactly).
 *
 * @experimental Settles when collection templates ship.
 */
export const PREVIEWED_ENTRY_KEYS: {
  readonly next: "shift+alt+ArrowDown";
  readonly previous: "shift+alt+ArrowUp";
} = Object.freeze({
  next: "shift+alt+ArrowDown",
  previous: "shift+alt+ArrowUp",
});

/** No provider: the document is not a template. */
const PreviewedEntryContext = createContext<PreviewedEntry | undefined>(
  undefined
);

/**
 * Hands the editor the entry a template is previewed with. The host mounts
 * it only around a template's editor, so a page, a component or a Layout
 * reads `undefined`.
 *
 * @experimental Settles when collection templates ship.
 */
export function PreviewedEntryProvider({
  value,
  children,
}: {
  readonly value: PreviewedEntry;
  readonly children?: ReactNode;
}): React.JSX.Element {
  return (
    <PreviewedEntryContext.Provider value={value}>
      {children}
    </PreviewedEntryContext.Provider>
  );
}

/**
 * The entry the template being edited is previewed with, or `undefined`
 * where the document is not a template and nothing is previewed.
 *
 * @experimental Settles when collection templates ship.
 */
export function usePreviewedEntry(): PreviewedEntry | undefined {
  return useContext(PreviewedEntryContext);
}
