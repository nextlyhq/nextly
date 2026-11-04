/**
 * The tokens studio's view of a site's token table, and the edits it makes.
 *
 * A token is a NAME the styling layer resolves — `color.primary` becomes
 * `--site-color-primary`, and every block referencing it follows when the value
 * changes. This module is the pure half of the panel that manages them: what to
 * show for each kind, what an edit produces, and what the engine will say about
 * the result. No DOM, so the rules below are testable without rendering, and
 * the panel above stays about layout.
 *
 * ## Identity is frozen; only the label moves
 *
 * The one rule this file exists to protect. A stored reference holds a token's
 * IDENTITY, and {@link renameSiteToken} pins that identity the first time a
 * token is renamed so it never tracks the label afterwards. Rename is therefore
 * safe here by construction — every existing reference goes on resolving and no
 * document is rewritten — which is not true of the tools this pattern comes
 * from: Figma variables and Tokens Studio key on the name, so both have to STAGE
 * alias rewiring for review before a rename can be applied.
 *
 * Getting it wrong is silent in the direction that loses work. Writing the NEW
 * name as the identity moves the custom property, every stored `$token` stops
 * resolving, and the page still renders — just without the style. Nothing
 * reports it, because an unresolved custom property invalidates its declaration
 * rather than raising. So every mutation here goes through the engine's own
 * helpers rather than composing a token literal.
 *
 * ## The engine judges values; this only asks
 *
 * Whether a value is usable, whether it contradicts its kind, whether two
 * tokens collide on one custom property — all of that is `emitTokenBlocks`'s
 * verdict, asked by emitting and reading what comes back. A second copy of
 * those rules here would agree on the cases someone thought of and diverge on
 * the rest, and the divergence is invisible: the studio would accept a token
 * the canvas silently drops.
 *
 * @module tokens-studio
 */
import {
  emitTokenBlocks,
  tokenDisplayLabel,
  tokenLabelIssue,
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKEN_NAME_SEGMENTS,
  tokenNamingProblem,
  renameSiteToken,
  tokenCustomProperty,
  tokenIdentity,
  type SiteToken,
  type SiteTokenSet,
  type TokenKind,
  type TokenMode,
  validateStyleValues,
} from "@nextlyhq/blocks-engine";

import { lineHeightFromText } from "./style-folded";

/**
 * What each kind is called in the interface.
 *
 * Written out rather than derived from the union, because a label is a piece of
 * copy and `fontFamily` is not one. Keyed by the kind so adding a kind to the
 * engine surfaces here as a type error rather than as a tab labelled with its
 * own identifier.
 */
export const TOKEN_KIND_LABELS: Readonly<Record<TokenKind, string>> = {
  color: "Colour",
  dimension: "Size",
  fontFamily: "Font",
  fontWeight: "Weight",
  number: "Number",
  shadow: "Shadow",
  duration: "Duration",
  custom: "Custom",
};

/**
 * An example value for a new token of each kind.
 *
 * A new row has to hold SOMETHING, and an empty value is refused by the emitter
 * — so a token created empty would arrive already broken, with an error the
 * author did not cause. These are the smallest valid value of each kind, chosen
 * to be obviously placeholder rather than plausibly deliberate.
 */
const TOKEN_KIND_SEEDS: Readonly<Record<TokenKind, string>> = {
  color: "#000000",
  dimension: "0px",
  fontFamily: "sans-serif",
  fontWeight: "400",
  number: "0",
  shadow: "0 0 0 rgba(0, 0, 0, 0)",
  duration: "0ms",
  // NOT a CSS-wide keyword. `initial` passes the emitter and is written without
  // complaint, and then behaves as the guaranteed-invalid value at SUBSTITUTION
  // — so `var(--site-custom)` invalidates the declaration reading it instead of
  // resolving to the word. A seed has to survive the whole road to the page,
  // not only the write.
  custom: "0",
};

