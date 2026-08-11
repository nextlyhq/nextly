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
import type { TokenRef } from "../document";
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
import type { CssValueRejection, MayFetchUrl } from "./css-value";

/** Human-readable reasons a value was refused, keyed by the safety check's verdict. */
const REJECTION_MESSAGES = {
  unparsable: "is not a valid CSS value",
  "unsafe-characters":
    "contains characters that are not allowed in a style value",
  "unsafe-url-scheme": "uses a URL scheme that is not allowed",
  "unsafe-url-characters": "contains characters that are not allowed in a URL",
  "url-host-not-allowed": "loads from a host this site does not allow",
  "not-a-length": "is not a length",
  "not-a-color": "is not a color",
  "too-deeply-nested": "is nested too deeply",
  "too-long": "is longer than a style value may be",
} as const;

/**
 * A shared allowance for what one validation run may report. Held by the caller
 * so the limits span a whole document rather than resetting at every node.
 *
 * Counting issues alone does not bound what is returned. A pointer repeats every
 * key above it, so one very long key — a breakpoint id, a property name — is
 * copied into every issue beneath it, and a document well inside the byte cap
 * can produce output hundreds of times its own size. Charging the paths bounds
 * the ANSWER, the way the byte cap bounds the question.
 *
 * Two allowances, spent independently. Structural findings describe the
 * document; site findings — a token name or a class id that resolves against
 * tables the caller supplied — describe the configuration it was read against.
 * Sharing one allowance lets the second kind consume the first: renaming a token
 * produces a warning at every use of it, and the marker saying checking stopped
 * early is an ERROR, so warnings documented as never blocking a publish would
 * block one. Separate allowances make that impossible rather than unlikely.
 */
export interface StyleIssueBudget {
  /** How many more structural issues this run may report. */
  remaining: number;
  /** How many more bytes of path those issues may carry between them. */
  pathBytes: number;
  /** Whether this run has already said structural checking stopped early. */
  truncated: boolean;
  /**
   * How many more unresolved-name warnings this run may report.
   *
   * Optional, along with the two below, because the three structural fields
   * were this type's whole shape when it shipped: a caller still holding that
   * object has to keep compiling, not only keep running. They are filled in on
   * the way through, so everything past the entry point works with all six.
   */
  siteRemaining?: number;
  /** How many more bytes of path those warnings may carry between them. */
  sitePathBytes?: number;
  /** Whether this run has already said name resolution stopped early. */
  siteTruncated?: boolean;
  /**
   * How many more times this run may ask the caller's lookups anything.
   *
   * A separate dimension because the two above do not bound this one. Both are
   * charged for what is REPORTED, and a name that resolves is not a finding, so
   * a document referencing thousands of DISTINCT names the site really defines
   * spends neither allowance while asking caller-supplied code once per name.
   * Memoizing collapses repeats and cannot collapse distinct names, so the
   * count is bounded only by the document's byte cap — thousands of calls, and
   * a cache retaining every answer, to return no issues at all.
   */
  siteLookups?: number;
}

/**
 * A budget with every allowance present.
 *
 * What the walk works with, produced from whatever a caller supplied by
 * {@link normalizeStyleIssueBudget}. Keeping the two apart is what lets the
 * accepted shape stay compatible without every read inside having to ask
 * whether an allowance exists.
 */
export type ReadyStyleIssueBudget = Required<StyleIssueBudget>;

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
 * The default number of times one run may ask the caller's lookups anything.
 *
 * Counted per DISTINCT name, since repeats are answered from the run's cache.
 * Far above any real site — a token table or class library is tens to hundreds
 * of entries, not ten thousand — and low enough that a document cannot turn its
 * byte cap into an unbounded amount of someone else's work.
 */
export const MAX_SITE_LOOKUPS = 10_000;

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
  sitePathBytes: number = MAX_SITE_ISSUE_PATH_BYTES,
  siteLookups: number = MAX_SITE_LOOKUPS
): ReadyStyleIssueBudget {
  return {
    remaining,
    pathBytes,
    truncated: false,
    siteRemaining,
    sitePathBytes,
    siteTruncated: false,
    siteLookups,
  };
}

