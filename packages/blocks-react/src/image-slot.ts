/**
 * How wide an image may be drawn on each device, so a published page sends
 * copies sized to where the image appears rather than its upload size.
 *
 * A slot is an UPPER bound per device: the most CSS pixels the image can take
 * there. It starts as the device's whole width and only narrows: by a row of
 * columns and by a width the block sets for itself. Anything this cannot
 * judge (a `calc()`, a class, custom CSS) leaves it as it was, so a slot is
 * never narrower than the image can really be drawn and an image is never
 * sent softer than it shows.
 *
 * @module image-slot
 */
import {
  defaultSiteTokens,
  resolveSiteTokens,
  type BreakpointSet,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";

/** The widest a desktop is taken to be, since its breakpoint has no maximum. */
const DESKTOP_WIDTH = 1920;

/** The narrowest a column is before Columns wraps it onto the next line. */
const COLUMN_MIN_WIDTH = 240;

/**
 * The widest gap the default row of columns draws between them: its
 * `space.columns` token's maximum, 2rem. Allowing for it makes a row wrap at
 * the widest it would, so a column is never judged narrower than it draws.
 */
const COLUMN_GAP_MAX = 32;

/** CSS pixels in a `rem`, at the browser's default root size. */
const REM = 16;

/** One resized copy of an image: its address and its width in pixels. */
export interface ImageCopy {
  readonly url: string;
  readonly width: number;
}

/**
 * Resized copies of an image, for a page drawing it at a known width: every
 * copy the site keeps no wider than `upTo`, narrowest first, or none when the
 * image is to be used as it is (an address on another host, a storage that
 * cannot make copies, an original narrower than any copy).
 *
 * `reads`, where given, is the page's read allowance: one read is claimed for
 * each lookup the answer needs, and an answer that cannot claim one is refused
 * rather than cut short, so a page never keeps a partial list.
 *
 * @experimental
 */
export type ImageCopies = (
  source: { readonly id: string } | { readonly url: string },
  upTo: number,
  reads?: { take(claim?: { readonly kind?: "image" }): boolean }
) => Promise<readonly ImageCopy[]>;

/** How wide an image may be drawn on one device. */
export interface SlotDevice {
  /** The viewport breakpoint's id. */
  readonly id: string;
  /** The device's widest viewport; absent on the base (desktop). */
  readonly maxViewport?: number;
  /** The most CSS pixels the image can take on this device. */
  readonly width: number;
}

/** The slot an image is drawn in, on every device the site defines. */
export interface ImageSlot {
  /** Widest device first, as the site's breakpoints list them. */
  readonly devices: readonly SlotDevice[];
  /** Whether the image is in the page's first section, found early. */
  readonly eager?: boolean;
  /**
   * Whether a row of columns may divide this slot: only where the site's gap
   * between columns is the default, whose widest the bound allows for. A site
   * that sets its own gap leaves its columns' images the row's full width.
   */
  readonly columnsDivide?: boolean;
}

/** The slot of a block at the top of a page: each device's whole width. */
export function rootImageSlot(
  breakpoints: BreakpointSet | undefined
): ImageSlot {
  const viewport = breakpoints?.viewport ?? [];
  const devices = viewport.map(
    (def): SlotDevice =>
      def.maxWidth === undefined
        ? { id: def.id, width: DESKTOP_WIDTH }
        : { id: def.id, maxViewport: def.maxWidth, width: def.maxWidth }
  );
  return {
    devices:
      devices.length === 0 ? [{ id: "base", width: DESKTOP_WIDTH }] : devices,
  };
}

/**
 * A slot divided among `count` columns, as many as fit side by side on each
 * device at their narrowest. The gap between them is left in, which only
 * keeps the bound high.
 */
export function narrowForColumns(slot: ImageSlot, count: number): ImageSlot {
  if (!Number.isInteger(count) || count <= 1) return slot;
  return {
    ...slot,
    devices: slot.devices.map(device => ({
      ...device,
      width: widestColumn(device.width, count),
    })),
  };
}

/**
 * The widest one of `count` columns is drawn anywhere up to a row `width`
 * wide. Below that width the row wraps, one column fewer each time a column
 * would fall under its minimum, so a column is widest either at the full
 * width or just before a row of two wraps to one: twice the minimum. A
 * device's slot covers every viewport up to its maximum, so both count.
 */
function widestColumn(width: number, count: number): number {
  const perRow = Math.max(
    1,
    Math.min(
      count,
      Math.floor((width + COLUMN_GAP_MAX) / (COLUMN_MIN_WIDTH + COLUMN_GAP_MAX))
    )
  );
  if (perRow === 1) return width;
  return Math.max(
    Math.ceil(width / perRow),
    Math.min(width, COLUMN_MIN_WIDTH * 2 + COLUMN_GAP_MAX)
  );
}
/** The style properties an author can redraw a row of columns with. */
const COLUMN_LAYOUT = [
  "display",
  "gridTemplateColumns",
  "gridAutoFlow",
  "flexDirection",
  "gap",
  "columnGap",
] as const;

/**
 * Whether a row of columns is laid out as the block lays it out: no layout
 * property set on it at any state or breakpoint, and no named class, which
 * could set one. Only then can its columns' width be judged.
 */
function columnsLaidOutByDefault(node: SizedNode): boolean {
  if (Array.isArray(node.classes) && node.classes.length > 0) return false;
  for (const byPoint of Object.values(recordOf(node.styles) ?? {})) {
    for (const values of Object.values(recordOf(byPoint) ?? {})) {
      const set = recordOf(values) ?? {};
      if (COLUMN_LAYOUT.some(property => set[property] !== undefined)) {
        return false;
      }
    }
  }
  return true;
}

/** One length this can read: a number and its unit. */
const LENGTH = /^(\d+(?:\.\d+)?|\.\d+)(px|rem|%)$/;

/**
 * A slot no wider than a width the block sets for itself. `px` and `rem` cap
 * every device; a percentage takes that share of each. Any other value
 * leaves the slot as it was.
 */
export function narrowToWidth(slot: ImageSlot, width: unknown): ImageSlot {
  if (lengthIn(width, 0) === undefined) return slot;
  return {
    ...slot,
    devices: slot.devices.map(device => ({
      ...device,
      width: Math.min(
        device.width,
        lengthIn(width, device.width) ?? device.width
      ),
    })),
  };
}

/**
 * A length's width in a box `width` wide: `px` and `rem` as they are, a
 * percentage as that share, `undefined` for anything else.
 */
function lengthIn(value: unknown, width: number): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = LENGTH.exec(value.trim().toLowerCase());
  if (match === null) return undefined;
  const amount = Number(match[1]);
  if (match[2] === "%") return Math.ceil((width * amount) / 100);
  return Math.ceil(match[2] === "rem" ? amount * REM : amount);
}
/**
 * The `sizes` attribute for a slot: each narrower device under its own
 * maximum, then the desktop's width. A browser picks the first that matches.
 */
