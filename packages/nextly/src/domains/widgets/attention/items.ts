/**
 * Plugins' attention items: checked at startup, kept for every request, and
 * read as each reader.
 *
 * ## Startup refuses a broken item
 *
 * {@link attentionItemFaults} names each item that breaks the declared shape,
 * repeats another's id, claims a reserved namespace, or is one more than a
 * plugin may declare. Its faults join every other dashboard fault in the one
 * startup error, so a site learns of all of them at once.
 *
 * ## An item shows only to a reader who could act on it
 *
 * An item with `permission` shows only to a holder of it, and one with
 * `collections` only to a reader of at least one of them. Anyone else is
 * handed nothing, not even the label. A declared collection the site does not
 * have is warned about once, and the item then shows to nobody.
 *
 * ## Its count reads as the reader, and only what it declared
 *
 * `count` gets the reader, a signal, read services bound to the reader, a
 * scope of the plugin's own and the answer's one instant, never settings. An
 * item with `collections` reads those collections alone; one of them the
 * reader may not read answers empty, so the count is right for that reader
 * without the plugin filtering for them.
 *
 * @module domains/widgets/attention/items
 * @experimental Plugin attention items may change until the card that draws
 *   them is built on them.
 */

import {
  callerHoldsPermission,
  readAccessCaller,
} from "../../../auth/entity-read-access";
import { NextlyError } from "../../../errors/nextly-error";
import { getNextlyLogger } from "../../../observability/logger";
import type { PluginDashboardSnapshot } from "../../../plugins/dashboard-declarations";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { isAdminRelativePath } from "../admin-path";
import { createBatchScope } from "../batch-scope";
import { renamedCollection } from "../declaration/card-settings";
import type { AttentionItem } from "../declaration/dashboard";
import { bindReadServices } from "../declaration/read-services";
import type { WidgetDeclarationFault } from "../declaration/validate";
import { validateWidgetQuery } from "../query";
import { readableCollectionSlugs } from "../reader-content";
import { getSource } from "../sources";

import type { DigestReader } from "./digest";

/** The most attention items one plugin may declare. */
export const MAX_ATTENTION_ITEMS_PER_PLUGIN = 10;

/** Namespaces core keeps for its own kinds and content: no plugin item may use them. */
const RESERVED_NAMESPACES: ReadonlySet<string> = new Set([
  "core",
  "collection",
  "single",
]);

/** An item id: "namespace/name", each part lowercase letters, digits and dashes. */
const ITEM_ID = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;

/** One item as startup kept it: whose it is, and the collections it reads, as the site names them. */
interface RegisteredAttentionItem {
  owner: string;
  item: AttentionItem;
  /** The declared collections, renamed as the site names them. */
  collections?: readonly string[];
  /** The plugin's own renames, so its reads name collections as it declared them. */
  renames?: Readonly<Record<string, string>>;
}

let registered: readonly RegisteredAttentionItem[] = [];

/** Items already warned about for naming a collection the site does not have. */
const warnedMissing = new Set<string>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** What is wrong with one declared item's shape, or nothing. */
function shapeProblems(given: unknown): string[] {
  if (!isRecord(given)) return ["is not an attention item"];
  return [
    idProblem(given.id),
    labelProblem(given.label),
    typeof given.count === "function" ? undefined : "needs a count function",
    // The one rule the admin also asks before it draws a plugin's link.
    isAdminRelativePath(given.link)
      ? undefined
      : 'needs a link inside the admin, relative to it, such as "collections/orders"',
    gateProblem(given.permission, given.collections),
  ].filter((problem): problem is string => problem !== undefined);
}

/** Why an item's id is unusable: not "namespace/name", or in a namespace core keeps. */
function idProblem(id: unknown): string | undefined {
  if (typeof id !== "string" || !ITEM_ID.test(id)) {
    return 'needs an id of the form "namespace/name"';
  }
  const namespace = id.split("/")[0];
  return RESERVED_NAMESPACES.has(namespace)
    ? `uses the reserved namespace "${namespace}"; core keeps "core", "collection" and "single"`
    : undefined;
}

