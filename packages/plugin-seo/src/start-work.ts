/**
 * The background work the SEO plugin's start runs, one part after another:
 * the address record's catch-up, the fingerprint upgrade, the not-found
 * log's move and the staging standing. Kept here so whatever must not run
 * beside it, an install or uninstall hook that tears the boot down, can wait
 * for all of it rather than for the catch-up alone.
 *
 * @module start-work
 */
import { lastCatchUp } from "./address-record/catch-up";

/** The last start's work, settled either way. */
let work: Promise<void> | undefined;

/** Keep `started`, the work a start began, to be waited for. */
export function keepStartWork(started: Promise<unknown>): void {
  work = started.then(
    () => undefined,
    () => undefined
  );
}

/**
 * The last start's background work settled, and then the catch-up under way,
 * where a request began one since.
 */
export async function lastStartWork(): Promise<void> {
  await work;
  await lastCatchUp();
}
