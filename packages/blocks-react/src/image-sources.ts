/**
 * The background image of a page's first section, sized to each device and
 * named in the page's head, so a phone downloads a phone-sized copy and the
 * browser starts on it from the HTML rather than once the stylesheet arrives.
 *
 * Only a background the page states once is sized: set on the first top-level
 * block, at the base breakpoint, in its resting state, drawn at a size of its
 * own (`cover`, `contain` or a length, not the image's own size), with no
 * gradient and no custom CSS beside it. Anything else (a background that changes by device or
 * on hover, a gradient layered with it) is left exactly as the page's own
 * stylesheet draws it, since a copy chosen for one of those cases would be
 * wrong in another.
 *
 * Each device gets the narrowest copy at least twice its slot's width, which a
 * screen at twice the density draws sharply; where none is that wide, the
 * widest the site keeps. The copy is set by one rule per device, anchored like
 * the page's own rules and carrying the node's class twice, so it outranks the
 * node's resting rule and still yields to its hover and focus rules, which
 * weigh the same and come later in the page. The same copies are preloaded with each
 * device's viewport as their `media`, so the browser fetches exactly the copy
 * the rule then draws.
 *
 * @module image-sources
 */
import {
  BLOCK_TYPE_CLASS_PREFIX,
  compileStyleValues,
  isFetchableUrl,
  isRemoteUrl,
  NODE_CLASS_PREFIX,
  PAGE_ROOT_SELECTOR,
  type RemotePatternInput,
} from "@nextlyhq/blocks-engine";

import {
  copiesWantedUpTo,
  type ImageCopies,
  type ImageCopy,
  type ImageSlot,
  narrowForOwnSize,
  type SlotDevice,
} from "./image-slot";

/** One device's copy of the background, and the viewport it is drawn at. */
interface BackgroundBand {
  /** The device's widest viewport; absent on the base (desktop). */
  readonly maxViewport?: number;
  /** The copy drawn there. */
  readonly url: string;
}

/** One copy to preload, and the viewports it is drawn at. */
export interface BackgroundPreload {
  readonly href: string;
  /** Absent where one copy is drawn at every width. */
  readonly media?: string;
}

/** A first section's background, sized: its rules and what to preload. */
export interface SizedBackground {
  /** One rule per device, widest first, as the cascade reads them. */
  readonly css: string;
  /** Each distinct copy, with the viewports it is drawn at. */
  readonly preloads: readonly BackgroundPreload[];
}

/** What `sizedFirstBackground` reads of the block. */
export interface BackgroundNode {
  readonly id?: string;
  readonly styles?: unknown;
  readonly customCss?: unknown;
}

/** What `sizedFirstBackground` reads of the page. */
export interface BackgroundPage {
  readonly imageCopies?: ImageCopies;
  readonly imageSlot?: ImageSlot;
  readonly firstBlockId?: string;
  readonly pageScope?: string;
}

/** The style properties that write a block's `background-image`. */
const IMAGE_LAYERS = ["background", "backgroundGradient"] as const;

/** A value that is a plain object, read without trusting its shape. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Whether a `background-size` draws the image at a size of its own rather
 * than at the image's: `cover`, `contain`, or one or two lengths of which at
 * least one is not `auto`. An image drawn at its intrinsic size (no size, or
 * `auto`) would be drawn smaller from a narrower copy, so it is left as it is.
 */
function sizedByBox(size: unknown): boolean {
  if (typeof size !== "string") return false;
  const parts = size.trim().toLowerCase().split(/\s+/);
  if (parts.length === 1 && (parts[0] === "cover" || parts[0] === "contain")) {
    return true;
  }
  return (
    parts.length <= 2 &&
    parts.some(part => part !== "auto" && part !== "") &&
    !parts.includes("cover") &&
    !parts.includes("contain")
  );
}

/** The image address one breakpoint's values set, or `undefined` if none. */
function layerUrl(values: Record<string, unknown>): string | undefined {
  if (values.backgroundGradient !== undefined) return undefined;
  const background = recordOf(values.background);
  if (!sizedByBox(background?.size)) return undefined;
  const url = background?.url;
  return typeof url === "string" && url !== "none" ? url : undefined;
}

