/**
 * What a Gallery's empty state and its file drops decide without drawing
 * anything: which canvas boxes are galleries waiting for pictures, which
 * files a drop or the chooser handed over are pictures, and where a file
 * held over the canvas lands.
 *
 * The Image's own empty state (`image-states-model.ts`) answers the same
 * questions for one picture; these answer them for several, from its
 * answers: a file is a picture by the same check, and refused in the same
 * words.
 *
 * @module canvas/gallery-states-model
 */

import {
  findNode,
  walkNodes,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { INSTANCE_ATTRIBUTE } from "@nextlyhq/blocks-react";

import {
  galleryPictureOf,
  isGallery,
} from "../inspector/content/gallery-pictures";

import { nodeElement } from "./canvas-addressing";
import { chosenFile } from "./image-states-model";

/** The words a gallery's empty state uses, in one place. */
export const GALLERY_STATE_WORDS = {
  title: "Add images",
  drop: "or drop files here",
  libraryTitle: "Choose images",
  dropToAdd: "Drop to add the images",
} as const;

/** One empty gallery on the canvas, waiting for pictures. */
export interface EmptyGalleryBox {
  readonly nodeId: string;
  readonly element: Element;
}

/**
 * The galleries holding no pictures that this page owns and the canvas
 * draws, in document order. One inside a placed component belongs to the
 * component, which its own editor fills.
 */
export function emptyGalleryBoxes(
  root: HTMLElement,
  document: BlockDocument
): EmptyGalleryBox[] {
  const found: EmptyGalleryBox[] = [];
  walkNodes(document.nodes, node => {
    if (!isGallery(node) || (node.slots?.children?.length ?? 0) > 0) return;
    const element = nodeElement(root, node.id);
    if (element === null || element.hasAttribute(INSTANCE_ATTRIBUTE)) return;
    found.push({ nodeId: node.id, element });
  });
  return found;
}

/**
 * The pictures among the files a drop or the chooser handed over, in the
 * order given, and whether any was refused for not being one: each judged
 * as an Image judges its one file.
 */
export function chosenPictures(files: FileList | readonly File[] | null): {
  readonly pictures: readonly File[];
  readonly refused: boolean;
} {
  const all = files === null ? [] : Array.from(files);
  const pictures: File[] = [];
  for (const file of all) {
    if (chosenFile([file])?.image === true) pictures.push(file);
  }
  return { pictures, refused: pictures.length < all.length };
}

/** How many files a drag carries, as far as the browser says mid-drag. */
export function filesCarried(transfer: DataTransfer | null): number {
  if (transfer === null) return 0;
  // Mid-drag the files are not readable yet, only their entries.
  const items = transfer.items as DataTransferItemList | undefined;
  return items === undefined ? transfer.files.length : items.length;
}

/** Where a file held over a block lands: an Image, or a gallery. */
export type FileLanding =
  | { readonly kind: "image"; readonly nodeId: string }
  | { readonly kind: "gallery"; readonly nodeId: string };

/**
 * Where files held over the block `nodeId` land: a gallery takes them as
 * pictures of its own, and so does a gallery's picture while more than one
 * file is held, since several files cannot replace one picture. One file
 * over any other Image replaces its picture. `null` where nothing takes
 * them.
 */
export function fileLanding(
  document: BlockDocument,
  nodeId: string,
  count: number,
  accepts: {
    readonly image: (nodeId: string) => boolean;
    readonly gallery: (nodeId: string) => boolean;
  }
): FileLanding | null {
  const node = findNode(document.nodes, nodeId);
  if (isGallery(node)) {
    return accepts.gallery(nodeId) ? { kind: "gallery", nodeId } : null;
  }
  const inGallery = galleryPictureOf(document, nodeId)?.galleryId;
  if (inGallery !== undefined && count > 1) {
    return accepts.gallery(inGallery)
      ? { kind: "gallery", nodeId: inGallery }
      : null;
  }
  return accepts.image(nodeId) ? { kind: "image", nodeId } : null;
}
