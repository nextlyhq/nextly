/**
 * Taking a token table out of this site, and bringing one in.
 *
 * A thin layer over the engine's `tokensToDtcg` and `dtcgToTokens`, which do
 * the conversion and already do the hard half of it: they REPORT what they
 * could not carry rather than dropping it in silence. That report is the whole
 * value of the pair — a designer handed a file with three tokens missing has no
 * way to know, and the ones that go missing are the interesting ones — so
 * everything here is arranged so the caller cannot accidentally throw it away.
 *
 * ## Import MERGES, and merges on identity
 *
 * A file adds tokens and changes the ones it names; it never removes what it
 * does not mention. Replacing the table would silently delete tokens that
 * blocks across the site still reference, with the page still rendering and no
 * error anywhere — an outcome nothing here could undo.
 *
 * Merged on IDENTITY rather than on name, because that is what a reference
 * stores and what every other tier merge in this system keys on. Keyed on the
 * name, a file naming a token the site has renamed would arrive as a second
 * entry beside it, and the two would collide on the one custom property they
 * both compose.
 *
 * ## A partial file imports partially
 *
 * The engine maps seven `$type`s and the format defines more — `typography`,
 * `transition`, `gradient` and the rest have no kind here — so a file exported
 * from a design tool usually contains entries this site cannot hold. Refusing
 * the whole file for them would mean import almost never succeeds, and the
 * author could not repair it without editing the file by hand. What comes in is
 * what fits; what did not is named, with the engine's own reason.
 *
 * @module tokens-transfer
 */
import {
  isPlainRecord,
  compileSiteSheet,
  dtcgToTokens,
  tokenCustomProperty,
  tokenIdentity,
  tokensToDtcg,
  type SiteToken,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";

/** What an import did, or why it could not begin. */
export type ImportResult =
  | {
      readonly ok: true;
      /** The whole table, with the file merged into it. */
      readonly tokens: SiteTokenSet;
      /** How many tokens the file contributed, added or changed. */
      readonly imported: number;
      /** What the file held that this site cannot, in the engine's words. */
      readonly skipped: readonly string[];
    }
  | {
      readonly ok: false;
      /** Why nothing could be read at all. */
      readonly error: string;
      /** Anything the engine said on the way, which may explain the refusal. */
      readonly skipped: readonly string[];
    };

/**
 * A design-token document merged into the table this site already has.
 *
 * The text is parsed HERE rather than handed to the engine as a string, because
 * "this is not JSON" and "this is JSON but not a token document" are different
 * failures with different repairs — one is a corrupt or truncated file, the
 * other is the wrong file — and a single message covering both sends the author
 * to look in the wrong place.
 */
export function importDtcg(text: string, into: SiteTokenSet): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      error:
        "That file is not valid JSON, so nothing in it could be read. It may be truncated or may not be a token file at all.",
      skipped: [],
    };
  }

  let read: ReturnType<typeof dtcgToTokens>;
  let report: string[];
  try {
    read = dtcgToTokens(parsed);
    // Inside the guard, because it is a SECOND traversal of the same untrusted
    // document: whatever defeats the reader can defeat this too, and it runs
    // after the reader has already succeeded — so outside, its failure would
    // escape a boundary that had already decided the file was readable.
    report = discarded(parsed);
  } catch {
    /*
     * The conversion walks the document recursively, so a deeply nested one —
     * a few thousand groups, which is tens of kilobytes of file — exhausts the
     * stack. A `RangeError` is not something a caller can act on, and this is
     * the import BOUNDARY: everything past it is a panel that would let the
     * rejection escape into a discarded promise, showing nothing and stopping
     * silently. Turned into the refusal every other failure here returns.
     */
    return {
      ok: false,
      error:
        "That file is nested too deeply to read. A design-token file groups its tokens a few levels deep; this one goes thousands.",
      skipped: [],
    };
  }
  const skipped = [...read.issues.map(issue => issue.message), ...report];
  if (read.tokens.length === 0) {
    return {
      ok: false,
      error:
        "No tokens in that file could be used by this site. Nothing was changed.",
      skipped,
    };
  }
  const merged = mergeById(into, read.tokens);
  return {
    ok: true,
    tokens: merged.tokens,
    // What SURVIVED, not what the file held. A file can name one token twice —
    // two entries carrying one identity — and only the last of them lands, so
    // counting the file's entries would claim an arrival that did not happen.
    imported: merged.landed,
    skipped: [...skipped, ...merged.refused],
  };
}

