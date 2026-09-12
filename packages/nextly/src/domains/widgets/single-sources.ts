/**
 * Which singles a widget may query, taken from the INITIALIZED singles
 * registry.
 *
 * The collection half of this decision lives in `collection-sources.ts`, and
 * this is the same decision for the other kind of content: the registry is
 * the one description of an install's singles that holds both schema modes,
 * it is read at request time rather than snapshotted at boot, and a single
 * whose stored metadata is known to be ahead of its table is withheld. The
 * reasoning for each of those is written once, there, and not restated here.
 *
 * What differs is what a single IS. It has one document, so its source answers
 * a fixed question and is built without the title nomination and the
 * timestamps toggle a collection carries -- a single has no `useAsTitle`, and
 * its table always has both timestamps.
 *
 * @module domains/widgets/single-sources
 */

import { container } from "../../di/container";
import { getNextlyLogger } from "../../observability/logger";

import { registerBuiltInSingleSources } from "./built-in-sources";
import { readableFields, statusClaimsPresent } from "./collection-sources";
import { deferredEntities } from "./deferred-entities";

/**
 * The slice of a `dynamic_singles` row this needs. Structural, like the
 * collection's, so the widget domain names what it reads.
 */
interface RegisteredSingle {
  slug?: unknown;
  fields?: unknown;
  /** The display name. Read defensively: the row is stored JSON. */
  label?: unknown;
  migrationStatus?: unknown;
  /** The Draft/Published `status` column, read for the reason the collection's is. */
  status?: unknown;
}

interface SingleRegistrySurface {
  getAllSingles(): Promise<RegisteredSingle[]>;
}

/**
 * The registry's singles, or `undefined` when it cannot be reached -- and on
 * that path the previously published sources are LEFT STANDING, for the reason
 * `refreshCollectionSources` leaves the collections': a source names what a
 * query may ask, and every execution still runs the ordinary access-controlled
 * read, so a stale entry cannot return a row its caller could not read.
 */
async function readRegisteredSingles(): Promise<
  RegisteredSingle[] | undefined
> {
  try {
    const registry = container.get<SingleRegistrySurface>(
      "singleRegistryService"
    );
    return await registry.getAllSingles();
  } catch (error) {
    getNextlyLogger().error({
      kind: "widget-single-sources-unavailable",
      err: error instanceof Error ? error.stack : String(error),
    });
    return undefined;
  }
}

/** A stored label when it is a usable string, else nothing. */
function labelOf(single: RegisteredSingle): string | undefined {
  return typeof single.label === "string" && single.label.trim() !== ""
    ? single.label
    : undefined;
}

/**
 * Rebuild the `single:` sources from the live registry.
 *
 * Withholds a single the reload declined DDL for, and one whose migration
 * label declines to claim its table -- the same two refusals the collection
 * half makes, decided from the same shared store and the same label reading.
 */
export async function refreshSingleSources(): Promise<void> {
  const singles = await readRegisteredSingles();
  if (!singles) return;

  const deferred = deferredEntities("single");
  const named = singles.filter(
    (single): single is RegisteredSingle & { slug: string } =>
      typeof single.slug === "string" &&
      single.slug !== "" &&
      !deferred.has(single.slug) &&
      statusClaimsPresent(single)
  );

  registerBuiltInSingleSources(
    named.map(single => ({
      slug: single.slug,
      fields: readableFields(single.fields),
      ...(labelOf(single) === undefined ? {} : { label: labelOf(single) }),
      // Only an explicit `true` turns the lifecycle on, the reading every
      // other consumer of the flag takes.
      status: single.status === true,
    }))
  );
}
