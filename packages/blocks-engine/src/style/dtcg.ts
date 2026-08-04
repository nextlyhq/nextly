/**
 * Site tokens as a DTCG file, and back.
 *
 * The Design Tokens Community Group format is what Figma, Style Dictionary and
 * Tokens Studio read and write, so this is the door a site's tokens leave and
 * arrive through. The token KINDS were chosen as a subset of DTCG's `$type`
 * vocabulary for exactly this reason: the mapping is a projection rather than a
 * translation.
 *
 * ## A dot-path name is a PATH, not a name
 *
 * DTCG reserves the period: "the following characters MUST NOT be used anywhere
 * in a token or group name: `{`, `}`, `.`". So `color.primary` is not a DTCG
 * name at all — it is the token `primary` inside the group `color`. Export
 * nests, import flattens, and because the spec forbids a period inside a name
 * the two directions cannot disagree about where a path divides.
 *
 * ## Most DTCG values are objects now
 *
 * A dimension is `{"value": 16, "unit": "px"}` and only `px` or `rem` are
 * allowed; a duration is the same shape; a colour is
 * `{"colorSpace", "components", "alpha?", "hex?"}` and a bare hex string is no
 * longer valid on its own. That has a consequence worth stating plainly rather
 * than discovering later: a token holding `1.5em`, `100%`, `clamp(...)` or a
 * `var()` reference **cannot be written as a conformant DTCG value at all**.
 *
 * So the export carries two things for every token it can: the native DTCG
 * value, for the tools this exists to talk to, and the exact CSS under this
 * vendor's `$extensions` key. Import prefers the extension when it is there,
 * which makes a Nextly-to-Nextly round trip exact, and falls back to converting
 * the native value, which makes a file from Figma import correctly. A token
 * with no representable value is reported rather than emitted with a shape that
 * would be a lie about what it holds.
 *
 * Foreign extension data is carried in both directions untouched, because the
 * format requires it: "Tools that process design token files MUST preserve any
 * extension data they do not themselves understand."
 *
 * @module style/dtcg
 */
import type { ValidationIssue } from "../validation";

import type { TokenKind } from "./catalog-types";
import type { SiteToken, SiteTokenSet } from "./site-tokens";
import { isTokenName } from "./site-tokens";

/** The key this vendor's data lives under, in the notation the format asks for. */
export const NEXTLY_EXTENSION = "com.nextlyhq.nextly";

/** What this writes under its own extension key. */
interface NextlyExtension {
  /** The exact CSS per mode, which is what makes a round trip exact. */
  css: { light: string; dark?: string };
  kind: TokenKind;
}

/** A DTCG group or token; the format is a tree of plain JSON. */
export type DtcgNode = { [key: string]: unknown };

/** The `$type` each kind projects onto, or `undefined` where DTCG has none. */
const DTCG_TYPE: Partial<Record<TokenKind, string>> = {
  color: "color",
  dimension: "dimension",
  fontFamily: "fontFamily",
  fontWeight: "fontWeight",
  number: "number",
  duration: "duration",
  shadow: "shadow",
};

/** The kinds a `$type` projects back onto. */
const KIND_BY_TYPE = new Map<string, TokenKind>(
  Object.entries(DTCG_TYPE).map(([kind, type]) => [type, kind as TokenKind])
);

function issue(message: string): ValidationIssue {
  return {
    path: "siteTokens",
    code: "invalid-style-value",
    severity: "warning",
    message,
  };
}

/* ------------------------------------------------------------------ export */

/**
 * A site's tokens as a DTCG document, with what could not be represented.
 *
 * Reported rather than dropped in silence: a designer handed a file with three
 * tokens missing has no way to know, and the ones that go missing are the
 * interesting ones — the `clamp()` that took an afternoon to get right.
 */