/** Every breakpoint's values a block stores, with its state and breakpoint. */
function storedValues(
  styles: unknown
): { at: string; values: Record<string, unknown> }[] {
  return Object.entries(recordOf(styles) ?? {}).flatMap(([state, byPoint]) =>
    Object.entries(recordOf(byPoint) ?? {}).map(([id, values]) => ({
      at: `${state}/${id}`,
      values: recordOf(values) ?? {},
    }))
  );
}

/**
 * The background image's address, where the block states it once: at the
 * base breakpoint of its resting state, with no gradient, and set at no other
 * breakpoint or state. `undefined` otherwise.
 */
function soleBackgroundUrl(styles: unknown): string | undefined {
  const layered = storedValues(styles).filter(({ values }) =>
    IMAGE_LAYERS.some(layer => values[layer] !== undefined)
  );
  const [only] = layered;
  if (layered.length !== 1 || only?.at !== "base/base") return undefined;
  return layerUrl(only.values);
}

/**
 * Whether the page may fetch an address: one on this site, or one the host's
 * remote patterns name. Never wider than the page's own stylesheet allows,
 * which with no patterns fetches from no other host.
 */
function mayFetchFor(
  patterns: readonly RemotePatternInput[] | undefined
): (url: string) => boolean {
  return url =>
    !isRemoteUrl(url) ||
    (patterns !== undefined && isFetchableUrl(url, patterns));
}

/** A class that is written into a selector as it is, with no escaping. */
const PLAIN_CLASS = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** The node's own class, from the classes a block puts on its root. */
function nodeClassOf(className: string): string | undefined {
  const own = className.split(" ")[0];
  if (own === undefined || !own.startsWith(NODE_CLASS_PREFIX)) return undefined;
  if (own.startsWith(BLOCK_TYPE_CLASS_PREFIX)) return undefined;
  return PLAIN_CLASS.test(own) ? own : undefined;
}

/**
 * The selector the copies are set under: the page's anchor, with its scope
 * where the page has one, then the node's class twice, which is one notch
 * above the node's own resting rule and level with its hover and focus rules.
 * Those come later in the page, so they still win. `undefined` for a scope
 * that would need escaping, which this leaves to the page's own rules.
 */
function selectorFor(
  nodeClass: string,
  scope: string | undefined
): string | undefined {
  if (scope !== undefined && !PLAIN_CLASS.test(scope)) return undefined;
  const root =
    scope === undefined ? PAGE_ROOT_SELECTOR : `${PAGE_ROOT_SELECTOR}.${scope}`;
  return `${root} .${nodeClass}.${nodeClass}`;
}

/**
 * The copy a device draws: the narrowest at least twice its slot's width, or
 * the widest the site keeps where none is that wide.
 */
function copyFor(
  device: SlotDevice,
  copies: readonly ImageCopy[]
): ImageCopy | undefined {
  return copies.find(copy => copy.width >= device.width * 2) ?? copies.at(-1);
}

/** The `background-image` the page's compiler writes for an address. */
function backgroundImageOf(
  url: string,
  mayFetchUrl: (url: string) => boolean
): string | undefined {
  const { declarations } = compileStyleValues(
    { background: { url } },
    "/styles/base/base",
    undefined,
    undefined,
    undefined,
    { mayFetchUrl }
  );
  return declarations.find(entry => entry.property === "background-image")
    ?.value;
}

/** Each device's rule: the base unconditioned, the others under their width. */
function bandRules(
  bands: readonly BackgroundBand[],
  selector: string,
  mayFetchUrl: (url: string) => boolean
): string | undefined {
  const rules: string[] = [];
  for (const band of bands) {
    const image = backgroundImageOf(band.url, mayFetchUrl);
    if (image === undefined) return undefined;
    const rule = `${selector}{background-image:${image}}`;
    rules.push(
      band.maxViewport === undefined
        ? rule
        : `@media (max-width: ${band.maxViewport}px){${rule}}`
    );
  }
  return rules.join("\n");
}

/**
 * The viewports a band covers, as a preload's `media`: from the next narrower
 * band's maximum (exclusive) to its own (inclusive), so exactly one band
 * matches any width.
 */
function bandMedia(band: BackgroundBand, bounds: readonly number[]): string {
  const max = band.maxViewport;
  const below =
    max === undefined ? bounds.at(-1) : bounds.filter(b => b < max).at(-1);
  if (max === undefined) {
    return below === undefined ? "all" : `(width > ${below}px)`;
  }
  return below === undefined
    ? `(width <= ${max}px)`
    : `(${below}px < width <= ${max}px)`;
}

