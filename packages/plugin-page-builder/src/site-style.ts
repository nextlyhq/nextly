/**
 * The site's style inputs, in one place.
 *
 * Tokens, fonts, named classes and breakpoints are site-level data this plugin
 * owns: the engine never reads storage, so it validates and compiles against
 * whatever set it is handed, and the answer to "what does this site define"
 * has to come from here.
 *
 * The inputs are LAYERED, and this module is the one merge point:
 *
 * 1. Config-supplied defaults — what the host's code states on the
 *    `pageBuilder({ siteStyle })` factory. A site whose design lives in the
 *    repository states it here and needs no database row.
 * 2. The stored Site Style document — what admins write through the API or,
 *    later, the style studios. Stored values override config defaults.
 *
 * `resolveSiteStyle` is the one implementation of that layering. The engine
 * applies a third, lower tier on its own — `resolveSiteTokens` layers the
 * merged token set over the engine's guaranteed defaults — so the full order
 * on a published page is engine defaults, then config defaults, then stored
 * edits: the theme.json arrangement of core, then the theme, then the user's
 * saved styles.
 *
 * It lives in its own module because SEVERAL surfaces need it and they must
 * not disagree. The field validator compiles a document against these
 * breakpoints; the editor canvas compiles the site sheet against them to draw
 * the same document; the published route compiles the sheet it serves. Two
 * merges written separately look identical on the day they are written, and
 * the day they diverge the canvas draws a layout the validator does not
 * accept — with each side internally consistent, so nothing looks wrong.
 *
 * Node-safe: no React, no admin imports. The validator runs server-side.
 *
 * @module @nextlyhq/plugin-page-builder/site-style
 */
import {
  DEFAULT_FLUID_RANGE,
  isLook,
  sameJsonValue,
  sameSiteToken,
  tokenIdentity,
} from "@nextlyhq/blocks-engine";
import type {
  BreakpointSet,
  FontFaceDef,
  NamedClass,
  SiteSheetInput,
  SiteToken,
  SiteTokenSet,
} from "@nextlyhq/blocks-engine";

/**
 * One tier of site style: what a host's config states, or what the stored
 * Site Style document holds. Every shape is the engine's own — a parallel
 * declaration here would be a second statement of the same contract, free to
 * drift from the one the compiler reads.
 *
 * `tokens` carries modes already: a `SiteToken`'s `values` holds `light`
 * (required) and `dark` (optional), so a stored token set never needs a
 * format migration when the mode UI arrives.
 */
export interface SiteStyleData {
  /** Design tokens, with per-mode values. Emitted as custom properties. */
  tokens?: SiteTokenSet;
  /** Self-hosted font faces. Remote sources are refused by the engine. */
  fonts?: readonly FontFaceDef[];
  /** The named-class library, in the order classes override one another. */
  classes?: readonly NamedClass[];
  /** The site's breakpoints, on both axes. */
  breakpoints?: BreakpointSet;
}

/**
 * What the server log says when a host still passes `siteStyle.spacingMode`,
 * or nothing when it does not. The option was removed: blocks are always
 * spaced by the gap of the container holding them. It is no longer in the
 * option's type, so only an untyped host reaches this, and it still starts:
 * the value is ignored rather than refused, since refusing would take a site
 * down over a setting that no longer does anything.
 */
export function removedSiteStyleOption(siteStyle: unknown): string | undefined {
  if (typeof siteStyle !== "object" || siteStyle === null) return undefined;
  if (!Object.hasOwn(siteStyle, "spacingMode")) return undefined;
  return "[page-builder] `siteStyle.spacingMode` was removed and is ignored: blocks are always spaced by the gap of the container holding them. Remove it from the pageBuilder() options.";
}

