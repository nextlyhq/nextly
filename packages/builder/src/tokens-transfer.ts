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
  try {
    read = dtcgToTokens(parsed);
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
  const skipped = read.issues.map(issue => issue.message);
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
   */
  const blocked = clashingIn(applyAll(into.tokens, wanted), wanted, refused);
  const taken = new Map(
    [...wanted].filter(([identity]) => !blocked.has(identity))
  );
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

/** The destination with every wanted token applied, replacing or appending. */
function applyAll(
  base: readonly SiteToken[],
  wanted: ReadonlyMap<string, SiteToken>
): SiteToken[] {
  const tokens = [...base];
  for (const [identity, token] of wanted) {
    const at = tokens.findIndex(held => tokenIdentity(held) === identity);
    if (at === -1) tokens.push(token);
    else tokens[at] = token;
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
  refused: string[]
): Set<string> {
  return new Set([
    ...sharingAKey(
      proposed,
      wanted,
      refused,
      token => token.name,
      (token, name) =>
        `"${name}" is already the name of a different token on this site, so it was not imported. Rename one of them and try again.`
    ),
    ...sharingAKey(
      proposed,
      wanted,
      refused,
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
  keyOf: (token: SiteToken) => string,
  say: (token: SiteToken, key: string) => string
): Set<string> {
  const held = new Map<string, SiteToken[]>();
  for (const token of proposed) group(held, keyOf(token), token);

  const blocked = new Set<string>();
  for (const [key, sharing] of held) {
    if (sharing.length < 2) continue;
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
  return {
    text: `${JSON.stringify(document, null, 2)}\n`,
    filename: "tokens.json",
    mime: "application/json",
    skipped: issues.map(issue => issue.message),
  };
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
    breakpoints: { base: { id: "base", label: "Base" } } as never,
  });
  return {
    text: `${sheet.css}\n`,
    filename: "tokens.css",
    mime: "text/css",
    skipped: sheet.warnings.map(warning => warning.message),
  };
}
