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
import { tokenIdentity } from "@nextlyhq/blocks-engine";
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
 * - **Fonts merge by face identity** — family, weight and style together,
 *   because one family legitimately ships several faces and replacing by
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
    classes: mergeByKey(defaults?.classes, stored?.classes, c => c.id),
    breakpoints: hasBreakpoints(stored?.breakpoints)
      ? stored?.breakpoints
      : defaults?.breakpoints,
  });
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
  };
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
export function tokensAfterRefusal(
  current: SiteTokenSet | null,
  refused: SiteTokenSet,
  persisted: SiteTokenSet | null
): SiteTokenSet | null {
  return current === refused ? persisted : current;
}

/**
 * Whether two tokens say the same thing.
 *
 * Field by field rather than by serialising both, because key order is not
 * meaning: a token that round-tripped through storage can carry its fields in
 * a different order and would compare as changed, so every edit anywhere would
 * store every config token — the failure this comparison exists to prevent.
 */
function sameSiteToken(a: SiteToken, b: SiteToken): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.kind === b.kind &&
    a.description === b.description &&
    a.values.light === b.values.light &&
    a.values.dark === b.values.dark &&
    // `extensions` is vendor data from Figma, Style Dictionary or whatever else
    // wrote the token, and DTCG requires a tool to preserve what it does not
    // understand. Left out of this comparison, a stored override differing ONLY
    // in extensions reads as identical to the config default — so the next edit
    // anywhere in the table filters it out of the payload and the vendor data is
    // gone, silently, from a save the author made about a different token.
    sameJsonValue(a.extensions, b.extensions)
  );
}

/**
 * Whether two values decoded from JSON say the same thing.
 *
 * Structural rather than `JSON.stringify`, because key order is not meaning and
 * a token that round-tripped through storage can carry its fields in another
 * order — the same reason the token comparison above is field by field. Written
 * for `extensions`, whose shape is by definition unknown: it is whatever
 * another tool wrote, so there is no set of fields to enumerate.
 */
function sameJsonValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return sameJsonArray(a, b);
  if (isJsonRecord(a) && isJsonRecord(b)) return sameJsonRecord(a, b);
  // Two primitives that were not `===` above, or one of each kind. Neither is
  // worth descending into.
  return false;
}

/**
 * Two arrays, element by element and in order.
 *
 * Asked apart from the record case because order MATTERS here and does not
 * there, which is the whole difference between the two — and an equality that
 * decided both in one branch would be one edit from applying the wrong rule.
 * An array beside a non-array is not equal, which is why both sides are tested
 * rather than only the one that got us here.
 */
function sameJsonArray(a: unknown, b: unknown): boolean {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((item, index) => sameJsonValue(item, b[index]))
  );
}

/** Two records: the same own keys, and the same value under each. */
function sameJsonRecord(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(key => Object.hasOwn(b, key) && sameJsonValue(a[key], b[key]))
  );
}

/** An object with named keys, as JSON produces. Arrays are handled apart. */
function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

/** What makes two font faces the same face: family, weight and style. */
function faceIdentity(face: FontFaceDef): string {
  // Weight and style default at emission (`normal` both), so an absent value
  // and the default spelled out are the same face and must collide here.
  return `${face.family} ${face.weight ?? "normal"} ${face.style ?? "normal"}`;
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
  return {
    tokens: tokens === undefined ? [] : [...tokens],
    ...(prefix === undefined ? {} : { prefix }),
    ...(darkMode === undefined ? {} : { darkMode }),
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
 */
export function siteSheet(style?: SiteStyleData): SiteSheetInput {
  return {
    ...(style?.tokens === undefined ? {} : { tokens: style.tokens }),
    ...(style?.fonts === undefined ? {} : { fonts: style.fonts }),
    ...(style?.classes === undefined ? {} : { classes: style.classes }),
    breakpoints: siteBreakpoints(style),
  };
}
