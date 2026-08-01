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
import {
  checkColorValue,
  checkCssValue,
  checkDimensionValue,
  checkUrlValue,
  isCssWideKeyword,
} from "./css-value";
import type { CssValueRejection } from "./css-value";

/** Human-readable reasons a value was refused, keyed by the safety check's verdict. */
const REJECTION_MESSAGES = {
  unparsable: "is not a valid CSS value",
  "unsafe-characters":
    "contains characters that are not allowed in a style value",
  "unsafe-url-scheme": "uses a URL scheme that is not allowed",
  "unsafe-url-characters": "contains characters that are not allowed in a URL",
  "not-a-length": "is not a length",
  "not-a-color": "is not a color",
  "too-deeply-nested": "is nested too deeply",
  "too-long": "is longer than a style value may be",
} as const;

/**
 * A shared allowance for how many style issues one validation run may report.
 * Held by the caller so the limit spans a whole document rather than resetting
 * at every node.
 */
export interface StyleIssueBudget {
  remaining: number;
  truncated: boolean;
}

/** The default number of style issues one document validation reports. */
export const MAX_STYLE_ISSUES = 200;

/** A fresh budget for one validation run. */
export function newStyleIssueBudget(
  remaining: number = MAX_STYLE_ISSUES
): StyleIssueBudget {
  return { remaining, truncated: false };
}

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

/**
 * The marker saying validation stopped early, emitted once per run.
 *
 * It is an ERROR, not a warning: a caller that keeps only errors — as the
 * page-builder write path does — would otherwise see a clean result for a
 * document whose remaining values were never inspected, and an unsafe value
 * sitting past the budget would reach the page. Stopping early means the
 * document is not known to be valid, so it fails closed.
 */
function truncationNotice(
  budget: StyleIssueBudget,
  path: string
): ValidationIssue[] {
  if (budget.truncated) return [];
  budget.truncated = true;
  return [
    {
      path,
      code: "style-issues-truncated",
      severity: "error",
      message:
        "There are more style problems than are reported here, so the rest of this document was not checked.",
    },
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
      // The CSS-wide keywords are legal wherever a value is, so a keyword leaf
      // accepts them alongside its own vocabulary, as lengths and colors do.
      // CSS keywords are ASCII case-insensitive, so a document storing
      // "Start" is valid and must not fail where "start" passes. Surrounding
      // whitespace goes the same way: a length or a color carrying it is
      // accepted, because parsing discards it, and the declaration a keyword
      // emits is just as valid — refusing it here would be this leaf kind
      // alone being strict about something no other one minds.
      if (typeof value === "string") {
        const written = value.trim().toLowerCase();
        if (
          leaf.values.some(allowed => allowed.toLowerCase() === written) ||
          isCssWideKeyword(written)
        ) {
          return [];
        }
      }
      return [
        invalid(
          path,
          `${describeValue(value)} is not one of the allowed values.`,
          `Use one of: ${leaf.values.join(", ")}.`
        ),
      ];
    }
    case "number": {
      // A later state or breakpoint needs these to reset an earlier value, and
      // they are legal wherever a value is. Trimmed first, as the keyword,
      // dimension and colour leaves all are: whichever leaf kind a property
      // happens to use should not decide whether stored whitespace is fatal.
      if (typeof value === "string" && isCssWideKeyword(value.trim())) {
        return [];
      }
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
      const rejection = checkDimensionValue(value, {
        keywords: leaf.keywords,
        maxParts: leaf.maxParts,
        allowNegative: leaf.allowNegative,
        allowPercentage: leaf.allowPercentage,
        functions: leaf.functions,
      });
      return rejection === null ? [] : rejected(path, value, rejection);
    }
    case "color": {
      if (typeof value !== "string") {
        return [invalid(path, `${describeValue(value)} is not a string.`)];
      }
      const rejection = checkColorValue(value);
      return rejection === null ? [] : rejected(path, value, rejection);
    }
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
  partLabel: string,
  budget?: StyleIssueBudget
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
    // One composite can hold as many keys as a whole style map, so the budget
    // has to stop this loop as well; checking it only between properties would
    // let a single object allocate without limit.
    if (budget !== undefined && issues.length >= budget.remaining) {
      issues.push(...truncationNotice(budget, path));
      break;
    }
    // Ownership is checked rather than trusting the lookup: a document may
    // legally contain a key such as `toString` or `constructor`, and a plain
    // object would answer those from its prototype, handing a function to the
    // shape walker instead of reporting an unknown field.
    const partShape = Object.hasOwn(parts, key) ? parts[key] : undefined;
    if (partShape === undefined) {
      issues.push(
        invalid(
          pointer(path, key),
          `"${describeValue(key)}" is not a known ${partLabel}.`,
          `Use one of: ${Object.keys(parts).join(", ")}.`
        )
      );
      continue;
    }
    issues.push(
      ...shapeIssues(partShape, partValue, pointer(path, key), budget)
    );
  }
  return issues;
}

/** Validate a value against any shape, leaf or composite. */
function shapeIssues(
  shape: StyleShape,
  value: unknown,
  path: string,
  budget?: StyleIssueBudget
): ValidationIssue[] {
  if (isStyleLeaf(shape)) return leafIssues(shape, value, path);
  switch (shape.kind) {
    case "logicalSides":
      return partIssues(shape.sides, value, path, "side", budget);
    case "logicalCorners":
      return partIssues(shape.corners, value, path, "corner", budget);
    case "object":
      return partIssues(shape.fields, value, path, "field", budget);
    case "union": {
      // A union accepts the value if any variant does. Variants are tried in
      // order and the first clean one wins; when none accepts, the first
      // variant's issues are reported, because it is the shape the catalog
      // lists first and therefore the one an author most likely intended.
      let best: ValidationIssue[] | undefined;
      for (const variant of shape.of) {
        const issues = shapeIssues(variant, value, path, budget);
        if (issues.length === 0) return [];
        // Prefer whichever variant the value structurally resembles: its issues
        // point at the offending leaf, while a mismatched variant only reports
        // that the whole value has the wrong shape.
        const deeper =
          best === undefined ||
          (issues[0]?.path.length ?? 0) > (best[0]?.path.length ?? 0);
        if (deeper) best = issues;
      }
      return best ?? [];
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
  mode: ValidationMode,
  budget?: StyleIssueBudget
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [property, value] of Object.entries(values)) {
    // A style map has no size limit of its own, so a document well inside the
    // byte cap can hold a hundred thousand keys. Stopping at a budget keeps the
    // work and the returned array proportional to what a reader can use, and
    // says so rather than going quiet.
    if (budget !== undefined && budget.remaining <= 0) {
      issues.push(...truncationNotice(budget, basePath));
      break;
    }
    const before = issues.length;
    const path = pointer(basePath, property);
    const entry = getStyleProperty(property);
    if (entry === undefined) {
      issues.push({
        path,
        code: "unknown-style-property",
        severity: mode === "strict" ? "error" : "warning",
        message: `"${describeValue(property)}" is not a style property.`,
      });
      if (budget !== undefined) budget.remaining -= issues.length - before;
      continue;
    }
    issues.push(...shapeIssues(entry.shape, value, path, budget));
    if (budget !== undefined) budget.remaining -= issues.length - before;
  }
  return issues;
}