/**
 * Entries the reader walked past without a word.
 *
 * The engine's walk descends into every child whose key does not begin with
 * `$`, and simply CONTINUES when that child is not an object — it is neither a
 * group to descend into nor a token to read. Nothing is reported, so a document
 * shaped like `{ good: <token>, lost: 42 }` imports one token and says nothing
 * about the other: part of the source file gone, from a feature whose whole
 * purpose is naming what was lost.
 *
 * Detected here rather than in the engine because that is a change to a shared
 * package this task does not own. That placement has a cost worth naming: this
 * walk MIRRORS `dtcgToTokens`'s traversal rather than deriving from it, so the
 * two can drift, and a reader taught to accept something new goes on being
 * reported here as dropping it. `fateOf` is arranged so the drift errs toward
 * saying too much rather than too little, which is the best a mirror can do —
 * the fix is for the engine to report its own losses, and when it does this
 * whole traversal should be DELETED rather than left beside it.
 *
 * Walked with an explicit stack rather than by recursion, for the reason the
 * conversion is caught above: a deep document must not put this on the stack
 * too.
 */
function discarded(root: unknown): string[] {
  const lost: string[] = [];
  const stack: Frame[] = [{ node: root, path: [] }];
  while (stack.length > 0) {
    const here = stack.pop();
    if (here === undefined) continue;
    const read = childrenOf(here);
    /*
     * Pushed one at a time. `push(...frontier)` passes every entry as a
     * function ARGUMENT, and a shallow document with enough top-level entries
     * exceeds the engine's argument limit — measured at a valid file of about
     * 5.6 MB, one group deep. Making the walk iterative to escape recursion
     * depth and then spreading its frontier trades one stack overflow for
     * another.
     */
    for (const frame of read.descend) stack.push(frame);
    for (const line of read.lost) lost.push(line);
  }
  return lost;
}

/** One node still to look at, and the path that reached it. */
interface Frame {
  readonly node: unknown;
  readonly path: readonly string[];
}

/**
 * What one node's children are: places to go on looking, and things lost.
 *
 * Split from the walk because they are different questions — where to go next
 * is about the shape of the document, and what was lost is about what this site
 * can read — and a reader following one of them should not have to step through
 * the other.
 */
function childrenOf(here: Frame): { descend: Frame[]; lost: string[] } {
  const descend: Frame[] = [];
  const lost: string[] = [];
  if (!isRecord(here.node)) return { descend, lost };

  const isToken = Object.hasOwn(here.node, "$value");
  for (const [key, value] of Object.entries(here.node)) {
    const fate = fateOf(key, value, [...here.path, key].join("."), isToken);
    if (fate.kind === "lost") lost.push(fate.said);
    else if (fate.kind === "descend") {
      descend.push({ node: value, path: [...here.path, key] });
    }
  }
  return { descend, lost };
}

/** What the reader does with one child: keeps it, walks into it, or drops it. */
type Fate =
  | { readonly kind: "kept" }
  | { readonly kind: "descend" }
  | { readonly kind: "lost"; readonly said: string };