export function tokensToDtcg(set: SiteTokenSet): {
  document: DtcgNode;
  issues: ValidationIssue[];
} {
  const document: DtcgNode = {};
  const issues: ValidationIssue[] = [];

  for (const token of set.tokens) {
    if (!isTokenName(token.name)) {
      issues.push(
        issue(`"${token.name}" is not a token name, so it was not exported.`)
      );
      continue;
    }

    const type = DTCG_TYPE[token.kind];
    const value = type === undefined ? undefined : toDtcgValue(token);
    if (type === undefined || value === undefined) {
      issues.push(
        issue(
          `"${token.name}" holds a value the design-token format cannot express, so it was not exported. Its value is still here in Nextly.`
        )
      );
      continue;
    }

    const extension: NextlyExtension = {
      css:
        token.values.dark === undefined
          ? { light: token.values.light }
          : { light: token.values.light, dark: token.values.dark },
      kind: token.kind,
    };
    const entry: DtcgNode = {
      $type: type,
      $value: value,
      $extensions: {
        ...(token.extensions ?? {}),
        [NEXTLY_EXTENSION]: extension,
      },
    };
    if (token.description !== undefined) entry.$description = token.description;

    place(document, token.name.split("."), entry, issues);
  }

  return { document, issues };
}

/** Put a token at its path, creating the groups it passes through. */
function place(
  root: DtcgNode,
  path: string[],
  entry: DtcgNode,
  issues: ValidationIssue[]
): void {
  let node = root;
  for (let index = 0; index < path.length - 1; index++) {
    const segment = path[index] ?? "";
    const existing = node[segment];
    if (existing === undefined) {
      const group: DtcgNode = {};
      node[segment] = group;
      node = group;
      continue;
    }
    if (!isPlainObject(existing) || "$value" in existing) {
      // A token and a group cannot share a path: `color.primary` and
      // `color.primary.hover` ask for `primary` to be both.
      issues.push(
        issue(
          `"${path.join(".")}" cannot be exported, because "${path.slice(0, index + 1).join(".")}" is already a token.`
        )
      );
      return;
    }
    node = existing;
  }
  const leaf = path[path.length - 1] ?? "";
  if (node[leaf] !== undefined) {
    issues.push(issue(`"${path.join(".")}" is exported more than once.`));
    return;
  }
  node[leaf] = entry;
}

/** A token's light value in the shape its `$type` requires, or `undefined`. */
function toDtcgValue(token: SiteToken): unknown {
  const css = token.values.light.trim();
  switch (token.kind) {
    case "color":
      return colorToDtcg(css);
    case "dimension":
      return measureToDtcg(css, ["px", "rem"]);
    case "duration":
      return measureToDtcg(css, ["ms", "s"]);
    case "fontFamily":
      return familyToDtcg(css);
    case "fontWeight":
      return weightToDtcg(css);
    case "number": {
      const value = Number.parseFloat(css);
      return Number.isFinite(value) && String(value) === css
        ? value
        : undefined;
    }
    // A CSS shadow is a list of lengths and a colour in an order DTCG models as
    // named fields. Converting it means parsing the shorthand, which is the
    // kind of guessing this file exists to avoid; the extension carries it.
    case "shadow":
      return undefined;
    default:
      return undefined;
  }
}

/** `16px` as `{value, unit}`, when the unit is one the format allows. */
function measureToDtcg(
  css: string,
  units: readonly string[]
): { value: number; unit: string } | undefined {
  const match = /^(-?\d*\.?\d+)([a-z]+)$/i.exec(css);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1] ?? "");
  const unit = (match[2] ?? "").toLowerCase();
  if (!Number.isFinite(value) || !units.includes(unit)) return undefined;
  return { value, unit };
}

/** A hex or `rgb()` colour in the format's object form. */
function colorToDtcg(css: string): DtcgNode | undefined {
  const rgb = parseSimpleColor(css);
  if (rgb === undefined) return undefined;
  const component = (value: number): number =>
    Math.round((value / 255) * 10000) / 10000;
  const node: DtcgNode = {
    colorSpace: "srgb",
    components: [component(rgb.r), component(rgb.g), component(rgb.b)],
    hex: toHex(rgb),
  };
  if (rgb.a < 1) node.alpha = rgb.a;
  return node;
}