/**
 * The merged site style: config defaults with stored edits layered on top.
 *
 * The granularity of "layered" differs by section, and each choice follows
 * from what a partial override would mean there:
 *
 * - **Tokens merge by IDENTITY** — `id` when the token carries one, and the
 *   name when it does not. Per entry rather than whole-set, because a site
 *   storing one brand colour must not lose the config's `content.width`: an
 *   unresolved custom property invalidates the declaration silently, so
 *   replacement fails invisibly. The KEY is the identity rather than the name
 *   because a tier overrides the token and not the label — a site that renamed
 *   a config token holds it under the config token's identity with a name of
 *   its own, and keying on the name would leave the config entry standing
 *   beside it. Same key, for that reason, as the engine's `resolveSiteTokens`,
 *   which this result is later handed to for the engine-defaults tier. For a
 *   set where nothing carries an id this is exactly the name merge it has
 *   always been. `prefix` and `darkMode` are site-wide decisions, not per-token
 *   values, so the stored ones win when stated.
 * - **Classes merge by ID.** A document references a class by its id, so the
 *   id is the unit of override: a stored class replaces the config class with
 *   the same id and keeps every other one. Each entry keeps its own
 *   `orderIndex`; precedence stays the engine's question.
 * - **Fonts merge by face identity** — family, weight, style and range
 *   together, because one family legitimately ships several faces and replacing by
 *   family alone would drop the italics when someone re-uploads the regular.
 * - **Breakpoints REPLACE as a whole set.** A breakpoint set is one designed
 *   cascade; splicing half of one set into half of another produces at-rules
 *   nobody chose. A stored set that defines any breakpoint wins outright; an
 *   empty stored set means "not configured" and leaves the defaults standing.
 */
export function resolveSiteStyle(
  defaults?: SiteStyleData,
  stored?: SiteStyleData
): SiteStyleData {
  return siteStyleOf({
    tokens: mergeTokens(defaults?.tokens, stored?.tokens),
    fonts: mergeByKey(defaults?.fonts, stored?.fonts, faceIdentity),
    classes: mergeByKey(
      defaults?.classes,
      withBuiltInNames(defaults?.classes, stored?.classes),
      c => c.id
    ),
    breakpoints: hasBreakpoints(stored?.breakpoints)
      ? stored?.breakpoints
      : defaults?.breakpoints,
  });
}

/**
 * What names a built-in block style, which the code states and a site may
 * not change: its name, slug, block type and whether it is the block's own
 * style. A stored override keeps only what the site changed, so it may
 * leave any of these out.
 */
export const BUILT_IN_NAME_FIELDS = [
  "label",
  "slug",
  "blockType",
  "isDefault",
] as const;

/**
 * The stored classes with each override of a built-in block style given
 * the code's name fields where it leaves them out, so it merges as the
 * built-in it overrides (the image's own style stays its own, named as the
 * code names it) rather than replacing it with a nameless shared class.
 */
export function withBuiltInNames(
  defaults: readonly NamedClass[] | undefined,
  stored: readonly NamedClass[] | undefined
): readonly NamedClass[] | undefined {
  if (stored === undefined || defaults === undefined) return stored;
  const code = new Map(
    defaults.filter(isLook).map(entry => [entry.id, entry] as const)
  );
  return stored.map(entry => {
    const base = code.get(entry.id);
    if (base === undefined) return entry;
    const filled: Record<string, unknown> = { ...entry };
    for (const field of BUILT_IN_NAME_FIELDS) {
      if (filled[field] === undefined && base[field] !== undefined) {
        filled[field] = base[field];
      }
    }
    return filled as unknown as NamedClass;
  });
}

/**
 * The stored class tier that, merged under the site's config classes, gives
 * this library.
 *
 * The same argument `tokenOverrideOf` makes, for the same reason: what the
 * canvas holds is the MERGED library, and saving it whole would copy every
 * config-supplied class into the database on the first creation and mask the
 * site's own code from then on. Only what differs is stored.
 *
 * A class is compared whole rather than by id alone, so an override that
 * changes a supplied class's name or styles is kept while an untouched copy of
 * it is dropped.
 */
export function classOverrideOf(
  defaults: readonly NamedClass[] | undefined,
  edited: readonly NamedClass[]
): NamedClass[] {
  const supplied = new Map((defaults ?? []).map(entry => [entry.id, entry]));
  return edited.filter(entry => {
    const base = supplied.get(entry.id);
    return base === undefined || !sameNamedClass(base, entry);
  });
}

