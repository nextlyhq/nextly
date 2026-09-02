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
} from "@nextlyhq/blocks-engine";

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
export function tokenRowsFor(
  tokens: SiteTokenSet | undefined,
  kind: TokenKind,
  mode: TokenMode = "light"
): readonly TokenRow[] {
  const all = tokens?.tokens ?? [];
  // Indexed against the WHOLE list before filtering, so `at` addresses the
  // stored position rather than a position within this tab.
  const seen = new Map<string, number>();
  return all
    .map((token, at) => {
      const identity = tokenIdentity(token);
      const nth = seen.get(identity) ?? 0;
      seen.set(identity, nth + 1);
      return { token, at, key: nth === 0 ? identity : `${identity}#${nth}` };
    })
    .filter(entry => entry.token.kind === kind)
    .map(entry => rowOf(entry.token, entry.at, entry.key, all, mode));
}

function rowOf(
  token: SiteToken,
  at: number,
  key: string,
  among: readonly SiteToken[],
  mode: TokenMode
): TokenRow {
  const own = token.values[mode];
  const collision = collisionFor(token, among);
  return {
    at,
    key,
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
function collisionFor(
  token: SiteToken,
  among: readonly SiteToken[]
): string | undefined {
  const property = tokenCustomProperty(tokenIdentity(token), "");
  const first = among.find(
    other => tokenCustomProperty(tokenIdentity(other), "") === property
  );
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
  const used = new Set<string>();
  for (const token of tokens?.tokens ?? []) {
    used.add(tokenCustomProperty(token.name, ""));
    used.add(tokenCustomProperty(tokenIdentity(token), ""));
  }
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
