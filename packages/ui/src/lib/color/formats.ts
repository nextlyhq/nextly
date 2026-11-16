/**
 * The three notations an author types or pastes a colour in: hex, `rgb()` and
 * `hsl()`. Read here into one colour, and written back in whichever of them
 * the picker's fields show.
 *
 * Beside `hex.ts` for the reason it gives: reading a colour is arithmetic on a
 * string, and nothing about it needs React.
 *
 * @module lib/color/formats
 */
import type { Rgb } from "./convert";
import { parseHex, toHex, type Rgba } from "./hex";

/** The notations the picker's fields can show a colour in. */
export type ColourFormat = "hex" | "rgb" | "hsl";

/** Hue in [0, 360), saturation and lightness in [0, 1]. */
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** A CSS number, optionally signed, with an optional fraction and exponent. */
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** A number and the unit written after it: `50%`, `120deg`, `0.5`. */
const NUMBER_AND_UNIT = /^(.*?)(%|[a-z]*)$/i;

/** One component as written: its number, and the unit after it, if any. */
function numberAndUnit(text: string): { value: number; unit: string } | null {
  const [, digits = "", unit = ""] = NUMBER_AND_UNIT.exec(text) ?? [];
  if (!NUMBER.test(digits)) return null;
  return { value: Number(digits), unit: unit.toLowerCase() };
}

/** A percentage as [0, 1], or a bare number divided by `whole`. */
function fractionOf(text: string | undefined, whole: number): number | null {
  if (text === undefined) return null;
  const part = numberAndUnit(text);
  if (part === null) return null;
  if (part.unit === "%") return clamp01(part.value / 100);
  return part.unit === "" ? clamp01(part.value / whole) : null;
}

/** Degrees in one of each angle unit CSS takes for a hue. */
const DEGREES: Readonly<Record<string, number>> = {
  "": 1,
  deg: 1,
  grad: 360 / 400,
  rad: 180 / Math.PI,
  turn: 360,
};

/** A hue, a bare number of degrees or an angle, as [0, 360). */
function hueOf(text: string): number | null {
  const part = numberAndUnit(text);
  const scale = part === null ? undefined : DEGREES[part.unit];
  if (part === null || scale === undefined) return null;
  const degrees = (part.value * scale) % 360;
  return degrees < 0 ? degrees + 360 : degrees;
}

/** What a colour function holds between its brackets. */
interface Components {
  channels: string[];
  alpha: string | undefined;
}

/** Every component separated by commas: `rgb(255, 0, 0, 0.5)`. */
function commaComponents(body: string): Components | null {
  if (body.includes("/")) return null;
  const parts = body.split(",").map(part => part.trim());
  if (parts.length !== 3 && parts.length !== 4) return null;
  return { channels: parts.slice(0, 3), alpha: parts[3] };
}

/** Channels separated by spaces, the alpha after a slash: `rgb(255 0 0 / 50%)`. */
function spaceComponents(body: string): Components | null {
  const [channelText = "", alpha, extra] = body.split("/");
  if (extra !== undefined || alpha?.trim() === "") return null;
  const channels = channelText.trim().split(/\s+/);
  return channels.length === 3 ? { channels, alpha: alpha?.trim() } : null;
}

/**
 * The components of a colour function, or `null` when its punctuation is
 * neither of the two grammars CSS has. The two are never mixed: `rgb(0 0 0
 * 0.5)` and `rgb(0, 0, 0 / 1)` are no colour to a browser, so none here.
 */
function componentsOf(body: string): Components | null {
  return body.includes(",") ? commaComponents(body) : spaceComponents(body);
}

/** A colour function, as its name and the text between its brackets. */
const FUNCTION = /^(rgba?|hsla?)\(\s*([^()]*?)\s*\)$/i;

function readRgb([r, g, b]: string[], alpha: number): Rgba | null {
  const red = fractionOf(r, 255);
  const green = fractionOf(g, 255);
  const blue = fractionOf(b, 255);
  if (red === null || green === null || blue === null) return null;
  return { r: red, g: green, b: blue, alpha };
}