/** One token as the studio draws it. */
export interface TokenRow {
  /**
   * WHERE this token sits in the stored list, and the handle every edit uses.
   *
   * Not the identity, which is the obvious choice and is wrong: a legacy or
   * imported set can hold two entries with the SAME identity, and the read path
   * keeps both deliberately so the engine's complaint about the collision is
   * visible on the row that has it. Addressed by identity, every edit to the
   * second row would resolve to the first — so the one state the studio exists
   * to help an author repair would be the one state it cannot address.
   */
  /**
   * Whether the ENGINE emitted this token, as `emitTokenBlocks` reports it.
   *
   * Carried rather than re-derived because the engine refuses on five separate
   * conditions — a name that is not a token name, no light value, a value the
   * guard rejects, a value that would fetch, and a collision on one custom
   * property — and a surface restating any of them agrees today and describes
   * a different stylesheet afterwards. A preview drawn for a token the page
   * does not carry is exactly that disagreement made visible.
   */
  readonly written: boolean;
  readonly at: number;
  /**
   * A React key that survives a removal elsewhere in the list.
   *
   * The position cannot be one: deleting any non-tail token shifts every
   * following `at`, so React reuses the deleted row's component for its
   * successor and the uncontrolled fields and the confirm state come with it —
   * a successor showing the deleted token's values, still in removal
   * confirmation, one click from removing the wrong token.
   *
   * The identity cannot be one either, for the reason `at` exists: two entries
   * can share one. So the key is the identity plus which occurrence of it this
   * is, which is unique always and stable under any removal that is not of the
   * same identity — and when it IS, remounting is the correct answer, because
   * the row's meaning has changed.
   */
  readonly key: string;
  /** What references STORE. Never changes once a token has been renamed. */
  readonly identity: string;
  /** What the author reads and edits. */
  readonly name: string;
  readonly kind: TokenKind;
  /** The value for the mode being shown, falling back to light. */
  readonly value: string;
  /**
   * What this MODE itself holds, or `undefined` when it holds nothing.
   *
   * Distinct from {@link value}, which is what to display and therefore falls
   * back. An editor comparing a typed value against the display cannot tell
   * "unchanged" from "pinned to the same value the fallback was giving" — and
   * the second is a real edit, the one that fixes a dark value in place before
   * the light one is changed later.
   */
  readonly stored: string | undefined;
  /** Whether the shown value belongs to this mode or is inherited from light. */
  readonly inherited: boolean;
  /**
   * What the engine says about this token, empty when it is happy.
   *
   * Shown to the author rather than counted, because the messages name the
   * repair — "is a measurement, not a colour" tells them what to type next, and
   * a bare invalid flag does not.
   */
  readonly issues: readonly string[];
}

/** The tokens of one kind, in stored order, as rows. */
function tokenRows(
  tokens: SiteTokenSet | undefined,
  mode: TokenMode = "light"
): readonly TokenRow[] {
  const set: SiteTokenSet = tokens ?? { tokens: [] };
  const all = set.tokens ?? [];
  /*
   * Built ONCE for the whole set rather than rediscovered per row: asking "who
   * else compiles to my custom property" with a linear scan inside a per-row
   * call makes the projection quadratic, and a DTCG import is not bounded to a
   * size where that stays invisible.
   *
   * And built from what the emitter actually WROTE, not from document order.
   * A token refused for its name, a missing light value, an unusable value or
   * a value that fetches never reaches `seen`, so it claims no property and a
   * later token with the same one is emitted normally. Ranking by position
   * handed the property to the refused token and told the written one that
   * only the refused one survives — the opposite of the compiled page.
   *
   * `emitTokenBlocks` reports `emitted` precisely so this question has one
   * answer; its own docblock says a caller re-deriving it "would have to
   * restate all five" refusals and would drift the first time one changed.
   */
  const made = emitTokenBlocks(set, ":root");
  const claimed = firstByProperty(made.emitted);
  /*
   * Which tokens the engine actually WROTE, for anything downstream that must
   * not describe a token the page does not carry. Same list, same call: asking
   * "is this written" a second way is how the panel and the stylesheet come to
   * disagree.
   */
  const written = new Set(made.emitted);
  // Indexed against the WHOLE list, so `at` addresses the stored position
  // rather than a position within any later grouping or filter.
  const seen = new Map<string, number>();
  return all.map((token, at) => {
    const identity = tokenIdentity(token);
    const nth = seen.get(identity) ?? 0;
    seen.set(identity, nth + 1);
    return rowOf(
      token,
      at,
      nth === 0 ? identity : `${identity}#${nth}`,
      claimed,
      written,
      mode
    );
  });
}

/**
 * The rows of ONE kind.
 *
 * Derived from {@link tokenRows} rather than projecting again, so a caller
 * asking for every kind pays for one pass over the set instead of one per
 * kind, and the two can never disagree about a row's key or its issues.
 */
export function tokenRowsFor(
  tokens: SiteTokenSet | undefined,
  kind: TokenKind,
  mode: TokenMode = "light"
): readonly TokenRow[] {
  return tokenRows(tokens, mode).filter(row => row.kind === kind);
}

function rowOf(
  token: SiteToken,
  at: number,
  key: string,
  claimed: ReadonlyMap<string, SiteToken>,
  written: ReadonlySet<SiteToken>,
  mode: TokenMode
): TokenRow {
  const own = token.values[mode];
  const collision = collisionFor(token, claimed);
  return {
    at,
    key,
    written: written.has(token),
    stored: own,
    identity: tokenIdentity(token),
    name: token.name,
    kind: token.kind,
    value: own ?? token.values.light,
    inherited: own === undefined,
    issues:
      collision === undefined
        ? issuesOf(token)
        : [collision, ...issuesOf(token)],
  };
}

/**
 * What the engine reports about ONE token, emitted on its own.
 *
 * Alone rather than within the set, so the messages that come back are about
 * this token and no other — and so the answer does not have to be found by
 * matching message text against a name, which would be a copy of wording
 * nobody promised to keep. The one verdict this cannot reach that way is the
 * collision, which is a property of the SET; {@link collisionFor} asks it.
 */