/**
 * Whether two classes are the same class, to the byte: every key an entry
 * stores, so an override that only names a supplied class, or only locks it,
 * is a difference worth storing.
 */
function sameNamedClass(a: NamedClass, b: NamedClass): boolean {
  return (
    a.id === b.id &&
    a.slug === b.slug &&
    a.label === b.label &&
    a.locked === b.locked &&
    a.orderIndex === b.orderIndex &&
    // The block type a look is bound to: the same styles on another type is
    // another look.
    a.blockType === b.blockType &&
    // A block's own look edits its type's base; the same entry without the
    // mark is a look blocks wear instead.
    a.isDefault === b.isDefault &&
    // The block style marks: an override that only moves the default ★ or
    // hides a built-in style is a difference worth storing.
    a.starred === b.starred &&
    a.hidden === b.hidden &&
    sameJsonValue(a.styles, b.styles)
  );
}

/**
 * The stored tier that, merged under the site's config defaults, gives this set.
 *
 * The INVERSE of the token half of {@link resolveSiteStyle}, and the reason a
 * studio cannot save what it was handed. `useSiteStyle` answers with the config
 * defaults and the stored tier already merged, because that is what the canvas
 * has to compile — so an editor that saved its whole working set would copy
 * every config-supplied token into the database on the author's first edit.
 * From then on the site's own code could not change those values: the accidental
 * overrides would mask them, silently, and only for sites that supply defaults.
 *
 * So only what actually DIFFERS is stored: a token the config never supplied,
 * or one whose value the author has changed. The prefix and the dark-mode
 * strategy follow the same rule.
 *
 * What this deliberately cannot express is REMOVING a config-supplied token.
 * Absence from the stored tier means "no override", so the default merges
 * straight back on the next read. The studio does not offer removal for those
 * rows rather than offering one that quietly undoes itself.
 */
export function tokenOverrideOf(
  defaults: SiteTokenSet | undefined,
  edited: SiteTokenSet
): SiteTokenSet {
  const supplied = new Map(
    (defaults?.tokens ?? []).map(token => [tokenIdentity(token), token])
  );
  const tokens = edited.tokens.filter(token => {
    const base = supplied.get(tokenIdentity(token));
    return base === undefined || !sameSiteToken(base, token);
  });
  return {
    tokens,
    ...(edited.prefix === undefined || edited.prefix === defaults?.prefix
      ? {}
      : { prefix: edited.prefix }),
    ...(edited.darkMode === undefined || edited.darkMode === defaults?.darkMode
      ? {}
      : { darkMode: edited.darkMode }),
    ...storedFluidRange(defaults, edited, tokens),
  };
}

/**
 * The fluid range the stored tier holds: where it differs from the code's,
 * and wherever the tier holds a size made with Fluid…, so the stored sizes
 * say what they were made across. A merge of two authors' saves writes
 * those sizes again from the stored tier alone.
 */
function storedFluidRange(
  defaults: SiteTokenSet | undefined,
  edited: SiteTokenSet,
  stored: readonly SiteToken[]
): Pick<SiteTokenSet, "fluidRange"> {
  const range =
    edited.fluidRange ?? defaults?.fluidRange ?? DEFAULT_FLUID_RANGE;
  if (stored.some(token => token.fluid !== undefined))
    return { fluidRange: range };
  return edited.fluidRange === undefined ||
    sameJsonValue(edited.fluidRange, defaults?.fluidRange)
    ? {}
    : { fluidRange: edited.fluidRange };
}

/**
 * What a studio should show once a REFUSED save has answered.
 *
 * Saves serialise but their answers do not have to arrive in order, and an
 * author can type two edits before the first one comes back. Rolling back
 * unconditionally then discards the newer edit — and if the newer save
 * succeeds, the panel goes on showing the older set while storage holds the
 * newer one, with nothing to reconcile them.
 *
 * So a rollback only applies while the refused edit is still what is on screen.
 * Anything typed since has its own save in flight and is the one that decides.
 *
 * It falls back to the last set a save is KNOWN to have stored, rather than to
 * whatever was on screen beforehand: after an earlier refusal, that is itself a
 * value the site never accepted, so restoring it would show the author
 * something no storage anywhere agrees with. `null` means nothing has been
 * stored by this session and the read's own answer is the truth.
 */
