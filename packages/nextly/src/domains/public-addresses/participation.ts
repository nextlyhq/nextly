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
 * The count this process started with, kept beside the participant list on
 * `globalThis` so every copy of this module reads the one value.
 */
const shared = globalThis as unknown as {
  __nextly_addressParticipation?: { count: number };
};

/**
 * Record the plugins taking part now, against `stored`, the row as the start
 * read it with its other meta rows: nothing written where the set is the
 * same; otherwise, under the row's lock, the new set and the count one
 * higher, so two starts running with one new set raise it once.
 */
export async function recordParticipation(
  adapter: DrizzleAdapter,
  meta: MetaService,
  stored: unknown
): Promise<void> {
  const owners = participatingOwners();
  const kept = participationOf(stored);
  if (sameOwners(kept.owners, owners)) {
    shared.__nextly_addressParticipation = { count: kept.count };
    return;
  }
  const count = await adapter.transaction(async tx => {
    const executor = tx.getDrizzle();
    const entry = await meta.getEntry(PARTICIPATION_META_KEY, executor, {
      lock: true,
    });
    const now = participationOf(entry.present ? entry.value : undefined);
    if (sameOwners(now.owners, owners)) return now.count;
    const next: Participation = { owners, count: now.count + 1 };
    await meta.set(PARTICIPATION_META_KEY, next, executor);
    return next.count;
  });
  shared.__nextly_addressParticipation = { count };
}

/**
 * How many times the set of participating plugins has changed, as this
 * process's start found it; 0 before any start recorded one.
 */
export function participationCount(): number {
  return shared.__nextly_addressParticipation?.count ?? 0;
}

/**
 * Record the participation as a config reload in development left it, read
 * from the database rather than from a start's meta rows: a plugin the
 * reload switched off is no longer asked, and saves made until it is
 * switched back on reach no record of its.
 */
export async function recordParticipationNow(): Promise<void> {
  const { getService } = await import("../../di/service-access");
  const meta = getService("metaService");
  await recordParticipation(
    getService("adapter"),
    meta,
    await meta.get(PARTICIPATION_META_KEY)
  );
}