/**
 * Fill in a budget that predates the site allowance.
 *
 * The structural fields have been public since this type shipped, so a caller
 * may hand back an object carrying only those. Reading a missing allowance
 * would bound nothing, and validation reports rather than throwing, so the
 * missing half is filled with its defaults instead.
 */
export function normalizeStyleIssueBudget(
  budget: StyleIssueBudget | undefined
): ReadyStyleIssueBudget | undefined {
  if (budget === undefined) return undefined;
  if (typeof budget.siteRemaining !== "number") {
    budget.siteRemaining = MAX_SITE_ISSUES;
  }
  if (typeof budget.sitePathBytes !== "number") {
    budget.sitePathBytes = MAX_SITE_ISSUE_PATH_BYTES;
  }
  if (typeof budget.siteTruncated !== "boolean") budget.siteTruncated = false;
  if (typeof budget.siteLookups !== "number") {
    budget.siteLookups = MAX_SITE_LOOKUPS;
  }
  // Every allowance is present now, which is what the walk below requires.
  return budget as ReadyStyleIssueBudget;
}

/** Charge a run for the issues just produced, each against its own allowance. */
export function chargeIssueBudget(
  budget: ReadyStyleIssueBudget | undefined,
  produced: readonly ValidationIssue[]
): void {
  if (budget === undefined) return;
  for (const issue of produced) {
    if (isSiteIssue(issue)) {
      budget.siteRemaining -= 1;
      budget.sitePathBytes -= issue.path.length;
    } else {
      budget.remaining -= 1;
      budget.pathBytes -= issue.path.length;
    }
  }
}

/**
 * A budget that gates like the real one but keeps nothing it spends.
 *
 * Trying a union arm is speculative, so what an arm spends must not survive
 * being discarded. Handing an arm NO budget would do that, and would also
 * remove the bound that stops it allocating: a composite arm walks every key it
 * was given, and the allowance is what keeps a document full of unknown keys
 * from building an issue for each one before anything looks at the result.
 *
 * A copy keeps both properties at once. The arm reads the same remaining
 * amounts, so it stops in the same place; every charge and every truncation flag
 * lands on the copy and goes away with it.
 */
export function speculativeBudget(
  budget: ReadyStyleIssueBudget | undefined
): ReadyStyleIssueBudget | undefined {
  return budget === undefined ? undefined : { ...budget };
}

/**
 * Whether the structural allowance is spent and the walk must stop.
 *
 * Named for WHICH allowance it reads. There are two now — structural and site —
 * and a bare "is the budget spent?" answers for neither in particular, which is
 * how site warnings came to be charged against the checks that decide validity.
 */
export function structuralAllowanceSpent(
  budget: ReadyStyleIssueBudget
): boolean {
  return budget.remaining <= 0 || budget.pathBytes <= 0;
}

/** Whether a run may still ask, and report, whether a name resolves. */
export function siteAllowanceSpent(
  budget: ReadyStyleIssueBudget | undefined
): boolean {
  return (
    budget !== undefined &&
    (budget.siteRemaining <= 0 || budget.sitePathBytes <= 0)
  );
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
  budget: ReadyStyleIssueBudget | undefined,
  path: string
): ValidationIssue[] {
  if (budget === undefined || budget.siteTruncated) return [];
  budget.siteTruncated = true;
  return charged(budget, {
    path,
    code: "site-issues-truncated",
    severity: "warning",
    message:
      "Some token and class names were not checked against this site, so any that do not resolve are not reported here.",
  });
}

/** Record one site finding against its allowance and return it as the result. */
function charged(
  budget: ReadyStyleIssueBudget | undefined,
  issue: ValidationIssue
): ValidationIssue[] {
  chargeIssueBudget(budget, [issue]);
  return [issue];
}

