/**
 * The site's looks as the Design panel lists them: one group per block type,
 * the block's own look first, then the looks its blocks can wear.
 *
 * Read from the same views the compiler reads, so a row is listed exactly
 * when its look takes effect: an own look as the engine reads it for its
 * type's base (`ownLooksRead`), and a worn look as the library renders it
 * (`sharedStyleRows`, which reads `usableSiteClasses`).
 *
 * @module block-look-rows
 * @experimental Settles with the Design panel's Block looks group.
 */

import {
  blockDefaultsOf,
  getBlock,
  overlaidStyles,
  ownLooksRead,
  type NamedClass,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";

import {
  sharedStyleName,
  sharedStyleRows,
  type SharedStyleRow,
} from "./shared-style-library";

/**
 * Which look is meant: its id and its block type together. Two block types'
 * own looks may share an id, since an own look claims none, so the type is
 * what tells them apart.
 */
export interface LookKey {
  readonly id: string;
  readonly blockType: string;
}

/** Whether a row is the look a key names. */
export function sameLook(
  row: LookKey,
  key: LookKey | null | undefined
): boolean {
  return (
    key !== null &&
    key !== undefined &&
    row.id === key.id &&
    row.blockType === key.blockType
  );
}

/** One look as the Design panel lists it. */
export interface BlockLookRow extends SharedStyleRow {
  /** The block type the look belongs to. */
  readonly blockType: string;
  /**
   * The block's own look: its styles are the site's edits to the type's
   * base, it is never a class, so its class name is empty and it has no
   * usage count of its own.
   */
  readonly own: boolean;
  /**
   * Another block type's own look carries the same id, so a write by id
   * would reach both: the look is shown, and held from editing.
   */
  readonly sharedId: boolean;
}

/** One block type's looks, its own look first. */
export interface BlockLookGroup {
  readonly blockType: string;
  readonly rows: readonly BlockLookRow[];
}

/**
 * Every block type's looks, in the order their first look sits in the
 * library, each type's own look first and then its worn looks in the order
 * that decides precedence. A type with only an own look is still listed,
 * since its own look is still the site's to edit.
 */
export function blockLookGroups(
  library: readonly NamedClass[],
  suppliedIds: ReadonlySet<string>
): BlockLookGroup[] {
  const ownRead = ownLooksRead(library);
  const shared = new Set(
    ownRead
      .map(entry => entry.id)
      .filter((id, at, ids) => ids.indexOf(id) !== at)
  );
  const own = new Map(
    ownRead.map(entry => [
      entry.blockType as string,
      ownRow(entry, suppliedIds, shared.has(entry.id)),
    ])
  );
  const typeOf = new Map(library.map(entry => [entry?.id, entry?.blockType]));
  const worn = new Map<string, BlockLookRow[]>();
  for (const row of sharedStyleRows(library, suppliedIds)) {
    const blockType = typeOf.get(row.id);
    if (row.look !== true || blockType === undefined) continue;
    worn.set(blockType, [
      ...(worn.get(blockType) ?? []),
      { ...row, blockType, own: false, sharedId: false },
    ]);
  }
  const types: string[] = [];
  for (const entry of library) {
    const type = (entry as { blockType?: unknown } | null)?.blockType;
    if (typeof type !== "string" || types.includes(type)) continue;
    if (own.has(type) || worn.has(type)) types.push(type);
  }
  return types.map(blockType => {
    const first = own.get(blockType);
    return {
      blockType,
      rows: [
        ...(first === undefined ? [] : [first]),
        ...(worn.get(blockType) ?? []),
      ],
    };
  });
}

/** An own look as a row: no class selects it, so its class name is empty. */
function ownRow(
  entry: NamedClass,
  suppliedIds: ReadonlySet<string>,
  sharedId: boolean
): BlockLookRow {
  return {
    id: entry.id,
    name: sharedStyleName(entry),
    slug: entry.slug,
    className: "",
    locked: entry.locked === true,
    inCode: suppliedIds.has(entry.id),
    look: true,
    styles: entry.styles,
    blockType: entry.blockType as string,
    own: true,
    sharedId,
  };
}

/**
 * A block type's base as the site draws it: the block's own base styles with
 * the site's edits to its own look laid over. Every look's specimen of that
 * type is drawn on it, as the canvas draws the blocks.
 */
export function siteBaseOf(
  library: readonly NamedClass[] | undefined,
  blockType: string
): NodeStyles | undefined {
  const base = getBlock(blockType)?.baseStyles;
  const edit = blockDefaultsOf(library ?? [])[blockType];
  return edit === undefined ? base : overlaidStyles(base, edit);
}

/** Who an edit to a look reaches, in the words the editing bar shows. */
export function lookReachWords(
  row: Pick<BlockLookRow, "own">,
  blockTitle: string
): string {
  // A block's own look is the base every other look of the type is laid on,
  // so an edit to it reaches every block of the type.
  return row.own ? `every ${blockTitle}` : `every ${blockTitle} that wears it`;
}

/** The Default chip's description: what a block's own look is to its type. */
export function ownLookDescription(blockTitle: string): string {
  return `Default · every ${blockTitle} starts from this look; other looks are laid on top`;
}
