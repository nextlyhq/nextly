/**
 * One template per collection: which collections may have one, and the
 * guard that keeps a second out and names the first.
 *
 * The `collection` field is unique, so the database itself refuses a second
 * template for a collection, on every dialect, under concurrent writes, and
 * whatever a hook running after this guard does to the data: the invariant
 * lives in the index over the value stored, not in anything a hook computes.
 * It holds whatever a template's state, so publishing, unpublishing, a
 * working draft's promotion and a restore cannot make two: a collection has
 * one template document, and a new design for a live template is that
 * template's working draft.
 *
 * The guard below judges a new template's collection and, before the
 * database is asked, finds the template already drawing it, so the refusal
 * names it. Two creates racing past that read both reach the index, and the
 * one that loses is refused there with the database's own duplicate error;
 * the template route reads the holder again and names it.
 *
 * @module templates/template-guard
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import { TEMPLATE_COLLECTION_FIELD } from "../collections/templates";
import { JUDGEMENT_CONTEXT } from "../judged-writes";

import {
  addressRefusal,
  heldAddressMessage,
  storedAddressOf,
  storedAddressProblem,
  writtenAddressOf,
  TEMPLATE_ADDRESS_FIELD,
  type AddressHolderRead,
} from "./template-routing";

/** The template drawing a collection, as a refusal names it. */
export interface TemplateHolder {
  readonly id: string;
  readonly title: string;
}

/** The template drawing `collection`, read as the system, or `null`. */
export type TemplateHolderRead = (
  collection: string
) => Promise<TemplateHolder | null>;

/** The part of the plugin's own reads the holder lookup makes. */
export interface OwnTemplateReads {
  listEntries(
    slug: string,
    options: {
      where: Record<string, unknown>;
      pagination: { limit: number; page?: number };
      depth: number;
    }
  ): Promise<{ data: readonly unknown[] }>;
}

/**
 * The holder lookup over the plugin's own reads: hook-free and as the system,
 * so a site's read hook cannot hide the template that draws a collection, and
 * every state of it is seen, a draft included.
 */
export function templateHolderReader(
  own: OwnTemplateReads,
  templatesCollection: string
): TemplateHolderRead {
  return async collection => {
    const found = await own.listEntries(templatesCollection, {
      where: { [TEMPLATE_COLLECTION_FIELD]: { equals: collection } },
      pagination: { limit: 1 },
      depth: 0,
    });
    const row = found.data[0] as Record<string, unknown> | undefined;
    if (row === undefined || typeof row.id !== "string") return null;
    return { id: row.id, title: titleOf(row.title) };
  };
}

/**
 * The lookup of the template storing an address, over the plugin's own reads,
 * hook-free and as the system, as the holder lookup above is, so a read hook
 * cannot hide the collection an address belongs to.
 */
export function addressHolderReader(
  own: OwnTemplateReads,
  templatesCollection: string
): AddressHolderRead {
  return async address => {
    const found = await own.listEntries(templatesCollection, {
      where: { [TEMPLATE_ADDRESS_FIELD]: { equals: address } },
      pagination: { limit: 10 },
      depth: 0,
    });
    // Matched again exactly: a database may compare text loosely.
    for (const entry of found.data) {
      const row = recordOf(entry);
      const collection = row?.[TEMPLATE_COLLECTION_FIELD];
      if (
        row?.[TEMPLATE_ADDRESS_FIELD] === address &&
        (typeof row.id === "string" || typeof row.id === "number") &&
        typeof collection === "string"
      ) {
        return { id: String(row.id), collection };
      }
    }
    return null;
  };
}

/** How many templates one read of every stored address takes. */
const ADDRESS_READ_PAGE = 100;

/**
 * Every collection whose template stores an address, with it, as last
 * committed: the plugin's own read, hook-free and as the system. A site has
 * a template per collection at most, so the walk is short.
 */
export function storedAddressesReader(
  own: OwnTemplateReads,
  templatesCollection: string
): () => Promise<ReadonlyMap<string, string>> {
  return async () => {
    const addresses = new Map<string, string>();
    for (let page = 1; ; page += 1) {
      const found = await own.listEntries(templatesCollection, {
        where: {},
        pagination: { limit: ADDRESS_READ_PAGE, page },
        depth: 0,
      });
      for (const entry of found.data) {
        const row = recordOf(entry);
        const collection = row?.[TEMPLATE_COLLECTION_FIELD];
        const address = storedAddressOf(row?.[TEMPLATE_ADDRESS_FIELD]);
        if (typeof collection === "string" && address !== null) {
          addresses.set(collection, address);
        }
      }
      if (found.data.length < ADDRESS_READ_PAGE) return addresses;
    }
  };
}

