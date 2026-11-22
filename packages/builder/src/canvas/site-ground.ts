/**
 * What colour a page's ground is, read the way the canvas needs it: whether a
 * colour is opaque, how light it is, and from those whether the page under the
 * editor's marks is dark.
 *
 * One module, because two places ask: the canvas root, marking whether the
 * site paints an opaque ground of its own, and the frame's layer, choosing the
 * hues its marks take for the page beneath them. Two copies of "is this ground
 * dark" would drift, and a mark drawn in the wrong hue is the result.
 *
 * @module site-ground
 */
import {
  parseColor,
  relativeLuminance,
  type Rgb,
} from "@nextlyhq/blocks-engine";

/**
 * The largest relative luminance a ground can have and still be dark: the
 * point where white text and black text contrast with it equally.
 */
const DARK_GROUND_LUMINANCE = 0.179;

/**
 * Whether a token value is a dark ground. A value this engine cannot read as a
 * colour — a named colour, `oklch()`, a reference to another property — says
 * nothing about how light it is, so it is not called dark: the canvas keeps the
 * page's light default rather than switching every native control to a dark
 * scheme over what may be a light ground.
 */
export function isDarkGround(value: string): boolean {
  const luminance = groundLuminance(value.trim());
  return luminance !== undefined && luminance < DARK_GROUND_LUMINANCE;
}

/**
 * One numeric colour component, with its percentage sign if it has one: an
 * optional sign, a decimal, an optional exponent, an optional `%`.
 *
 * The SAME grammar as the engine's `NUMERIC_COMPONENT` in `contrast.ts`, which
 * reads `rgb()` and does not export it; mirrored here for the two syntaxes the
 * engine does not read, so a component is a number in all of them alike.
 * Matched whole rather than parsed with `parseFloat`, which reads a prefix and
 * stops — `5e-1` would read as 5 and `12abc` as 12.
 */
const NUMERIC_COMPONENT = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?(%?)$/;

/** A component as a number, and whether it was a percentage. */
function numericOf(
  part: string | undefined
): { value: number; percent: boolean } | undefined {
  if (part === undefined) return undefined;
  const match = NUMERIC_COMPONENT.exec(part);
  if (match === null) return undefined;
  const value = Number.parseFloat(part);
  return Number.isFinite(value)
    ? { value, percent: match[1] === "%" }
    : undefined;
}

/** A component as a 0–1 fraction: a percentage of 100, or a number of `scale`. */
function fractionOf(
  part: string | undefined,
  scale: number
): number | undefined {
  const parsed = numericOf(part);
  if (parsed === undefined) return undefined;
  const fraction = parsed.value / (parsed.percent ? 100 : scale);
  // Clamped, as CSS Color 4 clamps alpha, lightness and saturation.
  return Math.min(1, Math.max(0, fraction));
}

/**
 * An `oklch()` or `hsl()`/`hsla()` call, split into its colour components and
 * its alpha: after a `/` in the modern syntax, the fourth comma-separated
 * component in the legacy one. `undefined` for anything else, or a call whose
 * shape is neither.
 */
function colourFunction(text: string): ColourCall | undefined {
  const call = /^(oklch|hsla?)\(([^()]*)\)$/i.exec(text);
  if (call === null) return undefined;
  const name = (call[1] ?? "").toLowerCase() === "oklch" ? "oklch" : "hsl";
  const body = call[2] ?? "";
  return body.includes(",") ? legacyCall(name, body) : modernCall(name, body);
}

/** A colour function's name, colour components and alpha, as written. */
interface ColourCall {
  readonly name: "oklch" | "hsl";
  readonly components: readonly string[];
  readonly alpha: string | undefined;
}

/**
 * The legacy, comma-separated form: `hsl(h, s%, l%)` or `hsla(h, s%, l%, a)`.
 * Only `hsl()` has one, and it takes no slash.
 */
function legacyCall(
  name: ColourCall["name"],
  body: string
): ColourCall | undefined {
  if (name === "oklch" || body.includes("/")) return undefined;
  const parts = body.split(",").map(part => part.trim());
  if (parts.length !== 3 && parts.length !== 4) return undefined;
  return { name, components: parts.slice(0, 3), alpha: parts[3] };
}

/** The modern, space-separated form, with an optional `/ alpha` after it. */
function modernCall(
  name: ColourCall["name"],
  body: string
): ColourCall | undefined {
  const [channels, alpha, ...rest] = body.split("/");
  if (rest.length > 0) return undefined;
  const parts = (channels ?? "")
    .trim()
    .split(/\s+/)
    .filter(part => part !== "");
  if (parts.length !== 3) return undefined;
  return { name, components: parts, alpha: alpha?.trim() };
}

