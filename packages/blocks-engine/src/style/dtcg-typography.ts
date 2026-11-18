/**
 * Text styles in the design-token file, both ways.
 *
 * A text style is a named look of typography only, so it has a DTCG form:
 * a `typography` value, one object of five parts (font family, size,
 * weight, letter spacing and line height). Each part the style takes from a
 * variable is written as an alias to that variable (`{font-size.h2}`), so a
 * design tool keeps the link; a plain value is written as the format types
 * it. The format requires all five parts, so a part the style leaves unset
 * is written as the text it sits in draws it: the body font, 1rem, 400, no
 * letter spacing and a line height of 1.2.
 *
 * The values sit under a `textStyles` group at the file's root. A variable's
 * path is lower case, so no variable's name can reach that group.
 *
 * What the format has no part for (a size per device, the case, which part
 * was set) is kept with every text style exactly, as Nextly data at the
 * file's root, and that copy is what an import reads: a round trip is exact
 * whatever a design tool made of the typography value. A text style whose
 * parts the format can't type at all (a letter spacing in `em`) is kept
 * there only.
 *
 * @module style/dtcg-typography
 */
import { isTokenRef, type StyleValue } from "../document-styles";
import type { ValidationIssue } from "../validation";

import { BASE_BREAKPOINT } from "./compile-page-breakpoints";
import { type DtcgNode, isPlainObject, issue } from "./dtcg-format";
import { typedValue, type TypedValue } from "./dtcg-values";
import {
  isUsableNamedClass,
  MAX_NAMED_CLASS_NAME_LENGTH,
  type NamedClass,
} from "./named-class";
import { MAX_NAMED_CLASSES } from "../document";
import type { TokenKind } from "./catalog-types";
import { type SiteToken, tokenIdentity } from "./site-tokens";

/** The group the typography values sit under, at the file's root. */
export const TEXT_STYLES_GROUP = "textStyles";

/** A typography value's parts, the variable kind each is, and its unset value. */
const PARTS: readonly (readonly [
  part: string,
  kind: TokenKind,
  unset: (aliasOf: (identity: string) => string | undefined) => unknown,
])[] = [
  ["fontFamily", "fontFamily", aliasOf => aliasOf("font.body") ?? "system-ui"],
  ["fontSize", "dimension", () => ({ value: 1, unit: "rem" })],
  ["fontWeight", "fontWeight", () => 400],
  ["letterSpacing", "dimension", () => ({ value: 0, unit: "px" })],
  ["lineHeight", "number", () => 1.2],
];

/** The DTCG type a variable of each kind is written as, for an alias's target. */
const DTCG_TYPE_OF: Partial<Record<TokenKind, string>> = {
  fontFamily: "fontFamily",
  dimension: "dimension",
  fontWeight: "fontWeight",
  number: "number",
};

/** What the writer knows about the variables the file types. */
export interface TypographyContext {
  /** The variables the file writes as DTCG tokens, by identity. */
  readonly typed: ReadonlyMap<
    string,
    { readonly token: SiteToken; readonly typed: TypedValue }
  >;
}

/**
 * The variables a file writes as DTCG tokens, by identity, for the aliases
 * a text style's parts are written as.
 */
export function typographyContext(
  written: readonly { token: SiteToken; typed: TypedValue }[]
): TypographyContext {
  const typed = new Map<string, { token: SiteToken; typed: TypedValue }>();
  for (const entry of written) {
    const identity = tokenIdentity(entry.token);
    if (!typed.has(identity)) typed.set(identity, entry);
  }
  return { typed };
}

/**
 * A text style as a DTCG typography value, or `undefined` when a part it
 * sets has no form the format types.
 */
export function textStyleToDtcg(
  style: NamedClass,
  context: TypographyContext
): DtcgNode | undefined {
  const base = style.styles.base?.[BASE_BREAKPOINT] ?? {};
  const aliasOf = (identity: string, kind?: TokenKind): string | undefined => {
    const found = context.typed.get(identity);
    if (found === undefined) return undefined;
    if (kind !== undefined && found.typed.type !== DTCG_TYPE_OF[kind]) {
      return undefined;
    }
    return `{${found.token.name}}`;
  };
  const value: DtcgNode = {};
  for (const [part, kind, unset] of PARTS) {
    const stated = Object.hasOwn(base, part) ? base[part] : undefined;
    const written =
      stated === undefined
        ? unset(identity => aliasOf(identity, kind))
        : partToDtcg(stated, kind, aliasOf, context);
    if (written === undefined) return undefined;
    value[part] = written;
  }
  return { $type: "typography", $value: value };
}