/** One preload per distinct copy, naming every viewport it is drawn at. */
function preloadsOf(bands: readonly BackgroundBand[]): BackgroundPreload[] {
  const bounds = bands
    .map(band => band.maxViewport)
    .filter((max): max is number => max !== undefined)
    .sort((a, b) => a - b);
  const byUrl = new Map<string, string[]>();
  for (const band of bands) {
    byUrl.set(band.url, [
      ...(byUrl.get(band.url) ?? []),
      bandMedia(band, bounds),
    ]);
  }
  return [...byUrl].map(([href, viewports]) =>
    byUrl.size === 1 ? { href } : { href, media: viewports.join(", ") }
  );
}

/** The site's copies of an image that the page may fetch, narrowest first. */
async function fetchableCopies(
  imageCopies: ImageCopies,
  url: string,
  upTo: number,
  mayFetchUrl: (url: string) => boolean
): Promise<ImageCopy[]> {
  const copies = await imageCopies({ url }, upTo).catch(
    (): readonly ImageCopy[] => []
  );
  return copies
    .filter(copy => copy.width > 0 && copy.width <= upTo)
    .filter(copy => mayFetchUrl(copy.url))
    .sort((a, b) => a.width - b.width);
}

/** Each device's copy, widest device first, or none where one has no copy. */
function bandsOf(
  slot: ImageSlot,
  copies: readonly ImageCopy[]
): BackgroundBand[] | undefined {
  const bands: BackgroundBand[] = [];
  for (const device of slot.devices) {
    const copy = copyFor(device, copies);
    if (copy === undefined) return undefined;
    bands.push(
      device.maxViewport === undefined
        ? { url: copy.url }
        : { maxViewport: device.maxViewport, url: copy.url }
    );
  }
  return bands.sort(
    (a, b) =>
      (b.maxViewport ?? Number.POSITIVE_INFINITY) -
      (a.maxViewport ?? Number.POSITIVE_INFINITY)
  );
}

/**
 * The address of a background this page sizes: the first top-level block's,
 * stated once, with no custom CSS beside it, on a page that offers copies.
 * Asked before anything is awaited, so a block that sizes nothing draws
 * exactly as it did.
 */
export function firstBackgroundSource(
  page: BackgroundPage | undefined,
  node: BackgroundNode | undefined
): string | undefined {
  if (page?.imageCopies === undefined || page.imageSlot === undefined) {
    return undefined;
  }
  if (node === undefined) return undefined;
  if (node.id === undefined || node.id !== page.firstBlockId) return undefined;
  if (typeof node.customCss === "string" && node.customCss.trim() !== "") {
    return undefined;
  }
  return soleBackgroundUrl(node.styles);
}

/**
 * The first section's background, sized to each device, or `undefined` where
 * the page draws it as it is: not the page's first top-level block, no copies
 * offered, a background stated more than once, custom CSS on the block, an
 * address the page will not fetch, or no copy to be had.
 */
export async function sizedFirstBackground(
  page: BackgroundPage,
  node: BackgroundNode,
  className: string,
  patterns: readonly RemotePatternInput[] | undefined
): Promise<SizedBackground | undefined> {
  const original = firstBackgroundSource(page, node);
  const nodeClass = nodeClassOf(className);
  const mayFetchUrl = mayFetchFor(patterns);
  const { imageCopies, imageSlot } = page;
  if (original === undefined || nodeClass === undefined) return undefined;
  if (imageCopies === undefined || imageSlot === undefined) return undefined;
  if (!mayFetchUrl(original)) return undefined;
  const slot = narrowForOwnSize(imageSlot, node.styles);
  const upTo = copiesWantedUpTo(slot);
  const copies = await fetchableCopies(
    imageCopies,
    original,
    upTo,
    mayFetchUrl
  );
  const bands = bandsOf(slot, copies);
  const selector = selectorFor(nodeClass, page.pageScope);
  if (bands === undefined || selector === undefined) return undefined;
  const css = bandRules(bands, selector, mayFetchUrl);
  if (css === undefined) return undefined;
  return { css, preloads: preloadsOf(bands) };
}
