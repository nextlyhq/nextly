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
  NEXTLY_EXTENSION,
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
  if (!kept) {
    const wanted = key === "$description" ? "a string" : "an object";
    return `"${path}" is not ${wanted}, so it was skipped and the token arrived without it.`;
  }
  return key === "$extensions" ? vendorLostIn(value, path) : undefined;
}

/**
 * What this system's OWN extension states and the reader will not take.
 *
 * The block as a whole being an object is not enough. `readToken` reads this
 * vendor payload field by field — a `css.light` that is a string, a `kind` it
 * recognises, a `css.dark` used only when it is a string too — and takes the
 * native `$value` instead whenever any of that does not hold. A file stating a
 * dark value as a number therefore imports looking entirely successful, with
 * the light value only, and the next export writes a token the file did not
 * describe.
 *
 * Only THIS vendor's key is read. Another tool's extensions are carried through
 * untouched and are none of this site's business, so nothing here judges them.
 */
function vendorLostIn(value: unknown, path: string): string | undefined {
  if (!isPlainRecord(value)) return undefined;
  const own = value[NEXTLY_EXTENSION];
  if (!isPlainRecord(own)) return undefined;
  const at = `${path}.${NEXTLY_EXTENSION}`;
  const css = own.css;
  const usable = isPlainRecord(css) && typeof css.light === "string";
  if (!usable) {
    // The whole extension path is skipped and the token is read from its
    // native value, which is a different token from the one stated here.
    return own.css === undefined
      ? undefined
      : `"${at}.css" does not state a light value as a string, so this site's own values in it were skipped and the token was read from "$value" instead.`;
  }
  return css.dark === undefined || typeof css.dark === "string"
    ? undefined
    : `"${at}.css.dark" is not a string, so the token arrived with its light value only.`;
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
  resolveClashes(into, taken, refused);

  return {
    tokens: { ...into, tokens: applyAll(into.tokens, taken) },
    landed: taken.size,
    refused,
  };
}

/**
 * One incoming token per identity, with the duplicates named.
 *
 * A file can name one token twice. `dtcgToTokens` returns both, because two
 * DTCG paths are two entries — but they compose one custom property here, so
 * only the last can be carried forward. Reported rather than dropped in
 * silence: two tokens going in and one arriving is precisely the loss this
 * feature exists to show.
 *
 * The message names which of the two was DROPPED and never says the other
 * landed, because this choice is made before any clash is judged and the
 * survivor can still be refused afterwards. Claiming it arrived produced a
 * report that contradicted itself on the same import — "only `taken` was
 * taken" beside "`taken` was not imported".
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
        `"${first.name}" and "${token.name}" are one token in that file — both carry the identity "${identity}" — so "${first.name}" was dropped in favour of "${token.name}".`
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
 * Where every proposed row sits, so a refusal can be judged without a rescan.
 *
 * Refusing a rename does not remove its row — it puts the STORED row back, and
 * that row's own name can collide with something still accepted. Judging that
 * by re-reading the whole table once per refusal is quadratic, and a file whose
 * renames form a long chain is exactly the shape that makes it so: measured at
 * 24ms for 250 tokens, 70 for 500, 269 for 1000 and 1082 for 2000, on the main
 * thread with the studio open.
 *
 * Indexed instead, because the consequences of a refusal are LOCAL: it can only
 * disturb the keys the restored row occupies. A custom property is composed
 * from the identity, which a refusal does not change, so those cannot cascade
 * at all and are settled once.
 */
interface Placement {
  /** identity -> the row currently proposed for it. */
  readonly row: Map<string, SiteToken>;
  /** an exact name -> the identities holding it. */
  readonly named: Map<string, Set<string>>;
  /** a group path -> the identities whose name is nested below it. */
  readonly below: Map<string, Set<string>>;
  /** a composed custom property -> the identities composing it. */
  readonly property: Map<string, Set<string>>;
}

/** Every group path a name passes through on its way to its last segment. */
function ancestorsOf(name: string): string[] {
  const segments = name.split(".");
  const found: string[] = [];
  for (let cut = 1; cut < segments.length; cut++) {
    found.push(segments.slice(0, cut).join("."));
  }
  return found;
}

function hold(index: Map<string, Set<string>>, key: string, who: string): void {
  const held = index.get(key);
  if (held === undefined) index.set(key, new Set([who]));
  else held.add(who);
}

function release(
  index: Map<string, Set<string>>,
  key: string,
  who: string
): void {
  const held = index.get(key);
  if (held === undefined) return;
  held.delete(who);
  if (held.size === 0) index.delete(key);
}

/** Put a row into every index that can report a conflict about it. */
function occupy(at: Placement, token: SiteToken): void {
  const identity = tokenIdentity(token);
  at.row.set(identity, token);
  hold(at.named, token.name, identity);
  for (const above of ancestorsOf(token.name)) hold(at.below, above, identity);
  // The prefix is the same string in front of every property, so it can neither
  // create a collision nor prevent one — the same reason the studio's own
  // collision check composes without it.
  hold(at.property, tokenCustomProperty(identity, ""), identity);
}

/** Take a row back out of every index, leaving its identity unplaced. */
function vacate(at: Placement, identity: string): void {
  const token = at.row.get(identity);
  if (token === undefined) return;
  at.row.delete(identity);
  release(at.named, token.name, identity);
  for (const above of ancestorsOf(token.name)) {
    release(at.below, above, identity);
  }
  release(at.property, tokenCustomProperty(identity, ""), identity);
}

/** One key some rows are fighting over, and which pass may settle it. */
interface Key {
  readonly kind: "name" | "property";
  readonly value: string;
}

