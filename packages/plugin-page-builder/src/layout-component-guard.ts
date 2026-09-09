/**
 * Refusing to delete a component a Layout still names.
 *
 * `decision:pb6-layout-component-delete-policy`, ruled 2026-09-04: REFUSE the
 * delete and show where the component is used. A Layout wraps every page
 * assigned to it, so a missing piece is a site-wide failure — which is what
 * separates this from an ordinary page, where the renderer draws one visible,
 * recoverable placeholder.
 *
 * ## Why a `beforeDelete` hook
 *
 * Because it is the phase that can still say no. The mutation service awaits
 * `beforeDelete` before removing anything and its own comment says a hook
 * "can prevent deletion by throwing error"; the `after*` phases are
 * side-effect phases whose throw the registry converts into a warning on an
 * already-committed write, which would report the refusal after the damage.
 *
 * The database will not do this for us. `areas` is a repeater stored as one
 * JSON column, so the relationship nested in it emits no foreign key and no
 * delete policy — `collections/layouts.ts` says so in as many words.
 *
 * ## The scan runs as the SYSTEM, and that is a correctness choice
 *
 * A Layout the deleting user cannot read would otherwise be invisible to the
 * scan, the delete would be permitted, and every page carrying that Layout
 * would break. So the read overrides access.
 *
 * The cost is stated rather than hidden: a refusal can name a Layout the user
 * could not have listed themselves. What it discloses is a title and an area —
 * that a Layout exists and uses this component — against the alternative of
 * destroying it. Nothing about the Layout's content is read or shown.
 *
 * ## What this does NOT close, stated rather than implied
 *
 * A Layout write racing this delete. The scan runs before the delete commits
 * and takes no lock the Layout write would contend for, so a Layout can add a
 * reference between the two and the delete still commits — leaving a dangling
 * id, which the missing foreign key does not refuse either.
 *
 * Narrowing it is not this hook's to do: the boundary would have to be shared
 * with the Layout write, and a plugin registering a hook has no transaction to
 * enlist it in. What the guard removes is the ordinary case — a component
 * already in use being deleted by someone who did not know — and the race is
 * left visible here rather than papered over by a check that looks total.
 *
 * A host's own `afterRead` hook on the Layouts collection, for the same reason.
 * The scan reads through the collection's read pipeline, which substitutes
 * whatever a registered hook returns, so a hook that drops or reshapes `areas`
 * hides a reference from this scan and the delete is permitted. Closing it
 * needs a read that bypasses those hooks, and the Direct API — a plugin's only
 * read surface — offers no option to.
 *
 * @module layout-component-guard
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import type { ClassUsageDirectApi } from "./class-usage-runtime";
import {
  layoutReferencesOf,
  type LayoutComponentReference,
  type LayoutPage,
  type LayoutRecord,
} from "./layout-component-usage";

/** How many Layouts one page of the scan asks for. */
const SCAN_PAGE_SIZE = 100;

/**
 * The Direct API surface this needs.
 *
 * An ALIAS of the declaration this package already pins, never a second
 * structural description of the same API. A structural restatement is checked
 * against nothing: it compiles whatever it claims, and a test fake written to
 * satisfy it agrees with the claim rather than with the API — so a wrong one
 * survives review and a green suite while the reads it describes answer
 * something else entirely, in the direction that ALLOWS a delete.
 *
 * `class-usage-runtime.test-d.ts` pins this declaration against the real
 * `Nextly`, control included, which is the property a second declaration
 * beside it would not have. The name is the class index's because that is
 * where it was first needed; what it describes is the Direct API this whole
 * package reads through.
 */
export type LayoutGuardDirectApi = ClassUsageDirectApi;

/** The plugin context this needs, named structurally. */
export interface LayoutGuardContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: unknown) => unknown
    ): void;
  };
}

/**
 * Refuse a component delete while a Layout still names it.
 *
 * Registered on the COMPONENTS collection by name rather than on the wildcard:
 * this asks one question about one collection, and a wildcard registration
 * would run a Layout scan on every delete the site performs.
 */
export function registerLayoutComponentGuard(args: {
  ctx: LayoutGuardContext;
  /** The RESOLVED components slug — a host may rename it. */
  componentsCollection: string;
  /** The RESOLVED layouts slug, for the same reason. */
  layoutsCollection: string;
}): void {
  args.ctx.hooks.on("beforeDelete", args.componentsCollection, context =>
    refuseWhileALayoutNamesIt(args, context)
  );
}

