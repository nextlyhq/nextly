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
      const wanted = rowsOf(componentId, retired);
      if (wanted.length === 0) return;
      const nextly = await args.nextly();
      const held = await readRetired(nextly, args.collection, [componentId]);
      const known = keysOf(componentId, held.get(componentId));
      for (const row of wanted) {
        if (known.has(row.identity)) continue;
        await createOnce(nextly, args.collection, row);
      }
    },
  };
}

/**
 * Every retired row of these components, paged to the end.
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
  for (let page = 1; ; page += 1) {
    const answer = await nextly.find({
      collection,
      where: { componentId: { in: [...componentIds] } },
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
function rowsOf(
  componentId: string,
  retired: RetiredExposures
): ComponentRetiredRow[] {
  const rows = (kind: RetiredKind, ids: readonly string[]) =>
    ids.map(exposureId => ({
      identity: retiredKey(componentId, kind, exposureId),
      componentId,
      kind,
      exposureId,
    }));
  return [
    ...rows("property", retired.properties),
    ...rows("slot", retired.slots),
  ];
}

/** The keys a component already holds. */
function keysOf(
  componentId: string,
  held: RetiredExposures | undefined
): ReadonlySet<string> {
  if (held === undefined) return new Set();
  return new Set(rowsOf(componentId, held).map(row => row.identity));
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
    if (keysOf(row.componentId, held.get(row.componentId)).has(row.identity)) {
      return;
    }
    throw error;
  }
}