/**
 * Each memoized lookup's cache, for asking whether a name can be answered
 * without going back to the caller.
 *
 * Keyed by the wrapper rather than held inside it because the question is asked
 * from the reference site, which has the lookup and not its innards. A `WeakMap`
 * so a lookup that goes out of scope takes its cache with it.
 */
const lookupCaches = new WeakMap<object, ReadonlyMap<string, unknown>>();

/** Record a wrapper's cache so {@link canResolveName} can consult it. */
export function registerLookupCache(
  lookup: object,
  seen: ReadonlyMap<string, unknown>
): void {
  lookupCaches.set(lookup, seen);
}

/**
 * Whether this run may still resolve one name.
 *
 * Three questions, and keeping them apart is the point. The reporting
 * allowances bound what comes BACK, so spending them stops resolution
 * altogether. The lookup allowance bounds what the CALLER is asked to do, so
 * spending it stops only the names that would ask them something new — a name
 * this run has already resolved is answered from the cache at no cost to
 * anyone, and refusing it would drop a warning that was free to produce while
 * claiming the name went unchecked when it had in fact been checked.
 */
export function canResolveName(
  lookup: object | undefined,
  name: string,
  budget: ReadyStyleIssueBudget | undefined
): boolean {
  if (budget === undefined) return true;
  // A name already resolved this run is answered from the cache, and that costs
  // nothing under any allowance — so it is answered even once reporting has
  // stopped. Knowing the answer is what lets the run tell "a warning I cannot
  // report" apart from "a name that is perfectly fine", and only the first is
  // something the truncation marker should ever be claiming.
  const seen = lookup === undefined ? undefined : lookupCaches.get(lookup);
  if (seen !== undefined && seen.has(name)) return true;
  // Uncached: asking is only worth the caller's time if the answer could still
  // be reported, and only allowed while there are lookups left to spend.
  if (siteAllowanceSpent(budget)) return false;
  return budget.siteLookups > 0;
}

/**
 * Report one site finding, or say once that reporting stopped.
 *
 * The allowance is checked HERE rather than before resolution, because whether
 * a name needs reporting at all is not known until it has been resolved. A
 * name that resolves cleanly produces nothing and truncates nothing, and
 * announcing otherwise tells a consumer that names went unchecked when every
 * one of them was checked.
 */
function reportSiteIssue(
  budget: ReadyStyleIssueBudget | undefined,
  issue: ValidationIssue
): ValidationIssue[] {
  if (siteAllowanceSpent(budget)) {
    return siteTruncationNotice(budget, issue.path);
  }
  return charged(budget, issue);
}

/**
 * Wrappers this module made, so one is never wrapped again.
 *
 * A document walk memoizes once and hands the result down, while a caller
 * reaching `validateStyleValues` directly hands in a raw lookup that still has
 * to be wrapped. Recognising our own is what lets both hold: the walk's cache
 * survives across envelopes instead of a second Map being stacked on it per
 * envelope, each starting empty.
 *
 * A `WeakSet` rather than a marker property: the lookup is a caller-facing
 * interface, and nothing a caller can see should have to carry a field that
 * exists for this.
 */
const memoizedLookups = new WeakSet<TokenLookup>();

/**
 * A lookup that asks the caller's at most once per name.
 *
 * `kindOf` is caller-supplied and may be expensive, and one reference is asked
 * about several times over: a union asks before choosing an arm, each arm asks
 * while being tried, and the winning arm asks again when it is re-run. Whether
 * a name resolves cannot change inside one run, so asking again is pure waste.
 *
 * The cache belongs to the walk that made it, not to one style envelope. A
 * document repeating a token across thousands of nodes, states and breakpoints
 * resolves it once; nothing bounds that repetition otherwise, because a name
 * that resolves is not an issue and so is never charged the issue allowance.
 */
