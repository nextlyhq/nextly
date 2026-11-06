/**
 * What a stored document refers to outside itself, read the way an export
 * needs it: the components it places, the shared styles its blocks wear, the
 * variables and breakpoints its styles name, the breakpoints its per-device
 * hide settings name, the media its blocks and placements show, and the
 * block types it uses.
 *
 * One walk over the document, through every slot, a placement's own slot
 * content included. Media is found by the block registry's own word: a prop
 * declared `type: "media"`, and a placement value for an exposure of type
 * `image`, which is the one exposure that holds a media id. A string prop that
 * merely looks like an id is never taken for one.
 *
 * @module transfer/transfer-references
 */
import {
  getBlock,
  isComponentInstance,
  walkNodes,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";

import { collectStyleTokens, forEachStyleValues } from "../style-token-refs";

/** The references one or more documents make, each kind de-duplicated. */
export interface TransferReferences {
  readonly components: Set<string>;
  readonly classes: Set<string>;
  readonly tokens: Set<string>;
  readonly breakpoints: Set<string>;
  readonly media: Set<string>;
  readonly blockTypes: Set<string>;
}

/** An empty set of references to collect into. */
export function emptyReferences(): TransferReferences {
  return {
    components: new Set(),
    classes: new Set(),
    tokens: new Set(),
    breakpoints: new Set(),
    media: new Set(),
    blockTypes: new Set(),
  };
}

/** What the walk needs to know beyond the document itself. */
export interface ReferenceLookups {
  /** The props a block type declares as media; none for an unknown type. */
  readonly mediaProps?: (type: string) => readonly string[];
  /**
   * The ids of a placed component's exposures that hold an image, when its
   * definition is known. A placement whose definition is not known yet
   * contributes no media; collect again once it is read.
   */
  readonly imageExposures?: (componentId: string) => ReadonlySet<string>;
}

/** The props a registered block declares as media. */
export function registryMediaProps(type: string): readonly string[] {
  const props = getBlock(type)?.props;
  if (props === undefined) return [];
  const media: string[] = [];
  for (const [name, schema] of Object.entries(props)) {
    if (schema?.type === "media") media.push(name);
  }
  return media;
}

/** The ids of a definition's exposures that hold an image. */
export function imageExposureIds(
  definition: ComponentDocument
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const exposure of definition.exposed ?? []) {
    if (exposure.type === "image") ids.add(exposure.id);
  }
  return ids;
}

/** A media id as stored: a non-empty string, or a number written as one. */
export function mediaIdOf(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Add everything one document refers to into `into`. */
export function collectDocumentReferences(
  document: BlockDocument,
  into: TransferReferences,
  lookups: ReferenceLookups = {}
): void {
  const mediaProps = lookups.mediaProps ?? registryMediaProps;
  collectStyleReferences(document.settings?.styles, into);
  for (const id of document.assets?.mediaIds ?? []) {
    const media = mediaIdOf(id);
    if (media !== undefined) into.media.add(media);
  }
  if (Array.isArray(document.nodes)) {
    walkNodes(document.nodes, node => {
      collectNodeReferences(node, into, mediaProps, lookups.imageExposures);
    });
  }
  if (document.kind === "component") {
    collectVariantMedia(document as ComponentDocument, into);
  }
}

/**
 * Add the variables and breakpoints a style envelope names. The walk is the
 * one the variable usage index records from (`style-token-refs`), so an
 * export carries exactly the variables a removal counts as used.
 */
export function collectStyleReferences(
  styles: NodeStyles | undefined,
  into: TransferReferences
): void {
  forEachStyleValues(styles, (breakpoint, values) => {
    into.breakpoints.add(breakpoint);
    collectStyleTokens(values, into.tokens);
  });
}

function collectNodeReferences(
  node: BlockNode,
  into: TransferReferences,
  mediaProps: (type: string) => readonly string[],
  imageExposures: ((componentId: string) => ReadonlySet<string>) | undefined
): void {
  collectStyleReferences(node.styles, into);
  for (const id of node.classes ?? []) {
    if (typeof id === "string" && id !== "") into.classes.add(id);
  }
  const devices = node.visibility?.devices;
  if (isRecord(devices)) {
    for (const breakpoint of Object.keys(devices))
      into.breakpoints.add(breakpoint);
  }
  const props = isRecord(node.props) ? node.props : {};
  if (isComponentInstance(node)) {
    collectPlacement(props, into, imageExposures);
    return;
  }
  into.blockTypes.add(node.type);
  for (const prop of mediaProps(node.type)) {
    const media = mediaIdOf(props[prop]);
    if (media !== undefined) into.media.add(media);
  }
}

/** A placement's component, and the media its image values name. */
function collectPlacement(
  props: Record<string, unknown>,
  into: TransferReferences,
  imageExposures: ((componentId: string) => ReadonlySet<string>) | undefined
): void {
  const componentId = props.componentId;
  if (typeof componentId !== "string" || componentId === "") return;
  into.components.add(componentId);
  const images = imageExposures?.(componentId);
  if (images !== undefined && isRecord(props.overrides)) {
    collectImageValues(props.overrides, images, into);
  }
}

/** The media ids among values keyed by exposure, for the image exposures only. */
function collectImageValues(
  overrides: Record<string, unknown>,
  images: ReadonlySet<string>,
  into: TransferReferences
): void {
  for (const [exposure, value] of Object.entries(overrides)) {
    const media = images.has(exposure) ? mediaIdOf(value) : undefined;
    if (media !== undefined) into.media.add(media);
  }
}

/** The media a component's variants set on its own image exposures. */
function collectVariantMedia(
  definition: ComponentDocument,
  into: TransferReferences
): void {
  const images = imageExposureIds(definition);
  if (images.size === 0 || !isRecord(definition.variants)) return;
  for (const variant of Object.values(definition.variants)) {
    const overrides = isRecord(variant) ? variant.overrides : undefined;
    if (isRecord(overrides)) collectImageValues(overrides, images, into);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