/** A stored title as a refusal names it. */
function titleOf(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : "";
  return title === "" ? "Untitled" : title;
}

/**
 * Whether the person refused may read the holder, so the refusal names it by
 * its title, or only by its id.
 */
export type MayReadTemplate = (id: string) => Promise<boolean>;

/**
 * The refusal of a second template for `collection`, naming the first: by its
 * title where the person may read it, by its id where they may not.
 */
export async function secondTemplateRefusal(
  collection: string,
  holder: TemplateHolder,
  mayRead: MayReadTemplate
): Promise<NextlyError> {
  const named = (await mayRead(holder.id).catch(() => false))
    ? `"${holder.title}" (${holder.id})`
    : `a template you cannot open (${holder.id})`;
  return NextlyError.conflict({
    reason: "state",
    message:
      `The collection "${collection}" already has a template: ${named}. ` +
      "A collection has one template; change that one, or delete it first.",
    logContext: {
      reason: "second-collection-template",
      collection,
      holder: holder.id,
    },
  });
}

/** A collection's record as the registry answers it, or `null` when absent. */
export type CollectionRecordRead = (
  slug: string
) => Promise<Record<string, unknown> | null>;

/** The field whose value is an entry's part of its address. */
const ENTRY_ADDRESS_FIELD = "slug";

/**
 * Why `collection` cannot have a template, or `null` when it can.
 *
 * A template draws a collection's entries at their own addresses, and an
 * entry's part of its address is its `slug` text field, so a collection
 * without one has nothing to serve an entry at. The page builder's own
 * collections are refused: a page is served as itself, and the stores pages
 * are built from are never served at all. So is a collection kept out of the
 * admin, as a plugin's private bookkeeping is.
 */
export async function templateCollectionProblem(
  collection: string,
  read: CollectionRecordRead,
  ownCollections: ReadonlySet<string>
): Promise<string | null> {
  if (ownCollections.has(collection)) {
    return `"${collection}" belongs to the page builder, and its documents are not drawn with a template.`;
  }
  const record = await read(collection);
  if (record === null) {
    return `There is no collection "${collection}" to give a template.`;
  }
  // A plugin's private collection is recorded as hidden from the admin, which
  // is the one trace of it the registry keeps; a collection kept out of the
  // admin is no one's content to design an entry page for.
  if (record.internal === true || recordOf(record.admin)?.hidden === true) {
    return `The collection "${collection}" is kept out of the admin, so its entries are not drawn with a template.`;
  }
  return hasAddressField(record)
    ? null
    : `The collection "${collection}" has no text field named "${ENTRY_ADDRESS_FIELD}", ` +
        "so its entries have no address to be served at. Add one, then give it a template.";
}

/** Whether a registry record declares a top-level `slug` text field. */
function hasAddressField(record: Record<string, unknown>): boolean {
  const own = Array.isArray(record.fields) ? record.fields : null;
  const schema = record.schemaDefinition;
  const nested =
    typeof schema === "object" &&
    schema !== null &&
    Array.isArray((schema as { fields?: unknown }).fields)
      ? (schema as { fields: unknown[] }).fields
      : null;
  return (own ?? nested ?? []).some(
    value =>
      typeof value === "object" &&
      value !== null &&
      (value as { name?: unknown }).name === ENTRY_ADDRESS_FIELD &&
      (value as { type?: unknown }).type === "text"
  );
}

/** The refusal of a template for a collection that cannot have one. */
export function templateCollectionRefusal(message: string): NextlyError {
  return NextlyError.validation({
    errors: [
      { path: TEMPLATE_COLLECTION_FIELD, code: "NOT_TEMPLATABLE", message },
    ],
    logContext: { reason: "template-collection-refused" },
  });
}

/** What the guard is built with. */
export interface TemplateGuardSetup {
  /** The RESOLVED templates slug: a host may rename it. */
  readonly templatesCollection: string;
  /** The page builder's own collections, by their resolved slugs. */
  readonly ownCollections: () => ReadonlySet<string>;
  readonly readCollection: CollectionRecordRead;
  readonly holderOf: TemplateHolderRead;
  /** Each address declared in code, by collection slug. */
  readonly declaredAddresses: ReadonlyMap<string, string>;
  /** The template storing an address, read as the system. */
  readonly addressHolderOf: AddressHolderRead;
}