function issuesOf(token: SiteToken): readonly string[] {
  return emitTokenBlocks({ tokens: [token] }, ":root").issues.map(
    issue => issue.message
  );
}

/**
 * The other token this one would collide with, or `undefined`.
 *
 * Two identities can compose one custom property — `color.primary-dark` and
 * `color-primary.dark` both give `--site-color-primary-dark` — and the emitter
 * writes the first and REFUSES the second. An author who cannot see that is
 * editing a token whose value never reaches the page, so it is reported here
 * rather than left to be discovered on the canvas.
 *
 * `tokenCustomProperty` composes the key, so the normalisation stays the
 * engine's; only the pairwise comparison is done here.
 */
/**
 * Which token each custom property belongs to.
 *
 * Takes the tokens the emitter WROTE, so a property is owned by whatever the
 * page actually resolves rather than by whatever came first in the stored
 * order. A refused token owns nothing, which is the whole point: it is not in
 * the emitted list to be found.
 */
function firstByProperty(
  emitted: readonly SiteToken[]
): ReadonlyMap<string, SiteToken> {
  const claimed = new Map<string, SiteToken>();
  for (const token of emitted) {
    const property = tokenCustomProperty(tokenIdentity(token), "");
    if (!claimed.has(property)) claimed.set(property, token);
  }
  return claimed;
}

function collisionFor(
  token: SiteToken,
  claimed: ReadonlyMap<string, SiteToken>
): string | undefined {
  const property = tokenCustomProperty(tokenIdentity(token), "");
  const first = claimed.get(property);
  if (first === undefined || first === token) return undefined;
  return `"${token.name}" and "${first.name}" both become "${property}", so only "${first.name}" is written.`;
}

/**
 * Why this name cannot be used, or `undefined`.
 *
 * The GRAMMAR is the engine's own rule, which is the same one a stored
 * `$token` reference is held to — so a table cannot hold a name that no
 * reference could spell. Checked before the edit rather than after, because the
 * emitter's answer to a bad name is to drop the token silently.
 */
export function tokenNameIssue(
  tokens: SiteTokenSet | undefined,
  at: number,
  name: string
): string | undefined {
  const trimmed = name.trim();
  if (trimmed === "") return "A token needs a name.";
  // Asked of the token the rename would PRODUCE, not of the label alone. A
  // rename keeps a working identity pinned, so a long label is fine — but where
  // the current identity is one the engine cannot write, the rename re-pins to
  // this label and it becomes the identity, which the emission cap does reach.
  // Validating the label alone accepts an edit that still leaves the token
  // dropped from CSS, which is the repair appearing to succeed and not.
  const existing = tokens?.tokens?.[at];
  const proposed =
    existing === undefined
      ? { name: trimmed }
      : renameSiteToken(existing, trimmed);
  const problem = tokenNamingProblem(proposed);
  if (problem?.reason === "grammar") {
    return 'A name is dot-separated words of letters, digits and dashes, like "color.primary".';
  }
  if (problem?.reason === "depth") {
    return `A name holds at most ${MAX_TOKEN_NAME_SEGMENTS} dot-separated parts.`;
  }
  if (problem?.reason === "length") {
    return `A name is at most ${MAX_TOKEN_NAME_LENGTH} characters when it is what the token is written under.`;
  }
  // Compared by the custom property each token is WRITTEN under, not by the
  // name an author reads. The mapping is deliberately not injective — a dot and
  // a dash both become a dash — so `color.primary-dark` and `color-primary.dark`
  // are two legal names that land on one property, and the engine drops
  // whichever it reaches second. A check on raw names accepts that edit and
  // leaves a token silently unwritten.
  const others = (tokens?.tokens ?? []).filter((_, index) => index !== at);

  // Two questions, and neither answers the other. This one is what an author
  // reads: two tokens answering to one name is a table nobody can use, whatever
  // each is written under.
  if (others.some(token => token.name === trimmed)) {
    return `Another token is already called "${trimmed}".`;
  }

  // And this one is what the engine writes. The name-to-property mapping is
  // deliberately not injective — a dot and a dash both become a dash — so
  // `color.primary-dark` and `color-primary.dark` are two legal, visibly
  // different names landing on one custom property, and the compiler drops
  // whichever it reaches second. The name check above cannot see that.
  const identityOf = (token: { name: string; id?: string }) =>
    token.id ?? token.name;
  const claimedIdentity = identityOf(proposed);
  const claimed = tokenCustomProperty(claimedIdentity, "");
  // Whether this row ALREADY shared its identity with another before the edit.
  // That is a repair in progress — reporting it leaves the row unfixable
  // whatever the author types — and it is a property of the row, not of the
  // name being proposed. Deciding it from the PROPOSED identity instead
  // suppresses the error whenever an edit newly claims another row's identity,
  // which is the collision this check exists for.
  const wasAlreadyTwinned =
    existing !== undefined &&
    others.some(token => identityOf(token) === identityOf(existing));

  const clash = others.find(token => {
    if (wasAlreadyTwinned && identityOf(token) === claimedIdentity)
      return false;
    return tokenCustomProperty(identityOf(token), "") === claimed;
  });
  return clash === undefined
    ? undefined
    : `"${trimmed}" is written under the same custom property as "${clash.name}".`;
}

