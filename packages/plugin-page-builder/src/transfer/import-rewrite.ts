/**
 * A transfer file's documents with the source site's references swapped for
 * the destination's: components, shared styles, variables, breakpoints and
 * media, each through its own map.
 *
 * Every reference the export reads (`transfer-references`) is one this
 * rewrites, in the same places: a placement's `componentId` and its image
 * values, a node's classes, styles and hide settings, a document's own styles
 * and asset list, a media prop, and a component's variants. A breakpoint the
 * import drops takes its styles and hide settings with it, and so does one the
 * file does not define, since the source drew nothing under it either; what is
 * kept is only ever written under a breakpoint the destination defines.
 *
 * Nothing else changes: node ids, exposure ids and variant keys are the
 * document's own, so a variant keeps its stable id and a placement's values
 * keep addressing the exposures they were set for.
 *
 * @module transfer/import-rewrite
 */
import {
  BASE_BREAKPOINT,
  isComponentInstance,
  isTokenRef,
  mapForest,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type NamedClass,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";

import { collectStyleTokens } from "../style-token-refs";

import { imageExposureIds, mediaIdOf } from "./transfer-references";

/** The destination's id for each source reference, one map per kind. */
export interface ReferenceMaps {
  readonly components: ReadonlyMap<string, string>;
  readonly classes: ReadonlyMap<string, string>;
  readonly tokens: ReadonlyMap<string, string>;
  /** Kept breakpoints only; a breakpoint absent here is dropped. */
  readonly breakpoints: ReadonlyMap<string, string>;
  readonly media: ReadonlyMap<string, string>;
  /**
   * Destination variables a style value may not name: a property whose value
   * names one, after mapping, is left out. Only an import's judging writes
   * set it, for the variables the site style does not hold until the import
   * applies; a write that commits leaves it unset and keeps every value.
   */
  readonly withheldTokens?: ReadonlySet<string>;
}

/** What the rewrite needs to read beyond the maps. */
export interface RewriteLookups {
  /** The props a block type declares as media. */
  readonly mediaProps: (type: string) => readonly string[];
  /** The image exposures of a component by its SOURCE id. */
  readonly imageExposures: (sourceComponentId: string) => ReadonlySet<string>;
}

/** A document with every reference mapped, as the docblock describes. */
export function rewriteDocument<T extends BlockDocument>(
  document: T,
  maps: ReferenceMaps,
  lookups: RewriteLookups
): T {
  const rewritten: BlockDocument = {
    ...document,
    nodes: mapForest(document.nodes, node => rewriteNode(node, maps, lookups)),
  };
  if (document.settings !== undefined) {
    const styles = rewriteStyles(document.settings.styles, maps);
    const settings = { ...document.settings };
    delete settings.styles;
    rewritten.settings =
      styles === undefined ? settings : { ...settings, styles };
  }
  if (document.assets?.mediaIds !== undefined) {
    rewritten.assets = {
      ...document.assets,
      mediaIds: document.assets.mediaIds.map(id => mapped(maps.media, id)),
    };
  }
  if (document.kind === "component") {
    const definition = rewritten as ComponentDocument;
    const images = imageExposureIds(document as ComponentDocument);
    if (definition.variants !== undefined && images.size > 0) {
      definition.variants = Object.fromEntries(
        Object.entries(definition.variants).map(([key, variant]) => [
          key,
          {
            ...variant,
            overrides: rewriteImages(variant.overrides, images, maps),
          },
        ])
      );
    }
  }
  return rewritten as T;
}

/** A shared style with its variables and breakpoints mapped. */
export function rewriteClass(
  entry: NamedClass,
  id: string,
  slug: string,
  orderIndex: number,
  maps: ReferenceMaps
): NamedClass {
  return {
    id,
    slug,
    orderIndex,
    // A look stays bound to its block type, so it keeps its place in the
    // cascade and stays a look where looks are kept apart.
    ...(entry.blockType === undefined ? {} : { blockType: entry.blockType }),
    styles: rewriteStyles(entry.styles, maps) ?? {},
  };
}

function rewriteNode(
  node: BlockNode,
  maps: ReferenceMaps,
  lookups: RewriteLookups
): BlockNode {
  const next = rewriteLook(node, maps);
  if (isComponentInstance(node)) {
    next.props = rewritePlacement(node.props, maps, lookups);
    return next;
  }
  const mediaProps = lookups.mediaProps(node.type);
  if (mediaProps.length === 0) return next;
  const props = { ...node.props };
  for (const prop of mediaProps) {
    const media = mediaIdOf(props[prop]);
    if (media !== undefined) props[prop] = mapped(maps.media, media);
  }
  next.props = props;
  return next;
}

/** A node with its styles, classes and hide settings mapped. */
function rewriteLook(node: BlockNode, maps: ReferenceMaps): BlockNode {
  const next: BlockNode = { ...node };
  if (node.styles !== undefined) {
    const styles = rewriteStyles(node.styles, maps);
    if (styles === undefined) delete next.styles;
    else next.styles = styles;
  }
  if (node.classes !== undefined) {
    // A class the file does not carry was no class on the source either (a
    // removed one, drawing nothing there), so it is left behind rather than
    // bound to whatever this site holds under the same id.
    next.classes = node.classes.flatMap(id => {
      const to = maps.classes.get(id);
      return to === undefined ? [] : [to];
    });
  }
  if (node.visibility?.devices !== undefined) {
    const kept = rewriteDevices(node.visibility.devices, maps);
    const visibility = { ...node.visibility };
    delete visibility.devices;
    next.visibility =
      kept === undefined ? visibility : { ...visibility, devices: kept };
  }
  return next;
}

/** Per-device hide settings under the destination's breakpoints. */
function rewriteDevices(
  devices: Record<string, boolean>,
  maps: ReferenceMaps
): Record<string, boolean> | undefined {
  const kept: Record<string, boolean> = {};
  for (const [breakpoint, shown] of Object.entries(devices)) {
    const to = breakpointTo(breakpoint, maps);
    if (to !== undefined) kept[to] = shown;
  }
  return Object.keys(kept).length === 0 ? undefined : kept;
}

/** A placement's props with its component and image values mapped. */
function rewritePlacement(
  props: Record<string, unknown>,
  maps: ReferenceMaps,
  lookups: RewriteLookups
): Record<string, unknown> {
  const next = { ...props };
  const source = typeof props.componentId === "string" ? props.componentId : "";
  if (source !== "") next.componentId = mapped(maps.components, source);
  if (isRecord(props.overrides)) {
    next.overrides = rewriteImages(
      props.overrides,
      lookups.imageExposures(source),
      maps
    );
  }
  return next;
}

/** Image values keyed by exposure, mapped; every other value as it was. */
function rewriteImages(
  overrides: Record<string, unknown>,
  images: ReadonlySet<string>,
  maps: ReferenceMaps
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [exposure, value] of Object.entries(overrides)) {
    const media = images.has(exposure) ? mediaIdOf(value) : undefined;
    next[exposure] = media === undefined ? value : mapped(maps.media, media);
  }
  return next;
}