export function sizesFor(slot: ImageSlot): string {
  const bounded = slot.devices
    .filter(
      (device): device is SlotDevice & { maxViewport: number } =>
        typeof device.maxViewport === "number"
    )
    .sort((a, b) => a.maxViewport - b.maxViewport)
    .map(device => `(max-width: ${device.maxViewport}px) ${device.width}px`);
  const widest = slot.devices.find(device => device.maxViewport === undefined);
  return [...bounded, `${widest?.width ?? maxWidthOf(slot)}px`].join(", ");
}

/** The widest the image is drawn anywhere. */
function maxWidthOf(slot: ImageSlot): number {
  return Math.max(...slot.devices.map(device => device.width));
}

/**
 * The widest copy worth asking for: twice the slot's widest width, which a
 * screen at twice the density draws sharply and nothing needs more of.
 */
export function copiesWantedUpTo(slot: ImageSlot): number {
  return maxWidthOf(slot) * 2;
}

/**
 * The context a page's images are sized from: the site's copies, the slot a
 * top-level block is drawn in, and the page's first top-level block, whose
 * images are found early. Nothing at all where the site offers no copies, so
 * every image is drawn as it always was.
 */
export function imageSizingFor(
  imageCopies: ImageCopies | undefined,
  breakpoints: BreakpointSet | undefined,
  nodes: readonly { readonly id?: string }[],
  /**
   * Whether the site's gap between columns is the default. Left out, it is
   * not known, and columns divide no slot.
   */
  defaultColumnGap = false
): {
  imageCopies?: ImageCopies;
  imageSlot?: ImageSlot;
  firstBlockId?: string;
} {
  if (imageCopies === undefined) return {};
  const firstBlockId = nodes[0]?.id;
  return {
    imageCopies,
    imageSlot: defaultColumnGap
      ? { ...rootImageSlot(breakpoints), columnsDivide: true }
      : rootImageSlot(breakpoints),
    ...(firstBlockId === undefined ? {} : { firstBlockId }),
  };
}

/** The token a row of columns spaces its columns by. */
const COLUMN_GAP_TOKEN = "space.columns";