/**
 * What becomes of one child of one node, as an EXHAUSTIVE decision.
 *
 * An ALLOWLIST: each branch below names something the reader keeps or walks
 * into, and anything no branch claims is reported. The denylist it replaced
 * asked the opposite question — which children are lost — and needed a new
 * branch for every field the reader happens to pass over, so it was extended
 * three times running: a group's own `$root` token, then a malformed
 * `$description`, then a `$type` that is not a name and a token nested inside
 * another token. Each repair was right and none could be the last, because
 * "what this reader ignores" is not a set that can be finished from here — it
 * grows whenever the shared package changes, silently, in the direction of
 * losing more.
 *
 * Reversed, the same uncertainty costs a line of noise instead: a field the
 * reader does read but this file has not heard of is reported as skipped, which
 * is wrong and visible, rather than dropped, which is wrong and invisible.
 *
 * Split on whether the key is the format's own, because the two are different
 * questions. A `$` key asks about the DTCG VOCABULARY — which of its fields
 * this reader takes, and in what shape. Any other key asks about the document's
 * TREE: whether there is anywhere left to walk.
 */
function fateOf(
  key: string,
  value: unknown,
  path: string,
  isToken: boolean
): Fate {
  return key.startsWith("$")
    ? reservedFate(key, value, path, isToken)
    : namedFate(value, path, isToken);
}

/** What the reader does with one of the format's own `$` fields. */
function reservedFate(
  key: string,
  value: unknown,
  path: string,
  isToken: boolean
): Fate {
  // What makes the node a token at all, and the two fields carried with it.
  if (key === "$value") return { kind: "kept" };
  if (key === "$description" || key === "$extensions") {
    const said = metadataLostAt(key, value, path, isToken);
    return said === undefined ? { kind: "kept" } : { kind: "lost", said };
  }
  /*
   * `$root` is a TOKEN, not a reserved field: DTCG 2025.10 gives a group its
   * own token under that name, so `color.$root` is a real token at the path
   * `color.$root`. The shared reader skips every `$` key, so such a token is
   * neither imported nor mentioned — silent loss arriving through the one `$`
   * key that is not metadata.
   */
  if (key === "$root") {
    return {
      kind: "lost",
      said: `"${path}" is a group's own token, which this site cannot read yet, so it was skipped.`,
    };
  }
  /*
   * A type descends through the groups to the tokens under them, and the
   * reader takes it only when it is a name. Anything else falls back to the
   * enclosing group's type without a word, so the file states one type and the
   * site holds another — the token arrives looking imported and is not the
   * token the file described.
   */
  if (key === "$type" && typeof value === "string") return { kind: "kept" };
  if (key === "$type") {
    return {
      kind: "lost",
      said: `"${path}" is not a usable type — a type is written as a name, such as "color" — so it was ignored and the type was taken from the group around it instead.`,
    };
  }
  return {
    kind: "lost",
    said: `"${path}" is a design-token field this site does not read, so it was skipped.`,
  };
}

/** Whether one NAMED child is somewhere the reader still has to go. */
function namedFate(value: unknown, path: string, isToken: boolean): Fate {
  /*
   * The reader STOPS at a token. `dtcgToTokens` reads the entry and moves to
   * the next SIBLING rather than descending, so a token written inside another
   * token is never reached. Walking in here would find a perfectly valid child
   * and report nothing about it — the shape this file is least able to notice,
   * because everything about the child looks importable.
   */
  if (isToken) {
    return {
      kind: "lost",
      said: `"${path}" is written inside a token, where this site's reader does not look, so it was skipped.`,
    };
  }
  return isRecord(value)
    ? { kind: "descend" }
    : {
        kind: "lost",
        said: `"${path}" is neither a token nor a group of them, so it was skipped.`,
      };
}

/**
 * Why a description or an extensions block will not be kept, or `undefined`.
 *
 * Its own question because it turns on two things the rest of the walk does not
 * care about: WHOSE metadata this is, and whether it is the shape the reader
 * accepts.
 *
 * On a GROUP it is dropped whatever its shape — the reader flattens a group's
 * children and keeps nothing of the group itself. On a TOKEN it is kept, but
 * only when a description is a string and extensions are a plain object; the
 * reader takes neither otherwise and says nothing, so a token with
 * `$description: 42` imports looking perfectly successful and comes back out
 * having lost it.
 */
