/**
 * A shadow as the shadow fields show it: layers of offsets, blur, spread, a
 * colour and "Inside", read from the CSS a shadow is stored as and written
 * back to it.
 *
 * Pure, so what a shadow reads as and what a layer writes are tested apart
 * from the fields. The parts are the engine's reading, the one its shadow
 * check uses, so the fields and the check never disagree about what a part
 * is. What cannot be shown as fields is kept as the CSS it was typed as.
 *
 * @module shadow-css
 */
import {
  resolveTokenPrefix,
  shadowLayerParts,
  tokenCustomProperty,
  type ShadowPart,
  type SiteTokenSet,
  type StyleLeaf,
  type TokenMode,
} from "@nextlyhq/blocks-engine";

import { variableFor, variablesFor } from "./style-colour";
import { NEW_SHADOW_VALUE } from "./tokens-studio";

/**
 * A layer's colour: one of the site's colour variables, by the identity a
 * rename never changes, or a colour written as itself.
 */
export type ShadowColour =
  | { readonly kind: "variable"; readonly identity: string }
  | { readonly kind: "raw"; readonly value: string };

/** One shadow layer, as its fields show it. Sizes are CSS lengths. */
export interface ShadowLayer {
  /** "Inside": drawn within the box rather than around it. */
  readonly inset: boolean;
  readonly x: string;
  readonly y: string;
  /** `undefined` where the layer sets none, which draws a sharp edge. */
  readonly blur: string | undefined;
  /** `undefined` where the layer sets none, which grows it by nothing. */
  readonly spread: string | undefined;
  /** `undefined` where the layer sets none, which takes the text colour. */
  readonly colour: ShadowColour | undefined;
}

/** A shadow read as layers, or kept as the CSS it is. */
export type ShadowReading =
  | { readonly kind: "layers"; readonly layers: readonly ShadowLayer[] }
  | { readonly kind: "css" };

/**
 * What a colour variable is offered at: a colour with no contrast partner,
 * so every colour variable the site has is listed for a shadow.
 */
export const SHADOW_COLOUR_LEAF: Extract<StyleLeaf, { kind: "color" }> = {
  kind: "color",
  cssProperty: "box-shadow",
  tokenKinds: ["color"],
};

/** A reference to one custom property, with no fallback. */
const PLAIN_REFERENCE = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/;

/**
 * The layers a shadow shows as, or `css` where any part cannot be a field:
 * a size through a function, a variable that is no colour of this site's, or
 * anything the engine's reading does not take as a size or a colour.
 */
export function readShadow(
  text: string,
  tokens: SiteTokenSet | undefined
): ShadowReading {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "none") {
    return { kind: "layers", layers: [] };
  }
  const layers: ShadowLayer[] = [];
  for (const parts of shadowLayerParts(trimmed)) {
    const layer = layerOf(parts, tokens);
    if (layer === undefined) return { kind: "css" };
    layers.push(layer);
  }
  return { kind: "layers", layers };
}

/** One layer as fields, or `undefined` where it cannot be one. */
function layerOf(
  parts: readonly ShadowPart[],
  tokens: SiteTokenSet | undefined
): ShadowLayer | undefined {
  const sizes: string[] = [];
  let inset = false;
  let colour: ShadowColour | undefined;
  for (const part of parts) {
    if (part.kind === "length") {
      sizes.push(part.text);
      continue;
    }
    // At most one of each; a second is a layer CSS reads differently.
    if (part.kind === "inset" && !inset) {
      inset = true;
      continue;
    }
    const read = colour === undefined ? colourOf(part, tokens) : undefined;
    if (read === undefined) return undefined;
    colour = read;
  }
  const [x, y, blur, spread, ...more] = sizes;
  if (x === undefined || y === undefined || more.length > 0) return undefined;
  return { inset, x, y, blur, spread, colour };
}

/** A part as a layer's colour, or `undefined` where it is none of the site's. */
function colourOf(
  part: ShadowPart,
  tokens: SiteTokenSet | undefined
): ShadowColour | undefined {
  if (part.kind === "colour") return { kind: "raw", value: part.text };
  if (part.kind !== "reference") return undefined;
  const property = PLAIN_REFERENCE.exec(part.text)?.[1];
  if (property === undefined) return undefined;
  const variable = colourVariables(tokens).find(
    candidate => propertyOf(candidate.identity, tokens) === property
  );
  return variable === undefined
    ? undefined
    : { kind: "variable", identity: variable.identity };
}

/** The site's colour variables, as a colour field offers them. */
function colourVariables(tokens: SiteTokenSet | undefined) {
  return variablesFor(SHADOW_COLOUR_LEAF, tokens);
}

/** The custom property a variable is declared as, under the site's prefix. */
function propertyOf(
  identity: string,
  tokens: SiteTokenSet | undefined
): string {
  return tokenCustomProperty(
    identity,
    resolveTokenPrefix(tokens?.prefix).prefix
  );
}

/**
 * The CSS for a shadow's layers, `none` for none. A colour variable is
 * written as the `var()` the site's stylesheet declares it under, so the
 * shadow follows the colour, its dark value included.
 */
export function writeShadow(
  layers: readonly ShadowLayer[],
  tokens: SiteTokenSet | undefined
): string {
  return written(layers, colour =>
    colour.kind === "raw"
      ? colour.value
      : `var(${propertyOf(colour.identity, tokens)})`
  );
}

/**
 * The CSS for a preview card in one mode: each colour variable painted with
 * its value in that mode, since the panel does not declare the site's
 * custom properties. A variable the site no longer has paints nothing.
 */
export function shadowPreview(
  layers: readonly ShadowLayer[],
  tokens: SiteTokenSet | undefined,
  mode: TokenMode
): string {
  return written(layers, colour =>
    colour.kind === "raw"
      ? colour.value
      : (variableFor(colour.identity, tokens, mode)?.swatch ?? "transparent")
  );
}

/**
 * Whether any colour variable a shadow uses reads differently in dark mode.
 * A variable with no dark value of its own shows its light one there.
 */
export function shadowFollowsDark(
  layers: readonly ShadowLayer[],
  tokens: SiteTokenSet | undefined
): boolean {
  return layers.some(
    ({ colour }) =>
      colour?.kind === "variable" &&
      variableFor(colour.identity, tokens, "dark")?.value !==
        variableFor(colour.identity, tokens, "light")?.value
  );
}

/** Layers as CSS, each colour written by `colourText`. */
function written(
  layers: readonly ShadowLayer[],
  colourText: (colour: ShadowColour) => string
): string {
  if (layers.length === 0) return "none";
  return layers
    .map(layer => {
      // A spread needs a blur before it, so a zero blur is written for one.
      const blur = layer.blur ?? (layer.spread === undefined ? undefined : "0");
      return [
        layer.inset ? "inset" : undefined,
        layer.x,
        layer.y,
        blur,
        layer.spread,
        layer.colour === undefined ? undefined : colourText(layer.colour),
      ]
        .filter(part => part !== undefined)
        .join(" ");
    })
    .join(", ");
}

/**
 * The layer "+ Add layer" adds: a new shadow variable's one layer, read
 * from its value, so the two cannot differ. Last in the module, so
 * everything reading it uses is defined first.
 */
export const NEW_SHADOW_LAYER: ShadowLayer = newShadowLayer();

function newShadowLayer(): ShadowLayer {
  const read = readShadow(NEW_SHADOW_VALUE, undefined);
  const [layer] = read.kind === "layers" ? read.layers : [];
  if (layer === undefined) throw new Error("A new shadow reads as no layer.");
  return layer;
}
