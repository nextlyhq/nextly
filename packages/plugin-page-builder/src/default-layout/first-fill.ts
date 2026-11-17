/**
 * The first header (or footer) an author publishes takes the starter's place
 * in the site default, once.
 *
 * ## When
 *
 * Asked after a component is published as a header or footer for the first
 * time (`first-fill-hook`), and it fills that area of the default only when
 * every one of these holds:
 *
 * - the area was never filled this way before (`fill-mark`);
 * - the component is not the starter itself;
 * - the default is the seeded set: a set the author made the default is
 *   theirs, and is never touched;
 * - the seeded set's row for that area is absent, or names the starter's
 *   component for that area while its published content is still what was
 *   seeded. A starter the author edited and published is theirs, and so is
 *   any other component they put there;
 * - the seeded set holds no unpublished change: an author editing the set has
 *   their own choice in progress, which the next publish of it decides.
 *
 * "Untouched" is the starter record's own rule (`untouchedStarterArea`), the
 * one the editor's "Starter header · edit or replace" tag asks, so the two
 * cannot disagree about which starter is still the seed's.
 *
 * ## The order, and two fills at once
 *
 * The mark is claimed first: its row's unique insert lets exactly one of two
 * racing fills of an area go on, and the other changes nothing. The default
 * is read again after the claim, so a make-default landing in between keeps
 * the author's choice. Then the seeded set is written, from the version read,
 * so a header's fill and a footer's landing together each keep the other's
 * row: a write refused as stale is made again on what is stored then. A
 * failure after the claim removes the mark again, so a later publish can
 * still fill the area. Only once the set is written is the publisher named
 * to be told, so nobody is told of a fill that has not happened.
 *
 * The starter component is kept, published: it can be chosen again.
 *
 * ## The write
 *
 * As the system, through the Direct API's ordinary update of the set, so
 * every check a set write meets (the removal fence, the component guards,
 * the composition judge) and the cache refresh after it apply, published.
 * Nothing here changes which set is the default.
 *
 * @module default-layout/first-fill
 */
import { withVersionFrom } from "../document-version";
import { retryOnStale } from "../stale-retry";

import type { FillMarkStore } from "./fill-mark";
import type { StarterArea } from "./seed-names";
import {
  untouchedStarterArea,
  type StarterRecordStore,
} from "./starter-record";
import {
  readLayoutSettings,
  relationId,
  type DefaultLayoutDirectApi,
  type DefaultLayoutSlugs,
} from "./store";

/** What a fill needs from the installed plugin. */
export interface FirstFillDeps {
  readonly nextly: DefaultLayoutDirectApi;
  readonly slugs: DefaultLayoutSlugs;
  /** The RESOLVED collection components are stored in. */
  readonly components: string;
  /** The field of a component row holding its document. */
  readonly componentField: string;
  readonly marks: FillMarkStore;
  readonly starter: Pick<StarterRecordStore, "read">;
}

/** The component just published as a header or footer, and who published it. */
export interface PublishedAs {
  readonly id: string;
  readonly area: StarterArea;
  /** The user who published it, who is told. */
  readonly by: string;
}

/** One row of a set's areas, as stored. */
interface AreaRow {
  readonly area?: unknown;
  readonly component?: unknown;
  readonly [key: string]: unknown;
}

/** The seeded set as read for the write, with the version the write sends. */
interface SeedRead {
  readonly id: string;
  readonly areas: readonly AreaRow[];
  readonly rev: string | undefined;
  /** Whether it holds an unpublished change. */
  readonly pending: boolean;
}

/**
 * Fill `published.area` of the default with `published.id` when the module
 * docblock's conditions hold, answering whether it did.
 */