function metadataLostAt(
  key: string,
  value: unknown,
  path: string,
  isToken: boolean
): string | undefined {
  if (!isToken) {
    return `"${path}" belongs to a group rather than to a token, and this site keeps only tokens, so it was skipped.`;
  }
  const kept =
    key === "$description" ? typeof value === "string" : isPlainRecord(value);
  if (kept) return undefined;
  const wanted = key === "$description" ? "a string" : "an object";
  return `"${path}" is not ${wanted}, so it was skipped and the token arrived without it.`;
}

/** An object with named keys, which is what a group and a token both are. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The table with `incoming` layered over it, matched on identity.
 *
 * Order is preserved for what was already there, and new tokens are appended,
 * so an import does not reshuffle a table the author has been reading. A token
 * the file names keeps its POSITION and takes the file's content.
 */
function mergeById(
  into: SiteTokenSet,
  incoming: readonly SiteToken[]
): { tokens: SiteTokenSet; landed: number; refused: string[] } {
  const refused: string[] = [];
  const wanted = oneEach(incoming, refused);

  /*
   * Conflicts are judged against the table as it WOULD be with everything
   * applied, not against a destination mutated entry by entry.
   *
   * Incrementally, the answer depends on the order the file happens to list its
   * tokens: a file renaming `a` to `beta` and `b` to `gamma` imports both if
   * `b` comes first and only one if `a` does, because `beta` is still taken at
   * the moment `a` is considered. Coordinated renames are ordinary — a design
   * tool emits them whenever someone reorganises a palette — and half-applying
   * one is worse than refusing it, because the half that lands is a rename the
   * author did not ask for on its own.
   *
   * Judged REPEATEDLY, because a refusal can free what it was blocking: a token
   * whose only clash is with another incoming token that must itself be refused
   * is perfectly importable once that one is gone. One pass would discard it for
   * a conflict that does not survive the pass. Each round removes at least one
   * token, so this terminates in at most as many rounds as the file has tokens,
   * and in practice in one.
   */
  const taken = new Map(wanted);
  /*
   * Rounds of refusals, until one removes nothing.
   *
   * An earlier version ran the two passes below ONCE, on the reasoning that
   * removing tokens only shrinks the table, so nothing new can clash after the
   * first pass. That is wrong, and wrong in the direction of accepting an
   * invalid table: refusing an incoming token does not remove a row, it REVERTS
   * that row to the name the site already had, and the name it reverts to can
   * collide with something still accepted. Three coordinated renames reach it —
   * one refusal forced by an untouched token, whose knock-on refusal restores a
   * stored name beside an accepted token that had taken it — and the import
   * reports success holding one name twice, which the next export cannot write.
   *
   * Each round that changes anything removes at least one entry from a finite
   * map, so this terminates; in practice it settles in one.
   */
  for (;;) {
    const before = taken.size;
    refuseClashing(into, taken, refused);
    if (taken.size === before) break;
  }

  return {
    tokens: { ...into, tokens: applyAll(into.tokens, taken) },
    landed: taken.size,
    refused,
  };
}

/**
 * ONE round of refusals against the table the import would produce.
 *
 * Two passes, and the order between them is the whole point.
 *
 * First remove what clashes with a token this file does not touch. Those
 * refusals are forced — the destination is not going to move — and removing
 * them can free tokens that were only blocked THROUGH them: a file bringing
 * `{id:"foo.bar", name:"taken"}` and `{id:"foo-bar", name:"usable"}` has the
 * first refused for its name, and the second shares a custom property only with
 * that first one, so it is importable the moment the first is gone. One pass
 * would discard it for a conflict that does not survive the pass.
 *
 * Then remove whatever still clashes, which by then is only tokens clashing
 * with EACH OTHER. A file holding two tokens that are one token here is a file
 * that contradicts itself, and there is no ground to prefer either, so both are
 * refused and both are named.
 *
 * Its own function because the caller asks a different question: this is what
 * ONE look at the proposal decides, and the caller is why one look is not
 * enough.
 */
function refuseClashing(
  into: SiteTokenSet,
  taken: Map<string, SiteToken>,
  refused: string[]
): void {
  for (const against of ["forced", "mutual"] as const) {
    for (const identity of clashingIn(
      applyAll(into.tokens, taken),
      taken,
      refused,
      against
    )) {
      taken.delete(identity);
    }
  }
}