/** Replace one token in the set, leaving every other entry untouched. */
function withToken(
  tokens: SiteTokenSet,
  index: number,
  token: SiteToken
): SiteTokenSet {
  const next = [...tokens.tokens];
  next[index] = token;
  return { ...tokens, tokens: next };
}

/**
 * The set with one token renamed, its identity pinned where it already was.
 *
 * Delegates to {@link renameSiteToken} rather than spreading a new name over
 * the token, which is the whole point: that helper is the ONE place the freeze
 * rule lives, and a second expression of it here would be one edit away from
 * writing the new name as the identity and silently breaking every reference.
 */
export function renameToken(
  tokens: SiteTokenSet,
  at: number,
  name: string
): SiteTokenSet {
  const token = tokens.tokens[at];
  if (token === undefined) return tokens;
  return withToken(tokens, at, renameSiteToken(token, name.trim()));
}

/**
 * The set with one token's value changed, for one mode.
 *
 * Writing `dark` never disturbs `light`, because light is what a reader with no
 * mode set resolves and a token that lost it would vanish for them.
 */
export function setTokenValue(
  tokens: SiteTokenSet,
  at: number,
  mode: TokenMode,
  value: string
): SiteTokenSet {
  const token = tokens.tokens[at];
  if (token === undefined) return tokens;
  return withToken(tokens, at, {
    ...token,
    values: { ...token.values, [mode]: value },
  });
}

/** What a line height that cannot be stored is told, in words. */
const LINE_HEIGHT_REFUSAL =
  "A line height is a number like 1.4, or a length like 24px.";

/**
 * What a dark line height is told when it would need a kind other than
 * light's. A token has one kind, and a number token refuses a length as surely
 * as a length token refuses a number; the light value is the one that sets it.
 */
export const LINE_HEIGHT_MIXED =
  "Light and dark line heights are both numbers, like 1.4, or both lengths, like 24px. Use the light value first to change which.";

/** Whether a variable is a line height of the type scale, by its code name. */
function isLineHeightToken(token: { name: string }): boolean {
  return token.name.startsWith(LINE_HEIGHT_PREFIX);
}

/**
 * The kind a line height is held as for a value: a plain number (`1.4`, a
 * multiple of the font size, which is what scales with it) is a `number`
 * token, and anything else (`24px`, `150%`, `calc()`) a `dimension`. Read
 * with the inspector's own rule for a typed line height, so the two agree on
 * what a plain number is.
 */
function lineHeightKindOf(value: string): TokenKind {
  return typeof lineHeightFromText(value) === "number" ? "number" : "dimension";
}

/**
 * Why a value cannot be a line height, or nothing. Judged by the catalogue's
 * rule for a block's line height, the value a token here is read into, rather
 * than by a second list of what a line height may be.
 */
function lineHeightValueIssue(value: string): string | undefined {
  const typed = lineHeightFromText(value);
  if (typed === null) return LINE_HEIGHT_REFUSAL;
  const issues = validateStyleValues({ lineHeight: typed }, "", "strict");
  return issues.some(issue => issue.severity === "error")
    ? LINE_HEIGHT_REFUSAL
    : undefined;
}

/** What writing a variable's value comes to: the new set, or why not. */
export type TokenValueWrite =
  | {
      readonly tokens: SiteTokenSet;
      /** Something the write changed beyond the field, said in words. */
      readonly note?: string;
    }
  | { readonly issue: string };

/** What the author is told when a light line height's new kind drops dark. */
export const DARK_FOLLOWS_LIGHT =
  "Dark now follows the light value; set a dark value again if you need one.";

/**
 * The set with one variable's value changed for one mode, or why it cannot be.
 *
 * Every variable but one is {@link setTokenValue}. A line height is the one
 * value that is right as a plain number or as a length, so its KIND follows
 * what is written: held as a `dimension`, `1.4` is a number where a length
 * belongs, and the save is refused for it. A value no line height can be is
 * refused here, in words, rather than stored for the page to drop.
 *
 * The LIGHT value sets the kind. A light edit of the other kind drops a dark
 * value that no longer fits, so dark follows light, and says so; a dark edit
 * of a kind other than light's is refused. Otherwise, with both modes set as
 * lengths, neither could be the first to become a number.
 */
export function writeTokenValue(
  tokens: SiteTokenSet,
  at: number,
  mode: TokenMode,
  value: string
): TokenValueWrite {
  const token = tokens.tokens[at];
  if (token === undefined || !isLineHeightToken(token)) {
    return { tokens: setTokenValue(tokens, at, mode, value) };
  }
  const issue = lineHeightValueIssue(value);
  if (issue !== undefined) return { issue };
  const kind = lineHeightKindOf(value);
  if (mode === "dark") {
    if (lineHeightKindOf(token.values.light) !== kind) {
      return { issue: LINE_HEIGHT_MIXED };
    }
    return {
      tokens: withToken(tokens, at, {
        ...token,
        // The kind both values are read as, set rather than kept: a legacy
        // unitless zero held as a length is a number to this rule, and a
        // number dark beside it would otherwise be refused as not a length.
        kind,
        values: { ...token.values, dark: value },
      }),
    };
  }
  const dark = token.values.dark;
  const darkFits = dark === undefined || lineHeightKindOf(dark) === kind;
  return {
    tokens: withToken(tokens, at, {
      ...token,
      kind,
      values: darkFits ? { ...token.values, light: value } : { light: value },
    }),
    ...(darkFits ? {} : { note: DARK_FOLLOWS_LIGHT }),
  };
}

