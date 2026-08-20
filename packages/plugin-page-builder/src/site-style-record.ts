/**
 * Reading and checking a stored Site Style document, with the engine's rules.
 *
 * ## Two postures over ONE set of checks
 *
 * Each section (tokens, fonts, classes, breakpoints) has exactly one checker,
 * and the write path and the read path differ only in what they do with its
 * answer:
 *
 * - **Writes fail closed.** The Site Style single's field validators (in
 *   `site-style-storage`) refuse the whole section on any issue, so garbage
 *   never reaches storage quietly. The checks are the ENGINE's —
 *   `emitTokenBlocks`, `validateFontFace`, `isUsableNamedClass` — because a
 *   validator restated here would drift from the compiler it is guarding.
 * - **Reads tolerate by narrowing.** Stored rows predate their validators, so
 *   a read keeps what it can type and drops what it cannot, exactly as the
 *   engine's own emitters drop what they cannot compile. A read that refused
 *   would take down every page on the site over one legacy row.
 *
 * Isomorphic on purpose: only the engine is imported, so the editor canvas
 * can narrow the serialized defaults it receives with the same checks the
 * server writes by.
 *
 * @module @nextlyhq/plugin-page-builder/site-style-record
 */
import {
  MAX_BREAKPOINTS_PER_AXIS,
  MAX_NAMED_CLASSES,
  TOKEN_KINDS,
  emitTokenBlocks,
  isPlainRecord,
  isUsableNamedClass,
  validateFontFace,
  type BreakpointDef,
  type BreakpointSet,
  type FontFaceDef,
  type NamedClass,
  type SiteToken,
  type SiteTokenSet,
  type TokenKind,
} from "@nextlyhq/blocks-engine";

import { siteStyleOf, type SiteStyleData } from "./site-style";

/**
 * One section's verdict: the narrowed value a reader may use, and the issues
 * a writer must not ignore.
 *
 * `value` is present whenever the section was SHAPE-readable — even when it
 * carries value-level issues — because the engine already drops a bad token or
 * face at compile time, per entry, and a read that pre-dropped whole sections
 * would lose more than the compiler would. Entries the shape check itself
 * cannot type are excluded from `value` AND reported, so a write refuses them
 * and a read skips them, from the same finding.
 */
export interface SectionCheck<T> {
  value?: T;
  issues: string[];
}

/** An absent section: nothing stored, nothing wrong. */
const EMPTY: SectionCheck<never> = { issues: [] };

/** Shared shape guard: a string, when the slot allows one. */
const optionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === "string";

/**
 * The stored token set, checked with the engine's own rules.
 *
 * Shape first, because `emitTokenBlocks` walks entries it assumes are
 * records — then the emitter itself, whose issues cover everything about
 * VALUES: names that cannot become custom properties, missing light values,
 * values CSS cannot hold, values that would fetch, colliding properties, and
 * kind mismatches. Refusing on the emitter's whole report is deliberately
 * stricter than the emitter (which writes a kind mismatch and warns): at
 * write time the author is present to fix it, and accepting a value the
 * browser will drop stores a defect for someone else to debug at render time.
 */
export function checkStoredTokens(raw: unknown): SectionCheck<SiteTokenSet> {
  if (raw === undefined || raw === null) return EMPTY;
  if (!isPlainRecord(raw) || !Array.isArray(raw.tokens)) {
    return {
      issues: ['Tokens must be an object with a "tokens" array.'],
    };
  }
  const issues: string[] = [];
  const tokens: SiteToken[] = [];
  raw.tokens.forEach((entry: unknown, index) => {
    if (
      !isPlainRecord(entry) ||
      typeof entry.name !== "string" ||
      typeof entry.kind !== "string" ||
      !(TOKEN_KINDS as readonly string[]).includes(entry.kind) ||
      !isPlainRecord(entry.values) ||
      typeof entry.values.light !== "string" ||
      !optionalString(entry.values.dark) ||
      !optionalString(entry.description)
    ) {
      issues.push(
        `tokens[${index}] is not a token: it needs a string name, a kind (${TOKEN_KINDS.join(", ")}), and values with a light string (dark optional).`
      );
      return;
    }
    tokens.push({
      name: entry.name,
      kind: entry.kind as TokenKind,
      values: {
        light: entry.values.light,
        ...(entry.values.dark === undefined ? {} : { dark: entry.values.dark }),
      },
      ...(entry.description === undefined
        ? {}
        : { description: entry.description }),
      ...(isPlainRecord(entry.extensions)
        ? { extensions: entry.extensions }
        : {}),
    });
  });

  if (!optionalString(raw.prefix)) {
    issues.push("The token prefix must be a string when set.");
  }
  const darkMode = raw.darkMode;
  if (
    darkMode !== undefined &&
    darkMode !== "attribute" &&
    darkMode !== "media"
  ) {
    issues.push('darkMode must be "attribute" or "media" when set.');
  }

  const set: SiteTokenSet = {
    tokens,
    ...(typeof raw.prefix === "string" ? { prefix: raw.prefix } : {}),
    ...(darkMode === "attribute" || darkMode === "media" ? { darkMode } : {}),
  };
  // The emitter is the validator: it is what will read this set on every
  // page render, so its report is the one that counts. The selector is
  // irrelevant to validation; the CSS is discarded.
  for (const issue of emitTokenBlocks(set, ":root").issues) {
    issues.push(issue.message);
  }
  return { value: set, issues };
}