/** A family list as one string or an array, which is what the format takes. */
function familyToDtcg(css: string): string | string[] | undefined {
  const parts = css
    .split(",")
    .map(part => part.trim().replace(/^["']|["']$/g, ""))
    .filter(part => part !== "");
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : parts;
}

/** A weight as a number, or one of the two keywords the format names. */
function weightToDtcg(css: string): number | string | undefined {
  const numeric = Number.parseInt(css, 10);
  if (Number.isFinite(numeric) && String(numeric) === css) return numeric;
  const keyword = css.toLowerCase();
  return keyword === "normal" || keyword === "bold" ? keyword : undefined;
}

/* ------------------------------------------------------------------ import */

/**
 * The tokens a DTCG document describes.
 *
 * Everything it cannot read is reported rather than guessed at, because a token
 * imported with the wrong value is worse than one that did not arrive: the site
 * renders, and nobody looks again.
 */
export function dtcgToTokens(input: unknown): {
  tokens: SiteToken[];
  issues: ValidationIssue[];
} {
  const tokens: SiteToken[] = [];
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(input)) {
    return {
      tokens,
      issues: [issue("The file is not a design-token document.")],
    };
  }
  read(input, [], undefined, tokens, issues);
  return { tokens, issues };
}

/** Walk a group, carrying the `$type` its children inherit. */
function read(
  node: DtcgNode,
  path: string[],
  inherited: string | undefined,
  tokens: SiteToken[],
  issues: ValidationIssue[]
): void {
  const groupType = typeof node.$type === "string" ? node.$type : inherited;

  for (const [key, child] of Object.entries(node)) {
    // `$`-prefixed keys are the format's own; a name may not begin with one.
    if (key.startsWith("$")) continue;
    if (!isPlainObject(child)) continue;
    const here = [...path, key];

    if ("$value" in child) {
      const token = readToken(child, here, groupType, issues);
      if (token !== undefined) tokens.push(token);
      continue;
    }
    read(child, here, groupType, tokens, issues);
  }
}

/** One token, preferring this vendor's exact CSS over a conversion. */
function readToken(
  node: DtcgNode,
  path: string[],
  inherited: string | undefined,
  issues: ValidationIssue[]
): SiteToken | undefined {
  const name = path.join(".");
  if (!isTokenName(name)) {
    issues.push(
      issue(`"${name}" is not a usable token name, so it was skipped.`)
    );
    return undefined;
  }

  const extensions = isPlainObject(node.$extensions)
    ? { ...node.$extensions }
    : {};
  const own = extensions[NEXTLY_EXTENSION];
  // Carried, not consumed: everything except this vendor's own key goes back
  // out with the token, which is what the format requires of any tool.
  delete extensions[NEXTLY_EXTENSION];

  const description =
    typeof node.$description === "string" ? node.$description : undefined;
  const carried = Object.keys(extensions).length > 0 ? extensions : undefined;

  // The exact CSS this system wrote, when the file came from here. Read field
  // by field rather than asserted: the extension is arbitrary JSON from a file,
  // and a cast would be this function agreeing to whatever shape it found.
  if (isPlainObject(own)) {
    const css = own.css;
    const kind = own.kind;
    if (isPlainObject(css) && typeof css.light === "string" && isKind(kind)) {
      const dark = css.dark;
      return {
        name,
        kind,
        values:
          typeof dark === "string"
            ? { light: css.light, dark }
            : { light: css.light },
        ...(description !== undefined ? { description } : {}),
        ...(carried !== undefined ? { extensions: carried } : {}),
      };
    }
  }

  const type = typeof node.$type === "string" ? node.$type : inherited;
  const kind = type === undefined ? undefined : KIND_BY_TYPE.get(type);
  if (kind === undefined) {
    issues.push(
      issue(
        `"${name}" has the type "${type ?? "none"}", which this site has no token kind for, so it was skipped.`
      )
    );
    return undefined;
  }

  const light = fromDtcgValue(node.$value, kind);
  if (light === undefined) {
    issues.push(
      issue(`"${name}" has a value that could not be read, so it was skipped.`)
    );
    return undefined;
  }

  return {
    name,
    kind,
    values: { light },
    ...(description !== undefined ? { description } : {}),
    ...(carried !== undefined ? { extensions: carried } : {}),
  };
}

/** Whether a value is one of this system's token kinds. */
function isKind(value: unknown): value is TokenKind {
  return typeof value === "string" && Object.hasOwn(DTCG_TYPE, value);
}

/** A DTCG value as the CSS this system stores, or `undefined`. */
function fromDtcgValue(value: unknown, kind: TokenKind): string | undefined {
  switch (kind) {
    case "color":
      return colorFromDtcg(value);
    case "dimension":
    case "duration": {
      if (!isPlainObject(value)) return undefined;
      const amount = value.value;
      const unit = value.unit;
      if (typeof amount !== "number" || typeof unit !== "string") {
        return undefined;
      }
      return `${amount}${unit}`;
    }
    case "fontFamily":
      if (typeof value === "string") return value;
      if (Array.isArray(value) && value.every(v => typeof v === "string")) {
        return value
          .map(part => (/\s/.test(part) ? `"${part}"` : part))
          .join(", ");
      }
      return undefined;
    case "fontWeight":
      if (typeof value === "number") return String(value);
      return typeof value === "string" ? value : undefined;
    case "number":
      return typeof value === "number" ? String(value) : undefined;
    default:
      return undefined;
  }
}

/**
 * A DTCG colour as CSS.
 *
 * The `hex` fallback is preferred where the file supplies one, because it is
 * exactly what the format says it is for and it round-trips byte for byte.
 * Otherwise the components are written as `rgb()`, which every browser reads —
 * `color(srgb …)` is newer and this is a value that has to render.
 */
function colorFromDtcg(value: unknown): string | undefined {
  if (!isPlainObject(value)) return undefined;
  if (typeof value.hex === "string" && /^#[0-9a-f]{6}$/i.test(value.hex)) {
    return value.hex;
  }
  const components = value.components;
  if (!Array.isArray(components) || components.length < 3) return undefined;
  if (value.colorSpace !== "srgb") return undefined;
  const channels = components.slice(0, 3);
  if (!channels.every(part => typeof part === "number")) return undefined;
  const [r, g, b] = channels.map(part =>
    Math.round(Math.min(1, Math.max(0, part)) * 255)
  );
  const alpha = typeof value.alpha === "number" ? value.alpha : 1;
  return alpha < 1 ? `rgb(${r} ${g} ${b} / ${alpha})` : `rgb(${r} ${g} ${b})`;
}

/* ------------------------------------------------------------------ shared */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Hex and `rgb()` only — the same two forms the contrast utility reads. */
function parseSimpleColor(
  css: string
): { r: number; g: number; b: number; a: number } | undefined {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(css);
  if (short) {
    const [, r, g, b] = short;
    return {
      r: Number.parseInt(`${r}${r}`, 16),
      g: Number.parseInt(`${g}${g}`, 16),
      b: Number.parseInt(`${b}${b}`, 16),
      a: 1,
    };
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css);
  if (long) {
    const [, r, g, b] = long;
    return {
      r: Number.parseInt(r ?? "0", 16),
      g: Number.parseInt(g ?? "0", 16),
      b: Number.parseInt(b ?? "0", 16),
      a: 1,
    };
  }
  const fn = /^rgba?\(([^)]*)\)$/i.exec(css);
  if (!fn) return undefined;
  const parts = (fn[1] ?? "")
    .replace(/\//g, " ")
    .split(/[\s,]+/)
    .filter(part => part !== "");
  if (parts.length < 3) return undefined;
  const [r, g, b] = parts.slice(0, 3).map(part => Number.parseFloat(part));
  if ([r, g, b].some(part => part === undefined || !Number.isFinite(part))) {
    return undefined;
  }
  const alpha = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
  return {
    r: r,
    g: g,
    b: b,
    a: Number.isFinite(alpha) ? alpha : 1,
  };
}

function toHex(rgb: { r: number; g: number; b: number }): string {
  const part = (value: number): string =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}
