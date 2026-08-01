/**
 * Validation of a document's style values against the catalog.
 *
 * Reports rather than throws, in the same `ValidationIssue` shape the rest of
 * the engine emits, so an editor, a CI gate, and an agent repairing a document
 * all read one vocabulary. Every issue carries a JSON-Pointer that resolves to
 * the exact offending value, down to the individual side of a box or field of a
 * composite.
 */
import { isTokenRef } from "../document";
import { describeValue, pointer } from "../issue-text";
import type { ValidationIssue, ValidationMode } from "../validation";

import { getStyleProperty } from "./catalog";
import { isStyleLeaf, shapeLeaves } from "./catalog-types";
import type { StyleLeaf, StyleShape, TokenKind } from "./catalog-types";
import { checkCssValue, checkDimensionValue, checkUrlValue } from "./css-value";
import type { CssValueRejection } from "./css-value";

/** Human-readable reasons a value was refused, keyed by the safety check's verdict. */
const REJECTION_MESSAGES = {
  unparsable: "is not a valid CSS value",
  "unsafe-characters":
    "contains characters that are not allowed in a style value",
  "unsafe-url-scheme": "uses a URL scheme that is not allowed",
  "unsafe-url-characters": "contains characters that are not allowed in a URL",
  "not-a-length": "is not a length",
} as const;

/** True when a token of the given kind may be stored at this leaf. */
export function tokenKindAllowedAt(leaf: StyleLeaf, kind: TokenKind): boolean {
  return leaf.tokenKinds.includes(kind);
}

/**
 * The token kinds a property accepts anywhere in its shape. A property whose
 * value is a composite accepts a token only at the leaves that declare kinds;
 * this is the union across them, which is what an editor needs to decide
 * whether to offer a token picker at all.
 */
export function tokenKindsForProperty(property: string): readonly TokenKind[] {
  const entry = getStyleProperty(property);
  if (entry === undefined) return [];
  const kinds: TokenKind[] = [];
  for (const leaf of shapeLeaves(entry.shape)) {
    for (const kind of leaf.tokenKinds) {
      if (!kinds.includes(kind)) kinds.push(kind);
    }
  }
  return kinds;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(
  path: string,
  message: string,
  suggestion?: string
): ValidationIssue {
  return {
    path,
    code: "invalid-style-value",
    severity: "error",
    message,
    ...(suggestion === undefined ? {} : { suggestion }),
  };
}

/**
 * The issue for a value the safety checks refused. A refused URL scheme carries
 * the same guidance wherever it was found, including inside a free-form value
 * where the URL is only part of what was written.
 */
function rejected(
  path: string,
  value: string,
  rejection: CssValueRejection
): ValidationIssue[] {
  return [
    invalid(
      path,
      `${describeValue(value)} ${REJECTION_MESSAGES[rejection]}.`,
      rejection === "unsafe-url-scheme"
        ? "Use an http(s) URL or a path relative to the site."
        : undefined
    ),
  ];
}

/** Validate a value against one leaf descriptor. */
function leafIssues(
  leaf: StyleLeaf,
  value: unknown,
  path: string
): ValidationIssue[] {
  // A token reference substitutes for the whole leaf value, so it is checked
  // against the leaf's declared token kinds rather than its literal shape.
  // Which token a name resolves to is a site-level question answered where the
  // token table is available, not here.
  if (isTokenRef(value)) {
    if (leaf.tokenKinds.length === 0) {
      return [
        {
          path,
          code: "token-not-allowed",
          severity: "error",
          message: `This value accepts only literals, not the design token "${describeValue(value.$token)}".`,
        },
      ];
    }
    return [];
  }

  switch (leaf.kind) {
    case "keyword": {
      if (typeof value === "string" && leaf.values.includes(value)) return [];
      return [
        invalid(
          path,
          `${describeValue(value)} is not one of the allowed values.`,
          `Use one of: ${leaf.values.join(", ")}.`
        ),
      ];
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return [invalid(path, `${describeValue(value)} is not a number.`)];
      }
      if (leaf.integer === true && !Number.isInteger(value)) {
        return [invalid(path, `${value} must be a whole number.`)];
      }
      if (leaf.min !== undefined && value < leaf.min) {
        return [invalid(path, `${value} is below the minimum of ${leaf.min}.`)];
      }
      if (leaf.max !== undefined && value > leaf.max) {
        return [invalid(path, `${value} is above the maximum of ${leaf.max}.`)];
      }
      return [];
    }
    case "dimension": {
      // Zero is the one number that is a complete CSS length on its own; every
      // other number would emit a unitless value the browser discards, so it is
      // refused here where the author can still see why.
      if (value === 0) return [];
      if (typeof value !== "string") {
        return [
          invalid(
            path,
            `${describeValue(value)} is not a length.`,
            'Use a string with a unit, such as "16px" or "2rem", or the number 0.'
          ),
        ];
      }
      const rejection = checkDimensionValue(value);
      return rejection === null ? [] : rejected(path, value, rejection);
    }
    case "color":
    case "cssValue": {
      if (typeof value !== "string") {
        return [invalid(path, `${describeValue(value)} is not a string.`)];
      }
      const rejection = checkCssValue(value);
      return rejection === null ? [] : rejected(path, value, rejection);
    }
    case "url": {
      if (typeof value !== "string") {
        return [invalid(path, `${describeValue(value)} is not a string.`)];
      }
      const rejection = checkUrlValue(value);
      return rejection === null ? [] : rejected(path, value, rejection);
    }
  }
}