/**
 * One incoming token per identity, with the duplicates named.
 *
 * A file can name one token twice. `dtcgToTokens` returns both, because two
 * DTCG paths are two entries — but they compose one custom property here, so
 * only the last can land. Reported rather than dropped in silence: two tokens
 * going in and one arriving is precisely the loss this feature exists to show.
 */
function oneEach(
  incoming: readonly SiteToken[],
  refused: string[]
): Map<string, SiteToken> {
  const wanted = new Map<string, SiteToken>();
  for (const token of incoming) {
    const identity = tokenIdentity(token);
    const first = wanted.get(identity);
    if (first !== undefined) {
      refused.push(
        `"${first.name}" and "${token.name}" are one token in that file — both carry the identity "${identity}" — so only "${token.name}" was taken.`
      );
    }
    wanted.set(identity, token);
  }
  return wanted;
}

/**
 * The destination with every wanted token applied, replacing or appending.
 *
 * The destination is indexed ONCE rather than searched per incoming token. A
 * scan inside the loop makes the whole import quadratic, and it runs on the
 * main thread while the studio is open: measured at roughly 1.3 seconds for
 * five thousand tokens, 4.7 for ten thousand and 18 for twenty thousand, with
 * the editor unresponsive throughout. A design system that large is unusual and
 * a generated one is not.
 */
function applyAll(
  base: readonly SiteToken[],
  wanted: ReadonlyMap<string, SiteToken>
): SiteToken[] {
  const tokens = [...base];
  const at = new Map<string, number>();
  tokens.forEach((token, index) => {
    // First wins, matching the emitter: where a table already holds two entries
    // under one identity, a replacement lands on the one that would be written.
    if (!at.has(tokenIdentity(token))) at.set(tokenIdentity(token), index);
  });
  for (const [identity, token] of wanted) {
    const index = at.get(identity);
    if (index === undefined) {
      at.set(identity, tokens.length);
      tokens.push(token);
    } else {
      tokens[index] = token;
    }
  }
  return tokens;
}

/**
 * Which incoming identities cannot land, because the result would be invalid.
 *
 * Three constraints, and they are different questions. A NAME belongs to one
 * token: the studio refuses a duplicate label outright, so admitting one
 * imports a state the editor cannot create. A name is also a PATH — a design
 * token file writes `brand.main` as a token `main` inside a group `brand` —
 * so a token named `brand` cannot sit beside one named `brand.main`, which
 * asks `brand` to be a token and a group at once. And a composed CUSTOM
 * PROPERTY belongs to one token too, which is not visible in the names at all:
 * `color.primary-dark` and `color-primary.dark` read as different tokens and
 * are the same property, so the emitter writes the first and refuses the
 * second.
 *
 * All three are the same failure from an author's side — an import that
 * reported success and lost a token on the way back out — and none of them is
 * implied by the others.
 *
 * Only INCOMING tokens are blocked. A clash the destination already had is not
 * this file's doing, and refusing the import for it would leave an author
 * unable to bring anything in until they had repaired something else.
 */
function clashingIn(
  proposed: readonly SiteToken[],
  wanted: ReadonlyMap<string, SiteToken>,
  refused: string[],
  against: "forced" | "mutual"
): Set<string> {
  const block = (
    clashes: readonly Clash[],
    say: (token: SiteToken, key: string) => string
  ) => blocking(clashes, wanted, refused, against, say);

  return new Set([
    ...block(
      groupedBy(proposed, token => token.name),
      (token, name) =>
        `"${name}" is already the name of a different token on this site, so it was not imported. Rename one of them and try again.`
    ),
    ...block(
      nestedUnder(proposed),
      (token, above) =>
        `"${token.name}" cannot be imported beside "${above}", which is a token on this site too. A design-token file writes "${above}" as either a token or a group holding others, never both, so a file exported with these two would lose one of them.`
    ),
    ...block(
      groupedBy(proposed, token =>
        // The prefix is the same string in front of every property, so it can
        // neither create a collision nor prevent one — the same reason the
        // studio's own collision check composes without it.
        tokenCustomProperty(tokenIdentity(token), "")
      ),
      (token, property) =>
        `"${token.name}" and another token here both become "${property}", so it was not imported. Two tokens cannot share one custom property.`
    ),
  ]);
}

