/**
 * A Gallery's pictures, as the editor adds and names them.
 *
 * A gallery holds real Image blocks, so adding pictures is inserting Image
 * children, each made as any new Image is (its block's version and defaults)
 * with the library file's id: nothing else is invented. Every add from the
 * Content tab, the canvas's empty state and a drop of files goes through
 * {@link addPicturesOps}, so the three store alike.
 *
 * A picture inside a gallery is read here too: its place among the gallery's
 * pictures, the gallery's name and what the gallery says a click does, for
 * the inspector's title and the picture's "When clicked".
 *
 * @module gallery-pictures
 */
import {
  findNode,
  getBlock,
  locateNode,
  makeNode,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { whenClickedOf } from "@nextlyhq/blocks-react";

import type { EditorState } from "../../editor-state";
import type { BuilderOp } from "../../op-vocabulary";
import { authoredName } from "../../panels/layers/layers";

/** The block whose pictures these are. */
export const GALLERY_BLOCK = "core/gallery";

/** The slot a gallery holds its pictures in. */
const PICTURES_SLOT = "children";

/** What a gallery is called where the author has not named it. */
const GALLERY_WORD = "Gallery";

/** Whether a node is a gallery. */
export function isGallery(node: BlockNode | undefined): boolean {
  return node?.type === GALLERY_BLOCK;
}

/**
 * The block a picture is, read from the gallery's own definition: the one
 * block its slot allows. `undefined` where the gallery is not registered or
 * allows anything other than exactly one block.
 */
function pictureBlockOf(gallery: BlockNode) {
  const allowed = getBlock(gallery.type)?.slots?.[PICTURES_SLOT]?.allow;
  const type = allowed?.length === 1 ? allowed[0] : undefined;
  return type === undefined ? undefined : getBlock(type);
}

/**
 * The ops that add one picture per library file to a gallery, in the order
 * given, after the pictures it holds: one insert each, for ONE step of the
 * history when applied together. Empty for no files; `null` where the node
 * is not a gallery or its picture block is not known.
 */
export function addPicturesOps(
  document: BlockDocument,
  galleryId: string,
  mediaIds: readonly string[]
): BuilderOp[] | null {
  const gallery = findNode(document.nodes, galleryId);
  if (gallery === undefined || !isGallery(gallery)) return null;
  const picture = pictureBlockOf(gallery);
  if (picture === undefined) return null;
  const have = gallery.slots?.[PICTURES_SLOT]?.length ?? 0;
  const defaults = (picture.defaultProps ?? {}) as Record<string, unknown>;
  return mediaIds.map((mediaId, offset) => ({
    kind: "insert" as const,
    node: makeNode(picture.name, picture.version, {
      ...structuredClone(defaults),
      mediaId,
    }),
    at: { parentId: galleryId, slot: PICTURES_SLOT, index: have + offset },
  }));
}

/**
 * Add several library files to a gallery as ONE step: one Image each, in
 * the order given. Answers whether they landed; a lock or a node that is no
 * gallery refuses the whole add.
 */
export function addPicturesTo(
  editor: Pick<EditorState, "document" | "applyAll">,
  galleryId: string,
  mediaIds: readonly string[]
): boolean {
  const ops = addPicturesOps(editor.document, galleryId, mediaIds);
  if (ops === null || ops.length === 0) return false;
  return editor.applyAll(ops) !== null;
}

/**
 * Whether a lock keeps a gallery's pictures as they are: asked of one
 * picture's add, through the same question `apply` asks.
 */
export function picturesHeld(
  editor: Pick<EditorState, "document" | "lockRefusalFor">,
  galleryId: string
): boolean {
  const ops = addPicturesOps(editor.document, galleryId, ["held"]);
  return ops === null || editor.lockRefusalFor(ops) !== undefined;
}

/** What a click on a gallery's pictures does, as the gallery says. */
export type GalleryChoice = "nothing" | "enlarge";

/** A picture inside a gallery, as the inspector names and reads it. */
export interface GalleryPicture {
  readonly galleryId: string;
  /** Its place among the gallery's pictures, from 1. */
  readonly position: number;
  /** The gallery's own name, or "Gallery". */
  readonly galleryName: string;
  /** What the gallery says a click on its pictures does. */
  readonly galleryChoice: GalleryChoice;
}

/**
 * The gallery's "When clicked", read as its pictures follow it: the stored
 * choice through `whenClickedOf`, the one reading of a click, and Nothing
 * for anything a gallery does not offer.
 */
function galleryChoiceOf(gallery: BlockNode): GalleryChoice {
  return whenClickedOf(gallery.props) === "enlarge" ? "enlarge" : "nothing";
}

/** The picture a node is inside its gallery, or `undefined` outside one. */
export function galleryPictureOf(
  document: BlockDocument,
  nodeId: string
): GalleryPicture | undefined {
  const located = locateNode(document.nodes, nodeId);
  const gallery = located?.parent;
  if (located === undefined || gallery === undefined) return undefined;
  if (!isGallery(gallery) || located.slot !== PICTURES_SLOT) return undefined;
  return {
    galleryId: gallery.id,
    position: located.index + 1,
    galleryName: authoredName(gallery) ?? GALLERY_WORD,
    galleryChoice: galleryChoiceOf(gallery),
  };
}
