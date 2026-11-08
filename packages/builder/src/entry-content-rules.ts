/**
 * What the editor holds an Entry content block to, from the engine's own
 * reading of the block, so the Add panel, the toolbar and the keys refuse
 * what the save refuses before an author meets the refusal there.
 *
 * - The Add panel offers it only while a template is open: anywhere else the
 *   save refuses it, so offering it would be offering a refusal.
 * - A template holds one, so with one placed the tile stays, refused with
 *   its reason, and Duplicate is refused with the same words.
 * - Placed, it names a field at once: the first of the collection's
 *   top-level blocks fields, the only one where there is one, so the stored
 *   choice is always explicit.
 *
 * @experimental Settles when collection templates ship.
 * @module entry-content-rules
 */
import {
  ENTRY_CONTENT_FIELD_PROP,
  ENTRY_CONTENT_TYPE,
  entryContentFieldOf,
  entryContentIssues,
  entryContentPlacements,
  findNode,
  holdsEntryContent,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

/**
 * Why a second Entry content block cannot be added: the words the Add panel's
 * tile and the toolbar's Duplicate say.
 */
const ENTRY_CONTENT_ONE_REASON = "A template holds one Entry content block.";

/**
 * Why an Entry content block cannot be added yet: the template's
 * collection's blocks fields are still being read, and one placed now would
 * name no field for anything to fill.
 */
const ENTRY_CONTENT_LOADING_REASON = "Loading the collection’s fields…";

/**
 * Whether the Add panel offers a block of `blockName` in a document of
 * `kind`: every block anywhere, but Entry content in a template only.
 */
export function offeredIn(kind: unknown, blockName: string): boolean {
  return blockName !== ENTRY_CONTENT_TYPE || kind === "template";
}

/**
 * Why a block of `blockName` cannot be added to `document`, or `undefined`
 * when nothing about Entry content stands in the way: the template's one is
 * already placed, or the collection's blocks fields are not known yet
 * (`fieldsKnown`), so the block would be placed naming none.
 */
export function entryContentRefusal(
  document: BlockDocument,
  blockName: string,
  fieldsKnown = true
): string | undefined {
  if (blockName !== ENTRY_CONTENT_TYPE) return undefined;
  if (entryContentPlacements(document.nodes).length > 0) {
    return ENTRY_CONTENT_ONE_REASON;
  }
  return fieldsKnown ? undefined : ENTRY_CONTENT_LOADING_REASON;
}

/**
 * Why the block `id` cannot be duplicated, or `undefined` where nothing about
 * Entry content refuses it: a copy of a block holding one is a second.
 */
export function duplicationRefusal(
  document: BlockDocument,
  id: string
): string | undefined {
  // The block itself, or one around one, which copies it too.
  const node = findNode(document.nodes, id);
  return node !== undefined && holdsEntryContent(node)
    ? ENTRY_CONTENT_ONE_REASON
    : undefined;
}

/**
 * Why the blocks `ids` of `document` cannot become a `kind`, a pattern or a
 * component (Save as pattern, Update a pattern, Turn into component), or
 * `undefined` where none of them holds Entry content. Asked of the save's own
 * rule (`entryContentIssues`), with the blocks as that kind would hold them:
 * it refuses Entry content anywhere but a template, and neither is one.
 */
export function compositionEntryContentRefusal(
  document: BlockDocument,
  ids: readonly string[],
  kind: "pattern" | "component"
): string | undefined {
  const selected = ids.flatMap(id => {
    const node = findNode(document.nodes, id);
    return node === undefined ? [] : [node];
  });
  const refused = entryContentIssues(selected, { documentKind: kind }).some(
    issue => issue.code === "entry-content-outside-template"
  );
  return refused
    ? `Entry content belongs in its template, so it can’t be saved in a ${kind}.`
    : undefined;
}

/**
 * `node` with the field an Entry content block draws filled where it names
 * none: `field`, the collection's first top-level blocks field. Any other
 * node, or one that already names a field, is returned as it was.
 */
export function withEntryContentField(
  node: BlockNode,
  field: string | undefined
): BlockNode {
  if (node.type !== ENTRY_CONTENT_TYPE || field === undefined) return node;
  if (entryContentFieldOf(node) !== undefined) return node;
  return {
    ...node,
    props: { ...node.props, [ENTRY_CONTENT_FIELD_PROP]: field },
  };
}