/** Tokens that cannot coexist, and the thing they are fighting over. */
interface Clash {
  readonly key: string;
  readonly sharing: readonly SiteToken[];
}

/**
 * Which incoming participants in a clash to refuse, and what to say about it.
 *
 * One implementation for every constraint, taking the clashes already found.
 * What differs between them is how a group is FORMED — equal keys for two of
 * them, a path relation for the third — and the policy on top is identical:
 * which side is blocked, and when a clash is forced rather than resolvable.
 * Written out per constraint, that policy is how the three stop agreeing.
 */
function blocking(
  clashes: readonly Clash[],
  wanted: ReadonlyMap<string, SiteToken>,
  refused: string[],
  against: "forced" | "mutual",
  say: (token: SiteToken, key: string) => string
): Set<string> {
  const blocked = new Set<string>();
  for (const { key, sharing } of clashes) {
    // Whether this clash involves a token the file does not touch. If it does,
    // the refusal is forced; if it does not, the incoming tokens are only
    // clashing with each other and may still be freed by an earlier removal.
    const untouched = sharing.some(token => !wanted.has(tokenIdentity(token)));
    if (against === "forced" && !untouched) continue;
    for (const token of sharing) {
      const identity = tokenIdentity(token);
      if (!wanted.has(identity)) continue;
      blocked.add(identity);
      refused.push(say(token, key));
    }
  }
  return blocked;
}

/** Tokens sharing one key, where more than one holds it. */
function groupedBy(
  proposed: readonly SiteToken[],
  keyOf: (token: SiteToken) => string
): Clash[] {
  const held = new Map<string, SiteToken[]>();
  for (const token of proposed) group(held, keyOf(token), token);
  const found: Clash[] = [];
  for (const [key, sharing] of held) {
    if (sharing.length > 1) found.push({ key, sharing });
  }
  return found;
}

/**
 * Tokens whose name sits on a path another token already occupies.
 *
 * Not the same question as two equal names, and not reachable from it: `brand`
 * and `brand.main` are different strings, so every key-based check accepts
 * both, and the loss appears only on the way back OUT — `place` walks to
 * `brand` looking for a group, finds a token, and drops the entry with an
 * issue. An import that reported success has quietly made the table
 * unexportable.
 *
 * Indexed by name rather than compared pair by pair. A name has a handful of
 * segments and a table can have thousands of tokens, and the quadratic form of
 * this runs on the main thread with the studio open — the same measurement that
 * decided how `applyAll` looks up its destination.
 */
function nestedUnder(proposed: readonly SiteToken[]): Clash[] {
  const at = new Map<string, SiteToken>();
  for (const token of proposed) {
    if (!at.has(token.name)) at.set(token.name, token);
  }
  const found: Clash[] = [];
  for (const token of proposed) {
    const segments = token.name.split(".");
    // Every group this name passes through on its way to its own last segment.
    for (let cut = 1; cut < segments.length; cut++) {
      const above = segments.slice(0, cut).join(".");
      const holder = at.get(above);
      if (holder !== undefined) {
        found.push({ key: above, sharing: [holder, token] });
      }
    }
  }
  return found;
}

/** Add a token to the list under a key, starting the list if it is the first. */
function group(
  index: Map<string, SiteToken[]>,
  key: string,
  token: SiteToken
): void {
  const held = index.get(key);
  if (held === undefined) index.set(key, [token]);
  else held.push(token);
}

/** A file this site can hand to another tool, and what it could not carry. */
export interface ExportResult {
  readonly text: string;
  /** The file name to offer, which is part of the artefact rather than chrome. */
  readonly filename: string;
  readonly mime: string;
  /** Tokens the format could not represent, in the engine's words. */
  readonly skipped: readonly string[];
}