export function memoizeTokenLookup(
  tokens: TokenLookup | undefined,
  budget?: ReadyStyleIssueBudget
): TokenLookup | undefined {
  if (tokens === undefined) return undefined;
  if (memoizedLookups.has(tokens)) return tokens;
  const seen = new Map<string, TokenKind | undefined>();
  const lookup: TokenLookup = {
    kindOf(name: string): TokenKind | undefined {
      const cached = seen.get(name);
      if (cached !== undefined || seen.has(name)) return cached;
      // Charged here rather than at the reference, so the count is of what the
      // caller was really asked. A repeated name is answered from this cache
      // and costs nothing; only a name never seen before reaches their code.
      if (budget !== undefined) budget.siteLookups -= 1;
      const kind = tokens.kindOf(name);
      seen.set(name, kind);
      return kind;
    },
  };
  memoizedLookups.add(lookup);
  registerLookupCache(lookup, seen);
  return lookup;
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
  path: string,
  budget?: ReadyStyleIssueBudget,
  check: ValueCheckContext = {}
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
    const { tokens } = check;
    if (tokens === undefined) return [];
    // The site allowance is spent HERE, at the reference, rather than once per
    // property. A property is a whole composite: charging only when it returns
    // lets one `border` emit a warning per leaf past an allowance with a single
    // slot left, which is not a bound. Asking here is also what makes the
    // marker below truthful — it is reported only when a reference really did
    // go unchecked, never because the next property happened to hold a literal.
    const name = value.$token;
    if (!canResolveName(tokens, name, budget)) {
      return siteTruncationNotice(budget, path);
    }
    const kind = tokens.kindOf(name);
    if (kind === undefined) {
      return reportSiteIssue(budget, {
        path,
        code: "unknown-token",
        severity: "warning",
        message: `This site defines no design token named "${describeValue(name)}".`,
        suggestion: "Create the token, or store a literal value instead.",
      });
    }
    if (!leaf.tokenKinds.includes(kind)) {
      return reportSiteIssue(budget, {
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
      const rejection = checkCssValue(value, check.mayFetchUrl);
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
      const rejection = checkUrlValue(value, "raw", check.mayFetchUrl);
      return rejection === null ? [] : rejected(path, value, rejection);
    }
  }
}

/**
 * Whether a token reference carries anything besides `$token`.
 *
 * Checked before the union shortcut below rather than left to the leaf that
 * would eventually run. A reference stands in for the whole value, so anything
 * beside `$token` is data a reader discards in silence, and taking the shortcut
 * first would let a malformed reference through with a warning where the leaf
 * would have refused it.
 */
function extraTokenKeys(value: TokenRef): boolean {
  return Object.keys(value).some(key => key !== "$token");
}

/**
 * Every token kind any arm of a union accepts.
 *
 * A union accepts a token the moment one arm does, so the kinds it accepts are
 * the union of its arms'. Order is the catalog's, deduplicated, so the message
 * built from this reads the same way every time.
 */
function unionTokenKinds(shape: StyleShape): TokenKind[] {
  const kinds: TokenKind[] = [];
  for (const leaf of shapeLeaves(shape)) {
    for (const kind of leaf.tokenKinds) {
      if (!kinds.includes(kind)) kinds.push(kind);
    }
  }
  return kinds;
}

/**
 * What a leaf needs besides the value itself.
 *
 * One object rather than one parameter apiece. These functions already carry
 * seven positional arguments, several optional and several defaulted, and a
 * second optional trailing parameter is the shape where a mis-slotted argument
 * is silently accepted — here that would mean a URL policy quietly dropped and
 * every URL in the document unasked about.
 */
interface ValueCheckContext {
  tokens?: TokenLookup;
  mayFetchUrl?: MayFetchUrl;
}

/** Validate a value against one named part of a composite shape. */
function partIssues(
  parts: Readonly<Record<string, StyleShape>>,
  value: unknown,
  path: string,
  partLabel: string,
  budget?: ReadyStyleIssueBudget,
  spent = 0,
  spentBytes = 0,
  check: ValueCheckContext = {}
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
        spent + count >= budget.remaining ||
        spentBytes + bytes >= budget.pathBytes)
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
      check
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
  budget?: ReadyStyleIssueBudget,
  spent = 0,
  spentBytes = 0,
  check: ValueCheckContext = {}
): ValidationIssue[] {
  if (isStyleLeaf(shape)) return leafIssues(shape, value, path, budget, check);
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
        check
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
        check
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
        check
      );
    case "union": {
      // A token is judged against every arm's kinds at once. Reporting the
      // first refusing arm's list names a subset: `lineHeight` takes a number
      // OR a dimension token, and a colour token there would be told the
      // property takes only numbers, steering the author away from a spelling
      // that works.
      // The allowance is asked BEFORE the lookup, not after: `kindOf` is the
      // caller's code and may be expensive, and a run that has already said
      // name checking stopped must stop calling it rather than call it and
      // discard the answer. The lookup and reporting allowances are distinct
      // (a name already answered this run costs the caller nothing), so the
      // same guard the leaf reference uses bounds the ask here too.
      const { tokens } = check;
      if (isTokenRef(value) && tokens !== undefined && !extraTokenKeys(value)) {
        const kinds = unionTokenKinds(shape);
        if (kinds.length > 0) {
          if (!canResolveName(tokens, value.$token, budget)) {
            return siteTruncationNotice(budget, path);
          }
          const kind = tokens.kindOf(value.$token);
          if (kind !== undefined && !kinds.includes(kind)) {
            return reportSiteIssue(budget, {
              path,
              code: "token-kind-mismatch",
              severity: "warning",
              message: `The design token "${describeValue(value.$token)}" is a ${kind}, and this value takes ${kinds.join(" or ")}.`,
              suggestion: `Use a token of kind ${kinds.join(" or ")}.`,
            });
          }
        }
      }
      // A union accepts the value if any variant does. Variants are tried in
      // order and the first clean one wins; when none accepts, the first
      // variant's issues are reported, because it is the shape the catalog
      // lists first and therefore the one an author most likely intended.
      let best: ValidationIssue[] | undefined;
      let bestVariant: StyleShape | undefined;
      let bestRejects = true;
      for (const variant of shape.of) {
        // Tried against a COPY of the allowances, because trying is
        // speculative and spending is not. The copy still gates, so an arm
        // cannot allocate past the cap; nothing it charges outlives it, so a
        // value is not billed once per arm and a discarded arm's truncation
        // marker cannot suppress one a later reference was going to get. The
        // winner is re-run below against the real budget.
        const issues = shapeIssues(
          variant,
          value,
          path,
          speculativeBudget(budget),
          spent,
          spentBytes,
          check
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
        check
      );
    }
  }
}

