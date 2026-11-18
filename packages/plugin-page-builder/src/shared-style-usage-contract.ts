/**
 * The types of a shared style's usage that name what the editor has open: the
 * kinds of document a style is counted on, what the usage read names (the
 * open document, field, language and form), and the parts of that document's
 * saved blocks the route answers. Types only, so the contract stays free of
 * runtime imports; re-exported from `library-contract`, which callers import.
 *
 * @module shared-style-usage-contract
 */

/**
 * The kinds of document a shared style is counted on. Every collection with a
 * page builder field other than the composition stores holds pages.
 */
export type SharedStyleUsageKind =
  | "pages"
  | "components"
  | "patterns"
  | "layouts";

/** The stored forms of a document: its main row, and a pending working draft. */
type SharedStyleUsageVariant = "published" | "draft";

/**
 * What the editor has open, as the usage route is told of it: a saved
 * document (an entry of a collection by its id, or a Single, which has one),
 * the blocks field the editor is bound to, the language and the stored form.
 */
export interface SharedStyleUsageHere {
  readonly document:
    | { readonly collection: string; readonly id: string }
    | { readonly single: string };
  readonly field: string;
  /** The language by code; absent for the site's default language. */
  readonly locale?: string;
  /**
   * `draft` while the editor holds a published document's pending working
   * draft, which is stored apart; `published` for the main row.
   */
  readonly variant: SharedStyleUsageVariant;
  /**
   * Set while the open copy is live as saved and stays so until this edit is
   * published: a published document with no pending draft, which a save
   * turns into a draft beside it. Its saved blocks are still on the site,
   * so they count beside the live edit rather than being replaced by it.
   */
  readonly keepsSaved?: true;
}

/**
 * The open document's saved blocks wearing a style, in the parts the editor
 * replaces with its live field: with the open field's rows set aside,
 * `alongside` is the largest copy the open field is part of (the language
 * being edited, or each language for a field they all share) and `elsewhere`
 * the largest of the document's other copies (and of the open copy as saved,
 * where it stays live: `keepsSaved`), so the document counts
 * `max(alongside + live, elsewhere)`. `saved` is what the document adds to
 * `SharedStyleUsage.blocks`, 0 when it holds none. `null` where a count is
 * unknown (a row stored before counts were kept, or a field whose place
 * among the copies the rows cannot say).
 */
export interface SharedStyleUsageHereParts {
  readonly saved: number | null;
  readonly alongside: number | null;
  readonly elsewhere: number | null;
  readonly kind: SharedStyleUsageKind;
}