/**
 * The site's tokens as a design-token document.
 *
 * Pretty-printed rather than minified: the artefact is read by people and lands
 * in version control, where a diff over one line per token is the difference
 * between a reviewable change and an opaque one.
 */
export function exportDtcg(tokens: SiteTokenSet): ExportResult {
  let skipped: string[];
  let text: string;
  try {
    /*
     * EVERY step that reads the vendor data is inside this guard, the
     * conversion included. Each was moved in separately after being found to
     * touch the same untrusted values one step earlier than the last: the
     * write reaches them through `JSON.stringify`, the preflight walks them
     * first, and `tokensToDtcg` SPREADS `token.extensions` before either runs,
     * so an enumerable getter that throws is read there. The boundary is the
     * whole export rather than any one of its steps, which is what stops a
     * line added later from landing outside it.
     */
    const { document, issues } = tokensToDtcg(tokens);
    skipped = [...issues.map(issue => issue.message), ...unwritable(tokens)];
    text = `${JSON.stringify(document, null, 2)}\n`;
  } catch {
    /*
     * `SiteToken.extensions` is `Record<string, unknown>` and carries vendor
     * data untouched, which is what the format asks for — and a site's own
     * TypeScript config can put a `bigint`, a cycle or a throwing `toJSON` in
     * there. `tokensToDtcg` copies it faithfully and `JSON.stringify` then
     * throws, out of a click handler, so nothing downloads and nothing is
     * said.
     *
     * Answered with an empty artefact and a reason rather than a throw: the
     * caller downloads what it is given, so a file that cannot be written has
     * to arrive here as a report.
     */
    return {
      text: "",
      filename: "tokens.json",
      mime: "application/json",
      /*
       * The engine's own issues are absent here deliberately: the conversion
       * that produces them is inside the guard, so a failure during it leaves
       * nothing to report but this. Naming issues from a conversion that did
       * not finish would be reporting a list nobody produced.
       */
      skipped: [
        "This site's tokens carry vendor data that cannot be written to a file — a value JSON has no form for, such as a very large number or a structure that refers to itself. Nothing was exported.",
      ],
    };
  }
  return {
    text,
    filename: "tokens.json",
    mime: "application/json",
    skipped,
  };
}

/**
 * Tokens whose vendor data will not survive being written, named.
 *
 * A THROWING value is caught where the file is built. This is the quieter case:
 * `JSON.stringify` succeeds and drops things on the way — a function, a symbol,
 * an `undefined`, a `toJSON` returning nothing — so the check cannot be "did it
 * throw". Everything it drops it drops SILENTLY, and one of the things riding
 * in `$extensions` is this system's own record of a token's stable identity and
 * exact CSS. Lose that and the file stops being round-trippable: importing it
 * back gives the token a new identity, and every document referencing the old
 * one stops resolving.
 *
 * Asked as "is this made only of things a file can hold" rather than by writing
 * it and comparing what comes back. The ALLOWLIST is the sound direction here:
 * what JSON can carry is closed and fixed by its grammar, while what it cannot
 * grows with the language — a check built from the second list goes quiet about
 * whatever was added since someone last looked at it.
 */
function unwritable(tokens: SiteTokenSet): string[] {
  const lost: string[] = [];
  for (const token of tokens.tokens) {
    if (token.extensions === undefined) continue;
    if (holdsOnlyJson(token.extensions)) continue;
    lost.push(
      `"${token.name}" carries vendor data that a file cannot hold, so the exported token is missing it. Importing this file back would give that token a different identity.`
    );
  }
  return lost;
}

/**
 * Whether a value is made only of what a JSON file can carry.
 *
 * `toJSON` counts as cannot: it means the written form is something other than
 * the value, so what a reader gets back is not what was stored — which is the
 * loss being looked for, whether or not the substitute is itself writable.
 *
 * A non-finite number is refused for the same reason rather than as pedantry:
 * `NaN` and the infinities are written as `null`, so the value silently becomes
 * a different one.
 */
