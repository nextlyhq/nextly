/**
 * A shadow as a DTCG `shadow` value, and back.
 *
 * The format models a shadow as named fields, one object per layer (a list
 * for more than one): `color`, `offsetX`, `offsetY`, `blur`, `spread` and
 * `inset`. A stored shadow is CSS text, so it is read with the engine's one
 * shadow reader (`shadowLayerParts`), the reader the builder's shadow fields
 * use, and written as fields only where every layer reads as them: an
 * optional `inset`, two to four sizes in px or rem, and one colour, written
 * as itself or, for a colour variable, as an alias to that variable. Any
 * other shadow has no conformant value, so the caller keeps it as Nextly-only
 * data, as it does every value the format cannot type.
 *
 * The colour, size and alias conversions are handed in rather than imported,
 * so this reads and writes with the same conversions every other value uses.
 *
 * @module style/dtcg-shadow
 */
import type { DtcgNode } from "./dtcg-format";
import { isPlainObject } from "./dtcg-format";
import { shadowLayerParts, type ShadowPart } from "./css-value-shadow";

/** The conversions a shadow is written with. */
export interface ShadowWriters {
  /** A colour written as itself, in the format's form, or `undefined`. */
  readonly colour: (text: string) => DtcgNode | undefined;
  /** A size in px or rem, in the format's form, or `undefined`. */
  readonly length: (
    text: string
  ) => { value: number; unit: string } | undefined;
  /** A `var()` of a colour variable as an alias (`{color.brand}`), or `undefined`. */
  readonly alias: (text: string) => string | undefined;
}

/** The conversions a shadow is read back with: each to CSS, or `undefined`. */
export interface ShadowReaders {
  readonly colour: (value: unknown) => string | undefined;
  readonly length: (value: unknown) => string | undefined;
}

/** The four sizes of a layer, in the order CSS writes them. */
const SIZES = ["offsetX", "offsetY", "blur", "spread"] as const;

/**
 * A shadow's CSS as a DTCG shadow value: one object for one layer, a list
 * for more. `undefined` when any layer is not one the fields can hold.
 */
export function shadowToDtcg(
  css: string,
  write: ShadowWriters
): DtcgNode | DtcgNode[] | undefined {
  const layers = shadowLayerParts(css.trim());
  const written: DtcgNode[] = [];
  for (const layer of layers) {
    const fields = layerToDtcg(layer, write);
    if (fields === undefined) return undefined;
    written.push(fields);
  }
  if (written.length === 0) return undefined;
  return written.length === 1 ? written[0] : written;
}

/** One layer as fields, or `undefined`. */
function layerToDtcg(
  layer: readonly ShadowPart[],
  write: ShadowWriters
): DtcgNode | undefined {
  const rest = [...layer];
  let inset = false;
  // `inset` may open or close a layer, once.
  if (rest[0]?.kind === "inset") {
    inset = true;
    rest.shift();
  } else if (rest.at(-1)?.kind === "inset") {
    inset = true;
    rest.pop();
  }
  // The colour may open or close it too: whichever end isn't a size.
  const colourAtStart = rest[0] !== undefined && rest[0].kind !== "length";
  const colourPart = colourAtStart ? rest.shift() : rest.pop();
  const colour =
    colourPart === undefined ? undefined : colourOf(colourPart, write);
  if (colour === undefined) return undefined;
  if (rest.length < 2 || rest.length > 4) return undefined;
  const sizes: { value: number; unit: string }[] = [];
  for (const part of rest) {
    if (part.kind !== "length") return undefined;
    const size = write.length(part.text);
    if (size === undefined) return undefined;
    sizes.push(size);
  }
  const zero = { value: 0, unit: "px" };
  return {
    color: colour,
    offsetX: sizes[0] ?? zero,
    offsetY: sizes[1] ?? zero,
    blur: sizes[2] ?? zero,
    spread: sizes[3] ?? zero,
    inset,
  };
}

/** A layer's colour as the format writes it, or `undefined`. */
function colourOf(
  part: ShadowPart,
  write: ShadowWriters
): DtcgNode | string | undefined {
  if (part.kind === "colour") return write.colour(part.text);
  if (part.kind === "reference") return write.alias(part.text);
  return undefined;
}

/**
 * A DTCG shadow value as CSS: one layer per object, its sizes in CSS order
 * and `inset` first. `undefined` when a layer misses a field or holds one
 * that is not read: an alias inside a layer names nothing a file read on
 * its own can resolve.
 */
export function shadowFromDtcg(
  value: unknown,
  read: ShadowReaders
): string | undefined {
  const layers = Array.isArray(value) ? value : [value];
  if (layers.length === 0) return undefined;
  const written: string[] = [];
  for (const layer of layers) {
    if (!isPlainObject(layer)) return undefined;
    const colour = read.colour(layer.color);
    if (colour === undefined) return undefined;
    const sizes: string[] = [];
    for (const field of SIZES) {
      const size = read.length(layer[field]);
      if (size === undefined) return undefined;
      sizes.push(size);
    }
    if (layer.inset !== undefined && typeof layer.inset !== "boolean") {
      return undefined;
    }
    written.push(
      [layer.inset === true ? "inset" : undefined, ...sizes, colour]
        .filter(part => part !== undefined)
        .join(" ")
    );
  }
  return written.join(", ");
}