/** One part a style sets, as the format writes it, or `undefined`. */
function partToDtcg(
  stated: StyleValue,
  kind: TokenKind,
  aliasOf: (identity: string, kind?: TokenKind) => string | undefined,
  context: TypographyContext
): unknown {
  if (isTokenRef(stated)) {
    if (stated.times === undefined) return aliasOf(stated.$token, kind);
    // A scaled variable has no alias: its value at the factor is written.
    const found = context.typed.get(stated.$token);
    return found === undefined ? undefined : scaled(found.typed, stated.times);
  }
  if (typeof stated !== "string" && typeof stated !== "number")
    return undefined;
  return typedValue({ name: "part", kind, values: { light: String(stated) } })
    ?.value;
}

/** A typed value at a factor: a dimension's or a number's, else nothing. */
function scaled(typed: TypedValue, times: number): unknown {
  const value = typed.value;
  if (typeof value === "number") return value * times;
  if (isPlainObject(value) && typeof value.value === "number") {
    return { ...value, value: value.value * times };
  }
  return undefined;
}

/** A text style as Nextly keeps it in the file: everything but its role. */
export function keptTextStyle(style: NamedClass): DtcgNode {
  return {
    id: style.id,
    slug: style.slug,
    ...(style.label === undefined ? {} : { label: style.label }),
    orderIndex: style.orderIndex,
    styles: style.styles as DtcgNode,
    ...(style.locked === true ? { locked: true } : {}),
  };
}

/**
 * The text styles a file keeps as Nextly data, each one this site can use,
 * in the file's order. One it can't use is named and skipped.
 */
export function readTextStyles(
  kept: unknown,
  issues: ValidationIssue[]
): NamedClass[] {
  if (!Array.isArray(kept)) {
    issues.push(
      issue(
        "The text styles in the file could not be read, so none was imported."
      )
    );
    return [];
  }
  const read: NamedClass[] = [];
  const ids = new Set<string>();
  for (const entry of kept.slice(0, MAX_NAMED_CLASSES)) {
    const style = textStyleOf(entry);
    if (style === undefined || ids.has(style.id)) {
      issues.push(
        issue(
          `${nameOf(entry)} is not a text style this site can use, so it was skipped.`
        )
      );
      continue;
    }
    ids.add(style.id);
    read.push(style);
  }
  if (kept.length > MAX_NAMED_CLASSES) {
    issues.push(
      issue(
        `The file holds more than ${MAX_NAMED_CLASSES} text styles, so only the first ${MAX_NAMED_CLASSES} were read.`
      )
    );
  }
  return read;
}

/** One kept entry as a text style, or `undefined`. */
function textStyleOf(entry: unknown): NamedClass | undefined {
  if (!isPlainObject(entry)) return undefined;
  const { id, slug, label, orderIndex, styles, locked } = entry;
  if (typeof orderIndex !== "number" || !Number.isFinite(orderIndex)) {
    return undefined;
  }
  if (label !== undefined && typeof label !== "string") return undefined;
  if (locked !== undefined && locked !== true) return undefined;
  const style = {
    id,
    slug,
    ...(label === undefined ? {} : { label }),
    orderIndex,
    styles,
    ...(locked === true ? { locked: true as const } : {}),
    role: "text" as const,
  };
  return isUsableNamedClass(style) ? style : undefined;
}

/** How a kept entry is named in a message: its name, its id, or neither. */
function nameOf(entry: unknown): string {
  if (!isPlainObject(entry)) return "A text style";
  const named = typeof entry.label === "string" ? entry.label : entry.id;
  return typeof named === "string" && named !== ""
    ? `"${named.slice(0, MAX_NAMED_CLASS_NAME_LENGTH)}"`
    : "A text style";
}
