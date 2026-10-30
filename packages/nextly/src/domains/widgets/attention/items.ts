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
import { isPermissionName } from "../declaration/permission-name";
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
    // The stored spelling, as a widget's access is held to: "orders:read"
    // would pass a looser check and hide the item from every reader.
    return isPermissionName(permission)
      ? undefined
      : `needs a permission in its stored form, "action-resource" such as "read-orders"`;
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
  // One id across every plugin: two plugins' items may not share one either.
  const seen = new Map<string, string>();
  return dashboards.flatMap(({ owner, attention }) =>
    attention === undefined ? [] : pluginAttentionFaults(owner, attention, seen)
  );
}

/** Every fault in one plugin's `attention`: the list itself, then each item. */
function pluginAttentionFaults(
  owner: string,
  attention: unknown,
  seen: Map<string, string>
): WidgetDeclarationFault[] {
  const widget = "(contributes.dashboard)";
  if (!Array.isArray(attention)) {
    return [
      { owner, widget, problem: "attention must be a list of attention items" },
    ];
  }
  const faults: WidgetDeclarationFault[] =
    attention.length > MAX_ATTENTION_ITEMS_PER_PLUGIN
      ? [
          {
            owner,
            widget,
            problem: `declares ${attention.length} attention items; a plugin may declare at most ${MAX_ATTENTION_ITEMS_PER_PLUGIN}`,
          },
        ]
      : [];
  // By index, not `forEach`, which steps over an empty slot: `[a, , b]` is
  // a list every reading of skips the middle of, so it is named.
  for (let index = 0; index < attention.length; index++) {
    faults.push(...slotFaults(owner, attention, index, seen));
  }
  return faults;
}

/** The faults of one slot of a plugin's list: empty, a broken shape, or a repeated id. */
function slotFaults(
  owner: string,
  attention: readonly unknown[],
  index: number,
  seen: Map<string, string>
): WidgetDeclarationFault[] {
  if (!Object.hasOwn(attention, index)) {
    return [
      {
        owner,
        widget: `(attention[${index}])`,
        problem: "is an empty slot in the attention list",
      },
    ];
  }
  const given: unknown = attention[index];
  const widget = itemName(given, index);
  const faults = shapeProblems(given).map(problem => ({
    owner,
    widget,
    problem,
  }));
  if (!isRecord(given) || typeof given.id !== "string") return faults;
  const first = seen.get(given.id);
  if (first === undefined) {
    seen.set(given.id, owner);
    return faults;
  }
  return [
    ...faults,
    {
      owner,
      widget,
      problem: `repeats the id of an attention item ${first} declares`,
    },
  ];
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
    // A check that throws denies, where the digest asks this (`isVisible`).
    return callerHoldsPermission(permission, readAccessCaller(caller));
  }
  if (!collectionsExist(entry)) return false;
  const slugs = await readable();
  return (entry.collections ?? []).some(slug => slugs.has(slug));
}

/**
 * The read services one item's count is handed: bound to the reader, and for
 * an item with `collections`, limited to those.
 *
 * 🔴 A declared collection the reader may not read answers "nothing there" to
 * every kind of read, rather than refusing: no entries, no groups, a series at
 * zero in every interval. So a reader of one of two collections gets the
 * numbers of the one they read and the item is never failed for a permission
 * gap, and nothing is disclosed: the answer is the one an empty collection
 * gives. Each read is checked first, as any other is (`answersNothing`), so a
 * malformed one is refused for every reader alike.
 */
function itemServices(
  entry: RegisteredAttentionItem,
  caller: ReadCaller,
  readable: ReadonlySet<string>,
  signal: AbortSignal,
  now: Date
): ReturnType<typeof bindReadServices> {
  const declared = entry.collections;
  return bindReadServices({
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
    // A declared collection this reader may not read: each read of it is
    // checked first, then answered as an empty collection answers it.
    ...(declared === undefined
      ? {}
      : {
          answersNothing: (slug: string) =>
            declared.includes(slug) && !readable.has(slug),
        }),
  });
}

/**
 * A reader for each plugin item, each counting as `caller`. Whether they may
 * see it is the reader's `visible` check, which the digest asks first within
 * the item's own budget and signal, so a stalled permission or collection
 * lookup costs only its own item, and hides it rather than failing it.
 */
export function pluginItemReaders(
  caller: ReadCaller,
  now: Date
): DigestReader[] {
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
  return registered.map(entry => ({
    id: entry.item.id,
    kind: "plugin" as const,
    label: entry.item.label,
    // A plugin's item ranks as a warning, always: only core's kinds are critical.
    severity: "warning" as const,
    link: entry.item.link,
    owner: entry.owner,
    visible: () => visibleTo(entry, caller, readable),
    read: async signal => {
      const slugs = entry.collections ? await readable() : new Set<string>();
      return entry.item.count({
        user: caller.user,
        signal,
        services: itemServices(entry, caller, slugs, signal, now),
        scope: scopes.forOwner(entry.owner),
        now: new Date(now),
      });
    },
  }));
}
