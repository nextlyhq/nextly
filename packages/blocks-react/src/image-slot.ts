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
 * @experimental
 */
export type ImageCopies = (
  source: { readonly id: string } | { readonly url: string },
  upTo: number
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
    devices: slot.devices.map(device => {
      const perRow = Math.max(
        1,
        Math.min(count, Math.floor(device.width / COLUMN_MIN_WIDTH))
      );
      return { ...device, width: Math.ceil(device.width / perRow) };
    }),
  };
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
  firstBlockId: string | undefined
): {
  imageCopies?: ImageCopies;
  imageSlot?: ImageSlot;
  firstBlockId?: string;
} {
  if (imageCopies === undefined) return {};
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
  return narrowToWidth(narrowToWidth(slot, base?.width), base?.maxWidth);
}

/** What `childImageContext` reads of a container. */
interface SizedNode {
  readonly id?: string;
  readonly type: string;
  readonly styles?: unknown;
  readonly slots?: unknown;
}

/**
 * The context a container hands its children: the slot narrowed by its own
 * size and, for a row of columns, divided among them; and marked eager inside
 * the page's first top-level block. `undefined` where the page sizes no
 * images, so the children are handed nothing new.
 */
export function childImageContext<
  C extends { imageSlot?: ImageSlot; firstBlockId?: string },
>(ctx: C, node: SizedNode): C | undefined {
  const slot = ctx.imageSlot;
  if (slot === undefined) return undefined;
  let next = narrowForOwnSize(slot, node.styles);
  if (node.type === COLUMNS_TYPE) {
    const children = recordOf(node.slots)?.children;
    next = narrowForColumns(
      next,
      Array.isArray(children) ? children.length : 0
    );
  }
  const eager = slot.eager === true || node.id === ctx.firstBlockId;
  return { ...ctx, imageSlot: eager ? { ...next, eager: true } : next };
}
