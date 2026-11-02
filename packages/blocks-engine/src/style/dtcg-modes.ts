/**
 * Light and dark across design-token files.
 *
 * A token file holds one value per token, so a second mode needs a second
 * place. Two shapes are written and read here:
 *
 * - **The theme file**, the DTCG Resolver format (2025.10): a `.resolver.json`
 *   that names the token file as its base set and adds a `theme` modifier with
 *   `light` and `dark` contexts. The dark context carries only the dark values,
 *   inline, so an export is two files rather than three.
 * - **One file per mode**, which is how Figma imports and exports variables:
 *   every token in every file with the same type, colours as sRGB with a hex,
 *   dimensions in px and a single font family per token.
 *
 * Both read through {@link dtcgToTokens}, so aliases are resolved and anything
 * this site cannot hold is reported the same way as for a single file.
 *
 * @module style/dtcg-modes
 */
import type { ValidationIssue } from "../validation";

import { parseColor } from "./contrast";
import {
  dtcgToTokens,
  exportNamingRefusal,
  readFamilyList,
  tokensToDtcg,
  type DtcgNode,
} from "./dtcg";
import type { SiteToken, SiteTokenSet, TokenMode } from "./site-tokens";

/** The Resolver format version a theme file declares. */
export const RESOLVER_VERSION = "2025.10";

/** The modifier a theme file switches light and dark with. */
const THEME_MODIFIER = "theme";

