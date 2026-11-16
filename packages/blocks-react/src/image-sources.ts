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
 * Each device gets the narrowest copy at least twice the width the background
 * is drawn at there, which a screen at twice the density draws sharply; where
 * none is that wide, the widest copy where it reaches the drawn width; and
 * where none does, the original, which is then the sharpest there is. That width is the box's for
 * `cover` and `contain`, and the stated width for a length or a percentage. A
 * `cover` image in a box taller than the image's proportions is drawn wider
 * than the box, which only its height decides: sized by the box's width, as
 * an `<img>`'s `sizes` is, it can be drawn a little larger than its copy. The copy is set by one rule per device, anchored like
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
  readonly pageMayFetchUrl?: (url: string) => boolean;
}

/** The style properties that write a block's `background-image`. */
const IMAGE_LAYERS = ["background", "backgroundGradient"] as const;

/** A value that is a plain object, read without trusting its shape. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** One length a `background-size` component can be read as. */
const SIZE_LENGTH = /^(\d+(?:\.\d+)?|\.\d+)(px|rem|%)$/;

/** CSS pixels in a `rem`, at the browser's default root size. */
const REM = 16;

/**
 * How wide a background is drawn in a box `width` wide, or `undefined` where
 * that cannot be told from its `background-size`:
 * - `cover` and `contain`: the box's width. A `cover` image can be drawn wider
 *   than the box, where the box is taller than the image's proportions, and
 *   is sized by the width as `sizes` sizes an image; see the module doc.
 * - a width as a length or a percentage, with or without a height: that width.
 * - no size, `auto`, or `auto` then a height: the image's own width or one set
 *   by its height, neither known here, so the background is left as it is.
 */
function drawnWidth(size: unknown, width: number): number | undefined {
  if (typeof size !== "string") return undefined;
  const parts = size.trim().toLowerCase().split(/\s+/);
  if (parts.length === 1 && (parts[0] === "cover" || parts[0] === "contain")) {
    return width;
  }
  return parts.length <= 2 ? lengthWidth(parts[0], width) : undefined;
}

/** A width stated as a length or a share of the box, or `undefined`. */
function lengthWidth(
  part: string | undefined,
  width: number
): number | undefined {
  const match = SIZE_LENGTH.exec(part ?? "");
  if (match === null) return undefined;
  const amount = Number(match[1]);
  if (match[2] === "%") return Math.ceil((width * amount) / 100);
  return Math.ceil(match[2] === "rem" ? amount * REM : amount);
}

/** A background image as one breakpoint's values set it. */
interface StatedBackground {
  readonly url: string;
  readonly size: unknown;
}