/** Why an item's label is unusable: it is drawn on one line of the card. */
function labelProblem(label: unknown): string | undefined {
  return typeof label === "string" &&
    label.trim() !== "" &&
    !/[\r\n]/.test(label)
    ? undefined
    : "needs a one-line label";
}

/**
 * Why an item's gate is unusable: it says who may see it by exactly one of a
 * permission slug or the collections it reads.
 */
function gateProblem(
  permission: unknown,
  collections: unknown
): string | undefined {
  if ((permission === undefined) === (collections === undefined)) {
    return "needs exactly one of permission or collections";
  }
  if (permission !== undefined) {
    return typeof permission === "string" && permission.trim() !== ""
      ? undefined
      : "needs a permission slug";
  }
  return Array.isArray(collections) &&
    collections.length > 0 &&
    collections.every(slug => typeof slug === "string" && slug.trim() !== "")
    ? undefined
    : "needs a list of one or more collection slugs";
}

/** How a fault names one item: by its id where it has one, by its place otherwise. */
function itemName(given: unknown, index: number): string {
  return isRecord(given) && typeof given.id === "string" && given.id !== ""
    ? `(attention "${given.id}")`
    : `(attention[${index}])`;
}

/**
 * Every fault in the plugins' attention items, for the one startup error:
 * a broken shape, a reserved namespace, an id another item already has, and
 * more items than a plugin may declare.
 */
export function attentionItemFaults(
  dashboards: readonly PluginDashboardSnapshot[]
): WidgetDeclarationFault[] {
  const faults: WidgetDeclarationFault[] = [];
  const seen = new Map<string, string>();
  for (const { owner, attention } of dashboards) {
    if (attention === undefined) continue;
    if (!Array.isArray(attention)) {
      faults.push({
        owner,
        widget: "(contributes.dashboard)",
        problem: "attention must be a list of attention items",
      });
      continue;
    }
    if (attention.length > MAX_ATTENTION_ITEMS_PER_PLUGIN) {
      faults.push({
        owner,
        widget: "(contributes.dashboard)",
        problem: `declares ${attention.length} attention items; a plugin may declare at most ${MAX_ATTENTION_ITEMS_PER_PLUGIN}`,
      });
    }
    attention.forEach((given: unknown, index) => {
      const widget = itemName(given, index);
      for (const problem of shapeProblems(given)) {
        faults.push({ owner, widget, problem });
      }
      if (!isRecord(given) || typeof given.id !== "string") return;
      const first = seen.get(given.id);
      if (first !== undefined) {
        faults.push({
          owner,
          widget,
          problem: `repeats the id of an attention item ${first} declares`,
        });
      } else {
        seen.set(given.id, owner);
      }
    });
  }
  return faults;
}

/**
 * Keep the plugins' attention items for every request. Called once startup
 * has found no fault in them, so each is the declared shape.
 */
export function registerAttentionItems(
  dashboards: readonly PluginDashboardSnapshot[]
): void {
  registered = dashboards.flatMap(({ owner, attention, collections }) =>
    Array.isArray(attention)
      ? (attention as AttentionItem[]).map(item => ({
          owner,
          item,
          ...(item.collections === undefined
            ? {}
            : {
                collections: item.collections.map(slug =>
                  renamedCollection(slug, collections)
                ),
              }),
          ...(collections === undefined ? {} : { renames: collections }),
        }))
      : []
  );
}

/** Forget every plugin's items, with the rest of the registries on a reset. */
export function clearAttentionItems(): void {
  registered = [];
  warnedMissing.clear();
}

/**
 * Whether the site has every collection an item declares. Warns once for an
 * item that names one it does not, which then shows to nobody.
 */
function collectionsExist(entry: RegisteredAttentionItem): boolean {
  const missing = (entry.collections ?? []).filter(
    slug => getSource(`collection:${slug}`) === undefined
  );
  if (missing.length === 0) return true;
  const key = `${entry.owner}\u0000${entry.item.id}`;
  if (!warnedMissing.has(key)) {
    warnedMissing.add(key);
    getNextlyLogger().warn({
      kind: "attention-item-collection-missing",
      owner: entry.owner,
      item: entry.item.id,
      collections: missing,
      message: `Attention item "${entry.item.id}" of ${entry.owner} declares ${missing.join(", ")}, which this site does not have; it shows to nobody.`,
    });
  }
  return false;
}