/**
 * A colour's alpha, 0–1, or `undefined` when it cannot be told.
 *
 * Hex and `rgb()` from the engine's parser; `oklch()` and `hsl()` from their
 * own alpha component, 1 when they state none. A bare colour keyword is opaque
 * — every named colour is — except `transparent`, and a keyword this cannot
 * place, such as `currentColor`, is unknown, as is a reference or a function
 * this does not read.
 */
export function alphaOf(text: string): number | undefined {
  const rgb = parseColor(text);
  if (rgb !== undefined) return rgb.a;
  const call = colourFunction(text);
  if (call !== undefined) {
    return call.alpha === undefined ? 1 : fractionOf(call.alpha, 1);
  }
  if (!/^[a-z]+$/i.test(text)) return undefined;
  const keyword = text.toLowerCase();
  if (keyword === "transparent") return 0;
  return keyword === "currentcolor" ? undefined : 1;
}

/**
 * The relative luminance of a ground colour, or `undefined` when it cannot be
 * told. Hex and `rgb()` go through the engine's own parser. `oklch()`, which
 * Tailwind themes write, carries perceptual lightness directly: its L cubed is
 * the luminance of a grey, close enough for a dark-or-light call. `hsl()`,
 * which shadcn-style themes write, converts to rgb by the standard formula.
 *
 * A TRANSLUCENT colour has no lightness of its own: what a visitor sees is the
 * surface behind it, which the canvas cannot see either. So any alpha below 1,
 * in any of these syntaxes, is `undefined` — `#0000` is not a dark ground — and
 * so is an alpha this cannot read.
 */
function groundLuminance(text: string): number | undefined {
  if (alphaOf(text) !== 1) return undefined;
  const rgb = parseColor(text);
  if (rgb !== undefined) return relativeLuminance(rgb);
  const call = colourFunction(text);
  if (call === undefined) return undefined;
  const [first, second, third] = call.components;
  if (call.name === "oklch") {
    // L is a number in 0–1, or a percentage.
    const lightness = fractionOf(first, 1);
    return lightness === undefined ? undefined : lightness ** 3;
  }
  // Hue as a number, in degrees if it says so; saturation and lightness as
  // percentages, or the bare numbers CSS Color 4 also accepts for them.
  const hue = numericOf(first?.replace(/deg$/i, ""));
  const saturation = fractionOf(second, 100);
  const lightness = fractionOf(third, 100);
  if (
    hue === undefined ||
    hue.percent ||
    saturation === undefined ||
    lightness === undefined
  ) {
    return undefined;
  }
  return relativeLuminance(hslToRgb(hue.value, saturation, lightness));
}

/** An HSL colour as 0–255 channels, by the CSS Color 4 conversion. */
function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const h = ((hue % 360) + 360) % 360;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number): number => {
    const k = (n + h / 30) % 12;
    return Math.round(
      (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255
    );
  };
  return { r: channel(0), g: channel(8), b: channel(4), a: 1 };
}

/** Whether an event started inside editor chrome rather than inside the page. */

/**
 * The alpha of a computed colour written as a function this module's colour
 * reader does not otherwise read — `color(display-p3 0 0 0 / 0.5)`, which a
 * browser can keep in a computed value — from its `/ alpha` part, 1 without
 * one; `undefined` for anything that is not a colour function.
 */
export function computedAlphaOf(text: string): number | undefined {
  const call = /^[a-z-]+\(([^()]*)\)$/i.exec(text);
  if (call === null) return undefined;
  const alpha = (call[1] ?? "").split("/")[1];
  return alpha === undefined ? 1 : fractionOf(alpha.trim(), 1);
}

/**
 * A background colour's channels and alpha, for compositing: the `rgb()` a
 * browser computes for most colours, or an `hsl()`. `undefined` for a colour
 * this module cannot turn into channels, such as `oklch()`.
 */
function channelsOf(text: string): Rgb | undefined {
  const rgb = parseColor(text);
  if (rgb !== undefined) return rgb;
  const call = colourFunction(text);
  if (call?.name !== "hsl") return undefined;
  const [first, second, third] = call.components;
  const hue = numericOf(first?.replace(/deg$/i, ""));
  const saturation = fractionOf(second, 100);
  const lightness = fractionOf(third, 100);
  const alpha = call.alpha === undefined ? 1 : fractionOf(call.alpha, 1);
  if (
    hue === undefined ||
    hue.percent ||
    saturation === undefined ||
    lightness === undefined ||
    alpha === undefined
  ) {
    return undefined;
  }
  return { ...hslToRgb(hue.value, saturation, lightness), a: alpha };
}

