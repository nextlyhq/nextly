/**
 * What an Image's empty state decides without drawing anything: which
 * canvas boxes are Images waiting for a picture, whether a file is a
 * picture, whether a link is one the page may load and does load, and what
 * a choice writes to the block.
 *
 * Kept apart from the overlay (`image-states.tsx`) so each answer is asked
 * once, by whoever needs it, and tested without a canvas.
 *
 * @module canvas/image-states-model
 */

import {
  findNode,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  fetchableUrl,
  INSTANCE_ATTRIBUTE,
  NODE_ID_ATTRIBUTE,
  type RemotePatternInput,
} from "@nextlyhq/blocks-react";

import {
  addressChanges,
  mediaPickChanges,
  type ImageChanges,
  type ImageSourceGroup,
} from "../image-group";
import type { BuilderOp } from "../op-vocabulary";

/**
 * The attribute the Image block puts on the box it draws for an author when
 * it has no picture: `empty`, nothing chosen yet, or `missing`, a library
 * file the library no longer has. Spelled here as the block spells it; the
 * overlay's test draws the block itself to find the box, so the two cannot
 * drift apart unseen.
 */
const IMAGE_EMPTY_ATTRIBUTE = "data-nx-image-empty";

/** The block whose empty state this is. */
const IMAGE_BLOCK_TYPE = "core/image";

/** Why an Image draws its empty box. */
export type ImageEmptyReason = "empty" | "missing";

/** The words the empty state uses, in one place. */
export const IMAGE_STATE_WORDS = {
  title: "Add an image",
  upload: "Upload",
  library: "Media library",
  link: "Link",
  drop: "or drop a file here",
  notImage: "That file isn't an image",
  badLink: "This link didn't load an image",
  tryAnotherLink: "Try another link",
  missing: "This image's file is missing",
  replace: "Replace",
  linkLabel: "Image address",
  addLink: "Add",
  cancel: "Cancel",
  checking: "Checking the link",
  uploading: "Uploading",
  dropToReplace: "Drop to replace the image",
  uploadFailed: "The upload didn't finish",
  libraryTitle: "Choose an image",
} as const;

/** The two props an Image's picture comes from, as the inspector groups them. */
const SOURCE: ImageSourceGroup = {
  media: "mediaId",
  address: "src",
  drawn: new Set(["mediaId", "src"]),
};

/** One Image box on the canvas, waiting for a picture. */
export interface EmptyImageBox {
  readonly nodeId: string;
  readonly reason: ImageEmptyReason;
  readonly element: Element;
}

/**
 * The Image boxes waiting for a picture that this page owns, in document
 * order: each one's node and why it is empty.
 *
 * A box inside a placed component belongs to the component, which its own
 * editor fills; a box for a node the document does not hold belongs to the
 * Layout drawn around the page. Neither is offered here.
 */
export function emptyImageBoxes(
  root: ParentNode,
  document: BlockDocument
): EmptyImageBox[] {
  const found: EmptyImageBox[] = [];
  root.querySelectorAll(`[${IMAGE_EMPTY_ATTRIBUTE}]`).forEach(element => {
    if (element.hasAttribute(INSTANCE_ATTRIBUTE)) return;
    const nodeId = element.getAttribute(NODE_ID_ATTRIBUTE);
    if (nodeId === null || imageNodeOf(document, nodeId) === undefined) return;
    const reason =
      element.getAttribute(IMAGE_EMPTY_ATTRIBUTE) === "missing"
        ? "missing"
        : "empty";
    found.push({ nodeId, reason, element });
  });
  return found;
}

/** The Image node by its id, or `undefined` when it is not one. */
export function imageNodeOf(
  document: BlockDocument,
  nodeId: string
): BlockNode | undefined {
  const node = findNode(document.nodes, nodeId);
  return node?.type === IMAGE_BLOCK_TYPE ? node : undefined;
}

/**
 * Whether an Image takes a picture from here: one whose picture is bound,
 * to a media field or to an address field, is filled by its binding instead.
 * Storing a file on it would outrank the binding and stop it following its
 * field.
 */
export function takesPicture(node: BlockNode): boolean {
  return (
    node.bindings?.mediaId === undefined && node.bindings?.src === undefined
  );
}

/** Whether a drag carries files from outside the page. */
export function carriesFiles(transfer: DataTransfer | null): boolean {
  if (transfer === null) return false;
  return Array.from(transfer.types).includes("Files");
}

/**
 * The first file a drop or a file chooser handed over, and whether it is a
 * picture, by the type the browser read it as. The library's upload checks
 * the file again, on the server, by its contents.
 */
export function chosenFile(
  files: FileList | readonly File[] | null | undefined
): { readonly file: File; readonly image: boolean } | undefined {
  const file = files === null || files === undefined ? undefined : files[0];
  if (file === undefined) return undefined;
  return { file, image: file.type.startsWith("image/") };
}

/**
 * The address a typed link is drawn from, or `undefined` when the page
 * would refuse it: through the same rule the Image block draws by, so a
 * link the canvas accepts is one the page draws.
 */
export function linkAddress(
  typed: string,
  patterns: readonly RemotePatternInput[] | undefined
): string | undefined {
  const trimmed = typed.trim();
  if (trimmed === "") return undefined;
  return fetchableUrl(trimmed, patterns);
}

/** How long a link is given to load before it counts as not loading. */
const LINK_LOAD_MS = 15_000;

/**
 * Whether an address loads as a picture, asked in the document the page is
 * drawn in, so it is fetched under the same rules the page's own picture
 * will be. A picture that loads with no size is not one.
 */
export function loadsAsImage(
  address: string,
  where: Document,
  waitMs: number = LINK_LOAD_MS
): Promise<boolean> {
  return new Promise(resolve => {
    const probe = where.createElement("img");
    let settled = false;
    const settle = (loaded: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      probe.onload = null;
      probe.onerror = null;
      resolve(loaded);
    };
    const timer = setTimeout(() => settle(false), waitMs);
    probe.onload = () => settle(probe.naturalWidth > 0);
    probe.onerror = () => settle(false);
    probe.src = address;
  });
}

/**
 * The op that gives an Image its picture: a library file, as the inspector's
 * Library side writes it (an address typed before stays as its fallback), or
 * an address, as its URL side does (dropping the library file). `null` when
 * the node is gone or holds no Image.
 */
export function pictureOp(
  document: BlockDocument,
  nodeId: string,
  picture: { readonly mediaId: string } | { readonly address: string }
): BuilderOp | null {
  const node = imageNodeOf(document, nodeId);
  if (node === undefined) return null;
  const changes: ImageChanges =
    "mediaId" in picture
      ? mediaPickChanges(SOURCE, picture.mediaId, node.props, [])
      : addressChanges(SOURCE, picture.address, node.props);
  const props: Record<string, unknown> = { ...node.props };
  for (const [name, value] of Object.entries(changes)) {
    if (value === undefined) delete props[name];
    else props[name] = value;
  }
  return { kind: "update", id: nodeId, patch: { props } };
}