/** Whether `caller` may see `entry`: holds its permission, or reads one of its collections. */
async function visibleTo(
  entry: RegisteredAttentionItem,
  caller: ReadCaller,
  readable: () => Promise<ReadonlySet<string>>
): Promise<boolean> {
  const { permission } = entry.item;
  if (permission !== undefined) {
    // A check that fails denies: an item is never shown on an unknown answer.
    return callerHoldsPermission(permission, readAccessCaller(caller)).catch(
      () => false
    );
  }
  if (!collectionsExist(entry)) return false;
  const slugs = await readable();
  return (entry.collections ?? []).some(slug => slugs.has(slug));
}

/**
 * The read services one item's count is handed: bound to the reader, and for
 * an item with `collections`, limited to those. A declared collection the
 * reader may not read answers empty rather than refusing, so a reader of one
 * of two collections gets the count of the one they read.
 */
function itemServices(
  entry: RegisteredAttentionItem,
  caller: ReadCaller,
  readable: ReadonlySet<string>,
  signal: AbortSignal,
  now: Date
): ReturnType<typeof bindReadServices> {
  const declared = entry.collections;
  const bound = bindReadServices({
    caller,
    signal,
    now,
    ...(entry.renames === undefined ? {} : { collections: entry.renames }),
    // Checked as a card's own read is: a valid query for its source. The read
    // itself runs as the reader, so access is decided there and only there.
    prepare: raw => {
      const query = validateWidgetQuery(raw);
      if (
        declared !== undefined &&
        !declared.some(slug => query.source === `collection:${slug}`)
      ) {
        throw NextlyError.invalidInput({
          message: "An attention item reads only the collections it declares.",
          logContext: { owner: entry.owner, item: entry.item.id },
        });
      }
      return Promise.resolve(query);
    },
  });
  if (declared === undefined) return bound;
  const unread = (collection: string) => {
    const slug = renamedCollection(collection, entry.renames);
    return declared.includes(slug) && !readable.has(slug);
  };
  return {
    count: (collection, options) =>
      unread(collection)
        ? Promise.resolve(0)
        : bound.count(collection, options),
    find: (collection, options) =>
      unread(collection)
        ? Promise.resolve({ items: [] })
        : bound.find(collection, options),
  };
}

/**
 * A reader for each plugin item `caller` may see, each counting as them.
 * Items they may not see get no reader, so they leave nothing in the digest.
 */
export async function pluginItemReaders(
  caller: ReadCaller,
  now: Date
): Promise<DigestReader[]> {
  if (registered.length === 0) return [];
  let readableOnce: Promise<ReadonlySet<string>> | undefined;
  // Read once for every item. A read that fails denies, as a permission check
  // that fails does: no item is shown on an unknown answer.
  const readable = () =>
    (readableOnce ??= readableCollectionSlugs(caller).then(
      slugs => new Set(slugs),
      () => new Set<string>()
    ));
  // One scope per answer, each plugin with its own keys, so two items of one
  // plugin can share a scan and no plugin reads another's.
  const scopes = createBatchScope();
  const visible = await Promise.all(
    registered.map(async entry => ({
      entry,
      shown: await visibleTo(entry, caller, readable),
    }))
  );
  const slugs = visible.some(({ shown, entry }) => shown && entry.collections)
    ? await readable()
    : new Set<string>();
  return visible
    .filter(({ shown }) => shown)
    .map(({ entry }) => ({
      id: entry.item.id,
      kind: "plugin" as const,
      label: entry.item.label,
      // A plugin's item ranks as a warning, always: only core's kinds are critical.
      severity: "warning" as const,
      link: entry.item.link,
      owner: entry.owner,
      read: signal =>
        entry.item.count({
          user: caller.user,
          signal,
          services: itemServices(entry, caller, slugs, signal, now),
          scope: scopes.forOwner(entry.owner),
          now: new Date(now),
        }),
    }));
}
