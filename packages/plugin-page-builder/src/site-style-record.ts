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
  newStyleIssueBudget,
  validateFontFace,
  validateStyleValues,
  type BreakpointDef,
  type BreakpointSet,
  type FontFaceDef,
  type MayFetchUrl,
  type NamedClass,
  type SiteToken,
  type SiteTokenSet,
  type StyleIssueBudget,
  type TokenKind,
} from "@nextlyhq/blocks-engine";

import {
  resolveSiteStyle,
  siteStyleOf,
  type SiteStyleData,
} from "./site-style";

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

/**
 * What a checker needs from the SITE, beyond the value being checked.
 *
 * A predicate rather than the host list it is derived from, so this module
 * keeps importing only the engine and one implementation of host matching
 * answers for every channel — the published sheet, the canvas and this gate.
 */
export interface SectionPolicy {
  /**
   * Which hosts this site will fetch from. Absent means unasked rather than
   * allowed, exactly as the engine treats it: with no policy the scheme
   * allowlist is the only limit on a `url()`.
   */
  mayFetchUrl?: MayFetchUrl;
  /**
   * The CONFIG tier this write will be merged with, when the caller has one.
   *
   * A checker seeing only the stored array judges something no consumer ever
   * compiles. Every consumer reads the merge, config first, and both engine
   * resolutions are first-wins — so a stored class whose slug a config class
   * already holds is accepted here and then dropped at render, and the node
   * referencing it gets no rule at all. Judging the merge is what makes the
   * refusal happen while the writer is present.
   *
   * Absent means the caller stated no defaults, not that there are none to
   * consider; a checker with no config tier judges the stored one, which is
   * exactly what it did before.
   */
  defaults?: SiteStyleData;
}

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
export function checkStoredTokens(
  raw: unknown,
  policy: SectionPolicy = {}
): SectionCheck<SiteTokenSet> {
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
  //
  // Emitted over the MERGE, because that is what every consumer compiles. A
  // stored token colliding with a config one on a single custom property is
  // refused by the emitter, and config is inserted first, so without this the
  // write is accepted and the token silently never applies.
  //
  // Reported as a DIFFERENCE against the config tier alone. A site whose own
  // config already emits an issue has a problem, but it is not one this write
  // introduced and not one the writer can fix from here — refusing their save
  // for it would be telling them about somebody else's mistake.
  //
  // `resolveSiteStyle` does the merging rather than a local one: it is the one
  // answer to what the merged style is, and a second one here would drift from
  // the render it is meant to predict.
  const merged = resolveSiteStyle(policy.defaults, { tokens: set }).tokens;
  const already = new Set(
    policy.defaults?.tokens === undefined
      ? []
      : emitTokenBlocks(policy.defaults.tokens, ":root").issues.map(
          issue => issue.message
        )
  );
  for (const issue of emitTokenBlocks(merged ?? set, ":root").issues) {
    if (!already.has(issue.message)) issues.push(issue.message);
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
 * Every property map inside a class envelope, with the address it sits at.
 *
 * `NodeStyles` is state × breakpoint × property, and the engine's value
 * validator judges ONE state × breakpoint's properties, so the two levels above
 * it are flattened here, by OWN key as the engine reads style maps.
 *
 * Every key is descended rather than only the states and breakpoints this
 * package knows. A breakpoint the site has not defined compiles to no rule
 * today and to a real rule the moment someone defines it, so a walk that
 * visited only what compiles now would gate less than the sheet eventually
 * serves. A level that is not a record is skipped rather than reported: the
 * envelope's SHAPE is `isUsableNamedClass`'s question, already asked.
 *
 * A generator, so a caller that has seen enough stops the walk rather than
 * receiving a list that was built in full first. The number of maps is bounded
 * only by the document's byte cap, and a payload can spend that cap on maps as
 * easily as on values.
 */
function* styleMapsIn(
  styles: Readonly<Record<string, unknown>>
): Generator<{ at: string; values: Readonly<Record<string, unknown>> }> {
  // `for...in` with an own-key guard rather than `Object.keys`, which is the
  // idiom `validateStyleValues` iterates its own property map by, for the
  // reason its comment gives: a map with a hundred thousand keys would
  // otherwise be materialised in full before anything downstream can stop.
  // Measured through a proxy counting descriptor lookups, breaking after the
  // first entry: `Object.keys` costs one per key up front, `for...in` one in
  // total. The guard is what keeps this to OWN keys, which the engine reads
  // style maps by.
  for (const state in styles) {
    if (!Object.hasOwn(styles, state)) continue;
    const byBreakpoint = styles[state];
    if (!isPlainRecord(byBreakpoint)) continue;
    for (const breakpoint in byBreakpoint) {
      if (!Object.hasOwn(byBreakpoint, breakpoint)) continue;
      const values = byBreakpoint[breakpoint];
      if (isPlainRecord(values)) yield { at: `${state}.${breakpoint}`, values };
    }
  }
}

/**
 * The values inside one class, judged by the engine's own validator.
 *
 * `isUsableNamedClass` types the envelope and stops at it: it never reads
 * inside `styles`. So the section's only value-level limit used to be whatever
 * the compiler drops at render, which is too late for a `url()` — the sheet is
 * already serving it to every visitor of every page. The token section has
 * never had that gap, because its gate IS its emitter.
 *
 * Errors only. A warning is a value the engine ACCEPTS and emits, so refusing
 * on one would refuse writes whose result the sheet would render happily.
 *
 * The MODE follows the policy, and it decides exactly one thing: whether a
 * property this engine has not learned is an error or a warning. Measured —
 * `mode === "strict" ? "error" : "warning"` occurs once in the whole validator,
 * in the unknown-property branch — so this switch cannot over-refuse anything
 * else.
 *
 * With no policy the answer is FORGIVING: a document written by a newer engine
 * is not something the author can fix here, and there is no host rule to
 * enforce anyway.
 *
 * With a policy it is STRICT, because the validator does not look INSIDE an
 * unknown property. `{ futureBackground: { url: "https://tracker.example" } }`
 * yields `unknown-style-property` alone — no value check at all — so a
 * forgiving read would store a URL that becomes live the moment an engine
 * learns that property, with no further validating write. A gate that cannot
 * judge a value must not pass it: this package's own url-policy module states
 * the same rule for the same reason, that a security control should fail
 * toward the annoyance. The cost is that a site WITH a host policy cannot store
 * a property this engine does not know, and is told which one.
 *
 * The BUDGET is the caller's, spanning the whole section, and the walk stops
 * when it is spent. One budget per MAP would bound each map and nothing else:
 * measured, a class spreading bad properties over 200 maps produced 40,200
 * diagnostics that way against 201 with one budget, and the map count is
 * limited only by the document's byte cap. Per CLASS has the same shape one
 * level up — `MAX_NAMED_CLASSES` is 2000, and the count check reports without
 * stopping the walk, so the array is not bounded at all.
 */
function classValueIssues(
  entry: NamedClass,
  index: number,
  policy: SectionPolicy,
  budget: StyleIssueBudget
): string[] {
  const options =
    policy.mayFetchUrl === undefined
      ? undefined
      : { mayFetchUrl: policy.mayFetchUrl };
  const mode = policy.mayFetchUrl === undefined ? "forgiving" : "strict";
  const issues: string[] = [];
  for (const { at, values } of styleMapsIn(entry.styles)) {
    for (const issue of validateStyleValues(
      values,
      `classes[${index}].styles.${at}`,
      mode,
      budget,
      false,
      undefined,
      options
    )) {
      if (issue.severity === "error") issues.push(issue.message);
    }
    // Truncation is itself an error, so it is already among the messages above
    // and the write is refused. What stopping adds is that the refusal costs a
    // bounded amount of work rather than one batch per remaining map.
    if (budget.truncated) break;
  }
  return issues;
}

/**
 * What the stored classes do once merged with the tier they will be merged with.
 *
 * Asked of `resolveSiteStyle` rather than modelled here, and asked even when
 * there is no config tier: the merge of nothing and the stored array is the
 * stored array, so one path covers both and the cap cannot be lost with it.
 *
 * The merge is keyed by class ID, so a stored class sharing an id with a config
 * one REPLACES it — concatenating the two tiers instead would refuse a
 * deliberate override as a duplicate, and would count a replacement twice
 * against the cap.
 *
 * What survives the merge and still breaks is a SLUG held by two different
 * ids: the compiler drops the later one, so a node referencing it gets no rule.
 * The cap is the merged length for the same reason — the compiler truncates the
 * merged library by array prefix.
 */
function mergedLibraryIssues(
  classes: readonly NamedClass[],
  policy: SectionPolicy
): string[] {
  // Run whether or not a config tier was stated. With none, the merge is the
  // stored array itself and the cap below is the only check that applies — but
  // it applies, and skipping it here would let a site with no config defaults
  // store more classes than the compiler reads.
  const merged = resolveSiteStyle(policy.defaults, { classes }).classes ?? [];
  const issues: string[] = [];
  if (merged.length > MAX_NAMED_CLASSES) {
    issues.push(
      `The class library holds ${merged.length} entries once merged with this site's config; the compiler reads at most ${MAX_NAMED_CLASSES}.`
    );
  }
  const owner = new Map<string, string>();
  const reported = new Set<string>();
  for (const entry of merged) {
    const held = owner.get(entry.slug);
    if (held === undefined) {
      owner.set(entry.slug, entry.id);
      continue;
    }
    if (held !== entry.id && !reported.has(entry.slug)) {
      reported.add(entry.slug);
      issues.push(
        `The slug "${entry.slug}" is held by two different classes once merged with this site's config; the compiler keeps the first, so the other is dropped at render.`
      );
    }
  }
  return issues;
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
 *
 * The VALUES inside each entry are judged too, under the site's host policy —
 * see `classValueIssues`. A class is emitted into the sheet of every public
 * page, so a `url()` here reaches every visitor, and it is emitted verbatim
 * rather than through the `var()` substitution that makes a token's own gate
 * the last chance to stop one.
 */
export function checkStoredClasses(
  raw: unknown,
  policy: SectionPolicy = {}
): SectionCheck<readonly NamedClass[]> {
  if (raw === undefined || raw === null) return EMPTY;
  if (!Array.isArray(raw)) {
    return { issues: ["Classes must be an array of named classes."] };
  }
  const issues: string[] = [];

  // ONE for the whole section: see `classValueIssues` for why neither per map
  // nor per class bounds the work a single write can ask for.
  const budget = newStyleIssueBudget();
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
    // Reported but still returned, as this module's two postures require: a
    // write refuses the section on any issue, while a read keeps the entry the
    // compiler will narrow for itself.
    if (!budget.truncated) {
      issues.push(...classValueIssues(entry, index, policy, budget));
    }
    classes.push(entry);
  });
  issues.push(...mergedLibraryIssues(classes, policy));
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