/** The background image one breakpoint's values set, or `undefined` if none. */
function layerOf(
  values: Record<string, unknown>
): StatedBackground | undefined {
  if (values.backgroundGradient !== undefined) return undefined;
  const background = recordOf(values.background);
  const url = background?.url;
  return typeof url === "string" && url !== "none"
    ? { url, size: background?.size }
    : undefined;
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
function soleBackground(styles: unknown): StatedBackground | undefined {
  const layered = storedValues(styles).filter(({ values }) =>
    IMAGE_LAYERS.some(layer => values[layer] !== undefined)
  );
  const [only] = layered;
  if (layered.length !== 1 || only?.at !== "base/base") return undefined;
  return layerOf(only.values);
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
 * where the page has one, then the node's class and the class naming this
 * background, which is one notch above the node's own resting rule and level
 * with its hover and focus rules. Those come later in the page, so they still
 * win. `undefined` for a scope that would need escaping, which this leaves to
 * the page's own rules.
 */
function selectorFor(
  nodeClass: string,
  revision: string,
  scope: string | undefined
): string | undefined {
  if (scope !== undefined && !PLAIN_CLASS.test(scope)) return undefined;
  const root =
    scope === undefined ? PAGE_ROOT_SELECTOR : `${PAGE_ROOT_SELECTOR}.${scope}`;
  return `${root} .${nodeClass}.${revision}`;
}

/**
 * A short key for a text. React keeps a hoisted stylesheet by its `href` and
 * never replaces its contents, so a key that changes with what it names gives
 * changed rules a stylesheet of their own.
 */
export function contentKey(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * The class a first section wears while this page sizes its background, named
 * by what the sizing is computed from: the background, the slot and the
 * scope. Its rules name it too, and React keeps a hoisted stylesheet after the
 * section that drew it is gone, so a page drawn again with another
 * background, or none, leaves the old rules matching nothing.
 */
export function backgroundRevision(
  page: BackgroundPage | undefined,
  node: BackgroundNode | undefined
): string | undefined {
  const source = firstBackgroundSource(page, node);
  if (source === undefined) return undefined;
  const key = contentKey(
    JSON.stringify([
      source.url,
      source.size,
      page?.imageSlot,
      page?.pageScope ?? null,
      node?.styles,
    ])
  );
  return `nx-pb-bg-${key}`;
}

/**
 * The address a device draws: the narrowest copy at least twice the width the
 * background is drawn at there; else the widest copy, where it is at least
 * that width; else the original. Copies are never wider than their original,
 * so where none reaches the drawn width the original is the sharpest there is.
 */
function sourceFor(
  device: SlotDevice,
  copies: readonly ImageCopy[],
  original: string
): string {
  const sharp = copies.find(each => each.width >= device.width * 2);
  if (sharp !== undefined) return sharp.url;
  const widest = copies.at(-1);
  return widest !== undefined && widest.width >= device.width
    ? widest.url
    : original;
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
  copies: readonly ImageCopy[],
  original: string
): BackgroundBand[] | undefined {
  if (copies.length === 0) return undefined;
  const bands: BackgroundBand[] = [];
  for (const device of slot.devices) {
    const url = sourceFor(device, copies, original);
    bands.push(
      device.maxViewport === undefined
        ? { url }
        : { maxViewport: device.maxViewport, url }
    );
  }
  return bands.sort(
    (a, b) =>
      (b.maxViewport ?? Number.POSITIVE_INFINITY) -
      (a.maxViewport ?? Number.POSITIVE_INFINITY)
  );
}

/**
 * How wide the background is drawn on each device of the box's slot, or
 * `undefined` where its size leaves that unknown on any of them.
 */
function drawnSlot(slot: ImageSlot, size: unknown): ImageSlot | undefined {
  const devices: SlotDevice[] = [];
  for (const device of slot.devices) {
    const width = drawnWidth(size, device.width);
    if (width === undefined || width <= 0) return undefined;
    devices.push({ ...device, width });
  }
  return { ...slot, devices };
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
): StatedBackground | undefined {
  if (page?.imageCopies === undefined || page.imageSlot === undefined) {
    return undefined;
  }
  if (node === undefined) return undefined;
  if (node.id === undefined || node.id !== page.firstBlockId) return undefined;
  if (typeof node.customCss === "string" && node.customCss.trim() !== "") {
    return undefined;
  }
  const source = soleBackground(node.styles);
  // Only a size the box sets: drawn at its own size, a narrower copy would
  // draw it smaller.
  if (source === undefined || drawnWidth(source.size, 1) === undefined) {
    return undefined;
  }
  return source;
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
  // The page's own policy where the renderer settled one, so these rules fetch
  // nothing the page's rules would refuse; this site's addresses and the
  // host's remote patterns otherwise.
  const mayFetchUrl = page.pageMayFetchUrl ?? mayFetchFor(patterns);
  const { imageCopies, imageSlot } = page;
  if (original === undefined || nodeClass === undefined) return undefined;
  if (imageCopies === undefined || imageSlot === undefined) return undefined;
  if (!mayFetchUrl(original.url)) return undefined;
  const slot = drawnSlot(
    narrowForOwnSize(imageSlot, node.styles),
    original.size
  );
  if (slot === undefined) return undefined;
  const upTo = copiesWantedUpTo(slot);
  const copies = await fetchableCopies(
    imageCopies,
    original.url,
    upTo,
    mayFetchUrl
  );
  const bands = bandsOf(slot, copies, original.url);
  const revision = backgroundRevision(page, node);
  const selector =
    revision === undefined
      ? undefined
      : selectorFor(nodeClass, revision, page.pageScope);
  if (bands === undefined || selector === undefined) return undefined;
  const css = bandRules(bands, selector, mayFetchUrl);
  if (css === undefined) return undefined;
  return { css, preloads: preloadsOf(bands) };
}