/** The parts of a `beforeChange` hook context the guard reads. */
interface GuardContext {
  readonly operation?: unknown;
  readonly data?: unknown;
  readonly originalData?: unknown;
  readonly executor?: unknown;
  /** The write's own hook context, which marks a judging write. */
  readonly context?: unknown;
  readonly user?: unknown;
  readonly req?: unknown;
}

/**
 * The hook registration the guard needs, in the shape the plugin's own
 * context offers it: a handler takes the hook context as it arrives, and the
 * guard reads only what it checks the shape of.
 */
export interface TemplateGuardHooks {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: unknown) => unknown
    ): void;
  };
}

/**
 * Register the guard on the templates collection.
 *
 * `beforeChange`, which runs after every `beforeCreate` and `beforeUpdate`
 * hook and after validation, still before the write. A hook running later
 * can still change the data; the unique index is what holds regardless.
 */
export function registerTemplateGuard(
  ctx: TemplateGuardHooks,
  setup: TemplateGuardSetup
): void {
  ctx.hooks.on("beforeChange", setup.templatesCollection, async context => {
    const hook = recordOf(context) ?? {};
    const data = await guardAddress(setup, hook);
    await guardWrite(setup, data === undefined ? hook : { ...hook, data });
    // The data as the address guard left it, an emptied address made none;
    // undefined keeps the write's own.
    return data;
  });
}

/**
 * Judge the address a write gives a template, when it gives one: its one
 * spelling, that it is not `/`, that no other collection is given it in code
 * or stores it, and that the template is a collection's own. An emptied
 * address, which a cleared input sends, is stored as none. Answers the data
 * to write where it changed it.
 *
 * Who may set it is not judged here: the field's create and update rules
 * take an address out of a write by anyone without the routing permission,
 * before this runs. The unique index refuses a second template storing an
 * address under concurrent writes; the template's in-transaction phase asks
 * the questions that need no read again, whichever path the write took.
 */
export async function guardAddress(
  setup: TemplateGuardSetup,
  context: GuardContext
): Promise<Record<string, unknown> | undefined> {
  const data = recordOf(context.data);
  if (
    data === null ||
    !Object.prototype.hasOwnProperty.call(data, TEMPLATE_ADDRESS_FIELD)
  ) {
    return undefined;
  }
  const address = writtenAddressOf(data[TEMPLATE_ADDRESS_FIELD]);
  const written =
    address === data[TEMPLATE_ADDRESS_FIELD]
      ? undefined
      : { ...data, [TEMPLATE_ADDRESS_FIELD]: address };
  const original = recordOf(context.originalData);
  if (
    address === null ||
    address === undefined ||
    (context.operation !== "create" &&
      address === storedAddressOf(original?.[TEMPLATE_ADDRESS_FIELD]))
  ) {
    return written;
  }
  const row = { ...original, ...data };
  const notHere = addressHolderProblem(row);
  if (notHere !== null) throw addressRefusal(notHere);
  const collection = row[TEMPLATE_COLLECTION_FIELD];
  const problem = storedAddressProblem(address, collection, {
    declared: setup.declaredAddresses,
  });
  if (problem !== null) throw addressRefusal(problem);
  // Text by now: anything else has a problem above.
  if (typeof address !== "string") return written;
  // Inside a caller's transaction a read would wait on the connection that
  // transaction holds, as `skipsReads` explains. A template action's dry run
  // asked who stores the address before it opened its transaction.
  if (context.executor !== undefined) {
    if (recordOf(context.context)?.[JUDGEMENT_CONTEXT] === true) return written;
    throw addressRefusal(
      "A template's address cannot be checked inside a bulk operation. Set it on the template on its own."
    );
  }
  const unserved = await addressCollectionProblem(setup, collection);
  if (unserved !== null) throw addressRefusal(unserved);
  const holder = await setup.addressHolderOf(address);
  if (holder !== null && holder.id !== original?.id) {
    throw addressRefusal(heldAddressMessage(address, holder));
  }
  return written;
}

/**
 * Why `collection`'s entries cannot be served under an address, or null
 * when they can: a localized collection's entries have a slug and a state in
 * each language, which one address per collection cannot follow yet, as a
 * collection given an address in code is refused at start.
 */
export async function addressCollectionProblem(
  setup: Pick<TemplateGuardSetup, "readCollection">,
  collection: unknown
): Promise<string | null> {
  if (typeof collection !== "string") return null;
  const record = await setup.readCollection(collection);
  return record?.localized === true
    ? `The collection "${collection}" is localized, and a localized collection's entries cannot be served under a template address yet.`
    : null;
}