function holdsOnlyJson(value: unknown, seen = new Set<unknown>()): boolean {
  if (isJsonLeaf(value)) return true;
  if (typeof value !== "object" || value === null) return false;
  /*
   * A cycle is not something a file can hold either, but it is reported where
   * writing THROWS rather than here — so what this needs from it is only not to
   * follow it forever. Without the set this walk recurses until the stack goes,
   * which is the failure it was written to prevent, one level up.
   */
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) {
    /*
     * Index by index rather than through `every`, which SKIPS holes. A sparse
     * array has none of its missing elements visited, so it passes vacuously
     * while `JSON.stringify` writes each hole as `null` — vendor data coming
     * back CHANGED rather than missing, which is the one shape a walk over the
     * values it can SEE cannot notice.
     *
     * Reading the index is all it takes: a hole reads as `undefined`, which is
     * not a leaf and not an object, so the same call that judges every other
     * element refuses it. An explicit `undefined` is refused with it, and
     * rightly — `JSON.stringify` turns that into `null` too.
     */
    for (let index = 0; index < value.length; index++) {
      if (!holdsOnlyJson(value[index], seen)) return false;
    }
    return true;
  }
  return recordHoldsJson(value, seen);
}

/**
 * Whether a non-array object is what it appears to be, contents included.
 *
 * Its own question because an object can MISREPRESENT itself in two ways an
 * array cannot, and both are answered before any of its contents matter:
 *
 * A `Map` or a `Set` has no own enumerable keys, so walking its values finds
 * nothing and it looks perfectly safe — and `JSON.stringify` writes it as
 * `{}`, erasing everything it held. That is the trap the engine's own
 * `isPlainRecord` exists for, and the reason it reads the prototype rather
 * than counting keys.
 *
 * A `toJSON` method means the written form is something OTHER than the value,
 * so a reader gets back something that was never stored — the loss being looked
 * for, whether or not the substitute is itself writable.
 */
function recordHoldsJson(value: object, seen: Set<unknown>): boolean {
  if (!isPlainRecord(value)) return false;
  if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return false;
  }
  return Object.values(value).every(item => holdsOnlyJson(item, seen));
}

/**
 * Whether a value is one a JSON file can carry as it stands.
 *
 * The closed half of the question, asked apart from the walk because it is
 * fixed by the grammar and the walk is not: strings, booleans, finite numbers
 * and null, and nothing else. A non-finite number is refused rather than
 * accepted as pedantry — `NaN` and the infinities are written as `null`, so the
 * value silently becomes a different one.
 */
function isJsonLeaf(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The site's tokens as the CSS custom properties a page actually resolves.
 *
 * Compiled with `compileSiteSheet` rather than assembled here, so what this
 * hands over is the same text a visitor's stylesheet contains. A second
 * renderer would agree today and drift, and the drift would be invisible: the
 * exported file would describe a site that does not exist.
 *
 * Export only. Reading CSS back would need a parser nothing in this system has,
 * and a token table recovered from custom properties would have lost every
 * token's kind — which is what decides where it may be used.
 */
export function exportCss(tokens: SiteTokenSet): ExportResult {
  const sheet = compileSiteSheet({
    tokens,
    /*
     * No breakpoints, and TYPED rather than cast. Token declarations are not
     * emitted under any at-rule, so the axes decide nothing here — but the cast
     * that used to stand in for them hid the fact that the value was the wrong
     * SHAPE entirely, and a wrong argument to this call would have gone on
     * compiling. A `BreakpointSet` with two empty axes says the same thing and
     * says it in the type.
     */
    breakpoints: { viewport: [], container: [] },
  });
  return {
    // An empty sheet stays empty rather than becoming a newline. A
    // one-character file downloads as `tokens.css` and reports as saved, which
    // tells an author their tokens were written when nothing was — and the
    // warnings saying why are the report they actually needed.
    text: sheet.css === "" ? "" : `${sheet.css}\n`,
    filename: "tokens.css",
    mime: "text/css",
    skipped: sheet.warnings.map(warning => warning.message),
  };
}
