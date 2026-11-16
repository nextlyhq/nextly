/**
 * The start-up passes over the address store, run once a start has
 * finished, and the mark that lets a start skip them when nothing they
 * follow from has changed since the last that completed.
 *
 * The passes reconcile: each reads what every page and entry should hold,
 * reads what the store holds, and writes only the difference, so a pass over
 * a store that is up to date writes nothing. They are the correctness path,
 * and right on their own. The mark is a shortcut on top of them: a digest of
 * everything the claims follow from, kept in the plugin's own
 * `page_builder__site_options` table once a pass completes. A start whose
 * digest matches it skips the passes after a handful of reads, whatever the
 * size of the site.
 *
 * What the digest is taken over, and why each:
 * - this format's number and the plugin's version: what a claim is, and how
 *   a pass derives one, may change with an upgrade;
 * - the collections' slugs as the host named them;
 * - the languages the site serves, and where it serves its pages
 *   (`pagePreviewPath`): every page's address follows from both, and no save
 *   happens when either changes;
 * - every template address, declared in code and stored on a template, and
 *   for each collection given one, everything about the collection that
 *   decides what its entries hold, as the start-up pass itself reads it
 *   (`collectionClaimInputs`: where it is served, its template, whether it
 *   may be served and has a Draft/Published lifecycle), and how many entries
 *   it has and when the newest was saved;
 * - how many pages are published, and when the newest of them was saved;
 * - how many templates and own designs there are, and when the newest was
 *   saved: a template decides where its entries are served and whether they
 *   hold a list's later pages;
 * - how many rows the store holds, so claims removed or restored behind its
 *   back are caught.
 *
 * Saves keep claims current in their own transaction, so the counts and
 * newest saves are there for what bypasses them (an import, a restore). A
 * change none of these sees, the next save of the document settles.
 *
 * A start that is going to run the passes first removes the mark, before
 * any pass can change a claim, and a new one is written only once every pass
 * settled everything. So passes that stop part way leave no mark, and the
 * next start runs them again whatever its inputs, even ones that match the
 * mark from before the change the passes were part way through.
 *
 * @module address-claims/start-pass
 */
import { eq } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
} from "@nextlyhq/plugin-sdk/schema";

import { siteOptions } from "../schema/tables";
import { readSiteOption } from "../site-option-read";

import { storedKey } from "./claim-store";
import type { CollectionClaimInputs } from "./entry-claims-hook";

/**
 * The number of how a pass derives claims. Raise it with any change to what
 * a claim is or how a page's or an entry's claims follow from its row, so
 * every site's next start runs the passes once.
 */
const START_PASS_FORMAT = 1;

/** The mark's name in the plugin's options table. */
const START_PASS_OPTION = "address-claims-settled";

/** A collection's rows, as far as the mark reads them. */
export interface RowsState {
  readonly total: number;
  /** When the newest was saved, or null where its rows keep no time. */
  readonly newest: string | null;
}

/** A collection given a template address, as far as the mark reads it. */
export interface AddressedCollection {
  readonly slug: string;
  /** What decides its entries' claims, as the start-up pass reads it. */
  readonly claims: CollectionClaimInputs;
  /** Its entries, or null where it cannot be read (removed since). */
  readonly rows: RowsState | null;
}

/** Everything the claims a start settles follow from. */
export interface StartInputs {
  readonly plugin: string;
  readonly slugs: readonly string[];
  readonly locales: readonly string[];
  readonly pagePath: string | null;
  /** Each collection and its address, declared in code. */
  readonly declared: readonly (readonly [string, string])[];
  /** Each collection and its address, stored on its template. */
  readonly stored: readonly (readonly [string, string])[];
  readonly collections: readonly AddressedCollection[];
  readonly pages: RowsState;
  readonly templates: RowsState;
  readonly claims: number;
}

