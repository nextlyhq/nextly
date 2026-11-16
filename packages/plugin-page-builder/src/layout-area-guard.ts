/**
 * A Layout can never be saved pointing at a component that does not exist.
 *
 * `areas` is a repeater stored as one JSON column, so the component each row
 * names carries no foreign key (`collections/layouts.ts`). This guard is the
 * check the database does not make, from the Layout's side; the delete of a
 * component a Layout names is refused from the other side
 * (`layout-component-guard.ts`).
 *
 * ## Two checks, one before the write and one inside it
 *
 * Before the write (`beforeChange`), a row naming a component that is not
 * there is either refused or dropped:
 *
 * - REFUSED, naming the area, when the write adds it: the author picked
 *   something that is gone, and is still looking at the row.
 * - DROPPED when the Layout already held it before this write. Such an id was
 *   left by a delete no check saw, and nothing can make it work again; the
 *   area simply has no component from this save on, which is what a reader
 *   already draws for it. Dropped as part of the save itself, so a save that
 *   fails leaves it as it was, and no migration rewrites stored rows.
 *
 * Inside the write's transaction (`onInTransaction`), every component the
 * write ADDS is judged again, on the write's own connection:
 *
 * - its row is held for share (`holdEntryInTransaction`), which also answers
 *   whether it is still there. A component delete locks that row for update
 *   before removing it, so the two take turns: the Layout either commits
 *   first, or waits and is told the component is gone;
 * - the composition graph lock is taken, then the component's delete run is
 *   read. Delete component moves its run to `deleting` under the same lock
 *   (`host-rewrite/fence.ts`), and its last check of the Layouts runs after
 *   that move. So a Layout either commits before the move, and that check
 *   sees it and refuses the delete, or reads the run after it and is refused.
 *   A Layout adding a component whose delete has merely started is refused
 *   too: the component is about to go.
 *
 * A reference the Layout already held is not judged in the transaction: it
 * is stored, so the delete's own check of the Layouts sees it.
 *
 * ## What it reads as
 *
 * The system. Whether a component exists is the question, not who may see it,
 * and a component the author cannot read still breaks every page the Layout
 * wraps. The refusal names only the area, never the component.
 *
 * Inside a caller's transaction (a batch, an import) nothing is read before
 * the write: a read on the pool there waits for the connection the
 * transaction holds. The check inside the transaction still runs, on that
 * transaction, so a component the import created in it counts as existing.
 *
 * @module layout-area-guard
 */
import {
  NextlyError,
  type InTransactionContext,
  type PluginCollectionTransaction,
} from "@nextlyhq/plugin-sdk";
import { inArray } from "@nextlyhq/plugin-sdk/db";

import type { ClassUsageDirectApi } from "./class-usage-runtime";
import { holdCompositionGraph } from "./composition-graph-lock";
import {
  areaRowsOf,
  referenceIdOf,
  type AreaRow,
} from "./layout-component-usage";
import { componentDeletions } from "./schema/tables";

/** The issue code a refused area carries. */
export const LAYOUT_COMPONENT_MISSING = "LAYOUT_COMPONENT_MISSING";

/** The issue code an area naming a component being deleted carries. */
export const LAYOUT_COMPONENT_BEING_DELETED = "LAYOUT_COMPONENT_BEING_DELETED";

/** How many ids one existence read names. */
const IDS_PER_READ = 100;

/** The plugin capabilities this needs, named structurally. */
export interface LayoutAreaGuardContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: unknown) => unknown
    ): void;
    onInTransaction(
      collection: string,
      handler: (write: InTransactionContext) => Promise<void>
    ): void;
  };
  dialect: Parameters<typeof holdCompositionGraph>[1];
  services: {
    collections: {
      holdEntryInTransaction(
        tx: PluginCollectionTransaction,
        collectionName: string,
        entryId: string
      ): Promise<boolean>;
    };
  };
}

/** What the guard is wired with. */
export interface LayoutAreaGuardArgs {
  readonly ctx: LayoutAreaGuardContext;
  /** The RESOLVED components slug. */
  readonly componentsCollection: string;
  /** The RESOLVED layouts slug. */
  readonly layoutsCollection: string;
}

/** Register both checks on the Layouts collection, by its RESOLVED slug. */
export function registerLayoutAreaGuard(args: LayoutAreaGuardArgs): void {
  args.ctx.hooks.on("beforeChange", args.layoutsCollection, context =>
    checkBeforeWrite(args, context)
  );
  args.ctx.hooks.onInTransaction(args.layoutsCollection, write =>
    checkInTransaction(args, write)
  );
}

/** The refusal of an area whose component does not exist. */
function missingComponentMessage(area: string): string {
  const where = areaWords(area);
  return `The ${where} names a component that doesn't exist. Choose another component for the ${where}.`;
}

/** The refusal of an area whose component is being deleted. */
function componentBeingDeletedMessage(area: string): string {
  const where = areaWords(area);
  return `The component chosen for the ${where} is being deleted, so it can't be used here. Choose another component for the ${where}.`;
}

/** The parts of a `beforeChange` context this reads. */
interface BeforeChangeContext {
  operation?: unknown;
  data?: Record<string, unknown>;
  originalData?: unknown;
  executor?: unknown;
  req?: { nextly?: unknown };
}

/**
 * Refuse an area the write adds that names a missing component, and drop one
 * the Layout already held. Only a write that sends `areas` is read: one that
 * leaves them alone adds nothing, and its stored rows stay as they are.
 */