/**
 * Whether a site's gap between columns is the default one: its
 * `space.columns` token as the engine ships it. Any other value, however
 * set, is one whose widest the column bound does not know.
 */
export function hasDefaultColumnGap(tokens: SiteTokenSet | undefined): boolean {
  const named = (
    set: readonly { readonly id?: string; readonly name: string }[]
  ) => set.find(token => (token.id ?? token.name) === COLUMN_GAP_TOKEN);
  const site = named(resolveSiteTokens(tokens).tokens);
  const shipped = named(defaultSiteTokens());
  if (site === undefined || shipped === undefined) return false;
  const valueOf = (token: object) => {
    const { value, values } = token as { value?: unknown; values?: unknown };
    return JSON.stringify({ value, values });
  };
  return valueOf(site) === valueOf(shipped);
}

/** The block type whose children share its width as a row of columns. */
const COLUMNS_TYPE = "core/columns";

/** A value that is a plain object, read without trusting its shape. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * A slot sized by the width and maximum width a block sets for itself, read
 * only where they hold on every device and in every state: set at the base,
 * in its resting state, set in no other state or breakpoint, and with no
 * minimum width anywhere. A width that changes by device or on hover is left
 * unjudged, since sizing by the base value would size the image too small
 * where it is drawn wider, and so is one a minimum could widen. A width set in
 * pixels can be wider than the container, since CSS draws it so.
 */
export function narrowForOwnSize(slot: ImageSlot, styles: unknown): ImageSlot {
  if (sizedOutsideTheBase(styles)) return slot;
  const base = recordOf(recordOf(recordOf(styles)?.base)?.base);
  if (base?.width === undefined && base?.maxWidth === undefined) return slot;
  return {
    ...slot,
    devices: slot.devices.map(device => {
      // A width set in pixels is drawn at, even past the container; a
      // percentage, and a maximum, are shares of the container.
      const own = lengthIn(base.width, device.width) ?? device.width;
      const cap =
        lengthIn(base.maxWidth, device.width) ?? Number.POSITIVE_INFINITY;
      return { ...device, width: Math.min(own, cap) };
    }),
  };
}

/** The size properties a block's own width is judged by. */
const OWN_SIZE = ["width", "maxWidth", "minWidth"] as const;

/**
 * Whether a block's size is set anywhere but its base breakpoint's resting
 * state, or by a minimum anywhere, any of which can draw it wider than the
 * base width says.
 */
function sizedOutsideTheBase(styles: unknown): boolean {
  return Object.entries(recordOf(styles) ?? {}).some(([state, byPoint]) =>
    Object.entries(recordOf(byPoint) ?? {}).some(([id, stored]) =>
      widensOwnSize(recordOf(stored) ?? {}, state === "base" && id === "base")
    )
  );
}

/**
 * Whether one breakpoint's values can draw a block wider than its base width:
 * a minimum anywhere, or a size anywhere but the resting base.
 */
function widensOwnSize(
  values: Record<string, unknown>,
  atRestingBase: boolean
): boolean {
  if (values.minWidth !== undefined) return true;
  return (
    !atRestingBase && OWN_SIZE.some(property => values[property] !== undefined)
  );
}
/** What `childImageContext` reads of a container. */
interface SizedNode {
  readonly id?: string;
  readonly type: string;
  readonly styles?: unknown;
  readonly slots?: unknown;
  readonly classes?: unknown;
}

/**
 * The context a container hands its children: the slot narrowed by its own
 * size and, for a row of columns, divided among them; and marked eager inside
 * the page's first top-level block. `undefined` where the page sizes no
 * images, so the children are handed nothing new.
 */
export function childImageContext<
  C extends { imageSlot?: ImageSlot; firstBlockId?: string },
>(ctx: C | undefined, node: SizedNode | undefined): C | undefined {
  const slot = ctx?.imageSlot;
  if (ctx === undefined || node === undefined || slot === undefined) {
    return undefined;
  }
  let next = narrowForOwnSize(slot, node.styles);
  if (
    node.type === COLUMNS_TYPE &&
    slot.columnsDivide === true &&
    columnsLaidOutByDefault(node)
  ) {
    const children = recordOf(node.slots)?.children;
    next = narrowForColumns(
      next,
      Array.isArray(children) ? children.length : 0
    );
  }
  const eager =
    slot.eager === true ||
    (node.id !== undefined && node.id === ctx.firstBlockId);
  return { ...ctx, imageSlot: eager ? { ...next, eager: true } : next };
}