/** The pairs of `map`, in one order whatever order they were set in. */
export function sortedPairs(
  map: ReadonlyMap<string, string>
): (readonly [string, string])[] {
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The digest of `inputs`: the same text for the same inputs on every
 * process, since every list in them is built in a fixed order.
 */
export function startMark(inputs: StartInputs): string {
  return storedKey(JSON.stringify({ format: START_PASS_FORMAT, ...inputs }));
}

/** Where the mark is kept: one row of the plugin's options table. */
export interface StartMarkStore {
  read(): Promise<string | null>;
  /** Remove the mark, so no start skips the passes until one is written. */
  clear(): Promise<void>;
  /** Write `value`, over whatever mark is there. */
  write(value: string): Promise<void>;
}

/** Which database, so a lost race to insert the row is recognised. */
type Dialect = Parameters<typeof isUniqueViolation>[0];

/** The mark over the plugin's own database surface. */
export function startMarkStore(
  db: Pick<PluginDatabase, "select" | "insert" | "update" | "delete" | "table">,
  dialect: Dialect
): StartMarkStore {
  const named = () => eq(db.table(siteOptions).name, START_PASS_OPTION);
  const update = async (value: string) => {
    await db.update(siteOptions, { value }).where(named());
  };
  return {
    read: () => readSiteOption(db, START_PASS_OPTION),
    clear: async () => {
      await db.delete(siteOptions).where(named());
    },
    // Inserted, since the passes removed any mark before they ran.
    write: async value => {
      try {
        await db.insert(siteOptions, { name: START_PASS_OPTION, value });
      } catch (error) {
        if (!isUniqueViolation(dialect, error)) throw error;
        // Another instance put its mark there first: this one is as recent.
        await update(value);
      }
    },
  };
}

/** What the start-up passes need. */
export interface AddressStartupDeps {
  /** Everything the claims follow from, read now. */
  readonly inputs: () => Promise<StartInputs>;
  readonly mark: StartMarkStore;
  /** The pages' pass: whether it settled every page. */
  readonly pages: () => Promise<boolean>;
  /** The release of collections no longer given an address: whether it settled all. */
  readonly sweep: () => Promise<boolean>;
  /** The entries' pass: whether it settled every collection. */
  readonly entries: () => Promise<boolean>;
  /** Called when the passes are skipped: the store is as they would leave it. */
  readonly skipped: () => void;
  /** Whether this start still belongs to the running site (see the backfill). */
  readonly current: () => boolean;
  readonly warn: (message: string, context: Record<string, unknown>) => void;
}

/**
 * Run the start-up passes, pages first, unless the mark the last complete
 * run left matches what the claims follow from now. Never throws.
 *
 * A mark there is removed before the passes run, so passes that stop part
 * way, having changed some claims, leave none behind for a later start to
 * match. A new one is written only after every pass settled everything,
 * taken over the inputs as they are then, so a save made during the passes
 * (which keeps its own claims) leaves the next start skipping rather than
 * running again. When the mark cannot be removed the passes do not run: the
 * next start, finding the inputs still differ from it, tries again.
 */
export async function runAddressStartup(
  deps: AddressStartupDeps
): Promise<void> {
  // Undefined when it cannot be read: there may be one to remove.
  const previous = await deps.mark.read().catch((error: unknown) => {
    deps.warn("Could not read when the address store was last settled.", {
      error: String(error),
    });
    return undefined;
  });
  // No mark: a site starting for the first time since it was installed or
  // upgraded, or one whose last passes stopped part way, whose store the
  // passes must settle whatever the inputs say.
  if (
    previous !== null &&
    previous !== undefined &&
    (await markNow(deps)) === previous
  ) {
    deps.skipped();
    return;
  }
  if (previous !== null) {
    try {
      await deps.mark.clear();
    } catch (error) {
      deps.warn(
        "Could not clear when the address store was last settled, so its start-up passes wait for the next start.",
        { error: String(error) }
      );
      return;
    }
  }
  try {
    const complete = await deps.pages();
    // Releasing a removed collection's claims takes nothing a page is owed,
    // so it runs whether or not the pages' pass completed; the entries' pass
    // only once every page holds its address, which an entry could take.
    const swept = await deps.sweep();
    const settled = complete && (await deps.entries());
    if (!(complete && swept && settled) || !deps.current()) return;
    const now = await markNow(deps);
    if (now !== null) await deps.mark.write(now);
  } catch (error) {
    deps.warn("Could not record that the address store is settled.", {
      error: String(error),
    });
  }
}

/** The mark of the inputs as they are now, or null when they cannot be read. */
async function markNow(deps: AddressStartupDeps): Promise<string | null> {
  try {
    return startMark(await deps.inputs());
  } catch (error) {
    deps.warn("Could not read what the address store follows from.", {
      error: String(error),
    });
    return null;
  }
}
