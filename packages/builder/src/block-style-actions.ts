/**
 * The host's writes for the Styles tab's block styles, and the words the
 * Block styles section says them in.
 *
 * Each write answers with the refusal in words, or nothing once stored; the
 * two that make a style answer with its id, so the section can open it in the
 * style editor.
 *
 * Every write but a removal is one whole class list, composed against the
 * list the host's queue holds when it runs, so it builds on every class
 * write queued before it. A removal goes through the host's removal, which
 * refuses a style a page still uses and says where.
 *
 * @module block-style-actions
 * @experimental Settles with the Styles tab's Block styles.
 */

import type { NamedClass } from "@nextlyhq/blocks-engine";

import {
  duplicateBlockStylePlan,
  newBlockStylePlan,
  renameBlockStylePlan,
  withDefaultBlockStyle,
  withHiddenBlockStyle,
  type BlockStylePlan,
} from "./block-style-plans";
import { EDITOR_WORDS } from "./editor-words";
import { blockLabel } from "./panels/add/inserter";

/** A write that makes a block style: the new style's id, or why it wasn't made. */
export type BlockStyleMade =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: string };

/** What the Block styles section asks of its host. */
export interface BlockStyleActions {
  /** Make a block style for a type, named by the author, from the ★ style's values. */
  readonly create: (blockType: string, name: string) => Promise<BlockStyleMade>;
  /** Copy a block style, built-in or the site's own, as the site's own. */
  readonly duplicate: (id: string) => Promise<BlockStyleMade>;
  /** Rename a block style the site made: its name only, never its id or class name. */
  readonly rename: (id: string, name: string) => Promise<string | undefined>;
  /** Remove a block style the site made, refused while a page uses it. */
  readonly remove: (id: string) => Promise<string | undefined>;
  /** Hide a built-in block style from the block panel, or show it again. */
  readonly setHidden: (
    id: string,
    hidden: boolean
  ) => Promise<string | undefined>;
  /**
   * Make a style the ★ of its type, the look its blocks have until another is
   * picked; `null` gives ★ back to the block's own style.
   */
  readonly setDefault: (
    blockType: string,
    id: string | null
  ) => Promise<string | undefined>;
}

/** The Block styles section's words, as decided. */
export const BLOCK_STYLE_WORDS = {
  heading: EDITOR_WORDS.blockStyles as "Block styles",
  line: "Saved looks for one kind of block. ★ is the look a block has until you pick another.",
  sharedLine: "Your own styles for any block.",
  setDefault: "Set as default ★",
  defaultChip: "★ Default",
  hidden: "Hidden",
  edit: "Edit",
  rename: "Rename",
  duplicate: "Duplicate",
  hide: "Hide",
  show: "Show",
  remove: "Remove",
} as const;

/** "+ New button style": the add row that ends a block type's styles. */
export function newStyleWords(blockTitle: string): string {
  return `+ New ${blockTitle.toLowerCase()} style`;
}

/**
 * One action's class list: the whole list after it, composed from the list
 * the host's queue holds, or why it can't be stored.
 */
export type ClassListEdit = (
  existing: readonly NamedClass[]
) => { readonly classes: readonly NamedClass[] } | { readonly reason: string };

/**
 * The host's whole-list class write: the list `compose` makes stored as one
 * history step, answering the refusal in words, or nothing once stored.
 */
export type EditClasses = (
  compose: ClassListEdit
) => Promise<string | undefined>;

/** The host's removal of unused styles, answering the refusal in words. */
type RemoveClasses = (ids: readonly string[]) => Promise<string | undefined>;

/** A plan as the host's writer takes it, keeping the id the plan made. */
function composing(
  plan: (existing: readonly NamedClass[]) => BlockStylePlan,
  made: { id?: string }
): ClassListEdit {
  return existing => {
    const planned = plan(existing);
    if (!planned.ok) return { reason: planned.reason };
    made.id = planned.id;
    return { classes: planned.classes };
  };
}

/** A write that makes a style, answering the style it made. */
async function making(
  edit: EditClasses,
  plan: (existing: readonly NamedClass[]) => BlockStylePlan
): Promise<BlockStyleMade> {
  const made: { id?: string } = {};
  const refused = await edit(composing(plan, made));
  if (refused !== undefined) return { ok: false, reason: refused };
  return made.id === undefined
    ? { ok: false, reason: "This block style could not be saved." }
    : { ok: true, id: made.id };
}

/** The title of the block type a stored style belongs to. */
function titleOf(existing: readonly NamedClass[], id: string): string {
  return blockLabel(existing.find(entry => entry.id === id)?.blockType ?? "");
}

/**
 * The Block styles section's writes over the host's one whole-list class
 * writer and its removal. Without a removal, removing is refused in words.
 */
export function blockStyleActionsOf(
  edit: EditClasses,
  remove: RemoveClasses | undefined
): BlockStyleActions {
  return {
    create: (blockType, name) =>
      making(edit, existing =>
        newBlockStylePlan(existing, blockType, name, blockLabel(blockType))
      ),
    duplicate: id =>
      making(edit, existing =>
        duplicateBlockStylePlan(existing, id, titleOf(existing, id))
      ),
    rename: (id, name) =>
      edit(
        composing(
          existing =>
            renameBlockStylePlan(existing, id, name, titleOf(existing, id)),
          {}
        )
      ),
    remove: async id =>
      remove === undefined
        ? "Block styles can't be removed here."
        : remove([id]),
    setHidden: (id, hidden) =>
      edit(existing => ({
        classes: withHiddenBlockStyle(existing, id, hidden),
      })),
    setDefault: (blockType, id) =>
      edit(existing => ({
        classes: withDefaultBlockStyle(existing, blockType, id),
      })),
  };
}
