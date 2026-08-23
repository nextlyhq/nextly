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
 * package this task does not own — and because the question this asks is
 * narrow: not "is this a valid token", which is the engine's to answer and
 * would be a second implementation of it, but "is this shaped like anything at
 * all". A number where a group or a token belongs is neither, whatever the
 * rules for tokens turn out to be.
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
    const said = lostAt(key, value, here, isToken);
    if (said !== undefined) lost.push(said);
    else if (!key.startsWith("$") && isRecord(value)) {
      descend.push({ node: value, path: [...here.path, key] });
    }
  }
  return { descend, lost };
}

/**
 * Why this child will not survive the import, or `undefined` when it will.
 *
 * The three ways a child goes missing, asked in one place because a reader
 * following "where does the walk go next" should not have to step through them,
 * and because they share one shape: a key the reader passes over without a
 * word.
 */
function lostAt(
  key: string,
  value: unknown,
  here: Frame,
  isToken: boolean
): string | undefined {
  const path = [...here.path, key].join(".");
  /*
   * `$root` is a TOKEN, not a reserved field: DTCG 2025.10 gives a group its
   * own token under that name, so `color.$root` is a real token at the path
   * `color.$root`. The shared reader skips every `$` key, so such a token is
   * neither imported nor mentioned — silent loss arriving through the one `$`
   * key that is not metadata.
   */
  if (key === "$root") {
    return `"${path}" is a group's own token, which this site cannot read yet, so it was skipped.`;
  }
  /*
   * On a TOKEN these are read and carried. On a GROUP they are not: the reader
   * flattens a group's children and keeps nothing of the group itself, so a
   * group's description and any vendor data on it are gone from the next export
   * with nothing said.
   */
  if (key === "$description" || key === "$extensions") {
    return isToken
      ? undefined
      : `"${path}" belongs to a group rather than to a token, and this site keeps only tokens, so it was skipped.`;
  }
  if (key.startsWith("$")) return undefined;
  return isRecord(value)
    ? undefined
    : `"${path}" is neither a token nor a group of them, so it was skipped.`;
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
   * TWO passes, and the order between them is the whole point.
   *
   * First remove what clashes with a token this file does not touch. Those
   * refusals are forced — the destination is not going to move — and removing
   * them can free tokens that were only blocked THROUGH them: a file bringing
   * `{id:"foo.bar", name:"taken"}` and `{id:"foo-bar", name:"usable"}` has the
   * first refused for its name, and the second shares a custom property only
   * with that first one, so it is importable the moment the first is gone. One
   * pass would discard it for a conflict that does not survive the pass.
   *
   * Then remove whatever still clashes, which by then is only tokens clashing
   * with EACH OTHER. A file holding two tokens that are one token here is a
   * file that contradicts itself, and there is no ground to prefer either, so
   * both are refused and both are named.
   *
   * Two passes suffice rather than a loop: removing tokens only ever shrinks
   * the table, so nothing new can clash after the first pass.
   */
  for (const identity of clashingIn(
    applyAll(into.tokens, taken),
    taken,
    refused,
    "forced"
  )) {
    taken.delete(identity);
  }
  for (const identity of clashingIn(
    applyAll(into.tokens, taken),
    taken,
    refused,
    "mutual"
  )) {
    taken.delete(identity);
  }

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
 * Two keys, and they are different questions. A NAME belongs to one token: the
 * studio refuses a duplicate label outright, so admitting one imports a state
 * the editor cannot create, and the export would place both at one design-token
 * path and drop one. A composed CUSTOM PROPERTY belongs to one token too, and
 * that one is not visible in the names: `color.primary-dark` and
 * `color-primary.dark` read as different tokens and are the same property, so
 * the emitter writes the first and refuses the second — an import that looked
 * successful whose value never reaches the page.
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
  return new Set([
    ...sharingAKey(
      proposed,
      wanted,
      refused,
      against,
      token => token.name,
      (token, name) =>
        `"${name}" is already the name of a different token on this site, so it was not imported. Rename one of them and try again.`
    ),
    ...sharingAKey(
      proposed,
      wanted,
      refused,
      against,
      // The prefix is the same string in front of every property, so it can
      // neither create a collision nor prevent one — the same reason the
      // studio's own collision check composes without it.
      token => tokenCustomProperty(tokenIdentity(token), ""),
      (token, property) =>
        `"${token.name}" and another token here both become "${property}", so it was not imported. Two tokens cannot share one custom property.`
    ),
  ]);
}

/**
 * The incoming identities that share `keyOf` with some other token.
 *
 * One question asked twice rather than two loops that happen to look alike:
 * what differs between the name check and the property check is the key and
 * the wording, and writing each out separately is how the two stop agreeing
 * about which side of a clash gets blocked.
 */
function sharingAKey(
  proposed: readonly SiteToken[],
  wanted: ReadonlyMap<string, SiteToken>,
  refused: string[],
  against: "forced" | "mutual",
  keyOf: (token: SiteToken) => string,
  say: (token: SiteToken, key: string) => string
): Set<string> {
  const held = new Map<string, SiteToken[]>();
  for (const token of proposed) group(held, keyOf(token), token);

  const blocked = new Set<string>();
  for (const [key, sharing] of held) {
    if (sharing.length < 2) continue;
    // Whether this clash involves a token the file does not touch. If it does,
    // the refusal is forced; if it does not, the incoming tokens are only
    // clashing with each other and may still be freed by an earlier removal.
    const untouched = sharing.some(token => !wanted.has(tokenIdentity(token)));
    if (against === "forced" && !untouched) continue;
    for (const token of sharing) {
      const identity = tokenIdentity(token);
      // Only INCOMING tokens are blocked. A clash the destination already had
      // is not this file's doing, and refusing the import for it would leave an
      // author unable to bring anything in until they had repaired something
      // else entirely.
      if (!wanted.has(identity)) continue;
      blocked.add(identity);
      refused.push(say(token, key));
    }
  }
  return blocked;
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
  const { document, issues } = tokensToDtcg(tokens);
  const skipped = [
    ...issues.map(issue => issue.message),
    ...unwritable(tokens),
  ];
  let text: string;
  try {
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
      skipped: [
        ...skipped,
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
    return value.every(item => holdsOnlyJson(item, seen));
  }
  if (!isRecord(value)) return false;
  // `toJSON` means the written form is something OTHER than the value, so a
  // reader gets back something that was never stored — the loss being looked
  // for, whether or not the substitute is itself writable.
  if (typeof (value as { toJSON?: unknown }).toJSON === "function")
    return false;
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
    text: `${sheet.css}\n`,
    filename: "tokens.css",
    mime: "text/css",
    skipped: sheet.warnings.map(warning => warning.message),
  };
}