/** The stored font faces, each checked by the engine's own face validator. */
export function checkStoredFonts(
  raw: unknown
): SectionCheck<readonly FontFaceDef[]> {
  if (raw === undefined || raw === null) return EMPTY;
  if (!Array.isArray(raw)) {
    return { issues: ["Fonts must be an array of font faces."] };
  }
  const issues: string[] = [];
  const faces: FontFaceDef[] = [];
  raw.forEach((entry: unknown, index) => {
    const face = readFontFace(entry);
    if (face === undefined) {
      issues.push(
        `fonts[${index}] is not a font face: it needs a string family and a src array of { url, format? } records.`
      );
      return;
    }
    faces.push(face);
    // The engine decides what a servable face is — including the refusal of
    // remote sources — so its messages travel to the writer verbatim.
    for (const issue of validateFontFace(face, `fonts[${index}]`)) {
      issues.push(issue.message);
    }
  });
  return { value: faces, issues };
}

/** One face's shape, or nothing. Value rules stay `validateFontFace`'s. */
function readFontFace(entry: unknown): FontFaceDef | undefined {
  if (!isPlainRecord(entry)) return undefined;
  if (typeof entry.family !== "string" || !Array.isArray(entry.src)) {
    return undefined;
  }
  const src: FontFaceDef["src"][number][] = [];
  for (const source of entry.src) {
    const record: unknown = source;
    if (
      !isPlainRecord(record) ||
      typeof record.url !== "string" ||
      !optionalString(record.format)
    ) {
      return undefined;
    }
    src.push({
      url: record.url,
      ...(record.format === undefined ? {} : { format: record.format }),
    });
  }
  if (
    !optionalString(entry.weight) ||
    !optionalString(entry.style) ||
    !optionalString(entry.display) ||
    !optionalString(entry.unicodeRange)
  ) {
    return undefined;
  }
  return {
    family: entry.family,
    src,
    ...(entry.weight === undefined ? {} : { weight: entry.weight }),
    ...(entry.style === undefined ? {} : { style: entry.style }),
    ...(entry.display === undefined ? {} : { display: entry.display }),
    ...(entry.unicodeRange === undefined
      ? {}
      : { unicodeRange: entry.unicodeRange }),
  };
}

/**
 * The stored class library.
 *
 * Usability per entry is the engine's `isUsableNamedClass` — the same
 * predicate the compiler and the renderer consult, so a class stored here is
 * a class they will read. `orderIndex` is checked on top because the
 * predicate does not cover it, yet the type requires it and the library
 * order is what precedence between classes MEANS.
 *
 * Duplicates are refused at write where the compiler would drop them at read:
 * a duplicate slug puts two rule sets on one selector, and a duplicate id
 * makes a node's reference ambiguous. Both are cheaper to reject while the
 * writer is present than to explain after a page styles itself with the
 * wrong preset.
 */
