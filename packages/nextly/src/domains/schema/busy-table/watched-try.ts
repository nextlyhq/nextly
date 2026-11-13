/**
 * The watch over one try for a busy table, wired as every runner of a try needs it: made before
 * the try's statements run, given the session once its id is known, reading what holds the table
 * just before it ends the statement, and saying, once the try has failed, whether the failure was
 * the wait ending and who held the table.
 *
 * @module domains/schema/busy-table/watched-try
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { endedWaiting } from "./ended-waiting";
import { readHolders } from "./holder";
import type { HolderReport } from "./types";
import { poolCanSpareOne } from "./watch-connection";
import { prepareTryWatchdog } from "./watchdog";

/** One try's watch. */
export interface WatchedTry {
  /** Starts watching the try's session, once its id is known. */
  readonly onSession: (session: string) => void;
  /** Stops the watch: awaited before the try's connection is let go, and once the try is done. */
  readonly settle: () => Promise<void>;
  /**
   * Stops the watch and says what held the table where `error` is the try's wait for a lock
   * ending (`endedWaiting`); undefined where it is any other failure, which the try lets through.
   */
  readonly ended: (error: unknown) => Promise<HolderReport | undefined>;
}

/**
 * A watch for one try of `tryMs` on `adapter`, made before the try's connection runs anything, so
 * its asks on another connection never run inside that connection's flow (`prepareTryWatchdog`).
 * On SQLite it watches nothing, and the holder it reports says why none is named.
 */
// One watch per try, and every try sends one statement: the try awaits `settle` (or `ended`)
// before the next statement, and stopping awaits a cancel under way, so a cancel can never reach
// a later statement. A runner that sends several statements in one try must tell the watch which
// one runs (`moveTo`) and await `idle` before each, as `runUnitInTries` does.
/** How long naming the holder may wait for a pooled connection while the try holds its own. */
const HOLDER_READ_MS = 2000;

const NO_SPARE =
  "The sessions holding the table could not be read: the pool has no connection to spare while this statement holds its own.";
const READ_TOO_LONG =
  "The sessions holding the table could not be read: no pooled connection was free in time.";

/** A holder report that names no session, saying why. */
function unreadableHolder(reason: string): HolderReport {
  return { kind: "named", sessions: [], unreadable: [reason] };
}

export function watchTry(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  tryMs: number
): WatchedTry {
  let session: string | undefined;
  // What holds the table, read by the watch just before it ends the try, while the session still
  // waits; after the statement ends it waits for nothing, and the database names no holder.
  let holder: HolderReport | undefined;
  const watchdog = prepareTryWatchdog(adapter, dialect, tryMs, {
    beforeCancel: async waiting => {
      holder = await readHolders(adapter, dialect, waiting);
    },
  });
  return {
    onSession: id => {
      session = id;
      watchdog.watch(id);
    },
    settle: async () => {
      await watchdog.stop();
    },
    ended: async error => {
      const { fired } = await watchdog.stop();
      if (!endedWaiting(error, dialect, fired)) return undefined;
      if (holder !== undefined) return holder;
      // The try's session still holds its connection here. A pool that cannot spare a second one
      // would make a read through it wait behind that session for good, so the holder is named
      // unreadable instead; a pool that can is asked, for a short while at most, since every one
      // of its connections may be in use.
      if (!poolCanSpareOne(adapter, dialect)) return unreadableHolder(NO_SPARE);
      return Promise.race([
        readHolders(adapter, dialect, session),
        new Promise<HolderReport>(settle =>
          setTimeout(
            () => settle(unreadableHolder(READ_TOO_LONG)),
            HOLDER_READ_MS
          ).unref?.()
        ),
      ]);
    },
  };
}