/**
 * A style envelope under the destination's breakpoints and variables, or
 * `undefined` when nothing in it is kept.
 */
function rewriteStyles(
  styles: NodeStyles | undefined,
  maps: ReferenceMaps
): NodeStyles | undefined {
  if (!isRecord(styles)) return undefined;
  const next: Record<string, Record<string, unknown>> = {};
  for (const [state, byBreakpoint] of Object.entries(styles)) {
    if (!isRecord(byBreakpoint)) continue;
    const kept: Record<string, unknown> = {};
    for (const [breakpoint, values] of Object.entries(byBreakpoint)) {
      const to = breakpointTo(breakpoint, maps);
      if (to === undefined) continue;
      const rewritten = withoutWithheld(
        rewriteTokens(values, maps),
        maps.withheldTokens
      );
      if (rewritten !== undefined) kept[to] = rewritten;
    }
    if (Object.keys(kept).length > 0) next[state] = kept;
  }
  return Object.keys(next).length === 0 ? undefined : next;
}

/** The destination breakpoint a source one maps to; `base` is everyone's. */
function breakpointTo(
  breakpoint: string,
  maps: ReferenceMaps
): string | undefined {
  if (breakpoint === BASE_BREAKPOINT) return BASE_BREAKPOINT;
  return maps.breakpoints.get(breakpoint);
}

/**
 * One breakpoint's values without the properties naming a withheld variable,
 * or `undefined` when every property named one. The whole property goes, not
 * just the reference, so a structured value is never left half made. Read by
 * the walk the variable fence and usage index read (`style-token-refs`), so
 * what is left names none of them.
 */
function withoutWithheld(
  values: unknown,
  withheld: ReadonlySet<string> | undefined
): unknown {
  if (withheld === undefined || withheld.size === 0 || !isRecord(values)) {
    return values;
  }
  const kept: Record<string, unknown> = {};
  for (const [property, value] of Object.entries(values)) {
    const named = new Set<string>();
    collectStyleTokens(value, named);
    if (![...named].some(id => withheld.has(id))) kept[property] = value;
  }
  const emptied =
    Object.keys(kept).length === 0 && Object.keys(values).length > 0;
  return emptied ? undefined : kept;
}

function rewriteTokens(value: unknown, maps: ReferenceMaps): unknown {
  if (isTokenRef(value))
    return { ...value, $token: mapped(maps.tokens, value.$token) };
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    next[key] = rewriteTokens(inner, maps);
  }
  return next;
}

/** A reference through its map; one the map does not name is kept as stored. */
function mapped(map: ReadonlyMap<string, string>, id: string): string {
  return map.get(id) ?? id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
