/**
 * One template per collection: the place each template holds, which
 * collections may have one, and the guard that keeps a second out.
 *
 * A template holds a place among templates, stored in its slot field: a
 * collection's own template holds `base:<collection>`. The field is unique, so
 * the database refuses a second template in a place on every dialect and
 * under concurrent writes, whichever path the write takes. The place is fixed
 * when the template is created and never moves, so publishing, unpublishing,
 * a working draft's promotion and a restore cannot change it: a collection
 * holds one base template document whatever its state, and a second can be
 * neither created nor, therefore, published. A new design for a live template
 * is that template's working draft.
 *
 * The guard below sets the place and, before the database is asked, finds the
 * template already holding it, so the refusal names it. Two creates racing
 * past that read both reach the index, and the one that loses is refused
 * there, with the database's own duplicate error; the template route reads
 * the holder again and names it.
 *
 * @module templates/template-slot
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import {
  TEMPLATE_COLLECTION_FIELD,
  TEMPLATE_SLOT_FIELD,
} from "../collections/templates";

/** The place a collection's own template holds. */
export function baseSlotKey(collection: string): string {
  return `base:${collection}`;
}

/** The template holding a place, as a refusal names it. */
export interface TemplateHolder {
  readonly id: string;
  readonly title: string;
}

/** The template holding `slot`, read as the system, or `null`. */
export type SlotHolderRead = (slot: string) => Promise<TemplateHolder | null>;

/** The part of the plugin's own reads the holder lookup makes. */
export interface OwnTemplateReads {
  listEntries(
    slug: string,
    options: {
      where: Record<string, unknown>;
      pagination: { limit: number };
      depth: number;
    }
  ): Promise<{ data: readonly unknown[] }>;
}

/**
 * The holder lookup over the plugin's own reads: hook-free and as the system,
 * so a site's read hook cannot hide the template that holds the place, and
 * every state of it is seen, a draft included.
 */
export function slotHolderReader(
  own: OwnTemplateReads,
  templatesCollection: string
): SlotHolderRead {
  return async slot => {
    const found = await own.listEntries(templatesCollection, {
      where: { [TEMPLATE_SLOT_FIELD]: { equals: slot } },
      pagination: { limit: 1 },
      depth: 0,
    });
    const row = found.data[0] as Record<string, unknown> | undefined;
    if (row === undefined || typeof row.id !== "string") return null;
    return { id: row.id, title: titleOf(row.title) };
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
 * are built from are never served at all. So is a collection the site keeps
 * for its own bookkeeping.
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
  if (record === null || record.internal === true) {
    return `There is no collection "${collection}" to give a template.`;
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
  readonly holderOf: SlotHolderRead;
}

/** The parts of a `beforeChange` hook context the guard reads. */
interface GuardContext {
  readonly operation?: unknown;
  readonly data?: unknown;
  readonly originalData?: unknown;
  readonly executor?: unknown;
  readonly user?: unknown;
  readonly req?: unknown;
}

/** The hook registration the guard needs. */
export interface TemplateGuardHooks {
  hooks: {
    on(
      phase: "beforeChange",
      collection: string,
      handler: (context: never) => unknown
    ): void;
  };
}

/**
 * Register the guard on the templates collection.
 *
 * `beforeChange`, which runs after every `beforeCreate` and `beforeUpdate`
 * hook and after validation, still before the write: the place it sets is the
 * one written, and nothing after it can change the collection it was set from.
 */
export function registerTemplateGuard(
  ctx: TemplateGuardHooks,
  setup: TemplateGuardSetup
): void {
  ctx.hooks.on(
    "beforeChange",
    setup.templatesCollection,
    (context: GuardContext) => guardWrite(setup, context)
  );
}

/** Judge one write to a template: set its place, or refuse it. */
export async function guardWrite(
  setup: TemplateGuardSetup,
  context: GuardContext
): Promise<void> {
  const data = recordOf(context.data);
  if (data === null) return;

  if (context.operation !== "create") {
    // The place never moves, so a value a write sends for it is dropped
    // rather than stored: a restore of an old version, or a client that sent
    // the field back, writes the place the template already holds.
    delete data[TEMPLATE_SLOT_FIELD];
    const before = recordOf(context.originalData)?.[TEMPLATE_COLLECTION_FIELD];
    if (
      Object.prototype.hasOwnProperty.call(data, TEMPLATE_COLLECTION_FIELD) &&
      data[TEMPLATE_COLLECTION_FIELD] !== before
    ) {
      throw templateCollectionRefusal(
        "A template's collection cannot be changed. Create a template for the other collection instead."
      );
    }
    return;
  }

  const collection = data[TEMPLATE_COLLECTION_FIELD];
  // A missing or empty value is the field's own `required` check's to refuse,
  // which has already run; nothing here can name a place for it.
  if (typeof collection !== "string" || collection === "") return;

  const problem = await templateCollectionProblem(
    collection,
    setup.readCollection,
    setup.ownCollections()
  );
  if (problem !== null) throw templateCollectionRefusal(problem);

  const slot = baseSlotKey(collection);
  data[TEMPLATE_SLOT_FIELD] = slot;

  // Inside a caller's transaction the read would take a second connection,
  // which on a small pool can wait for the one that transaction holds. The
  // index still refuses a second template there; the refusal is only unnamed.
  if (context.executor !== undefined) return;
  const holder = await setup.holderOf(slot);
  if (holder === null) return;
  throw await secondTemplateRefusal(collection, holder, id =>
    mayReadAsWriter(context, setup.templatesCollection, id)
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
