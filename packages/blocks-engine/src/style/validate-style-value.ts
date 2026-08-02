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
import { isPlainRecord } from "../plain-record";
import type {
  IssueCode,
  TokenLookup,
  ValidationIssue,
  ValidationMode,
} from "../validation";

import { getStyleProperty } from "./catalog";
import { isStyleLeaf, shapeLeaves } from "./catalog-types";
import type { StyleLeaf, StyleShape, TokenKind } from "./catalog-types";
import {
  checkColorValue,
  checkCssValue,
  checkDimensionValue,
  checkUrlValue,
  asciiLower,
  decodeIdentifier,
  isCssWideKeyword,
  isOverlongValue,
  splitCssTokens,
  trimCssWhitespace,
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
 * One allowance: how many more issues may be reported, how many bytes of
 * JSON-Pointer path they may carry between them, and whether this allowance has
 * already said that it stopped early.
 *
 * Counting issues alone does not bound what is returned. A pointer repeats
 * every key above it, so one very long key — a breakpoint id, a property
 * name — is copied into every issue beneath it, and a document well inside the
 * byte cap can produce output hundreds of times its own size. Charging the
 * paths bounds the ANSWER, the way the byte cap bounds the question.
 */
export interface IssueAllowance {
  count: number;
  pathBytes: number;
  truncated: boolean;
}

/**
 * A shared allowance for what one validation run may report. Held by the caller
 * so the limits span a whole document rather than resetting at every node.
 *
 * Two allowances, spent independently. Structural findings describe the
 * document; site findings — a token name or a class id that resolves against
 * tables the caller supplied — describe the configuration it was read against.
 * Sharing one allowance lets the second kind consume the first: renaming a
 * token produces a warning at every use of it, and the marker saying checking
 * stopped early is an ERROR, so warnings documented as never blocking a publish
 * would block one. Separate allowances make that impossible rather than
 * unlikely.
 */
export interface StyleIssueBudget {
  structural: IssueAllowance;
  site: IssueAllowance;
}

/** The default number of structural style issues one validation reports. */
export const MAX_STYLE_ISSUES = 200;

/**
 * The default path allowance for one run. Generous against real documents —
 * 200 issues at 250 bytes of pointer each — and small enough that no key can
 * multiply itself across the whole report.
 */
export const MAX_STYLE_ISSUE_PATH_BYTES = 50_000;

/** The default number of unresolved-name warnings one validation reports. */
export const MAX_SITE_ISSUES = 200;

/** The default path allowance for unresolved-name warnings. */
export const MAX_SITE_ISSUE_PATH_BYTES = 50_000;

/**
 * The diagnostics that ask about the SITE rather than about the document. Each
 * one resolves against a table the caller supplies, so the same document
 * produces it or not depending on configuration the document does not contain.
 */
const SITE_ISSUE_CODES: ReadonlySet<IssueCode> = new Set<IssueCode>([
  "unknown-token",
  "token-kind-mismatch",
  "unknown-class",
  "site-issues-truncated",
]);

/** Whether an issue resolves against the site rather than against the document. */
export function isSiteIssue(issue: ValidationIssue): boolean {
  return SITE_ISSUE_CODES.has(issue.code);
}

/** A fresh budget for one validation run. */
export function newStyleIssueBudget(
  remaining: number = MAX_STYLE_ISSUES,
  pathBytes: number = MAX_STYLE_ISSUE_PATH_BYTES,
  siteRemaining: number = MAX_SITE_ISSUES,
  sitePathBytes: number = MAX_SITE_ISSUE_PATH_BYTES
): StyleIssueBudget {
  return {
    structural: { count: remaining, pathBytes, truncated: false },
    site: { count: siteRemaining, pathBytes: sitePathBytes, truncated: false },
  };
}

/** Charge a run for the issues just produced, each against its own allowance. */
export function chargeIssueBudget(
  budget: StyleIssueBudget | undefined,
  produced: readonly ValidationIssue[]
): void {
  if (budget === undefined) return;
  for (const issue of produced) {
    const allowance = isSiteIssue(issue) ? budget.site : budget.structural;
    allowance.count -= 1;
    allowance.pathBytes -= issue.path.length;
  }
}

/** Whether an allowance has spent either of its limits. */
function allowanceSpent(allowance: IssueAllowance): boolean {
  return allowance.count <= 0 || allowance.pathBytes <= 0;
}

/** Whether the structural allowance is spent and the walk must stop. */
export function structuralAllowanceSpent(budget: StyleIssueBudget): boolean {
  return allowanceSpent(budget.structural);
}

/** Whether a run may still ask, and report, whether a name resolves. */
export function siteAllowanceSpent(
  budget: StyleIssueBudget | undefined
): boolean {
  return budget !== undefined && allowanceSpent(budget.site);
}

/** Record one site finding against its allowance and return it as the result. */
function charged(
  budget: StyleIssueBudget | undefined,
  issue: ValidationIssue
): ValidationIssue[] {
  chargeIssueBudget(budget, [issue]);
  return [issue];
}

/**
 * The marker saying name resolution stopped early, emitted once per run.
 *
 * A WARNING, unlike its structural counterpart. What went unchecked is whether
 * names resolve, and an unresolved name costs one dropped declaration rather
 * than a document that cannot render, so stopping early here leaves nothing
 * unsafe behind. Reporting it as an error is exactly the laundering of a
 * warning into a blocker that the separate allowance exists to prevent.
 */
export function siteTruncationNotice(
  budget: StyleIssueBudget | undefined,
  path: string
): ValidationIssue[] {
  if (budget === undefined || budget.site.truncated) return [];
  budget.site.truncated = true;
  return charged(budget, {
    path,
    code: "site-issues-truncated",
    severity: "warning",
    message:
      "Some token and class names were not checked against this site, so any that do not resolve are not reported here.",
  });
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
  if (budget.structural.truncated) return [];
  budget.structural.truncated = true;
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
  path: string,
  budget?: StyleIssueBudget,
  tokens?: TokenLookup
): ValidationIssue[] {
  // A token reference substitutes for the whole leaf value, so it is checked
  // against the leaf's declared token kinds rather than its literal shape.
  // Which token a name resolves to is a site-level question answered where the
  // token table is available, not here.
  if (isTokenRef(value)) {
    // A reference stands in for the whole value, so it carries nothing else.
    // Anything beside `$token` is data a reader would discard in silence,
    // which is worse than being told the shape is wrong.
    const extra = Object.keys(value).filter(key => key !== "$token");
    if (extra.length > 0) {
      return [
        invalid(
          path,
          `A design token reference carries only "$token", not ${describeValue(extra[0])}.`,
          "Remove the extra fields, or store a literal value instead."
        ),
      ];
    }
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
    // Whether the NAME resolves is a question about the site, not about the
    // document, so it is asked only when the caller supplied something that can
    // answer for every token the site defines.
    //
    // Both answers are WARNINGS in either mode, and deliberately so. A document
    // is data; a token table is configuration. An unresolved reference emits a
    // custom property that resolves to nothing, so the browser drops one
    // declaration and the element renders with what it inherits — a visual
    // fault, not a structural one. Reporting it as an error would mean renaming
    // a token makes every document that used it unpublishable, and would arm
    // the trap where defining a site's FIRST token invalidates every other
    // reference in storage.
    if (tokens === undefined) return [];
    // The site allowance is spent HERE, at the reference, rather than once per
    // property. A property is a whole composite: charging only when it returns
    // lets one `border` emit a warning per leaf past an allowance with a single
    // slot left, which is not a bound. Asking here is also what makes the
    // marker below truthful — it is reported only when a reference really did
    // go unchecked, never because the next property happened to hold a literal.
    if (siteAllowanceSpent(budget)) return siteTruncationNotice(budget, path);
    const name = value.$token;
    const kind = tokens.kindOf(name);
    if (kind === undefined) {
      return charged(budget, {
        path,
        code: "unknown-token",
        severity: "warning",
        message: `This site defines no design token named "${describeValue(name)}".`,
        suggestion: "Create the token, or store a literal value instead.",
      });
    }
    if (!leaf.tokenKinds.includes(kind)) {
      return charged(budget, {
        path,
        code: "token-kind-mismatch",
        severity: "warning",
        message: `The design token "${describeValue(name)}" is a ${kind}, and this value takes ${leaf.tokenKinds.join(" or ")}.`,
        suggestion: `Use a token of kind ${leaf.tokenKinds.join(" or ")}.`,
      });
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
        // The size cap comes before normalising, not after: trimming a value
        // that is mostly whitespace would otherwise let an arbitrarily long
        // string match a short keyword, and every copy made along the way is
        // work bought with a value that should never have been read.
        if (isOverlongValue(value)) return rejected(path, value, "too-long");
        // Split before decoding: an escape can spell a space, and that space
        // belongs INSIDE its identifier rather than separating two of them.
        const parts = splitCssTokens(value).map(token =>
          asciiLower(decodeIdentifier(token))
        );
        // Collapsed rather than compared raw, so that a vocabulary entry
        // written as two words — `grid-auto-flow: row dense` is one value, not
        // two — still matches however the stored string was spaced.
        const written = parts.join(" ");
        const allowed = (part: string): boolean =>
          leaf.values.some(entry => asciiLower(entry) === part);
        if (parts.length === 0) return rejected(path, value, "unparsable");
        if (isCssWideKeyword(written) || allowed(written)) return [];
        // Only a property declared as a shorthand reads its value as several
        // keywords; for every other one the whole string is the value, which is
        // what keeps a two-word entry from being mistaken for two entries. A
        // value listed as solo is a complete declaration like a CSS-wide
        // keyword, so it may not appear as one part of a shorthand.
        const solo = leaf.soloValues ?? [];
        const pairable = (part: string): boolean =>
          allowed(part) && !solo.some(entry => asciiLower(entry) === part);
        if (parts.length <= (leaf.maxParts ?? 1) && parts.every(pairable)) {
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
      if (typeof value === "string") {
        // Bounded before normalising, for the same reason the keyword leaf is.
        if (isOverlongValue(value)) return rejected(path, value, "too-long");
        if (isCssWideKeyword(decodeIdentifier(trimCssWhitespace(value)))) {
          return [];
        }
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
        allowNumber: leaf.allowNumber,
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
      // Bounded before normalising, as the keyword and numeric leaves are.
      if (isOverlongValue(value)) return rejected(path, value, "too-long");
      // A keyword stands in for the whole URL, so it is matched before the URL
      // rules rather than beside them: a value the property accepts as a
      // keyword is not a path and must not be judged as one.
      const written = asciiLower(decodeIdentifier(trimCssWhitespace(value)));
      const keywords = leaf.keywords ?? [];
      if (
        isCssWideKeyword(written) ||
        keywords.some(entry => asciiLower(entry) === written)
      ) {
        return [];
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
  budget?: StyleIssueBudget,
  spent = 0,
  spentBytes = 0,
  tokens?: TokenLookup
): ValidationIssue[] {
  if (!isPlainRecord(value)) {
    return [
      invalid(
        path,
        `${describeValue(value)} is not a plain object.`,
        `Use an object with any of: ${Object.keys(parts).join(", ")}.`
      ),
    ];
  }
  const issues: ValidationIssue[] = [];
  // What this level has produced towards the STRUCTURAL allowance: how many
  // issues, and how many bytes of path between them. Tracked here and compared
  // against the run's allowance because the run is charged when this walk
  // RETURNS, so a loop that only asked the budget would build every issue it
  // can first. One long key above a composite is enough for that to be hundreds
  // of megabytes from a document inside the byte cap.
  //
  // Site findings are excluded from both. They are spent from their own
  // allowance, so counting them here would let unresolved names stop structural
  // checking early, which is the truncation error that must not follow from a
  // warning.
  let count = 0;
  let bytes = 0;
  // Enumerated lazily rather than through `Object.entries`, which would build a
  // pair for every key before the budget below sees the first one — the budget
  // is meant to bound the work, not only the issues it reports.
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    // One composite can hold as many keys as a whole style map, so the budget
    // has to stop this loop as well; checking it only between properties would
    // let a single object allocate without limit.
    // Counts what this walk has produced ABOVE this level as well as at it:
    // comparing only the local total hands every nested composite the whole
    // allowance again, so a value one level deeper reported past the cap.
    if (
      budget !== undefined &&
      (structuralAllowanceSpent(budget) ||
        spent + count >= budget.structural.count ||
        spentBytes + bytes >= budget.structural.pathBytes)
    ) {
      issues.push(...truncationNotice(budget, path));
      break;
    }
    // Ownership is checked rather than trusting the lookup: a document may
    // legally contain a key such as `toString` or `constructor`, and a plain
    // object would answer those from its prototype, handing a function to the
    // shape walker instead of reporting an unknown field.
    const partValue = value[key];
    const partShape = Object.hasOwn(parts, key) ? parts[key] : undefined;
    if (partShape === undefined) {
      const unknownField = invalid(
        pointer(path, key),
        `"${describeValue(key)}" is not a known ${partLabel}.`,
        `Use one of: ${Object.keys(parts).join(", ")}.`
      );
      count += 1;
      bytes += unknownField.path.length;
      issues.push(unknownField);
      continue;
    }
    const nested = shapeIssues(
      partShape,
      partValue,
      pointer(path, key),
      budget,
      spent + count,
      spentBytes + bytes,
      tokens
    );
    for (const issue of nested) {
      if (isSiteIssue(issue)) continue;
      count += 1;
      bytes += issue.path.length;
    }
    issues.push(...nested);
  }
  return issues;
}

/** Validate a value against any shape, leaf or composite. */
function shapeIssues(
  shape: StyleShape,
  value: unknown,
  path: string,
  budget?: StyleIssueBudget,
  spent = 0,
  spentBytes = 0,
  tokens?: TokenLookup
): ValidationIssue[] {
  if (isStyleLeaf(shape)) return leafIssues(shape, value, path, budget, tokens);
  switch (shape.kind) {
    case "logicalSides":
      return partIssues(
        shape.sides,
        value,
        path,
        "side",
        budget,
        spent,
        spentBytes,
        tokens
      );
    case "logicalCorners":
      return partIssues(
        shape.corners,
        value,
        path,
        "corner",
        budget,
        spent,
        spentBytes,
        tokens
      );
    case "object":
      return partIssues(
        shape.fields,
        value,
        path,
        "field",
        budget,
        spent,
        spentBytes,
        tokens
      );
    case "union": {
      // A union accepts the value if any variant does. Variants are tried in
      // order and the first clean one wins; when none accepts, the first
      // variant's issues are reported, because it is the shape the catalog
      // lists first and therefore the one an author most likely intended.
      let best: ValidationIssue[] | undefined;
      let bestVariant: StyleShape | undefined;
      let bestRejects = true;
      for (const variant of shape.of) {
        // Tried WITHOUT the budget, because trying is speculative and the
        // budget is not. Name resolution is charged where the reference is, so
        // handing each arm the real allowance would bill a value once per arm
        // and let a discarded arm's truncation marker suppress a later one that
        // was going to be reported. The winner is re-run below with the budget,
        // so exactly one arm ever spends anything.
        const issues = shapeIssues(
          variant,
          value,
          path,
          undefined,
          spent,
          spentBytes,
          tokens
        );
        if (issues.length === 0) return [];
        // A variant that reports only warnings has ACCEPTED the value and
        // remarked on it. One that reports an error has refused it. Ranking by
        // path depth alone cannot tell those apart, so a value the catalog
        // lists two ways — a keyword or a number — could be refused by the arm
        // that structurally forbids it while the other arm merely warned, and
        // the refusal would win on a tie. That would turn an advisory note into
        // something that blocks a publish.
        const rejects = issues.some(issue => issue.severity === "error");
        if (bestRejects && !rejects) {
          best = issues;
          bestVariant = variant;
          bestRejects = false;
          continue;
        }
        if (rejects !== bestRejects) continue;
        // Within the same verdict, prefer whichever variant the value
        // structurally resembles: its issues point at the offending leaf, while
        // a mismatched variant only reports that the whole value is the wrong
        // shape.
        const deeper =
          best === undefined ||
          (issues[0]?.path.length ?? 0) > (best[0]?.path.length ?? 0);
        if (deeper) {
          best = issues;
          bestVariant = variant;
        }
      }
      if (bestVariant === undefined) return [];
      return shapeIssues(
        bestVariant,
        value,
        path,
        budget,
        spent,
        spentBytes,
        tokens
      );
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
  budget?: StyleIssueBudget,
  skipValueParsing = false,
  tokens?: TokenLookup
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  // Lazily enumerated for the same reason the composite walk is: a style map
  // with a hundred thousand keys would otherwise be materialised in full before
  // the budget below stops anything.
  for (const property in values) {
    if (!Object.hasOwn(values, property)) continue;
    // A style map has no size limit of its own, so a document well inside the
    // byte cap can hold a hundred thousand keys. Stopping at a budget keeps the
    // work and the returned array proportional to what a reader can use, and
    // says so rather than going quiet.
    if (budget !== undefined && structuralAllowanceSpent(budget)) {
      issues.push(...truncationNotice(budget, basePath));
      break;
    }
    const before = issues.length;
    const value = values[property];
    const path = pointer(basePath, property);
    const entry = getStyleProperty(property);
    if (entry === undefined) {
      issues.push({
        path,
        code: "unknown-style-property",
        severity: mode === "strict" ? "error" : "warning",
        message: `"${describeValue(property)}" is not a style property.`,
      });
      chargeIssueBudget(budget, issues.slice(before));
      continue;
    }
    // A document that already failed the byte cap is rejected whatever its
    // values say, and parsing each one builds an AST apiece. The property is
    // still recognised, which is cheap; reading its value is not.
    if (!skipValueParsing) {
      // Name resolution stops being asked for once its own allowance is spent,
      // while structural checking carries on to the end of the document: what a
      // name resolves to cannot decide whether a document is valid, so running
      // out of room to report on names must not cut short the checks that can.
      issues.push(
        ...shapeIssues(entry.shape, value, path, budget, 0, 0, tokens)
      );
    }
    // Structural findings only: a site finding is charged at the reference that
    // produced it, so billing the whole batch here would charge it twice.
    chargeIssueBudget(
      budget,
      issues.slice(before).filter(issue => !isSiteIssue(issue))
    );
  }
  return issues;
}