/** What a studio should do once a save has answered. */
export interface TokenSaveOutcome {
  /** What to show, or `undefined` to leave the panel exactly as it is. */
  readonly tokens?: SiteTokenSet | null;
  /** What to say: a message, `null` to clear one, `undefined` to leave it. */
  readonly issue?: string | null;
}

/**
 * What a save's answer MEANS, apart from wiring it into any state.
 *
 * Both branches turn on one question — is this answer still about what the
 * author is looking at — and that is why they are decided together rather than
 * beside each other. Saves serialise, their answers need not arrive in order,
 * and an answer for a superseded edit must neither roll the newer one back nor
 * speak about it. Deciding the value and the message under separate rules is
 * how a studio ends up announcing that a set it did save was not saved.
 *
 * `undefined` for either field means LEAVE IT, which is a third answer beside
 * "set this" and "clear this": an obsolete refusal has nothing to say about a
 * panel that has moved on.
 */
export function tokenSaveOutcome(
  saved: boolean,
  issues: Readonly<Record<string, string>>,
  attempted: SiteTokenSet,
  latest: SiteTokenSet | null,
  persisted: SiteTokenSet | null
): TokenSaveOutcome {
  const current = latest === attempted;
  if (saved) {
    // A refusal for an EARLIER edit can arrive after a later one has already
    // cleared the message, so a success has to clear it again — otherwise the
    // studio goes on reporting a set it did save as unsaved.
    return current ? { issue: null } : {};
  }
  if (!current) return {};
  return {
    tokens: tokensAfterRefusal(latest, attempted, persisted),
    issue: Object.values(issues)[0] ?? "That change was not saved.",
  };
}

export function tokensAfterRefusal(
  current: SiteTokenSet | null,
  refused: SiteTokenSet,
  persisted: SiteTokenSet | null
): SiteTokenSet | null {
  return current === refused ? persisted : current;
}

/**
 * A style whose keys are only the DEFINED sections.
 *
 * An `undefined` property and an absent one mean the same thing to a reader,
 * but not to everything downstream: `{ tokens: undefined }` overrides a
 * spread's earlier value and survives `Object.keys`, so "absent means the
 * site defines none" only holds if absence is real. One place builds the
 * object so every producer of a `SiteStyleData` says absence the same way.
 */
export function siteStyleOf(sections: SiteStyleData): SiteStyleData {
  return {
    ...(sections.tokens === undefined ? {} : { tokens: sections.tokens }),
    ...(sections.fonts === undefined ? {} : { fonts: sections.fonts }),
    ...(sections.classes === undefined ? {} : { classes: sections.classes }),
    ...(sections.breakpoints === undefined
      ? {}
      : { breakpoints: sections.breakpoints }),
  };
}

/** Whether a set defines any breakpoint at all, on either axis. */
function hasBreakpoints(set: BreakpointSet | undefined): boolean {
  return (
    set !== undefined && (set.viewport.length > 0 || set.container.length > 0)
  );
}

/**
 * What makes two font faces the same face: family, weight, style and the
 * characters it covers. One cut in two scripts is two files, each with its
 * own `unicode-range`, and both must load.
 */
export function faceIdentity(
  face: Pick<FontFaceDef, "family" | "weight" | "style" | "unicodeRange">
): string {
  // Weight and style default at emission (`normal` both), so an absent value
  // and the default spelled out are the same face and must collide here.
  return `${face.family} ${face.weight ?? "normal"} ${face.style ?? "normal"} ${face.unicodeRange ?? ""}`;
}

/**
 * Defaults first, then overrides, each entry keyed by its identity — so an
 * override with a known key replaces the default and a new key appends.
 */
function mergeByKey<T>(
  defaults: readonly T[] | undefined,
  overrides: readonly T[] | undefined,
  keyOf: (entry: T) => string
): readonly T[] | undefined {
  if (defaults === undefined && overrides === undefined) return undefined;
  const byKey = new Map<string, T>();
  // Iterated rather than spread, so a later duplicate WITHIN one tier also
  // wins — the same rule the engine applies to duplicate token names.
  for (const entry of defaults ?? []) byKey.set(keyOf(entry), entry);
  for (const entry of overrides ?? []) byKey.set(keyOf(entry), entry);
  return [...byKey.values()];
}

