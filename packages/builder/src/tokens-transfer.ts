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

  const read = dtcgToTokens(parsed);
  const skipped = read.issues.map(issue => issue.message);
  if (read.tokens.length === 0) {
    return {
      ok: false,
      error:
        "No tokens in that file could be used by this site. Nothing was changed.",
      skipped,
    };
  }
  return {
    ok: true,
    tokens: mergeById(into, read.tokens),
    imported: read.tokens.length,
    skipped,
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
): SiteTokenSet {
  const byIdentity = new Map<string, SiteToken>();
  for (const token of incoming) byIdentity.set(tokenIdentity(token), token);

  const kept = into.tokens.map(token => {
    const replacement = byIdentity.get(tokenIdentity(token));
    if (replacement === undefined) return token;
    byIdentity.delete(tokenIdentity(token));
    return replacement;
  });
  return { ...into, tokens: [...kept, ...byIdentity.values()] };
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