/** One delete, refused or allowed to proceed. */
async function refuseWhileALayoutNamesIt(
  args: Parameters<typeof registerLayoutComponentGuard>[0],
  context: unknown
): Promise<void> {
  // A caller-owned TRANSACTION. The bulk paths run this hook inside one and
  // hand it an executor so reads reuse that connection — the bulk service says
  // so itself, binding its own resolution "so this resolution does not
  // re-enter the pool from inside the transaction". The Direct API takes no
  // executor, so a read here checks out a SECOND connection: on a small or
  // saturated pool it waits for one the open transaction holds, and that
  // transaction is waiting for this hook.
  //
  // REFUSED rather than skipped. Skipping would let exactly the deletes this
  // guard exists for through, on the path that deletes many at once. Refusing
  // fails towards keeping a component, which an author can undo by deleting it
  // singly; the other direction destroys Layouts on every page.
  if (isInsideACallerTransaction(context)) {
    throw refusal(
      `This component cannot be deleted in a bulk operation, because whether a ` +
        `Layout still uses it cannot be checked safely there. Delete it on its ` +
        `own and the check will run.`
    );
  }

  const componentId = componentIdOf(context);
  const nextly = directApiOf(context);
  // Nothing addressable, or no Direct API to ask with. Left alone rather than
  // refused: a guard that blocked every delete it could not evaluate would
  // make the collection undeletable on any path that shapes its context
  // differently, and this is a data-integrity guard rather than an
  // authorisation one.
  if (componentId === null || nextly === null) return;

  const usage = await layoutReferencesOf({
    componentId,
    read: async ({ page }) => {
      const answered = await nextly.find({
        collection: args.layoutsCollection,
        limit: SCAN_PAGE_SIZE,
        page,
        // EVERY Layout in ONE enumeration, whatever lifecycle state it is in.
        // Asking for the states separately misses the one that matters most: a
        // published Layout holding unpublished changes keeps its main row
        // published, so a draft-scoped read excludes exactly the Layout whose
        // pending edit has to be inspected.
        status: "all",
        // A DETERMINISTIC page order. Absent a sort the query service issues no
        // `ORDER BY` at all, and paging by limit and offset over an unordered
        // result may answer overlapping or disjoint pages — so a Layout naming
        // the component can fall in the gap between two pages and never be
        // seen, while the scan still reports that it finished.
        sort: "id",
        // The relationship is only ever compared as an ID here. Left to the
        // default the read expands it per repeater row, fetching every named
        // component's whole document — hundreds of extra reads before a
        // delete, for a value this discards.
        depth: 0,
        overrideAccess: true,
      });
      return {
        items: await withPendingEdits(
          nextly,
          args.layoutsCollection,
          answered.items ?? []
        ),
        hasNext: answered.meta?.hasNext === true,
      } satisfies LayoutPage;
    },
  });

  // An UNFINISHED scan refuses too. Its `references` is a prefix, so an empty
  // one says "no Layout names this" — the answer that permits exactly the
  // delete this exists to prevent. Refusing on a scan that could not finish
  // fails towards keeping a component, which is recoverable; the other
  // direction is not.
  if (!usage.complete) {
    throw refusal(
      `This component cannot be deleted: there are too many Layouts to check, ` +
        `so whether one still uses it could not be established.`
    );
  }

  if (usage.references.length === 0) return;

  const named = layoutsNamed(usage.references);
  throw refusal(
    `This component cannot be deleted because ${describeLayouts(named)}. ` +
      `A Layout appears on every page assigned to it, so removing a component ` +
      `it uses would leave a gap on all of them. Remove it from ${
        named.length === 1 ? "that Layout" : "those Layouts"
      } first.`
  );
}

/**
 * A refusal an author actually sees.
 *
 * A typed CONFLICT rather than a bare `Error`. The mutation service catches an
 * untyped throw as a code-less failure and the envelope reconstructs it as an
 * internal error, so the author is shown the generic unexpected-error message
 * and none of the Layout names assembled here — a refusal they cannot act on,
 * which is worse than the delete it prevented.
 */
function refusal(message: string): Error {
  return NextlyError.conflict({ message });
}

/** Whether this hook is running inside a transaction its caller owns. */
function isInsideACallerTransaction(context: unknown): boolean {
  return (
    typeof context === "object" &&
    context !== null &&
    (context as { executor?: unknown }).executor !== undefined
  );
}

/**
 * The Layouts an author has to go and edit, named once each.
 *
 * By LAYOUT, not by reference: one Layout naming the component in two areas —
 * or in both its stored form and its pending edit — is one place to go, and
 * listing it twice reads as two problems.
 *
 * The single source for BOTH halves of the refusal, the names and their plural
 * agreement. Counting references for one and Layouts for the other lets the
 * sentence contradict itself, naming one Layout and then asking the author to
 * edit several.
 */