function issue(message: string): ValidationIssue {
  return {
    path: "siteTokens",
    code: "invalid-style-value",
    severity: "warning",
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* --------------------------------------------------------------- theme file */

/**
 * The theme file for a set: the token file as the base, and the dark values
 * as the `dark` context of a `theme` modifier.
 *
 * `source` is the file name the token file is saved under, which the theme
 * file refers to. A set with no dark values still gets a theme, with an empty
 * dark context, so a reader always finds the same shape.
 */
export function tokensToResolver(
  set: SiteTokenSet,
  source: string
): { resolver: DtcgNode; issues: ValidationIssue[] } {
  const darkTokens: SiteToken[] = [];
  for (const token of set.tokens) {
    if (token.values.dark === undefined) continue;
    darkTokens.push({
      name: token.name,
      kind: token.kind,
      values: { light: token.values.dark },
    });
  }
  const dark = tokensToDtcg({ tokens: darkTokens });
  stripExtensions(dark.document);
  return {
    resolver: {
      version: RESOLVER_VERSION,
      sets: { base: { sources: [{ $ref: source }] } },
      modifiers: {
        [THEME_MODIFIER]: {
          contexts: {
            light: [],
            dark:
              Object.keys(dark.document).length === 0 ? [] : [dark.document],
          },
          default: "light",
        },
      },
      resolutionOrder: [
        { $ref: "#/sets/base" },
        { $ref: `#/modifiers/${THEME_MODIFIER}` },
      ],
    },
    issues: dark.issues,
  };
}

/**
 * The tokens a theme file describes, with light and dark values.
 *
 * `files` holds the other files chosen with it, by file name, for the sources
 * it refers to. The modifier read for modes is the first whose contexts
 * include `dark`; its `light` context (or its default) gives the light values.
 */
export function resolverToTokens(
  resolver: unknown,
  files: ReadonlyMap<string, unknown>
): { tokens: SiteToken[]; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (!isRecord(resolver) || typeof resolver.version !== "string") {
    return {
      tokens: [],
      issues: [issue("The theme file does not say which version it follows.")],
    };
  }
  const base = mergeSources(baseSources(resolver), files, issues);
  const modes = themeContexts(resolver);
  const light = mergeTrees(base, mergeSources(modes.light, files, issues));
  const dark =
    modes.dark === undefined
      ? undefined
      : mergeTrees(base, mergeSources(modes.dark, files, issues));
  const read = combineModes(light, dark);
  return { tokens: read.tokens, issues: [...issues, ...read.issues] };
}

/** The sources of every set, in the order the theme file resolves them. */
function baseSources(resolver: Record<string, unknown>): unknown[] {
  const sets = isRecord(resolver.sets) ? resolver.sets : {};
  const order = Array.isArray(resolver.resolutionOrder)
    ? resolver.resolutionOrder
    : Object.keys(sets).map(name => ({ $ref: `#/sets/${name}` }));
  const sources: unknown[] = [];
  for (const step of order) {
    const ref = isRecord(step) ? step.$ref : undefined;
    if (typeof ref !== "string" || !ref.startsWith("#/sets/")) continue;
    const set = sets[ref.slice("#/sets/".length)];
    if (isRecord(set) && Array.isArray(set.sources))
      sources.push(...set.sources);
  }
  return sources;
}

/** The light and dark sources of the modifier that switches modes. */
function themeContexts(resolver: Record<string, unknown>): {
  light: unknown[];
  dark: unknown[] | undefined;
} {
  const modifiers = isRecord(resolver.modifiers) ? resolver.modifiers : {};
  for (const modifier of Object.values(modifiers)) {
    if (!isRecord(modifier) || !isRecord(modifier.contexts)) continue;
    const contexts = modifier.contexts;
    if (!Array.isArray(contexts.dark)) continue;
    const lightName =
      typeof modifier.default === "string" && modifier.default !== "dark"
        ? modifier.default
        : "light";
    const light = contexts[lightName];
    return { light: Array.isArray(light) ? light : [], dark: contexts.dark };
  }
  return { light: [], dark: undefined };
}

/** Sources merged in order: an inline group, or a `$ref` to a chosen file. */
function mergeSources(
  sources: readonly unknown[],
  files: ReadonlyMap<string, unknown>,
  issues: ValidationIssue[]
): DtcgNode {
  let tree: DtcgNode = {};
  for (const source of sources) {
    if (!isRecord(source)) continue;
    const ref = source.$ref;
    if (typeof ref !== "string") {
      tree = mergeTrees(tree, source);
      continue;
    }
    const file = files.get(fileNameOf(ref));
    if (!isRecord(file)) {
      issues.push(
        issue(
          `The theme file uses "${ref}", which was not among the files chosen, so its tokens were not read. Choose it together with the theme file.`
        )
      );
      continue;
    }
    tree = mergeTrees(tree, file);
  }
  return tree;
}

/** The last segment of a path or URL, which is how a chosen file is named. */
function fileNameOf(ref: string): string {
  return ref.split(/[\\/]/).at(-1) ?? ref;
}

/**
 * Two token trees as one, the second winning: a group merges into a group,
 * and anything else (a token, a value) replaces what was there.
 */
function mergeTrees(base: DtcgNode, over: DtcgNode): DtcgNode {
  const entries = new Map<string, unknown>(Object.entries(base));
  for (const [key, value] of Object.entries(over)) {
    const held = entries.get(key);
    entries.set(
      key,
      isGroup(held) && isGroup(value) ? mergeTrees(held, value) : value
    );
  }
  return Object.fromEntries(entries);
}

function isGroup(value: unknown): value is DtcgNode {
  return isRecord(value) && !("$value" in value);
}

/* ------------------------------------------------------- one file per mode */

/** One chosen file, already parsed. */
export interface ModeFile {
  readonly name: string;
  readonly document: unknown;
}

/**
 * Tokens from one file per mode, as Figma writes them.
 *
 * The mode is read from the file name ("Light.tokens.json",
 * "dark.tokens.json"). Where neither name says, the first file is light and
 * the second dark; where only one does, the other is reported and not read.
 * A single file is read as light.
 */
export function modeFilesToTokens(files: readonly ModeFile[]): {
  tokens: SiteToken[];
  issues: ValidationIssue[];
} {
  // Two modes, so two files at most. Reading two of a larger choice would
  // drop the rest without a word.
  if (files.length > 2) {
    return {
      tokens: [],
      issues: [
        issue(
          `${String(files.length)} files were chosen. Choose one file, or two: one for light and one for dark, with a theme file if there is one.`
        ),
      ],
    };
  }
  // A name saying both words says neither: which file is which cannot be
  // told, so the choice is reported rather than half read.
  const both = files.find(
    file => /light/i.test(file.name) && /dark/i.test(file.name)
  );
  if (files.length === 2 && both !== undefined) {
    return {
      tokens: [],
      issues: [
        issue(
          `${both.name} has both "light" and "dark" in its name, so which file holds which mode cannot be told and neither was read. Rename it to say one mode.`
        ),
      ],
    };
  }
  const named = (word: RegExp) => files.find(file => word.test(file.name));
  const lightNamed = named(/light/i);
  const darkNamed = named(/dark/i);
  // Two files and only one named for its mode: the other could be either, so
  // it is reported rather than guessed at or dropped without a word.
  const unclear =
    files.length === 2 &&
    (lightNamed === undefined) !== (darkNamed === undefined)
      ? files.find(file => file !== (lightNamed ?? darkNamed))
      : undefined;
  if (unclear !== undefined) {
    const said = issue(
      `${unclear.name} does not say in its name whether it is light or dark, so it was not read. Rename it with "light" or "dark" in its name and choose both again.`
    );
    if (lightNamed === undefined) return { tokens: [], issues: [said] };
    const read = combineModes(lightNamed.document, undefined);
    return { tokens: read.tokens, issues: [...read.issues, said] };
  }
  const dark = darkNamed ?? (lightNamed ? undefined : files[1]);
  const light = lightNamed ?? files.find(file => file !== dark) ?? files[0];
  if (light === undefined) return { tokens: [], issues: [] };
  return combineModes(
    light.document,
    dark === undefined || dark === light ? undefined : dark.document
  );
}

/**
 * Light tokens, each given its dark value from the dark document by name.
 *
 * A dark value equal to the light one is not stored, because a token with no
 * dark value already follows light and keeps following it when light changes.
 * A token only the dark document holds is named and skipped: every token needs
 * a light value.
 */
function combineModes(
  light: unknown,
  dark: unknown
): { tokens: SiteToken[]; issues: ValidationIssue[] } {
  const lightRead = dtcgToTokens(light);
  if (dark === undefined) return lightRead;
  const darkRead = dtcgToTokens(dark);
  const said = new Set(lightRead.issues.map(entry => entry.message));
  const issues = [
    ...lightRead.issues,
    ...darkRead.issues.filter(entry => !said.has(entry.message)),
  ];
  const darkByName = new Map(darkRead.tokens.map(token => [token.name, token]));
  const tokens = lightRead.tokens.map(token => {
    const other = darkByName.get(token.name);
    darkByName.delete(token.name);
    if (other === undefined || other.values.light === token.values.light) {
      return token;
    }
    // A dark value of another kind would make a token the site refuses to
    // save, so the pair is reported and the token keeps its light value.
    if (other.kind !== token.kind) {
      issues.push(
        issue(
          `"${token.name}" is a ${token.kind} in the light file and a ${other.kind} in the dark file, so its dark value was skipped.`
        )
      );
      return token;
    }
    return {
      ...token,
      values: { light: token.values.light, dark: other.values.light },
    };
  });
  for (const name of darkByName.keys()) {
    issues.push(
      issue(
        `"${name}" is only in the dark file, so it was skipped. Every variable needs a light value.`
      )
    );
  }
  return { tokens, issues };
}

/* ---------------------------------------------------------------- For Figma */

/** What Figma reads for one token, or why it cannot. */
type FigmaValue = { type: string; value: unknown } | { refused: string };

/**
 * One mode of a set as a file Figma can import.
 *
 * Every token appears in the files for both modes with the same type, which
 * Figma requires: a token with no dark value takes its light value in the dark
 * file. A token Figma cannot hold in either mode is left out of both, and
 * named in `issues` (the same list for both modes).
 */
export function tokensToFigma(
  set: SiteTokenSet,
  mode: TokenMode
): { document: DtcgNode; issues: ValidationIssue[] } {
  const document: DtcgNode = {};
  const issues: ValidationIssue[] = [];
  for (const token of set.tokens) {
    // The same naming verdict the DTCG export applies: a name the engine
    // refuses is a key no file should carry.
    const naming = exportNamingRefusal(
      token,
      "it was left out of the Figma files"
    );
    if (naming !== undefined) {
      issues.push(issue(naming));
      continue;
    }
    const pair = figmaPair(token);
    if ("refused" in pair) {
      issues.push(
        issue(
          `"${token.name}" ${pair.refused} It was left out of the Figma files.`
        )
      );
      continue;
    }
    const chosen = pair[mode];
    const placed = placeAt(document, token.name.split("."), {
      $type: chosen.type,
      $value: chosen.value,
    });
    if (!placed) {
      issues.push(
        issue(
          `"${token.name}" sits where another variable's group is, so it was left out of the Figma files.`
        )
      );
    }
  }
  return { document, issues };
}

/** A converted Figma value. */
type FigmaReady = { type: string; value: unknown };

/**
 * A token's value in both modes, or why Figma cannot take it. Refused when
 * either mode cannot convert, because Figma needs every token in every file.
 */
function figmaPair(
  token: SiteToken
): { light: FigmaReady; dark: FigmaReady } | { refused: string } {
  const convert = FIGMA_CONVERTERS[token.kind];
  const light = convert(token.values.light.trim());
  if ("refused" in light) return light;
  const dark = convert((token.values.dark ?? token.values.light).trim());
  if ("refused" in dark) return dark;
  return { light, dark };
}

/** A dimension in px, which is the one unit Figma's import takes. */
function figmaDimension(text: string): FigmaValue {
  const px = pixelsOf(text);
  return px === undefined
    ? { refused: "is a size Figma cannot read: it takes px and rem only." }
    : { type: "dimension", value: { value: px, unit: "px" } };
}

/** The first family of a list, since Figma takes a single family. */
function figmaFamily(text: string): FigmaValue {
  // Only a list of family names: one reading another property, or a bare
  // keyword, has no name Figma could hold.
  const reading = readFamilyList(text);
  if (reading.kind !== "families") {
    return { refused: "is not a list of font names Figma can read." };
  }
  const first = reading.parts[0]?.part.name;
  return first === undefined || first === ""
    ? { refused: "names no font family Figma can read." }
    : { type: "fontFamily", value: first };
}

function figmaWeight(text: string): FigmaValue {
  const weight = WEIGHT_WORDS[text.toLowerCase()] ?? Number(text);
  return Number.isFinite(weight)
    ? { type: "number", value: weight }
    : { refused: "is a font weight Figma cannot read." };
}

function figmaNumber(text: string): FigmaValue {
  const value = Number(text);
  return text !== "" && Number.isFinite(value)
    ? { type: "number", value }
    : { refused: "is not a plain number." };
}

/** A duration in seconds, which is the unit Figma's import takes. */
function figmaDuration(text: string): FigmaValue {
  const match = /^(-?\d*\.?\d+)(ms|s)$/.exec(text);
  if (match === null) return { refused: "is a duration Figma cannot read." };
  const amount = Number(match[1]);
  return {
    type: "duration",
    value: { value: match[2] === "ms" ? amount / 1000 : amount, unit: "s" },
  };
}

/** How each kind is written for Figma; shadows and custom values are not. */
const FIGMA_CONVERTERS: Readonly<
  Record<SiteToken["kind"], (text: string) => FigmaValue>
> = {
  color: text => figmaColour(text),
  dimension: figmaDimension,
  fontFamily: figmaFamily,
  fontWeight: figmaWeight,
  number: figmaNumber,
  duration: figmaDuration,
  shadow: () => ({
    refused: "is a shadow, which Figma variables cannot hold.",
  }),
  custom: () => ({
    refused: "is a custom value, which Figma variables cannot hold.",
  }),
};

const WEIGHT_WORDS: Readonly<Record<string, number>> = {
  normal: 400,
  bold: 700,
};

/** A colour as Figma writes one: sRGB components, alpha and a six-digit hex. */
function figmaColour(text: string): FigmaValue {
  const rgb = parseColor(text);
  if (rgb === undefined) {
    return {
      refused: "is a colour Figma cannot read: it takes hex and rgb() colours.",
    };
  }
  const hex = [rgb.r, rgb.g, rgb.b]
    .map(channel => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return {
    type: "color",
    value: {
      colorSpace: "srgb",
      components: [rgb.r / 255, rgb.g / 255, rgb.b / 255],
      alpha: rgb.a,
      hex: `#${hex}`,
    },
  };
}

/** A length in px, from px or rem (16px each), or `undefined`. */
function pixelsOf(text: string): number | undefined {
  if (text === "0") return 0;
  const match = /^(-?\d*\.?\d+)(px|rem)$/.exec(text);
  if (match === null) return undefined;
  const amount = Number(match[1]);
  return match[2] === "rem" ? amount * 16 : amount;
}

/**
 * Put a token at its path, creating groups on the way. False when a token
 * already sits where a group is needed, or the other way round.
 */
function placeAt(
  root: DtcgNode,
  path: readonly string[],
  token: DtcgNode
): boolean {
  let node = root;
  for (const segment of path.slice(0, -1)) {
    const held = Object.hasOwn(node, segment) ? node[segment] : undefined;
    if (held === undefined) {
      const group: DtcgNode = {};
      node[segment] = group;
      node = group;
    } else if (isGroup(held)) {
      node = held;
    } else {
      return false;
    }
  }
  const leaf = path.at(-1) ?? "";
  if (Object.hasOwn(node, leaf)) return false;
  node[leaf] = token;
  return true;
}

/** Remove `$extensions` from every token in a tree, in place. */
function stripExtensions(node: DtcgNode): void {
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$") || !isRecord(child)) continue;
    if ("$value" in child) delete child.$extensions;
    else stripExtensions(child);
  }
}