/** Judge one write to a template's collection, refusing it or letting it through. */
export async function guardWrite(
  setup: TemplateGuardSetup,
  context: GuardContext
): Promise<void> {
  const data = recordOf(context.data);
  if (data === null) return;
  const collection = data[TEMPLATE_COLLECTION_FIELD];

  if (context.operation !== "create") {
    const original = recordOf(context.originalData);
    const before = original?.[TEMPLATE_COLLECTION_FIELD];
    if (
      !Object.prototype.hasOwnProperty.call(data, TEMPLATE_COLLECTION_FIELD) ||
      collection === before
    ) {
      return;
    }
    if (skipsReads(context)) return;
    // A template keeps the collection it draws. The one exception is a
    // template whose collection no longer exists under its name, renamed or
    // deleted: it may be pointed at another, judged as a new template's
    // collection is, so a rename never strands its design.
    if (
      typeof before === "string" &&
      (await setup.readCollection(before)) !== null
    ) {
      throw templateCollectionRefusal(
        "A template's collection cannot be changed while that collection exists. Create a template for the other collection instead."
      );
    }
    const id = original?.id;
    await judgeCollection(
      setup,
      context,
      collection,
      typeof id === "string" ? id : null
    );
    return;
  }

  await judgeCollection(setup, context, collection, null);
}

/**
 * Judge the collection a template is to draw: one that may have a template,
 * and that no other template draws. `self` is the template being written, so
 * it is never named as its own rival.
 */
async function judgeCollection(
  setup: TemplateGuardSetup,
  context: GuardContext,
  collection: unknown,
  self: string | null
): Promise<void> {
  // A missing or empty value is the field's own `required` check's to refuse,
  // which has already run.
  if (typeof collection !== "string" || collection === "") return;

  if (skipsReads(context)) return;

  const problem = await templateCollectionProblem(
    collection,
    setup.readCollection,
    setup.ownCollections()
  );
  if (problem !== null) throw templateCollectionRefusal(problem);

  const holder = await setup.holderOf(collection);
  if (holder === null || holder.id === self) return;
  throw await secondTemplateRefusal(collection, holder, id =>
    mayReadAsWriter(context, setup.templatesCollection, id)
  );
}

/**
 * Whether a write is judged without reading, or refused for being in a
 * caller's transaction.
 *
 * Inside a caller's transaction every read the guard makes would take a
 * second connection, which on a small pool waits for the one that
 * transaction holds, while the transaction waits for this hook. A template
 * action's dry run asked the same questions before it opened its
 * transaction, so its judging write goes on to the index. Any other write in
 * a caller's transaction that names a collection is refused rather than let
 * through unjudged.
 */
function skipsReads(context: GuardContext): boolean {
  if (context.executor === undefined) return false;
  if (recordOf(context.context)?.[JUDGEMENT_CONTEXT] === true) return true;
  throw templateCollectionRefusal(
    "A template's collection cannot be checked inside a bulk operation. Create or change the template on its own."
  );
}

/**
 * Whether the person making the write may read template `id`, through core's
 * own read access as that person. No person, or no Direct API on the hook's
 * request, answers no, so the refusal names the template by its id alone.
 */
async function mayReadAsWriter(
  context: GuardContext,
  templatesCollection: string,
  id: string
): Promise<boolean> {
  const nextly = directApiOf(context);
  if (nextly === null || recordOf(context.user) === null) return false;
  const row = await nextly.findByID({
    collection: templatesCollection,
    id,
    overrideAccess: false,
    user: context.user,
    status: "all",
    depth: 0,
  });
  return recordOf(row) !== null;
}

/** The one Direct API read the guard makes as the writer. */
interface ReadsById {
  findByID(args: Record<string, unknown>): Promise<unknown>;
}

/** The Direct API on the hook's request, or `null` where it carries none. */
function directApiOf(context: GuardContext): ReadsById | null {
  const nextly = recordOf(recordOf(context.req)?.nextly);
  return nextly !== null && typeof nextly.findByID === "function"
    ? (nextly as unknown as ReadsById)
    : null;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Why a template row cannot hold an address at all, or null when it can.
 * Only a collection's base template holds one: the address is where the
 * collection's entries are served.
 */
export function addressHolderProblem(
  row: Readonly<Record<string, unknown>>
): string | null {
  // An entry's own design names the entry it draws, not a collection, and is
  // served at that entry's address. Once templates carry that field, refuse
  // an address on a row whose `entry` is set here:
  //   if (row.entry != null && row.entry !== "") return "An entry's own design has no address of its own: it is served at its entry's.";
  const collection = row[TEMPLATE_COLLECTION_FIELD];
  return typeof collection === "string" && collection !== ""
    ? null
    : "Only a collection's template has an address: this template draws no collection.";
}
