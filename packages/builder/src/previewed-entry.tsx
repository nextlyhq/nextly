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
 * One top-level blocks field of a template's collection: what an Entry
 * content block may draw.
 *
 * @experimental Settles when collection templates ship.
 */
export interface PreviewedBlocksField {
  /** The field's name, which the block stores. */
  readonly name: string;
  /** What the admin calls it: "Body". */
  readonly label: string;
}

/**
 * The collection a template draws, as its editor names it: its names, its
 * top-level blocks fields, and where one of its entries is edited.
 *
 * - `blocksFields` is `undefined` while they are not known (the first
 *   answer is on its way, or the author may not read the collection), so a
 *   choice is never called removed for want of an answer.
 *
 * @experimental Settles when collection templates ship.
 */
export interface PreviewedCollection {
  /** The collection's slug. */
  readonly slug: string;
  /** Its name for one entry, as a sentence reads it: "post". */
  readonly singular: string;
  /** Its name, as a heading reads it: "Posts". */
  readonly plural: string;
  /** Its top-level blocks fields, in the collection's order. */
  readonly blocksFields: readonly PreviewedBlocksField[] | undefined;
  /**
   * What a field of the collection is called, by its name: its label where
   * it is one of {@link blocksFields}, else its name in words as the admin
   * words a key ("membersOnly" is "Members Only"), for a field the
   * collection no longer has. The one name a field is shown by, on the
   * canvas, in Layers and in the inspector alike.
   */
  readonly fieldLabel: (name: string) => string;
  /** The admin address where entry `id` is edited. */
  readonly entryHref: (id: string) => string;
}

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

/** No provider, or one that names no collection: not a template. */
const PreviewedCollectionContext = createContext<
  PreviewedCollection | undefined
>(undefined);

/**
 * Hands the editor the entry a template is previewed with. The host mounts
 * it only around a template's editor, so a page, a component or a Layout
 * reads `undefined`.
 *
 * @experimental Settles when collection templates ship.
 */
export function PreviewedEntryProvider({
  value,
  collection,
  children,
}: {
  readonly value: PreviewedEntry;
  /**
   * The template's collection, for what reads its fields: an Entry content
   * block's mark, its inspector and its canvas notes.
   */
  readonly collection?: PreviewedCollection | undefined;
  readonly children?: ReactNode;
}): React.JSX.Element {
  return (
    <PreviewedEntryContext.Provider value={value}>
      <PreviewedCollectionContext.Provider value={collection}>
        {children}
      </PreviewedCollectionContext.Provider>
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

/**
 * The collection the template being edited draws, or `undefined` where the
 * document is not a template, or its editor names none.
 *
 * @experimental Settles when collection templates ship.
 */
export function usePreviewedCollection(): PreviewedCollection | undefined {
  return useContext(PreviewedCollectionContext);
}

/**
 * The words an Entry content block is named by on the canvas and in
 * Layers, with the field it draws: "Entry content · Body", or the field's
 * name where the collection's fields are not known.
 *
 * @experimental Settles when collection templates ship.
 */
export function entryContentLabel(
  field: string | undefined,
  collection: PreviewedCollection | undefined
): string {
  if (field === undefined) return ENTRY_CONTENT_NAME;
  return `${ENTRY_CONTENT_NAME} · ${fieldName(field, collection)}`;
}

/**
 * The name a field an Entry content block draws is shown by: the
 * collection's (`PreviewedCollection.fieldLabel`), or the field's own name
 * where no template's collection is known.
 *
 * @experimental Settles when collection templates ship.
 */
export function fieldName(
  field: string,
  collection: PreviewedCollection | undefined
): string {
  return collection?.fieldLabel(field) ?? field;
}

/**
 * Whether the collection is known to have no top-level blocks field named
 * `field`. Never while its fields are not known, so a choice is not called
 * removed for want of an answer.
 */
export function entryFieldRemoved(
  field: string | undefined,
  collection: PreviewedCollection | undefined
): boolean {
  const fields = collection?.blocksFields;
  return (
    field !== undefined &&
    fields !== undefined &&
    !fields.some(each => each.name === field)
  );
}

/** The block's own name, as the Add panel reads it. */
const ENTRY_CONTENT_NAME = "Entry content";
