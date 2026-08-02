/**
 * Turning stored style values into CSS declarations.
 *
 * The walk mirrors the one validation performs, because both read the same
 * catalog shape: a leaf pairs a stored value with the CSS property it emits, a
 * composite names its parts.
 *
 * What it does NOT do is repeat validation's checks. It asks validation for a
 * verdict and writes only what came back clean. Two consequences, and both are
 * the point. A document that validates cleanly compiles completely, because
 * there is no second, subtly stricter opinion to disagree with the first. And a
 * caller who skipped validation still cannot put an unsafe value on a page,
 * because the verdict is taken here rather than assumed to have been taken
 * earlier.
 *
 * @module style/declarations
 */
import { isTokenRef } from "../document";
import { describeValue, pointer } from "../issue-text";
import { isPlainRecord } from "../plain-record";
import type { ValidationIssue } from "../validation";

import { getStyleProperty } from "./catalog";
import { isStyleLeaf } from "./catalog-types";
import type { StyleLeaf, StyleShape, UrlLeaf } from "./catalog-types";
import {
  asciiLower,
  decodeIdentifier,
  isCssWideKeyword,
  trimCssWhitespace,
} from "./css-value";
import { validateStyleValues } from "./validate-style-value";

/** One `property: value` pair bound for a rule. */
export interface Declaration {
  property: string;
  value: string;
  /**
   * A selector appended to the node's own, for the enumerated cases where a
   * property styles something inside the block rather than its root.
   */
  descendant?: string;
}

/** What one style map compiled to, and what it refused on the way. */
export interface CompiledDeclarations {
  declarations: Declaration[];
  warnings: ValidationIssue[];
}

/**
 * The token-name grammar: dot-separated lowercase slugs.
 *
 * Checked here rather than left to validation because a name is written into a
 * `var()` unquoted. A stored name carrying a bracket or a semicolon would close
 * the function and open a declaration of its own choosing, which is the one way
 * a document could write arbitrary CSS through a path that looks like data.
 */
const TOKEN_NAME_RE = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

/** The default custom-property prefix for site tokens. */
export const DEFAULT_TOKEN_PREFIX = "--site-";

/**
 * The shape a custom-property prefix may take.
 *
 * The prefix comes from a caller and lands inside `var()` unquoted, so one
 * carrying CSS syntax would close the function and open declarations of its
 * own. A prefix that merely forgets the leading `--` is a quieter failure with
 * the same shape: every token reference it builds is nonsense the browser drops.
 */
const TOKEN_PREFIX_RE = /^--[a-z0-9-]*$/;

/**
 * The prefix to write tokens under, or the default when the supplied one cannot
 * be used. Reports rather than throwing, in keeping with everything else here:
 * one bad setting should cost the tokens, not the page.
 */
export function safeTokenPrefix(prefix: string | undefined): {
  prefix: string;
  warning?: string;
} {
  if (prefix === undefined) return { prefix: DEFAULT_TOKEN_PREFIX };
  if (TOKEN_PREFIX_RE.test(prefix)) return { prefix };
  return {
    prefix: DEFAULT_TOKEN_PREFIX,
    warning: `"${describeValue(prefix)}" is not a custom-property prefix, so design tokens were written under "${DEFAULT_TOKEN_PREFIX}" instead.`,
  };
}

function warning(path: string, message: string): ValidationIssue {
  return { path, code: "invalid-style-value", severity: "warning", message };
}

/**
 * The custom property a token reference reads.
 *
 * `color.primary` becomes `--site-color-primary`: a dot is not a custom-property
 * character, and a dash reads the same way to anyone who has seen the name.
 */
export function tokenCustomProperty(name: string, prefix: string): string {
  return prefix + name.replace(/\./g, "-");
}

/** A declaration with the pointer it came from, so a verdict can be applied. */
interface PlacedDeclaration extends Declaration {
  path: string;
}

interface Walk {
  placed: PlacedDeclaration[];
  warnings: ValidationIssue[];
  prefix: string;
}

/** The CSS text for one stored scalar, or nothing when it cannot be written. */
function scalarText(
  leaf: StyleLeaf,
  value: unknown,
  path: string,
  walk: Walk
): string | undefined {
  if (isTokenRef(value)) {
    const name = value.$token;
    if (!TOKEN_NAME_RE.test(name)) {
      walk.warnings.push(
        warning(
          path,
          `"${describeValue(name)}" is not a design-token name, so it was not written.`
        )
      );
      return undefined;
    }
    return `var(${tokenCustomProperty(name, walk.prefix)})`;
  }
  // Written through `String`, which does not read a locale. A formatter that
  // did would emit "1,5" on half the machines in the world, breaking both the
  // CSS and the guarantee that the same document always produces the same bytes.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  return leaf.kind === "url" ? urlText(leaf, value) : value;
}

/**
 * A stored URL as the declaration writes it.
 *
 * The value is a path, not a CSS value: `background-image` takes `url(...)`,
 * so emitting what was stored would produce a declaration the browser discards
 * and every background image on the site would silently do nothing.
 *
 * A keyword is the exception and is matched first, the way validation matches
 * it: `background-image: none` is how an image set at an earlier state is
 * cleared, and wrapping it would emit `url("none")` and go looking for a file.
 */
