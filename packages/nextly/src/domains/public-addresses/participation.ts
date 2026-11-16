/**
 * Which plugins took part in keeping public addresses unique at the last
 * start, and how many times that set has changed.
 *
 * A participant's record misses every save made while it is not running:
 * its plugin disabled, removed, uninstalled, or switched off by a config
 * reload in development. Nothing it reads at its next start says so, since
 * no address template or language need have changed. So core keeps, in
 * `nextly_meta`, the set of participating plugins a start ran with and a
 * count that goes up each time a start runs with another set, and
 * `fingerprint()` includes the count: a participant storing its fingerprint
 * finds it changed after any start that ran without it, and catches up.
 *
 * The count only ever goes up, and decides nothing but that a participant's
 * next start re-checks its record. A start reads the row with the other meta
 * rows it already reads, and writes it only when the set changed.
 *
 * @module domains/public-addresses/participation
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { Logger } from "../../shared/types";
import type { MetaService } from "../meta/services/meta-service";

import { participatingOwners } from "./participants";

/** The `nextly_meta` key the participation is kept under. */
export const PARTICIPATION_META_KEY = "public_address_participation";

/** What the row keeps: the participating owners, sorted, and the count. */
interface Participation {
  owners: string[];
  count: number;
}

/** The kept participation, or none on a site no start has recorded yet. */
function participationOf(value: unknown): Participation {
  if (typeof value !== "object" || value === null) {
    return { owners: [], count: 0 };
  }
  const { owners, count } = value as Record<string, unknown>;
  return {
    owners: Array.isArray(owners)
      ? owners.filter((owner): owner is string => typeof owner === "string")
      : [],
    count: typeof count === "number" && Number.isFinite(count) ? count : 0,
  };
}

const sameOwners = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((owner, at) => owner === b[at]);

/**
 * The count this process started with, and the participation reloads still
 * have to keep, in order, kept beside the participant list on `globalThis`
 * so every copy of this module reads and queues on the one value.
 */
const shared = globalThis as unknown as {
  __nextly_addressParticipation?: { count: number };
  __nextly_addressParticipationQueue?: Promise<void>;
};

/**
 * Record `owners`, the plugins taking part (the ones asked now, by
 * default), against `stored`, the row as the caller read it: nothing written
 * where the set is the same.
 *
 * Otherwise the row is first made where there is none, by one insert the
 * database skips when another start made it first, so a missing row is never
 * read as the absence two starts both act on; then, under the row's lock,
 * the new set and the count one higher, so two starts running with one new
 * set raise it once. Throws what the database refused; this process's count
 * is then the one `stored` holds.
 */
export async function recordParticipation(
  adapter: DrizzleAdapter,
  meta: MetaService,
  stored: unknown,
  owners: readonly string[] = participatingOwners()
): Promise<void> {
  const kept = participationOf(stored);
  shared.__nextly_addressParticipation = { count: kept.count };
  if (sameOwners(kept.owners, owners)) return;
  await meta.insertIfAbsent(PARTICIPATION_META_KEY, {
    owners: [],
    count: 0,
  } satisfies Participation);
  const count = await adapter.transaction(async tx => {
    const executor = tx.getDrizzle();
    const entry = await meta.getEntry(PARTICIPATION_META_KEY, executor, {
      lock: true,
    });
    const now = participationOf(entry.present ? entry.value : undefined);
    if (sameOwners(now.owners, owners)) return now.count;
    const next: Participation = { owners: [...owners], count: now.count + 1 };
    await meta.set(PARTICIPATION_META_KEY, next, executor);
    return next.count;
  });
  shared.__nextly_addressParticipation = { count };
}

/**
 * {@link recordParticipation} for a start, which it never fails: what it
 * keeps only makes participants check their records again, so a database
 * refusing it costs at most one catch-up that does not run, never a site
 * that does not start. The refusal is logged.
 */
export async function recordStartParticipation(
  adapter: DrizzleAdapter,
  meta: MetaService,
  stored: unknown,
  logger: Pick<Logger, "warn">
): Promise<void> {
  try {
    await recordParticipation(adapter, meta, stored);
  } catch (error) {
    logger.warn?.(
      `[Nextly] The plugins keeping public addresses unique could not be recorded at start: ${String(error)}`
    );
  }
}

/**
 * How many times the set of participating plugins has changed, as this
 * process's start found it; 0 before any start recorded one.
 */
export function participationCount(): number {
  return shared.__nextly_addressParticipation?.count ?? 0;
}

/**
 * Keep `owners`, the plugins taking part as a config reload in development
 * left them, after every set an earlier reload queued: each reload's set is
 * read when it commits and kept in the order the reloads ran, so a plugin
 * switched off and quickly on again still raises the count twice, rather than
 * both writes finding it on. Read from the database each time, since the
 * reload has no start's meta rows.
 */
export function queueParticipation(owners: readonly string[]): Promise<void> {
  const keep = async (): Promise<void> => {
    const { getService } = await import("../../di/service-access");
    const meta = getService("metaService");
    await recordParticipation(
      getService("adapter"),
      meta,
      await meta.get(PARTICIPATION_META_KEY),
      owners
    );
  };
  const next = (shared.__nextly_addressParticipationQueue ?? Promise.resolve())
    .catch(() => undefined)
    .then(keep);
  shared.__nextly_addressParticipationQueue = next.catch(() => undefined);
  return next;
}