export function checkStoredClasses(
  raw: unknown
): SectionCheck<readonly NamedClass[]> {
  if (raw === undefined || raw === null) return EMPTY;
  if (!Array.isArray(raw)) {
    return { issues: ["Classes must be an array of named classes."] };
  }
  const issues: string[] = [];
  if (raw.length > MAX_NAMED_CLASSES) {
    issues.push(
      `The class library holds ${raw.length} entries; the compiler reads at most ${MAX_NAMED_CLASSES}.`
    );
  }
  const classes: NamedClass[] = [];
  const ids = new Set<string>();
  const slugs = new Set<string>();
  raw.forEach((entry: unknown, index) => {
    if (!isUsableNamedClass(entry) || !Number.isFinite(entry.orderIndex)) {
      issues.push(
        `classes[${index}] is not a usable class: it needs a string id, a lowercase dash-separated slug, a numeric orderIndex and a styles record.`
      );
      return;
    }
    if (ids.has(entry.id)) {
      issues.push(`classes[${index}] repeats the id "${entry.id}".`);
      return;
    }
    if (slugs.has(entry.slug)) {
      issues.push(`classes[${index}] repeats the slug "${entry.slug}".`);
      return;
    }
    ids.add(entry.id);
    slugs.add(entry.slug);
    classes.push(entry);
  });
  return { value: classes, issues };
}

/**
 * The stored breakpoint set.
 *
 * The rules are the ones the engine's validation states about the set it is
 * handed: ids unique ACROSS both axes (a node's style key carries no axis, so
 * a repeated id is ambiguous), at most `MAX_BREAKPOINTS_PER_AXIS` per axis,
 * and a `maxWidth` that is a positive number when present. An absent axis
 * reads as empty rather than refusing, so a document storing only viewport
 * breakpoints — the common case — round-trips unchanged.
 */
export function checkStoredBreakpoints(
  raw: unknown
): SectionCheck<BreakpointSet> {
  if (raw === undefined || raw === null) return EMPTY;
  if (!isPlainRecord(raw)) {
    return {
      issues: ["Breakpoints must be an object with viewport/container arrays."],
    };
  }
  const issues: string[] = [];
  const seen = new Set<string>();
  const readAxis = (axis: "viewport" | "container"): BreakpointDef[] => {
    const rawAxis = raw[axis];
    if (rawAxis === undefined) return [];
    if (!Array.isArray(rawAxis)) {
      issues.push(`breakpoints.${axis} must be an array.`);
      return [];
    }
    if (rawAxis.length > MAX_BREAKPOINTS_PER_AXIS) {
      issues.push(
        `breakpoints.${axis} defines ${rawAxis.length} breakpoints; the maximum per axis is ${MAX_BREAKPOINTS_PER_AXIS}.`
      );
    }
    const defs: BreakpointDef[] = [];
    rawAxis.forEach((entry: unknown, index) => {
      if (
        !isPlainRecord(entry) ||
        typeof entry.id !== "string" ||
        entry.id === "" ||
        typeof entry.label !== "string" ||
        (entry.maxWidth !== undefined &&
          (typeof entry.maxWidth !== "number" ||
            !Number.isFinite(entry.maxWidth) ||
            entry.maxWidth <= 0))
      ) {
        issues.push(
          `breakpoints.${axis}[${index}] is not a breakpoint: it needs a string id, a label, and a positive maxWidth when one is set.`
        );
        return;
      }
      if (seen.has(entry.id)) {
        issues.push(
          `breakpoints.${axis}[${index}] repeats the id "${entry.id}"; ids must be unique across both axes.`
        );
        return;
      }
      seen.add(entry.id);
      defs.push({
        id: entry.id,
        label: entry.label,
        ...(entry.maxWidth === undefined ? {} : { maxWidth: entry.maxWidth }),
      });
    });
    return defs;
  };
  const viewport = readAxis("viewport");
  const container = readAxis("container");
  return { value: { viewport, container }, issues };
}

/**
 * The stored tier of the site style, read from a Site Style document.
 *
 * Reading posture: keep what the checkers could type, drop what they could
 * not, and say nothing — the engine reports and skips value-level problems at
 * compile, so re-reporting them per render would say the same thing twice.
 */
export function readSiteStyleRecord(doc: unknown): SiteStyleData {
  if (!isPlainRecord(doc)) return {};
  return siteStyleOf({
    tokens: checkStoredTokens(doc.tokens).value,
    fonts: checkStoredFonts(doc.fonts).value,
    classes: checkStoredClasses(doc.classes).value,
    breakpoints: checkStoredBreakpoints(doc.breakpoints).value,
  });
}