function urlText(leaf: UrlLeaf, value: string): string {
  const written = asciiLower(decodeIdentifier(trimCssWhitespace(value)));
  const keywords = leaf.keywords ?? [];
  if (
    isCssWideKeyword(written) ||
    keywords.some(entry => asciiLower(entry) === written)
  ) {
    return value;
  }
  // Quoted, with the two characters that could end the string escaped. The
  // safety check refuses the rest, and a URL that survives both is one the
  // browser reads as a single argument whatever it contains.
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `url("${escaped}")`;
}

/** Compile one value against one shape. */
function shapeDeclarations(
  shape: StyleShape,
  value: unknown,
  path: string,
  walk: Walk
): void {
  if (isStyleLeaf(shape)) {
    const text = scalarText(shape, value, path, walk);
    if (text === undefined) return;
    walk.placed.push({
      path,
      property: shape.cssProperty,
      value: text,
      ...(shape.descendant === undefined
        ? {}
        : { descendant: shape.descendant }),
    });
    return;
  }
  switch (shape.kind) {
    case "logicalSides":
      partDeclarations(shape.sides, value, path, walk);
      return;
    case "logicalCorners":
      partDeclarations(shape.corners, value, path, walk);
      return;
    case "object":
      partDeclarations(shape.fields, value, path, walk);
      return;
    case "union": {
      // The stored value decides which arm it is: a corner radius written as
      // one scalar and the same property written as four corners are different
      // arms of the same entry. The first arm that writes something wins, which
      // is the order the catalog lists them in.
      let refused: Walk | undefined;
      for (const variant of shape.of) {
        const attempt: Walk = { placed: [], warnings: [], prefix: walk.prefix };
        shapeDeclarations(variant, value, path, attempt);
        if (attempt.placed.length > 0) {
          walk.placed.push(...attempt.placed);
          walk.warnings.push(...attempt.warnings);
          return;
        }
        refused ??= attempt;
      }
      // No arm wrote anything. Whatever the first one objected to is why, and
      // dropping it would leave a value missing from the stylesheet with
      // nothing anywhere saying so — which is the one thing these warnings
      // exist to prevent.
      if (refused !== undefined) walk.warnings.push(...refused.warnings);
      return;
    }
  }
}

/** Compile the named parts of a composite. */
function partDeclarations(
  parts: Readonly<Record<string, StyleShape>>,
  value: unknown,
  path: string,
  walk: Walk
): void {
  if (!isPlainRecord(value)) return;
  // Sorted, so two documents differing only in the order their keys were
  // written compile to the same bytes. Ownership is checked rather than trusted:
  // a stored key may be `constructor`, which a plain lookup answers from the
  // prototype and hands a function to the walk.
  const keys = Object.keys(value)
    .filter(key => Object.hasOwn(value, key))
    .sort();
  for (const key of keys) {
    const partShape = Object.hasOwn(parts, key) ? parts[key] : undefined;
    if (partShape === undefined) continue;
    shapeDeclarations(partShape, value[key], pointer(path, key), walk);
  }
}

/** Whether a pointer is at or below one of the refused ones. */
function refusedAt(path: string, refused: readonly string[]): boolean {
  return refused.some(at => path === at || path.startsWith(`${at}/`));
}

/**
 * Compile one style map into declarations.
 *
 * Properties are emitted in sorted order rather than in the order the document
 * happens to list them. Within one rule, CSS order decides only between two
 * declarations of the same property, which a map cannot hold twice, so sorting
 * costs nothing and buys the guarantee that the same styles always produce the
 * same bytes.
 */
export function compileStyleValues(
  values: Readonly<Record<string, unknown>>,
  basePath: string,
  tokenPrefix?: string
): CompiledDeclarations {
  // Strict, because this decides what reaches a page: a property this engine
  // does not know is preserved in the document and left out of the stylesheet,
  // rather than written on the guess that it might mean something.
  const issues = validateStyleValues(values, basePath, "strict");
  const refused = issues
    .filter(issue => issue.severity === "error")
    .map(issue => issue.path);

  const safe = safeTokenPrefix(tokenPrefix);
  const walk: Walk = { placed: [], warnings: [], prefix: safe.prefix };
  if (safe.warning !== undefined) {
    walk.warnings.push(warning(basePath, safe.warning));
  }
  const properties = Object.keys(values)
    .filter(key => Object.hasOwn(values, key))
    .sort();
  for (const property of properties) {
    const entry = getStyleProperty(property);
    if (entry === undefined) continue;
    shapeDeclarations(
      entry.shape,
      values[property],
      pointer(basePath, property),
      walk
    );
  }

  const declarations: Declaration[] = [];
  for (const placed of walk.placed) {
    if (refusedAt(placed.path, refused)) continue;
    const { path: _path, ...declaration } = placed;
    declarations.push(declaration);
  }
  return {
    declarations,
    // Validation's errors are reported as the reason something is missing from
    // the stylesheet. They keep their own paths and codes, so a caller that
    // already validated sees the same issue twice rather than two accounts of it.
    warnings: [
      ...issues.filter(issue => issue.severity === "error"),
      ...walk.warnings,
    ],
  };
}