/**
 * Who is fighting over one key, and what each of them should be told.
 *
 * A name carries TWO constraints and a row can break both at once, so the
 * wording is per participant rather than per key: two rows with the same name
 * are duplicates, and a row named `brand` beside one named `brand.main` asks
 * `brand` to be a token and a group at the same time.
 */
function contestAt(
  at: Placement,
  key: Key
): { holders: Set<string>; say: (identity: string) => string } | undefined {
  if (key.kind === "property") {
    const holders = at.property.get(key.value);
    if (holders === undefined || holders.size < 2) return undefined;
    return {
      holders,
      say: identity =>
        `"${at.row.get(identity)?.name ?? identity}" and another token here both become "${key.value}", so it was not imported. Two tokens cannot share one custom property.`,
    };
  }
  const same = at.named.get(key.value) ?? new Set<string>();
  const nested = at.below.get(key.value) ?? new Set<string>();
  const duplicated = same.size > 1;
  const straddled = same.size > 0 && nested.size > 0;
  if (!duplicated && !straddled) return undefined;
  return {
    holders: new Set([...same, ...nested]),
    say: identity =>
      same.has(identity) && duplicated
        ? `"${key.value}" is already the name of a different token on this site, so it was not imported. Rename one of them and try again.`
        : `"${at.row.get(identity)?.name ?? identity}" cannot be imported beside "${key.value}", which is a token on this site too. A design-token file writes "${key.value}" as either a token or a group holding others, never both, so a file exported with these two would lose one of them.`,
  };
}

/**
 * Refuse one incoming row, put the site's own back, and say where to look next.
 *
 * The restored row is not going to move again — it is what the site already
 * had — so every conflict it creates is a forced one, which is why the cascade
 * never has to revisit the mutual pass.
 */
function revert(
  at: Placement,
  taken: Map<string, SiteToken>,
  stored: ReadonlyMap<string, SiteToken>,
  identity: string,
  work: Key[]
): void {
  taken.delete(identity);
  vacate(at, identity);
  const back = stored.get(identity);
  if (back === undefined) return;
  occupy(at, back);
  work.push({ kind: "name", value: back.name });
  for (const above of ancestorsOf(back.name)) {
    work.push({ kind: "name", value: above });
  }
}

/**
 * Settle every conflict of ONE kind reachable from a worklist.
 *
 * `forced` means at least one row in the fight cannot move: the destination is
 * not going to give the name up, so the refusal is unavoidable. Anything else
 * is incoming rows clashing only with EACH OTHER, and those are left until the
 * forced ones have finished, because a forced refusal can free a name and make
 * a mutual clash disappear. Refusing both halves first would discard an import
 * that a moment later had nothing wrong with it.
 */
function settle(
  at: Placement,
  taken: Map<string, SiteToken>,
  stored: ReadonlyMap<string, SiteToken>,
  refused: string[],
  mode: "forced" | "mutual",
  work: Key[]
): void {
  while (work.length > 0) {
    const key = work.pop();
    if (key === undefined) continue;
    const fight = contestAt(at, key);
    if (fight === undefined) continue;
    // Only INCOMING rows can be refused. A clash the destination already had is
    // not this file's doing, and refusing the import for it would leave an
    // author unable to bring anything in until they had repaired something
    // else entirely.
    const movable = [...fight.holders].filter(identity => taken.has(identity));
    if (movable.length === 0) continue;
    if (movable.length < fight.holders.size !== (mode === "forced")) continue;
    for (const identity of movable) {
      refused.push(fight.say(identity));
      revert(at, taken, stored, identity, work);
    }
  }
}

/** Every key some rows are currently fighting over. */
function contestedKeys(at: Placement): Key[] {
  const found: Key[] = [];
  for (const [value, holders] of at.named) {
    if (holders.size > 1 || at.below.has(value)) {
      found.push({ kind: "name", value });
    }
  }
  for (const [value, holders] of at.property) {
    if (holders.size > 1) found.push({ kind: "property", value });
  }
  return found;
}

/**
 * Remove from `taken` every incoming token the result could not hold, naming it.
 *
 * Three passes, and the order between them is the whole point. Forced refusals
 * first, because they are unavoidable and can FREE a name that some other
 * incoming token was only blocked by. Then the mutual ones, which by that point
 * are tokens clashing with each other and nothing else — a file that
 * contradicts itself, where there is no ground to prefer either, so both are
 * refused and both are named. Then forced once more, because a mutual refusal
 * also puts a stored row back.
 *
 * A fourth pass cannot be needed. Refusing a token only ever ADDS an immovable
 * row to a key, so any conflict that appears afterwards has an immovable
 * participant and is forced by construction; and freeing a key never creates a
 * conflict at all.
 */
function resolveClashes(
  into: SiteTokenSet,
  taken: Map<string, SiteToken>,
  refused: string[]
): void {
  const stored = new Map<string, SiteToken>();
  for (const token of into.tokens) {
    // First wins, matching the emitter and `applyAll`: where a table already
    // holds one identity twice, the row the emitter would write is the row
    // this judges.
    const identity = tokenIdentity(token);
    if (!stored.has(identity)) stored.set(identity, token);
  }
  const at: Placement = {
    row: new Map(),
    named: new Map(),
    below: new Map(),
    property: new Map(),
  };
  for (const token of applyAll(into.tokens, taken)) {
    if (!at.row.has(tokenIdentity(token))) occupy(at, token);
  }
  settle(at, taken, stored, refused, "forced", contestedKeys(at));
  settle(at, taken, stored, refused, "mutual", contestedKeys(at));
  settle(at, taken, stored, refused, "forced", contestedKeys(at));
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