/** Validate a value against one named part of a composite shape. */
function partIssues(
  parts: Readonly<Record<string, StyleShape>>,
  value: unknown,
  path: string,
  partLabel: string
): ValidationIssue[] {
  if (!isPlainObject(value)) {
    return [
      invalid(
        path,
        `${describeValue(value)} is not an object.`,
        `Use an object with any of: ${Object.keys(parts).join(", ")}.`
      ),
    ];
  }
  const issues: ValidationIssue[] = [];
  for (const [key, partValue] of Object.entries(value)) {
    // Ownership is checked rather than trusting the lookup: a document may
    // legally contain a key such as `toString` or `constructor`, and a plain
    // object would answer those from its prototype, handing a function to the
    // shape walker instead of reporting an unknown field.
    const partShape = Object.hasOwn(parts, key) ? parts[key] : undefined;
    if (partShape === undefined) {
      issues.push(
        invalid(
          pointer(path, key),
          `"${key}" is not a known ${partLabel}.`,
          `Use one of: ${Object.keys(parts).join(", ")}.`
        )
      );
      continue;
    }
    issues.push(...shapeIssues(partShape, partValue, pointer(path, key)));
  }
  return issues;
}

/** Validate a value against any shape, leaf or composite. */
function shapeIssues(
  shape: StyleShape,
  value: unknown,
  path: string
): ValidationIssue[] {
  if (isStyleLeaf(shape)) return leafIssues(shape, value, path);
  switch (shape.kind) {
    case "logicalSides":
      return partIssues(shape.sides, value, path, "side");
    case "logicalCorners":
      return partIssues(shape.corners, value, path, "corner");
    case "object":
      return partIssues(shape.fields, value, path, "field");
    case "union": {
      // A union accepts the value if any variant does. Variants are tried in
      // order and the first clean one wins; when none accepts, the first
      // variant's issues are reported, because it is the shape the catalog
      // lists first and therefore the one an author most likely intended.
      let firstIssues: ValidationIssue[] | undefined;
      for (const variant of shape.of) {
        const issues = shapeIssues(variant, value, path);
        if (issues.length === 0) return [];
        firstIssues ??= issues;
      }
      return firstIssues ?? [];
    }
  }
}

/**
 * Validate one state × breakpoint's style values.
 *
 * `basePath` is the JSON-Pointer of the `StyleValues` object being checked, so
 * issues resolve inside the document that contains it. Unknown properties
 * follow the same policy as unknown block types: an error under strict
 * validation, a warning under forgiving validation, because a document written
 * by a newer engine may legitimately carry a property this one has not learned
 * yet.
 */
export function validateStyleValues(
  values: Readonly<Record<string, unknown>>,
  basePath: string,
  mode: ValidationMode
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [property, value] of Object.entries(values)) {
    const path = pointer(basePath, property);
    const entry = getStyleProperty(property);
    if (entry === undefined) {
      issues.push({
        path,
        code: "unknown-style-property",
        severity: mode === "strict" ? "error" : "warning",
        message: `"${property}" is not a style property.`,
      });
      continue;
    }
    issues.push(...shapeIssues(entry.shape, value, path));
  }
  return issues;
}