async function checkBeforeWrite(
  args: LayoutAreaGuardArgs,
  context: unknown
): Promise<void> {
  if (!isRecord(context)) return;
  const hook = context as BeforeChangeContext;
  const data = hook.data;
  if (data === undefined || !Object.hasOwn(data, "areas")) return;
  if (hook.executor !== undefined) return;
  const nextly = directApiOf(hook);
  if (nextly === null) return;

  const rows = areaRowsOf(data.areas);
  if (rows.length === 0) return;
  const existing = await existingComponents(
    nextly,
    args.componentsCollection,
    rows.map(row => row.componentId)
  );
  const missing = rows.filter(row => !existing.has(row.componentId));
  if (missing.length === 0) return;

  const held = await componentsHeldBefore(nextly, args.layoutsCollection, hook);
  const added = missing.filter(row => !held.has(row.componentId));
  if (added.length > 0) {
    throw areaRefusal(added, LAYOUT_COMPONENT_MISSING, missingComponentMessage);
  }
  // Every missing component was already held: those rows go with this save.
  const dropped = new Set(missing.map(row => row.index));
  data.areas = (data.areas as unknown[]).filter(
    (_row, index) => !dropped.has(index)
  );
}

/**
 * The components the Layout named before this write: its stored row and its
 * pending edit, if it has one. A create held nothing.
 */
async function componentsHeldBefore(
  nextly: ClassUsageDirectApi,
  layouts: string,
  hook: BeforeChangeContext
): Promise<Set<string>> {
  const held = new Set<string>();
  if (!isRecord(hook.originalData)) return held;
  for (const row of areaRowsOf(hook.originalData.areas)) {
    held.add(row.componentId);
  }
  const id = referenceIdOf(hook.originalData.id);
  if (id === null) return held;
  // A published Layout edited since keeps the edit apart from its row; the
  // author saving the edit sends what the edit names.
  const pending = await nextly.findByID({
    collection: layouts,
    id,
    draft: true,
    depth: 0,
    overrideAccess: true,
  });
  if (isRecord(pending) && pending._isWorkingDraft === true) {
    for (const row of areaRowsOf(pending.areas)) held.add(row.componentId);
  }
  return held;
}

/** Which of these components exist, in any lifecycle state, read as the system. */
async function existingComponents(
  nextly: ClassUsageDirectApi,
  components: string,
  ids: readonly string[]
): Promise<Set<string>> {
  const wanted = [...new Set(ids)];
  const found = new Set<string>();
  for (let at = 0; at < wanted.length; at += IDS_PER_READ) {
    const chunk = wanted.slice(at, at + IDS_PER_READ);
    const answered = (await nextly.find({
      collection: components,
      where: { id: { in: chunk } },
      limit: chunk.length,
      status: "all",
      depth: 0,
      overrideAccess: true,
    })) as { items?: readonly unknown[] };
    for (const item of answered.items ?? []) {
      const id = isRecord(item) ? referenceIdOf(item.id) : null;
      if (id !== null) found.add(id);
    }
  }
  return found;
}

/**
 * Judge every component the write adds, on its own transaction: still there,
 * and not being deleted. Throws the refusal.
 */
async function checkInTransaction(
  args: LayoutAreaGuardArgs,
  write: InTransactionContext
): Promise<void> {
  if (write.operation === "delete") return;
  const before = new Set(
    areaRowsOf(write.originalData?.areas).map(row => row.componentId)
  );
  const added = areaRowsOf(write.data?.areas).filter(
    row => !before.has(row.componentId)
  );
  if (added.length === 0) return;

  const gone: AreaRow[] = [];
  for (const row of added) {
    const there = await args.ctx.services.collections.holdEntryInTransaction(
      write.transaction,
      args.componentsCollection,
      row.componentId
    );
    if (!there) gone.push(row);
  }
  if (gone.length > 0) {
    throw areaRefusal(gone, LAYOUT_COMPONENT_MISSING, missingComponentMessage);
  }

  await holdCompositionGraph(write.db, args.ctx.dialect);
  const deleting = await componentsBeingDeleted(
    write.db,
    added.map(row => row.componentId)
  );
  const fenced = added.filter(row => deleting.has(row.componentId));
  if (fenced.length > 0) {
    throw areaRefusal(
      fenced,
      LAYOUT_COMPONENT_BEING_DELETED,
      componentBeingDeletedMessage
    );
  }
}

/**
 * The components among these that a delete run is open for, or that one
 * deleted. Read on the write's transaction, after the graph lock.
 */
async function componentsBeingDeleted(
  db: Pick<InTransactionContext["db"], "select" | "table">,
  ids: readonly string[]
): Promise<Set<string>> {
  const runs = await db
    .select(componentDeletions)
    .where(inArray(db.table(componentDeletions).componentId, [...ids]))
    .all();
  // A purpose nobody can classify counts as a delete, as the fence reads it.
  return new Set(
    runs
      .filter(run => run.purpose !== "strip-retired")
      .map(run => run.componentId)
  );
}

/** The refusal, one issue per area, on the row's component. */
function areaRefusal(
  rows: readonly AreaRow[],
  code: string,
  words: (area: string) => string
): NextlyError {
  return NextlyError.validation({
    errors: rows.map(row => ({
      path: `areas[${String(row.index)}].component`,
      code,
      message: words(row.area),
    })),
  });
}

/** An area as a sentence names it: "header", or "area" when unreadable. */
function areaWords(area: string): string {
  return area === "" ? "area" : area;
}

/** The Direct API the request carries, or null. */
function directApiOf(hook: BeforeChangeContext): ClassUsageDirectApi | null {
  const nextly = hook.req?.nextly;
  return typeof nextly === "object" && nextly !== null
    ? (nextly as ClassUsageDirectApi)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
