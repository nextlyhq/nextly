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
import type { BreakpointSet } from "@nextlyhq/blocks-engine";

/** The widest a desktop is taken to be, since its breakpoint has no maximum. */
const DESKTOP_WIDTH = 1920;

/** The narrowest a column is before Columns wraps it onto the next line. */
const COLUMN_MIN_WIDTH = 240;

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
    Math.min(count, Math.floor(width / COLUMN_MIN_WIDTH))
  );
  const atFullWidth = Math.ceil(width / perRow);
  if (perRow === 1) return width;
  return Math.max(atFullWidth, Math.min(width, COLUMN_MIN_WIDTH * 2));
}

/** The style properties an author can redraw a row of columns with. */
const COLUMN_LAYOUT = [
  "display",
  "gridTemplateColumns",
  "gridAutoFlow",
  "flexDirection",
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
  if (typeof width !== "string") return slot;
  const match = LENGTH.exec(width.trim().toLowerCase());
  if (match === null) return slot;
  const amount = Number(match[1]);
  const unit = match[2];
  return {
    ...slot,
    devices: slot.devices.map(device => {
      const own =
        unit === "%"
          ? Math.ceil((device.width * amount) / 100)
          : unit === "rem"
            ? Math.ceil(amount * REM)
            : Math.ceil(amount);
      return { ...device, width: Math.min(device.width, own) };
    }),
  };
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
  nodes: readonly { readonly id?: string }[]
): {
  imageCopies?: ImageCopies;
  imageSlot?: ImageSlot;
  firstBlockId?: string;
} {
  if (imageCopies === undefined) return {};
  const firstBlockId = nodes[0]?.id;
  return {
    imageCopies,
    imageSlot: rootImageSlot(breakpoints),
    ...(firstBlockId === undefined ? {} : { firstBlockId }),
  };
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
 * A slot narrowed by the width and maximum width a block sets for itself,
 * read only where they hold on every device: set at the base, in its resting
 * state, and set at no other breakpoint. A width that changes by device is
 * left unjudged, since narrowing by the base value would size the image too
 * small on a device that draws it wider.
 */
export function narrowForOwnSize(slot: ImageSlot, styles: unknown): ImageSlot {
  const breakpoints = recordOf(recordOf(styles)?.base);
  if (breakpoints === undefined) return slot;
  for (const [id, values] of Object.entries(breakpoints)) {
    if (id === "base") continue;
    const sized = recordOf(values);
    if (sized?.width !== undefined || sized?.maxWidth !== undefined) {
      return slot;
    }
  }
  const base = recordOf(breakpoints.base);
  // Each against the block's container, as CSS resolves both, then the
  // narrower: a percentage maximum is a share of the container, never of the
  // width the block's own `width` already gave it.
  return narrowerOf(
    narrowToWidth(slot, base?.width),
    narrowToWidth(slot, base?.maxWidth)
  );
}

/** Two bounds on one slot, device by device, the narrower of each. */
function narrowerOf(a: ImageSlot, b: ImageSlot): ImageSlot {
  if (a === b) return a;
  return {
    ...a,
    devices: a.devices.map((device, index) => ({
      ...device,
      width: Math.min(device.width, b.devices[index]?.width ?? device.width),
    })),
  };
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
  if (node.type === COLUMNS_TYPE && columnsLaidOutByDefault(node)) {
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