/**
 * The set with one token's dark value REMOVED, so it follows light again.
 *
 * Distinct from writing the light value into dark, which looks identical on
 * screen and is not the same document: an explicit dark value stops tracking
 * later edits to light, so the two drift apart the next time anyone changes the
 * light one.
 */
export function clearDarkValue(tokens: SiteTokenSet, at: number): SiteTokenSet {
  const token = tokens.tokens[at];
  if (token === undefined) return tokens;
  return withToken(tokens, at, {
    ...token,
    values: { light: token.values.light },
  });
}

/**
 * The set without the token at this position. Any reference stops resolving.
 *
 * By POSITION rather than by identity, so removing one of two entries that
 * share an identity removes exactly one. Filtering on the identity would take
 * both, which is the opposite of what an author repairing a collision means.
 */
export function removeToken(tokens: SiteTokenSet, at: number): SiteTokenSet {
  return {
    ...tokens,
    tokens: tokens.tokens.filter((_, index) => index !== at),
  };
}

/**
 * Every custom property the set's names and identities take. A name is folded
 * in beside the identity because a name is what a later rename freezes into
 * one.
 */
function usedProperties(tokens: SiteTokenSet | undefined): Set<string> {
  const used = new Set<string>();
  for (const token of tokens?.tokens ?? []) {
    used.add(tokenCustomProperty(token.name, ""));
    used.add(tokenCustomProperty(tokenIdentity(token), ""));
  }
  return used;
}

/**
 * A name nothing in the set is using yet, based on the kind.
 *
 * Suffixed rather than randomised so a second colour token is `color.2` and not
 * a word the author has to read. Checked against IDENTITIES as well as names,
 * because a renamed token still holds its old name as its identity and a new
 * token taking that name would collide on the custom property.
 */
