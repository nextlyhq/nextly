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
  resolveSiteTokens,
  usableNamedClasses,
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
 * A record or nothing, for the two fields whose CONTENTS this layer never reads.
 *
 * Refused rather than narrowed away. Both carry data that exists to survive a
 * round trip — another tool's, and a newer build of this one's — so dropping a
 * malformed one quietly would report a successful save that discarded exactly
 * what the author was trying to keep. The shape is all that can be judged here;
 * what is inside came from a design-token file.
 */
const optionalRecord = (
  value: unknown
): value is Readonly<Record<string, unknown>> | undefined =>
  value === undefined || isPlainRecord(value);

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
      !optionalString(entry.description) ||
      // Shape only. Whether the id can become a custom property is the
      // emitter's question and it already asks it, holding an id to the same
      // grammar as a name because it reaches CSS by the same route. What has
      // to happen HERE is that a non-string is refused rather than skipped:
      // this identity is what a document's `$token` resolves through, so
      // letting an unusable one fall out of the object would lose it on a save
      // the author is told succeeded.
      !optionalString(entry.id) ||
      !optionalRecord(entry.extensions) ||
      !optionalRecord(entry.unreadExtension)
    ) {
      issues.push(
        `tokens[${index}] is not a token: it needs a string name, a kind (${TOKEN_KINDS.join(", ")}), and values with a light string (dark optional). An id, when present, must be a string, and extensions must be an object.`
      );
      return;
    }
    tokens.push({
      // Carried, not rebuilt. The id is the whole point of the field: it is
      // what a rename leaves alone, so a write that does not preserve it turns
      // every rename into a silent break of every reference.
      ...(entry.id === undefined ? {} : { id: entry.id }),
      name: entry.name,
      kind: entry.kind as TokenKind,
      values: {
        light: entry.values.light,
        ...(entry.values.dark === undefined ? {} : { dark: entry.values.dark }),
      },
      ...(entry.description === undefined
        ? {}
        : { description: entry.description }),
      // Both named here because this object is a WHITELIST: a token field the
      // list omits is dropped by a save that reports success, which for either
      // of these would mean data survives an import and is lost the moment the
      // site is written. The guard above has already refused anything that is
      // neither a record nor absent, so a present value here is a record.
      ...(entry.extensions === undefined
        ? {}
        : { extensions: entry.extensions }),
      ...(entry.unreadExtension === undefined
        ? {}
        : { unreadExtension: entry.unreadExtension }),
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
  issues.push(...tokenEmissionIssues(set, policy));
  return { value: set, issues };
}

/**
 * What emitting this token set would report, minus what the config tier already
 * reported on its own.
 *
 * The emitter is the validator: it is what will read the set on every page
 * render, so its report is the one that counts. The selector is irrelevant to
 * validation; the CSS is discarded.
 *
 * Three runs, because "did this write cause it" and "is this new" are different
 * questions and only the second can be answered by comparing merged against
 * config.
 *
 * The stored set's OWN issues are always reported. A message names the token
 * and not the offending value, so a config token that already emits one and a
 * stored override emitting a different one produce byte-identical strings — and
 * suppressing on that accepts a value the compiler drops. What the writer wrote
 * is theirs whatever the config tier says.
 *
 * Only issues the MERGE creates are compared and suppressed when the config
 * tier already had them, because a collision that predates this write is not
 * reachable from the admin. `resolveSiteStyle` does the merging rather than a
 * second implementation here: it is the one answer to what the merged style is,
 * and a local copy would drift from the render it exists to predict.
 */
function tokenEmissionIssues(
  set: SiteTokenSet,
  policy: SectionPolicy
): string[] {
  // Two runs over the stored set, and the second is not redundant with the
  // first. AS RENDERED is what a page produces. AS AUTHORED is the only view in
  // which two entries sharing one identity are both still present — resolving
  // keys them into a Map and keeps one, so the emitter's collision check cannot
  // observe the pair it names in its own comment. Without this run, an author
  // can rename a token and then create a new one under the freed name, and the
  // save succeeds while one of the two silently stops existing.
  const own = [...new Set([...emittedMessages(set), ...authoredMessages(set)])];
  const merged = resolveSiteStyle(policy.defaults, { tokens: set }).tokens;
  // The config tier emitted under the MERGED prefix, so the two runs are
  // comparable. A collision message renders the custom property the two names
  // both become, and the prefix is part of that rendering rather than part of
  // the collision — emitting the baseline under its own prefix makes a write
  // that changes only the prefix look like a brand new collision, and refuses
  // it for a clash it did not cause and cannot reach.
  const inherited = new Set(
    policy.defaults?.tokens === undefined
      ? []
      : emittedMessages(withPrefixOf(policy.defaults.tokens, merged))
  );
  const reported = new Set(own);
  const issues = [...own];
  for (const message of emittedMessages(merged ?? set)) {
    if (inherited.has(message) || reported.has(message)) continue;
    reported.add(message);
    issues.push(message);
  }
  return issues;
}

/** One token set as it would render under another's prefix. */
function withPrefixOf(
  tokens: SiteTokenSet,
  under: SiteTokenSet | undefined
): SiteTokenSet {
  return under?.prefix === undefined
    ? tokens
    : { ...tokens, prefix: under.prefix };
}

/**
 * What emitting one token set reports, as plain messages, AS RENDERED.
 *
 * Resolved through `resolveSiteTokens` first, because that is what a page does:
 * `PageRenderer` layers the site's tokens over the engine's defaults before
 * compiling, so a stored name that collides with a default is dropped at render
 * while a gate judging the stored and config tiers alone sees nothing at all.
 * Measured: `color-primary` emits no issue on its own and collides with the
 * default `color.primary` on `--site-color-primary` once resolved.
 *
 * Applied here rather than at each call so all three emissions — the stored set,
 * the config baseline and the merge — are judged against the same tier stack.
 */
function emittedMessages(tokens: SiteTokenSet): string[] {
  return emitTokenBlocks(resolveSiteTokens(tokens), ":root").issues.map(
    issue => issue.message
  );
}

/**
 * What emitting one token set reports AS AUTHORED, without resolving it.
 *
 * The un-resolved run exists for one class the resolved one cannot reach.
 * `resolveSiteTokens` is a Map keyed on identity, so two stored entries sharing
 * an identity — a token renamed away from a name, and a new token that claims
 * it — are reduced to one before `emitTokenBlocks` is handed the set. The
 * emitter holds the check for exactly that pair and names it in its own
 * comment; it simply is never shown both.
 *
 * Nothing is restated here. It is the same emitter answering the same question
 * about a set that has not had one of the two removed from it.
 */
function authoredMessages(tokens: SiteTokenSet): string[] {
  return emitTokenBlocks(tokens, ":root").issues.map(issue => issue.message);
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

/**
 * The stored font rows this reader cannot type, named by their position.
 *
 * The reading posture drops what it cannot type, which is right for a RENDER —
 * one legacy row must not take the editor down. It is wrong for a WRITE. A
 * section is saved by replacement, so a writer that appends to the read value
 * sends a list with the dropped rows missing, and they are gone: the write
 * succeeds, because what it sends is exactly what the checker approves.
 *
 * Answered here, from `readFontFace` — the same predicate the reader drops on,
 * so the two cannot come to disagree about which rows survive.
 *
 * A writer that has these must refuse rather than proceed. It is not a
 * regression to refuse: `refusing` in {@link site-style-storage} rejects a
 * write over ANY issue, so the row already blocks every save of this section;
 * refusing early names the row before an upload it cannot use.
 *
 * The same question exists for classes and breakpoints and is not asked here,
 * because their writers hand over a whole set the author edited rather than
 * appending to what was read — a different shape, whose answer belongs with
 * whichever writer first needs it.
 *
 * @param doc - The stored Site Style document, as read
 * @returns One `fonts[i]` label per unreadable row, empty when all were typed
 */
export function unreadableStoredFonts(doc: unknown): readonly string[] {
  if (!isPlainRecord(doc) || !Array.isArray(doc.fonts)) return [];
  const unreadable: string[] = [];
  doc.fonts.forEach((entry: unknown, index) => {
    if (readFontFace(entry) === undefined) unreadable.push(`fonts[${index}]`);
  });
  return unreadable;
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
  // Asked of the engine, never modelled. `usableNamedClasses` is the list the
  // compiler writes and the renderer is handed, so it already applies the
  // ordering (`orderIndex`, then `id`) and the claim rules (a slug or an id
  // already taken drops the later entry). Reproducing those here was wrong four
  // separate ways, each a different rule; asking cannot be wrong in any of
  // them.
  //
  // The cap is applied BEFORE resolution, as an array prefix on the whole
  // library, so it is applied that way here too.
  const merged = resolveSiteStyle(policy.defaults, { classes }).classes ?? [];
  const before = renderedIds(policy.defaults?.classes ?? []);
  const after = renderedIds(merged);

  const issues: string[] = [];
  // A class the site used to render and no longer does. This write caused it,
  // whether by claiming its slug, taking its id, reordering it behind another,
  // or pushing it past the cap.
  for (const id of before) {
    if (!after.has(id)) {
      issues.push(
        `Saving this would stop the class "${id}" rendering: once merged with this site's config it is no longer one of the ${MAX_NAMED_CLASSES} the compiler reads, or another class claims its slug or id first.`
      );
    }
  }
  // A class in this write that will not render. Reported by id, because that is
  // what a node references and what the author can act on.
  for (const entry of classes) {
    if (!after.has(entry.id)) {
      issues.push(
        `The class "${entry.id}" would not render: once merged with this site's config another class claims its slug or id first, or it falls past the ${MAX_NAMED_CLASSES} the compiler reads.`
      );
    }
  }
  return issues;
}

/** The ids a library actually renders, as the compiler resolves it. */
function renderedIds(library: readonly NamedClass[]): Set<string> {
  const read =
    library.length > MAX_NAMED_CLASSES
      ? library.slice(0, MAX_NAMED_CLASSES)
      : library;
  return new Set(usableNamedClasses(read).map(entry => entry.id));
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
