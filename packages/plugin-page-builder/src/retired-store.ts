/**
 * Reading and recording the ids a component has retired.
 *
 * Both act as the SYSTEM: the table denies every access rule it declares, so a
 * read on a user's behalf answers nothing, which reads as "nothing retired",
 * and every write would then keep a value it must strip.
 *
 * @module retired-store
 */
import type {
  RetiredByComponent,
  RetiredExposures,
} from "@nextlyhq/blocks-engine";

import type { ClassUsageDirectApi } from "./class-usage-runtime";
import {
  retiredKey,
  type ComponentRetiredRow,
  type RetiredKind,
} from "./collections/component-retired-exposures";

/** How many rows one page of the read returns. */
const ROWS_PER_PAGE = 200;

/**
 * How many component ids one read names.
 *
 * Each id is a bound parameter of the `IN` list, and SQLite refuses a statement
 * past 999 of them, while one document may place up to the node cap's worth of
 * components. A refused read keeps every retired value the write carries.
 */
const IDS_PER_READ = 128;

/** What the store reads and writes through. */
export type RetiredDirectApi = Pick<ClassUsageDirectApi, "find" | "create">;

/** The retired ids, read and recorded. */
export interface RetiredStore {
  /**
   * Each named component's retired ids. A component with none is absent from
   * the map, so an empty map means nothing these documents place is retired.
   */
  of(componentIds: readonly string[]): Promise<RetiredByComponent>;
  /**
   * Record that a component retired these ids. Idempotent: an id already
   * recorded, including by a concurrent publish, is not recorded twice.
   */
  retire(componentId: string, retired: RetiredExposures): Promise<void>;
}

/** The store over the plugin's own table, by its RESOLVED slug. */
export function retiredStore(args: {
  nextly: () => Promise<RetiredDirectApi>;
  collection: string;
}): RetiredStore {
  return {
    of: async componentIds => {
      const ids = [...new Set(componentIds)];
      if (ids.length === 0) return new Map();
      return readRetired(await args.nextly(), args.collection, ids);
    },
    retire: async (componentId, retired) => {
      const wanted = await rowsOf(componentId, retired);
      if (wanted.length === 0) return;
      const nextly = await args.nextly();
      const held = await readRetired(nextly, args.collection, [componentId]);
      for (const row of wanted) {
        if (holds(held, row)) continue;
        await createOnce(nextly, args.collection, row);
      }
    },
  };
}

/**
 * Every component's retired ids, the whole table paged to the end: what the
 * cleanup of retired values walks the site for. Small however large the site,
 * for the reason {@link readRetired} reads it uncapped.
 */
export async function allRetired(args: {
  nextly: () => Promise<RetiredDirectApi>;
  collection: string;
}): Promise<RetiredByComponent> {
  const nextly = await args.nextly();
  const found = new Map<string, { properties: string[]; slots: string[] }>();
  for (let page = 1; ; page += 1) {
    const answer = await nextly.find({
      collection: args.collection,
      limit: ROWS_PER_PAGE,
      page,
      sort: "id",
      depth: 0,
      overrideAccess: true,
    });
    for (const row of answer.items) addRow(found, row);
    if (!answer.meta.hasNext) return found;
  }
}

/**
 * Every retired row of these components, a bounded number of ids per read,
 * each paged to the end.
 *
 * Not capped. A list cut short would leave a retired id unknown, and every
 * write would then keep its value; retirements are a designer's deliberate
 * removals, so the whole list is small however large the site.
 */
async function readRetired(
  nextly: RetiredDirectApi,
  collection: string,
  componentIds: readonly string[]
): Promise<RetiredByComponent> {
  const found = new Map<string, { properties: string[]; slots: string[] }>();
  for (let at = 0; at < componentIds.length; at += IDS_PER_READ) {
    const chunk = componentIds.slice(at, at + IDS_PER_READ);
    for (let page = 1; ; page += 1) {
      const answer = await nextly.find({
        collection,
        where: { componentId: { in: chunk } },
        limit: ROWS_PER_PAGE,
        page,
        sort: "id",
        depth: 0,
        overrideAccess: true,
      });
      for (const row of answer.items) addRow(found, row);
      if (!answer.meta.hasNext) break;
    }
  }
  return found;
}

/** Fold one stored row into the map, skipping a row this cannot read. */
function addRow(
  found: Map<string, { properties: string[]; slots: string[] }>,
  row: unknown
): void {
  if (typeof row !== "object" || row === null) return;
  const { componentId, kind, exposureId } = row as Record<string, unknown>;
  if (typeof componentId !== "string" || typeof exposureId !== "string") {
    return;
  }
  if (kind !== "property" && kind !== "slot") return;
  const entry = found.get(componentId) ?? { properties: [], slots: [] };
  (kind === "property" ? entry.properties : entry.slots).push(exposureId);
  found.set(componentId, entry);
}

/** The rows a retirement stores. */
async function rowsOf(
  componentId: string,
  retired: RetiredExposures
): Promise<ComponentRetiredRow[]> {
  const rows = (kind: RetiredKind, ids: readonly string[]) =>
    ids.map(async exposureId => ({
      identity: await retiredKey(componentId, kind, exposureId),
      componentId,
      kind,
      exposureId,
    }));
  return Promise.all([
    ...rows("property", retired.properties),
    ...rows("slot", retired.slots),
  ]);
}

/** Whether the rows read already hold this one. */
function holds(held: RetiredByComponent, row: ComponentRetiredRow): boolean {
  const ids = held.get(row.componentId);
  if (ids === undefined) return false;
  return (row.kind === "property" ? ids.properties : ids.slots).includes(
    row.exposureId
  );
}

/**
 * Create one row, accepting that a concurrent publish recorded it first.
 *
 * The unique key refuses the second create. That refusal is the expected end
 * of a race, not a failure, so it is confirmed by reading the row back; any
 * other failure, and a refusal with no row behind it, is raised.
 */
async function createOnce(
  nextly: RetiredDirectApi,
  collection: string,
  row: ComponentRetiredRow
): Promise<void> {
  try {
    await nextly.create({ collection, data: { ...row }, overrideAccess: true });
  } catch (error) {
    const held = await readRetired(nextly, collection, [row.componentId]);
    if (holds(held, row)) return;
    throw error;
  }
}