function layoutsNamed(
  references: readonly LayoutComponentReference[]
): string[] {
  const byLayout = new Map<string, LayoutComponentReference>();
  for (const reference of references) {
    if (!byLayout.has(reference.layoutId)) {
      byLayout.set(reference.layoutId, reference);
    }
  }
  return [...byLayout.values()].map(reference => {
    const title = reference.title === "" ? reference.layoutId : reference.title;
    return reference.variant === "draft" ? `${title} (draft)` : title;
  });
}

/** How those Layouts read in the refusal, so an author knows where to go. */
function describeLayouts(named: readonly string[]): string {
  return named.length === 1
    ? `the Layout "${named[0]}" uses it`
    : `${String(named.length)} Layouts use it: ${named.map(n => `"${n}"`).join(", ")}`;
}

/** The id being deleted, or null when the context does not carry one. */
function componentIdOf(context: unknown): string | null {
  if (typeof context !== "object" || context === null) return null;
  const data = (context as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === "string" && id !== "" ? id : null;
}

/** The Direct API the request carries, or null. */
function directApiOf(context: unknown): LayoutGuardDirectApi | null {
  if (typeof context !== "object" || context === null) return null;
  const req = (context as { req?: unknown }).req;
  if (typeof req !== "object" || req === null) return null;
  const nextly = (req as { nextly?: unknown }).nextly;
  return typeof nextly === "object" && nextly !== null
    ? (nextly as LayoutGuardDirectApi)
    : null;
}

/**
 * The same Layouts, each paired with its PENDING edit where it has one.
 *
 * A published Layout edited since keeps its main row published and its changes
 * in a sidecar, and no list read surfaces that — only a by-id read asking for
 * the draft does. So a component named only by an unpublished edit is invisible
 * to the enumeration, and deleting it breaks the Layout the moment the edit is
 * published.
 *
 * Attempted for EVERY Layout, because the row's own lifecycle state does not
 * say whether it has one: a pending edit is a separate document, and the state
 * that most needs asking — published, with unpublished changes — is the state
 * that looks least like a draft from the outside.
 *
 * The pair is kept rather than the edit substituted. A component the pending
 * edit no longer names may still be named by the form the site stores today,
 * and replacing one with the other would lose whichever it replaced.
 *
 * `_isWorkingDraft` is what identifies an overlay, and it is checked rather
 * than assumed: the by-id read falls back to the LIVE row when there is no
 * sidecar, and taking that as a pending edit would report the stored
 * references a second time.
 *
 * SEQUENTIAL, one read at a time. Issuing a page of these at once would put a
 * burst of reads on the pool immediately before a delete; the population is
 * assumed small and the scan is bounded, so the walk costs little and the
 * burst is the only part that could hurt.
 */
async function withPendingEdits(
  nextly: LayoutGuardDirectApi,
  collection: string,
  items: readonly unknown[]
): Promise<LayoutRecord[]> {
  const records: LayoutRecord[] = [];
  for (const item of items) {
    const variant = variantOf(item);
    const id = idOf(item);
    if (id === null) {
      records.push({ stored: item, variant, pending: null });
      continue;
    }
    const pending = await nextly.findByID({
      collection,
      id,
      draft: true,
      depth: 0,
      overrideAccess: true,
    });
    records.push({
      stored: item,
      variant,
      pending: isPendingEdit(pending) ? pending : null,
    });
  }
  return records;
}

/**
 * Which lifecycle state a stored Layout is in.
 *
 * Only the WORDING of the refusal turns on this — every form is scanned either
 * way — so an unreadable value reads as published. Labelling a live Layout
 * "(draft)" would tell the author the reference serves nobody when it serves
 * every page the Layout is assigned to.
 */
function variantOf(item: unknown): "published" | "draft" {
  if (typeof item !== "object" || item === null) return "published";
  return (item as { status?: unknown }).status === "draft"
    ? "draft"
    : "published";
}

/**
 * Whether a by-id read answered an OVERLAY rather than the live row.
 *
 * The read falls back to the live row when there is no sidecar, and taking
 * that as a pending edit would report the published references a second time —
 * so the marker is checked rather than the read merely succeeding.
 */
function isPendingEdit(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { _isWorkingDraft?: unknown })._isWorkingDraft === true
  );
}

/** A stored row's id, or null when it carries none this can address. */
function idOf(item: unknown): string | null {
  if (typeof item !== "object" || item === null) return null;
  const id = (item as { id?: unknown }).id;
  return typeof id === "string" && id !== "" ? id : null;
}