export async function fillDefaultOnFirstPublish(
  deps: FirstFillDeps,
  published: PublishedAs
): Promise<boolean> {
  const { area } = published;
  if ((await deps.marks.read())[area] !== undefined) return false;
  const seed = await seededDefault(deps);
  if (seed === null) return false;
  const record = await deps.starter.read();
  const starter = record === null || record === "made" ? null : record;
  if (starter !== null && isStarter(starter, published.id)) return false;
  // Judged before the claim, so a publish the default is not waiting for
  // leaves the area free for the one it is.
  const first = await readSeed(deps, seed);
  if (first === null || !(await isOpen(deps, first, area, starter))) {
    return false;
  }

  if (!(await deps.marks.claim(area, published.id))) return false;
  let filled: boolean;
  try {
    filled =
      (await seededDefault(deps)) === seed &&
      (await retryOnStale(
        async () => readSeed(deps, seed),
        async read => {
          if (read === null || !(await isOpen(deps, read, area, starter))) {
            return false;
          }
          await deps.nextly.update({
            collection: deps.slugs.layouts,
            id: seed,
            data: withVersionFrom(
              {
                areas: withArea(read.areas, area, published.id),
                status: "published",
              },
              read.rev
            ),
            overrideAccess: true,
          });
          return true;
        },
        { read: first }
      ));
  } catch (error) {
    await deps.marks.release(area, published.id).catch(() => undefined);
    throw error;
  }
  if (!filled) {
    await deps.marks.release(area, published.id);
    return false;
  }
  // Only now is there something to tell. The fill stands whether or not the
  // publisher can be named: a failure here costs the notice, never the fill.
  await deps.marks
    .announce(area, published.id, published.by)
    .catch(() => undefined);
  return true;
}

/** The seeded set's id while it is the default, or null. */
async function seededDefault(deps: FirstFillDeps): Promise<string | null> {
  const { defaultLayout, seededLayout } = await readLayoutSettings(
    deps.nextly,
    deps.slugs
  );
  return seededLayout !== null && defaultLayout === seededLayout
    ? seededLayout
    : null;
}

/** Whether `id` is one of the starter's own components. */
function isStarter(
  starter: { readonly [A in StarterArea]: { readonly id: string } },
  id: string
): boolean {
  return starter.header.id === id || starter.footer.id === id;
}

/**
 * The seeded set as stored now, its working draft overlaid where it has one,
 * or null when it is gone.
 */
async function readSeed(
  deps: FirstFillDeps,
  id: string
): Promise<SeedRead | null> {
  const row = await deps.nextly
    .findByID({
      collection: deps.slugs.layouts,
      id,
      draft: true,
      depth: 0,
      overrideAccess: true,
    })
    .catch(() => null);
  if (row === null || row.status !== "published") return null;
  return {
    id,
    areas: Array.isArray(row.areas) ? (row.areas as AreaRow[]) : [],
    rev: typeof row._rev === "string" ? row._rev : undefined,
    pending: row._isWorkingDraft === true,
  };
}

/**
 * Whether `area` of the seed is the seed's to fill: no unpublished change,
 * and the area empty or holding the untouched starter.
 */
async function isOpen(
  deps: FirstFillDeps,
  seed: SeedRead,
  area: StarterArea,
  starter:
    | {
        readonly [A in StarterArea]: {
          readonly id: string;
          readonly fingerprint: string;
        };
      }
    | null
): Promise<boolean> {
  if (seed.pending) return false;
  const row = seed.areas.find(entry => entry.area === area);
  if (row === undefined) return true;
  const placed = relationId(row.component);
  if (placed === null) return true;
  if (starter === null || starter[area].id !== placed) return false;
  const content = await publishedContentOf(deps, placed);
  return untouchedStarterArea(starter, placed, content) === area;
}

/** A component's published document, or undefined when it has none. */
async function publishedContentOf(
  deps: FirstFillDeps,
  id: string
): Promise<unknown> {
  const found = await deps.nextly.find({
    collection: deps.components,
    where: { id: { equals: id } },
    status: "published",
    limit: 1,
    depth: 0,
    overrideAccess: true,
  });
  const row = found.items[0] as Record<string, unknown> | undefined;
  return row?.[deps.componentField];
}

/** `areas` with `area` naming `component`, every other row kept as stored. */
function withArea(
  areas: readonly AreaRow[],
  area: StarterArea,
  component: string
): AreaRow[] {
  let placed = false;
  const next: AreaRow[] = [];
  for (const entry of areas) {
    if (entry.area !== area) {
      next.push(entry);
    } else if (!placed) {
      // The area's own row keeps its place and its row id.
      next.push({ ...entry, area, component });
      placed = true;
    }
  }
  return placed ? next : [...next, { area, component }];
}