/** Caller-supplied policy for a validation run. */
export interface StyleValueOptions {
  /**
   * Which hosts this site will fetch from.
   *
   * Absent by default, and absent means unasked rather than allowed: the engine
   * ships no host list of its own, because which hosts a site trusts is the
   * site operator's decision and not a property of the document format.
   */
  mayFetchUrl?: MayFetchUrl;
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
  suppliedBudget?: StyleIssueBudget,
  skipValueParsing = false,
  suppliedTokens?: TokenLookup,
  // An OBJECT, where the six before it are positional. Six is already past the
  // point where a call reads by position, and the next optional added in line
  // would sit beside `suppliedTokens` with nothing but its type to tell them
  // apart. A named field cannot be mis-slotted, and a caller who omits it gets
  // exactly today's behaviour rather than a policy that silently did nothing.
  options?: StyleValueOptions
): ValidationIssue[] {
  // The structural half of this shape has been public since it shipped, so a
  // caller may hand back an object that predates the site allowance. Filling it
  // in beats reading a missing number: validation reports, it does not throw.
  const budget = normalizeStyleIssueBudget(suppliedBudget);
  const tokens = memoizeTokenLookup(suppliedTokens, budget);
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
        ...shapeIssues(entry.shape, value, path, budget, 0, 0, {
          tokens,
          mayFetchUrl: options?.mayFetchUrl,
        })
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