function readHsl([hue = "", sat, light]: string[], alpha: number): Rgba | null {
  const h = hueOf(hue);
  // Saturation and lightness are percentages; a bare number is read as one,
  // as the space-separated syntax allows.
  const s = fractionOf(sat, 100);
  const l = fractionOf(light, 100);
  if (h === null || s === null || l === null) return null;
  return { ...hslToRgb({ h, s, l }), alpha };
}

/** `rgb()`, `rgba()`, `hsl()` or `hsla()`, or `null` for anything else. */
function parseFunction(text: string): Rgba | null {
  const [, name = "", body = ""] = FUNCTION.exec(text) ?? [];
  const parts = name === "" ? null : componentsOf(body);
  if (parts === null) return null;
  const alpha = parts.alpha === undefined ? 1 : fractionOf(parts.alpha, 1);
  if (alpha === null) return null;
  return name.toLowerCase().startsWith("rgb")
    ? readRgb(parts.channels, alpha)
    : readHsl(parts.channels, alpha);
}

/**
 * Read a colour typed or pasted as hex (3, 4, 6 or 8 digits), `rgb()`/`rgba()`
 * or `hsl()`/`hsla()`, in either the comma or the space syntax, or `null` if
 * the text is none of them yet.
 *
 * `null` rather than a guess, as `parseHex` answers: a field someone is typing
 * into holds "not a colour yet" most of the time. Components out of range are
 * clamped, as a browser clamps them.
 *
 * @experimental
 */
export function parseColour(input: string): Rgba | null {
  const text = input.trim();
  return parseHex(text) ?? parseFunction(text);
}

/** Which sixth of the hue circle a colour sits in, from its largest channel. */
function hueSector({ r, g, b }: Rgb, max: number, d: number): number {
  if (max === r) return ((g - b) / d + 6) % 6;
  if (max === g) return (b - r) / d + 2;
  return (r - g) / d + 4;
}

/** sRGB channels in [0, 1] as hue, saturation and lightness. */
export function rgbToHsl(color: Rgb): Hsl {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  return { h: hueSector(color, max, d) * 60, s, l };
}

/** Hue, saturation and lightness as sRGB channels in [0, 1]. */
export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: f(0), g: f(8), b: f(4) };
}

/** ` / 0.5` for a translucent colour, nothing for an opaque one. */
function alphaSuffix(alpha: number): string {
  const opacity = Number.isFinite(alpha) ? clamp01(alpha) : 1;
  return opacity === 1 ? "" : ` / ${Math.round(opacity * 100) / 100}`;
}

/** A channel in [0, 1] as the 0-255 `rgb()` writes. */
const byte = (channel: number): number =>
  Math.round(clamp01(Number.isFinite(channel) ? channel : 0) * 255);

/** A fraction as a whole percentage. */
const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

/** `hsl()` for a colour, read from its bytes so it names what hex would. */
function hslText(color: Rgb, alpha: number): string {
  const { h, s, l } = rgbToHsl({
    r: byte(color.r) / 255,
    g: byte(color.g) / 255,
    b: byte(color.b) / 255,
  });
  return `hsl(${Math.round(h) % 360} ${percent(s)} ${percent(l)}${alphaSuffix(alpha)})`;
}

/**
 * Write a colour in one of the three notations: hex as `toHex` writes it, and
 * the functions in the space-separated syntax, with the alpha after a slash
 * only when the colour is not opaque.
 *
 * @experimental
 */
export function formatColour(
  color: Rgb,
  alpha: number,
  format: ColourFormat
): string {
  if (format === "hex") return toHex(color, alpha);
  if (format === "hsl") return hslText(color, alpha);
  return `rgb(${byte(color.r)} ${byte(color.g)} ${byte(color.b)}${alphaSuffix(alpha)})`;
}