function freeName(tokens: SiteTokenSet | undefined, kind: TokenKind): string {
  // Compared as composed CUSTOM PROPERTIES, which is the real uniqueness
  // boundary — `color-2` and `color.2` are different strings and both become
  // `--site-color-2`, so a raw-name check hands back a name the emitter will
  // refuse the moment it is written. Names are folded in alongside identities
  // because a name is what a later rename freezes into one.
  const used = usedProperties(tokens);
  const free = (candidate: string): boolean =>
    !used.has(tokenCustomProperty(candidate, ""));
  const base = kind === "custom" ? "custom" : kind.toLowerCase();
  if (free(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}.${n}`;
    if (free(candidate)) return candidate;
  }
}

/**
 * The set with a new token of this kind appended, and where it landed.
 *
 * The position comes back because the panel has to address the new row, and
 * finding it afterwards by name or identity would break the moment two tokens
 * share one — which is a state this table can legitimately be in.
 *
 * Created with NO `id`, so its identity is its name until the first rename
 * freezes one. That is the same shape every token stored before `id` existed
 * has, which is why nothing needs migrating.
 */
export function addToken(
  tokens: SiteTokenSet | undefined,
  kind: TokenKind
): { tokens: SiteTokenSet; at: number } {
  const name = freeName(tokens, kind);
  const token: SiteToken = {
    name,
    kind,
    values: { light: TOKEN_KIND_SEEDS[kind] },
  };
  const base = tokens ?? { tokens: [] };
  return {
    tokens: { ...base, tokens: [...base.tokens, token] },
    at: base.tokens.length,
  };
}

/* ------------------------------------------------------------------ groups */

/** The groups the Design panel shows variables in, in order. */
export type VariableGroup = "colours" | "type" | "spacing" | "other";

const VARIABLE_GROUPS: readonly VariableGroup[] = [
  "colours",
  "type",
  "spacing",
  "other",
];

/** Each group's heading, in plain words. */
const VARIABLE_GROUP_LABELS: Readonly<Record<VariableGroup, string>> = {
  colours: "Colours",
  type: "Type scale",
  spacing: "Spacing, radius & shadows",
  other: "Other",
};

/**
 * Every group with its heading, in the order the Design panel lists them, for
 * a list elsewhere that groups variables the same way.
 */
export function variableGroupHeadings(): readonly {
  group: VariableGroup;
  heading: string;
}[] {
  return VARIABLE_GROUPS.map(group => ({
    group,
    heading: VARIABLE_GROUP_LABELS[group],
  }));
}

/** The code-name prefixes of a type size and of its line height. */
const SIZE_PREFIX = "font-size.";
const LINE_HEIGHT_PREFIX = "line-height.";

/** Code-name prefixes of a spacing step, and of a radius. */
const SPACING_PREFIXES = ["space.", "spacing.", "gap."];
const RADIUS_PREFIX = "radius.";

/** The families a length variable belongs to, each made for its own fields. */
export type LengthFamily = "font-size" | "line-height" | "spacing" | "radius";

/**
 * The family a length variable belongs to, read from its code name as the
 * Design panel groups it, or `undefined` for a length that names none (a
 * content width) and for anything that is not a length.
 *
 * The inspector offers each field its own family, so a padding lists the
 * spacing steps and a radius the radii; asked here so the Design panel's
 * groups and the inspector's lists cannot disagree about what a variable is.
 */
export function lengthFamilyOf(token: {
  name: string;
  kind: TokenKind;
}): LengthFamily | undefined {
  const type = typeScaleProperty(token);
  if (type !== undefined) return type;
  if (token.kind !== "dimension") return undefined;
  if (token.name.startsWith(RADIUS_PREFIX)) return "radius";
  return SPACING_PREFIXES.some(prefix => token.name.startsWith(prefix))
    ? "spacing"
    : undefined;
}

/**
 * The CSS property a type-scale variable is made for: `font-size` for a type
 * size, `line-height` for its paired line height, or `undefined` for any other
 * variable.
 *
 * Read from the code name, as the Design panel groups by it, and asked here
 * once so the panel's "Type scale" group and the inspector's offer of a type
 * size only where text is sized cannot disagree about what a type size is.
 */
export function typeScaleProperty(token: {
  name: string;
  kind: TokenKind;
}): "font-size" | "line-height" | undefined {
  if (token.kind !== "dimension" && token.kind !== "number") return undefined;
  if (token.name.startsWith(SIZE_PREFIX)) return "font-size";
  if (token.name.startsWith(LINE_HEIGHT_PREFIX)) return "line-height";
  return undefined;
}

/**
 * Which group a variable belongs in: by kind for colours and shadows, and by
 * its code name for the lengths, since a size, a gap and a radius are all
 * dimensions.
 *
 * Exported so the inspector's variable list groups exactly as Design does.
 */
export function variableGroupOf(token: {
  name: string;
  kind: TokenKind;
}): VariableGroup {
  if (token.kind === "color") return "colours";
  if (token.kind === "shadow") return "spacing";
  const family = lengthFamilyOf(token);
  if (family === "font-size" || family === "line-height") return "type";
  if (family === "spacing" || family === "radius") return "spacing";
  return "other";
}

/** One row of the Design panel. */
export interface VariableEntry {
  /** The variable itself; for a type size, its font size. */
  readonly row: TokenRow;
  /** The plain name shown: the label, or one derived from the code name. */
  readonly label: string;
  /** A type size's line height, paired by name, when there is one. */
  readonly lineHeight?: TokenRow;
  /**
   * What kind of variable it is, in words ("radius"), when another row is
   * shown under the same name: `space.card` and `radius.card` both read
   * "Card", and side by side nothing else says which is which.
   */
  readonly kindWord?: string;
}

/** A row's kind in words, as the panel tells two rows of one name apart. */
function kindWordOf(row: TokenRow): string {
  const family = lengthFamilyOf(row);
  if (family === "font-size") return "type size";
  if (family === "line-height") return "line height";
  if (family !== undefined) return family;
  // The kind's own label, as the panel names kinds elsewhere.
  return TOKEN_KIND_LABELS[row.kind].toLowerCase();
}

/**
 * A group's rows with their kind added where two or more share a name,
 * ignoring case, as {@link labelClashes} compares names. Where the kinds
 * clash as well (`space.card` and `spacing.card`, both spacing steps called
 * "Card"), the code name, which no two variables share, tells them apart.
 */
function withKindWhereNamesClash(
  entries: readonly VariableEntry[]
): VariableEntry[] {
  const count = (keys: readonly string[]) => {
    const seen = new Map<string, number>();
    for (const key of keys) seen.set(key, (seen.get(key) ?? 0) + 1);
    return seen;
  };
  const names = count(entries.map(entry => entry.label.toLowerCase()));
  const kinds = count(
    // JSON, so no label can run into its kind.
    entries.map(entry =>
      JSON.stringify([entry.label.toLowerCase(), kindWordOf(entry.row)])
    )
  );
  return entries.map(entry => {
    const name = entry.label.toLowerCase();
    if ((names.get(name) ?? 0) < 2) return entry;
    const kind = kindWordOf(entry.row);
    const unique = (kinds.get(JSON.stringify([name, kind])) ?? 0) < 2;
    return { ...entry, kindWord: unique ? kind : entry.row.name };
  });
}

/**
 * Every group with its rows, Other included even when empty: the panel
 * decides what an empty group shows.
 *
 * A font size and the line height of the same name are ONE row, so a type
 * size reads as "16 / 26" the way designers write it. A line height with no
 * size of its own still gets a row.
 */
export function variableGroups(
  tokens: SiteTokenSet | undefined,
  mode: TokenMode = "light"
): readonly {
  group: VariableGroup;
  heading: string;
  entries: readonly VariableEntry[];
}[] {
  const rows = tokenRows(tokens, mode);
  const stored = tokens?.tokens ?? [];
  const lineHeights = new Map<string, TokenRow>();
  for (const row of rows) {
    if (row.name.startsWith(LINE_HEIGHT_PREFIX)) {
      lineHeights.set(row.name.slice(LINE_HEIGHT_PREFIX.length), row);
    }
  }
  const paired = new Set<TokenRow>();
  const byGroup = new Map<VariableGroup, VariableEntry[]>(
    VARIABLE_GROUPS.map(group => [group, []])
  );
  for (const row of rows) {
    const token = stored[row.at];
    if (token === undefined) continue;
    const group = variableGroupOf(row);
    const lineHeight =
      group === "type" && row.name.startsWith(SIZE_PREFIX)
        ? lineHeights.get(row.name.slice(SIZE_PREFIX.length))
        : undefined;
    if (lineHeight !== undefined) paired.add(lineHeight);
    byGroup.get(group)?.push({
      row,
      label: tokenDisplayLabel(token),
      ...(lineHeight === undefined ? {} : { lineHeight }),
    });
  }
  // Within each group: rows of one name under two headings are told apart
  // by the headings already.
  return variableGroupHeadings().map(({ group, heading }) => ({
    group,
    heading,
    entries: withKindWhereNamesClash(
      (byGroup.get(group) ?? []).filter(entry => !paired.has(entry.row))
    ),
  }));
}

/* ------------------------------------------------------------------ labels */

/**
 * Why this label cannot be given to the variable at `at`, or nothing.
 *
 * The engine's rule for a label, plus one of the panel's own: two variables
 * shown under one name cannot be told apart in a list or a picker.
 */
export function variableLabelIssue(
  tokens: SiteTokenSet | undefined,
  at: number,
  label: string
): string | undefined {
  const trimmed = label.trim();
  if (trimmed === "") return undefined;
  const problem = tokenLabelIssue(trimmed);
  if (problem !== undefined) return problem;
  const wanted = trimmed.toLowerCase();
  const clash = visibleNames(tokens).find(
    shown => !shown.ats.includes(at) && shown.label.toLowerCase() === wanted
  );
  return clash === undefined
    ? undefined
    : `Another variable is already called "${clash.label}".`;
}

/**
 * Each variable as the panel shows it: its name, and the stored positions
 * behind it, two for a type size and its paired line height. Names are
 * compared here, over the rows an author sees, so a pair is one name.
 */
function visibleNames(
  tokens: SiteTokenSet | undefined
): { label: string; ats: number[] }[] {
  return variableGroups(tokens).flatMap(group =>
    group.entries.map(entry => ({
      label: entry.label,
      ats:
        entry.lineHeight === undefined
          ? [entry.row.at]
          : [entry.row.at, entry.lineHeight.at],
    }))
  );
}

/**
 * The names shown for more than one variable in a set, once each, ignoring
 * case, since "Brand" and "brand" cannot be told apart in a list.
 *
 * The same rule {@link variableLabelIssue} holds one edit to, asked of a whole
 * set, as an import produces one.
 */
export function labelClashes(tokens: SiteTokenSet): string[] {
  const seen = new Set<string>();
  const clashes = new Map<string, string>();
  for (const { label } of visibleNames(tokens)) {
    const key = label.toLowerCase();
    if (seen.has(key)) clashes.set(key, label);
    seen.add(key);
  }
  return [...clashes.values()];
}

/**
 * The set with one variable's label changed. A blank label is removed, so the
 * derived label shows again and nothing is stored for it.
 */
export function relabelToken(
  tokens: SiteTokenSet,
  at: number,
  label: string
): SiteTokenSet {
  const token = tokens.tokens[at];
  if (token === undefined) return tokens;
  const { label: _previous, ...rest } = token;
  const trimmed = label.trim();
  return withToken(
    tokens,
    at,
    trimmed === "" ? rest : { ...rest, label: trimmed }
  );
}

/* --------------------------------------------------------------- adding */

/** What a group's "+" can add. */
export type NewVariable =
  | "colour"
  | "type size"
  | "spacing"
  | "radius"
  | "shadow"
  | Exclude<TokenKind, "color" | "shadow">;

/** The code-name prefix, kind and first value of each new variable. */
const NEW_VARIABLES: Readonly<
  Record<NewVariable, { prefix: string; kind: TokenKind; value: string }>
> = {
  colour: { prefix: "color", kind: "color", value: "#000000" },
  "type size": { prefix: "font-size", kind: "dimension", value: "16px" },
  spacing: { prefix: "space", kind: "dimension", value: "16px" },
  radius: { prefix: "radius", kind: "dimension", value: "4px" },
  shadow: { prefix: "shadow", kind: "shadow", value: TOKEN_KIND_SEEDS.shadow },
  dimension: { prefix: "size", kind: "dimension", value: "0px" },
  fontFamily: { prefix: "font", kind: "fontFamily", value: "sans-serif" },
  fontWeight: { prefix: "weight", kind: "fontWeight", value: "400" },
  number: { prefix: "number", kind: "number", value: "0" },
  duration: { prefix: "duration", kind: "duration", value: "200ms" },
  custom: { prefix: "custom", kind: "custom", value: "0" },
};

/**
 * The line height a new type size starts with: unitless, so it is a multiple
 * of the size and follows it when the size changes, where a fixed length is
 * right for one size only. 1.25 sits between the tighter leading a heading
 * wants and the looser one body text wants, since a new size starts at 16px
 * and is usually given a heading's size next.
 */
const NEW_LINE_HEIGHT = "1.25";

/** The words a new variable's code name is made from, before it is named. */
const NEW_WORDS: Readonly<Record<NewVariable, string>> = {
  colour: "new-colour",
  "type size": "new-size",
  spacing: "new-spacing",
  radius: "new-radius",
  shadow: "new-shadow",
  dimension: "new-size",
  fontFamily: "new-font",
  fontWeight: "new-weight",
  number: "new-number",
  duration: "new-duration",
  custom: "new-value",
};

/**
 * The set with a new variable for a group's "+", and where it landed.
 *
 * Named so its derived label reads in plain words ("New colour") until the
 * author names it. A type size adds its line height too, under the same
 * name, which is what pairs them.
 */
export function addVariable(
  tokens: SiteTokenSet | undefined,
  what: NewVariable
): { tokens: SiteTokenSet; at: number } {
  const base = tokens ?? { tokens: [] };
  const spec = NEW_VARIABLES[what];
  const words = freeWords(
    base,
    spec.prefix,
    NEW_WORDS[what],
    what === "type size"
  );
  const added: SiteToken[] = [
    {
      name: `${spec.prefix}.${words}`,
      kind: spec.kind,
      values: { light: spec.value },
    },
  ];
  if (what === "type size") {
    added.push({
      name: `${LINE_HEIGHT_PREFIX}${words}`,
      // A plain number, so a number token: as a `dimension` it would be a
      // value the engine reports as not a length.
      kind: "number",
      values: { light: NEW_LINE_HEIGHT },
    });
  }
  return {
    tokens: { ...base, tokens: [...base.tokens, ...added] },
    at: base.tokens.length,
  };
}

/**
 * The set with a just-added variable labelled, and its code name made from
 * that label (`Heading 1` gives `font-size.heading-1`), its line height
 * following.
 *
 * Only for a variable created moments ago, which nothing can reference yet:
 * once a variable may be in use, its code name stays put and only the label
 * changes, through {@link relabelToken}.
 */
export function labelNewVariable(
  tokens: SiteTokenSet,
  at: number,
  label: string
): SiteTokenSet {
  const token = tokens.tokens[at];
  if (token === undefined || token.id !== undefined) {
    return relabelToken(tokens, at, label);
  }
  const relabelled = relabelToken(tokens, at, label);
  const slug = slugOf(label);
  if (slug === "") return relabelled;
  const dot = token.name.indexOf(".");
  const prefix = dot === -1 ? token.name : token.name.slice(0, dot);
  const partnerAt = token.name.startsWith(SIZE_PREFIX)
    ? tokens.tokens.findIndex(
        other =>
          other.name ===
          `${LINE_HEIGHT_PREFIX}${token.name.slice(SIZE_PREFIX.length)}`
      )
    : -1;
  const others = {
    ...relabelled,
    tokens: relabelled.tokens.filter(
      (_, index) => index !== at && index !== partnerAt
    ),
  };
  const words = freeWords(others, prefix, slug, partnerAt !== -1);
  const next = [...relabelled.tokens];
  const named = next[at];
  if (named !== undefined) next[at] = { ...named, name: `${prefix}.${words}` };
  const partner = partnerAt === -1 ? undefined : next[partnerAt];
  if (partner !== undefined) {
    next[partnerAt] = { ...partner, name: `${LINE_HEIGHT_PREFIX}${words}` };
  }
  return { ...relabelled, tokens: next };
}

/** A label as code-name words: lowercase letters, digits and dashes. */
function slugOf(label: string): string {
  return label
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

/**
 * Words free under `prefix` (and under the line-height prefix too, for a type
 * size), suffixed `-2`, `-3`… when taken. Compared as custom properties, which
 * is the real uniqueness boundary, against names and identities alike.
 */
function freeWords(
  tokens: SiteTokenSet,
  prefix: string,
  words: string,
  withLineHeight: boolean
): string {
  const used = usedProperties(tokens);
  const free = (candidate: string): boolean =>
    !used.has(tokenCustomProperty(`${prefix}.${candidate}`, "")) &&
    (!withLineHeight ||
      !used.has(tokenCustomProperty(`${LINE_HEIGHT_PREFIX}${candidate}`, "")));
  if (free(words)) return words;
  for (let n = 2; ; n += 1) {
    if (free(`${words}-${n}`)) return `${words}-${n}`;
  }
}