/**
 * The colour seen where translucent layers are painted over an opaque ground,
 * each over what lies beneath it. `layers` runs innermost first, as they are
 * met walking outwards from the canvas root, so it is applied in reverse:
 * paint order, the outermost ancestor's first.
 */
function composited(ground: Rgb, layers: readonly Rgb[]): Rgb {
  let seen = ground;
  for (const layer of [...layers].reverse()) {
    const over = (top: number, under: number): number =>
      layer.a * top + (1 - layer.a) * under;
    seen = {
      r: over(layer.r, seen.r),
      g: over(layer.g, seen.g),
      b: over(layer.b, seen.b),
      a: 1,
    };
  }
  return seen;
}

/** The scheme an opaque colour reads as. */
function schemeOfColour(rgb: Rgb): "dark" | "light" {
  return relativeLuminance(rgb) < DARK_GROUND_LUMINANCE ? "dark" : "light";
}

/**
 * The document's own canvas where nothing paints a ground: white in the light
 * scheme, and the near-black a browser paints in the dark one.
 */
const CANVAS_COLOURS: Readonly<Record<"dark" | "light", Rgb>> = {
  light: { r: 255, g: 255, b: 255, a: 1 },
  dark: { r: 18, g: 18, b: 18, a: 1 },
};

/**
 * The scheme the page beneath the editor's marks is drawn in, from the colour
 * it actually paints.
 *
 * Read from the first ancestor, from the canvas root outwards, that paints an
 * opaque background, with every translucent background painted over it on
 * the way composited in paint order, because that is the ground the marks are
 * seen against: a heavy tint over a white page is a dark ground. Not from
 * `color-scheme`: a site that offers a dark set declares `light dark` whatever
 * the page in front of the author is showing, so the declaration says which
 * schemes are possible, not which one is drawn. Only where nothing paints an
 * opaque ground does the document's own canvas show, and that follows the
 * scheme the browser uses for it.
 */
export function pageSchemeOf(root: HTMLElement): "dark" | "light" {
  const view = root.ownerDocument.defaultView;
  if (view === null) return "light";
  const { layers, opaque } = paintedBeneath(root, view);
  if (opaque !== null) return schemeOver(opaque, layers);
  const canvas = canvasSchemeOf(root.ownerDocument, view);
  return layers.length === 0
    ? canvas
    : schemeOfColour(composited(CANVAS_COLOURS[canvas], layers));
}

/**
 * What is painted from the canvas root outwards: the translucent backgrounds
 * met, innermost first, and the first opaque one beneath them, or `null` when
 * none is reached or its colour cannot be read.
 */
function paintedBeneath(
  root: HTMLElement,
  view: Window
): { layers: Rgb[]; opaque: string | null } {
  const layers: Rgb[] = [];
  for (let at: Element | null = root; at !== null; at = at.parentElement) {
    const colour = view.getComputedStyle(at).backgroundColor.trim();
    const alpha = alphaOf(colour) ?? computedAlphaOf(colour);
    if (alpha === 1) {
      return {
        layers,
        opaque: groundLuminance(colour) === undefined ? null : colour,
      };
    }
    // A layer that cannot be read as channels is left out: the ground
    // beneath it still decides, as it did before any layer was counted.
    const channels =
      alpha === undefined || alpha === 0 ? undefined : channelsOf(colour);
    if (channels !== undefined) layers.push(channels);
  }
  return { layers, opaque: null };
}

/**
 * The scheme of an opaque ground with translucent layers over it; by the
 * ground alone where it cannot be read as channels (`oklch()`).
 */
function schemeOver(opaque: string, layers: readonly Rgb[]): "dark" | "light" {
  const ground = channelsOf(opaque);
  if (ground === undefined || layers.length === 0) {
    return isDarkGround(opaque) ? "dark" : "light";
  }
  return schemeOfColour(composited(ground, layers));
}

/** The scheme the browser paints a document's own canvas in. */
function canvasSchemeOf(document: Document, view: Window): "dark" | "light" {
  const declared = view.getComputedStyle(document.documentElement).colorScheme;
  if (!declared.includes("dark")) return "light";
  if (!declared.includes("light")) return "dark";
  return view.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