/** Token sets merged by token identity; `prefix`/`darkMode` from the override. */
function mergeTokens(
  defaults: SiteTokenSet | undefined,
  stored: SiteTokenSet | undefined
): SiteTokenSet | undefined {
  if (defaults === undefined && stored === undefined) return undefined;
  // `tokenIdentity`, not the name, and imported rather than restated. The
  // engine names three things that have to agree by construction — the custom
  // property the emitter writes, the key a tier merge overrides on, and the
  // string a document stores — and this is the second of them. Keyed on the
  // name, a renamed stored token stops matching its config counterpart and the
  // default survives beside the override: not a collision, because the engine's
  // own resolution deduplicates on identity and the stored token wins, but a
  // stale entry in the LIST that every studio and `useSiteStyle` read.
  //
  // Tokens with no id key exactly as they did, because the identity falls back
  // to the name.
  const tokens = mergeByKey<SiteToken>(
    defaults?.tokens,
    stored?.tokens,
    tokenIdentity
  );
  const prefix = stored?.prefix ?? defaults?.prefix;
  const darkMode = stored?.darkMode ?? defaults?.darkMode;
  const fluidRange = stored?.fluidRange ?? defaults?.fluidRange;
  return {
    tokens: tokens === undefined ? [] : [...tokens],
    ...(prefix === undefined ? {} : { prefix }),
    ...(darkMode === undefined ? {} : { darkMode }),
    ...(fluidRange === undefined ? {} : { fluidRange }),
  };
}

/**
 * The site's breakpoints.
 *
 * Read from the merged style rather than declared here, so the storage has
 * exactly one function every consumer goes through — and the validator, the
 * canvas and the published route move together by construction. Called with
 * nothing it answers the empty set, which is what a consumer with no access
 * to the merged style validates against; the engine treats an unknown
 * breakpoint id as a warning in forgiving mode, so that consumer stays
 * permissive rather than wrong.
 */
export function siteBreakpoints(style?: SiteStyleData): BreakpointSet {
  return style?.breakpoints ?? { viewport: [], container: [] };
}

/**
 * What a canvas or a published route compiles its site stylesheet from.
 *
 * Sections the merged style does not define are OMITTED rather than
 * defaulted. An invented token set would render a canvas that looks finished
 * and matches no published page, which is worse than one that plainly shows
 * block defaults: a wrong preview is trusted, an unstyled one is questioned.
 * `blockBases` is never part of site style — a block type's default look
 * belongs to the block's definition, not to a site's stored edits.
 *
 * The same style answers the same sheet object. The canvas, the Layout's
 * header and footer around it and the entry page's small preview each keep
 * what they drew while their inputs keep their identity, and the renderer
 * keeps the compiled site sheet the same way; a new sheet object per render
 * made every one of them draw and compile again for a selection or a
 * keystroke. A style is read as a value: a new style is a new object.
 */
export function siteSheet(style?: SiteStyleData): SiteSheetInput {
  if (style === undefined) return NO_STYLE_SHEET;
  const kept = SHEETS.get(style);
  if (kept !== undefined) return kept;
  const sheet = sheetOf(style);
  SHEETS.set(style, sheet);
  return sheet;
}

/** The sheets answered, per style, weakly: a sheet goes with its style. */
const SHEETS = new WeakMap<SiteStyleData, SiteSheetInput>();

/** {@link siteSheet}'s answer, made. */
function sheetOf(style?: SiteStyleData): SiteSheetInput {
  return {
    ...(style?.tokens === undefined ? {} : { tokens: style.tokens }),
    ...(style?.fonts === undefined ? {} : { fonts: style.fonts }),
    ...(style?.classes === undefined ? {} : { classes: style.classes }),
    breakpoints: siteBreakpoints(style),
  };
}

/** The sheet for no style: breakpoints alone, the empty set. */
const NO_STYLE_SHEET: SiteSheetInput = sheetOf();
