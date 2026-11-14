/**
 * How the record of a change a busy table stopped is written: within one try, as a whole.
 *
 * Once the tries have stopped, the change's record (its failed attempt, its start row's removal)
 * still goes to the ledger table, which can be the very table another session holds. It is written
 * in one transaction whose every lock wait the database bounds (`writeLedgerBounded`), and which a
 * watch ends once its waits together use up one try, so several waits in turn cannot add up past
 * it. A record that cannot be written then leaves the attempt for the next run to refuse on.
 *
 * @module domains/schema/busy-table/stopped-record
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  writeLedgerBounded,
  type AfterWatch,
} from "../migrate/migration-transaction";

import { prepareTryWatchdog } from "./watchdog";

/** Writes a stopped change's record through the handle it is given, bounded by one try of `tryMs`. */
export function boundedStopRecord(
  adapter: DrizzleAdapter,
  tryMs: number
): (write: (db: unknown) => Promise<void>) => Promise<void> {
  const dialect = adapter.getCapabilities().dialect;
  const watch = (): AfterWatch => {
    const watchdog = prepareTryWatchdog(adapter, dialect, tryMs);
    // The record's statements are one step of their own: a cancel may end any of them.
    watchdog.moveTo(0);
    return {
      watch: session => watchdog.watch(session),
      settle: async () => {
        await watchdog.stop();
      },
    };
  };
  return write => writeLedgerBounded(adapter, tryMs, write, watch);
}
