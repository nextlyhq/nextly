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
 * @module layout-component-guard
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import type { ClassUsageDirectApi } from "./class-usage-runtime";
import {
  layoutReferencesOf,
  type LayoutComponentReference,
  type LayoutPage,
} from "./layout-component-usage";

/** How many Layouts one page of the scan asks for. */
const SCAN_PAGE_SIZE = 100;

/**
 * The Direct API surface this needs.
 *
 * REUSED rather than restated. A structural subset of a published API is a
 * restatement, and a restatement can be wrong while everything built on it
 * compiles and every test passes — the fake matches the restatement, so the
 * tests agree with the mistake. This guard was written with its own, declaring
 * `find` as `{ docs, hasNextPage }`; the scan then saw an empty page for every
 * Layout and ALLOWED the delete it exists to refuse, with a green suite.
 *
 * `ClassUsageDirectApi` already declares both reads correctly and is pinned
 * against the real `Nextly` by `class-usage-runtime.test-d.ts`, control
 * included. A second declaration beside it would be a second thing to keep
 * true. The name is the class index's because that is where it was first
 * needed; what it describes is the Direct API this package reads through.
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
    read: async ({ variant, page }) => {
      const answered = await nextly.find({
        collection: args.layoutsCollection,
        limit: SCAN_PAGE_SIZE,
        page,
        // Both stored forms, asked separately. A draft Layout naming the
        // component is on no page yet and breaks the moment somebody
        // publishes it.
        status: variant,
        // The relationship is only ever compared as an ID here. Left to the
        // default the read expands it per repeater row, fetching every named
        // component's whole document — hundreds of extra reads before a
        // delete, for a value this discards.
        depth: 0,
        overrideAccess: true,
      });
      const items = answered.items ?? [];
      return {
        items:
          variant === "draft"
            ? await withPendingEdits(nextly, args.layoutsCollection, items)
            : items,
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

  throw refusal(
    `This component cannot be deleted because ${describeLayouts(usage.references)}. ` +
      `A Layout appears on every page assigned to it, so removing a component ` +
      `it uses would leave a gap on all of them. Remove it from ${
        usage.references.length === 1 ? "that Layout" : "those Layouts"
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

/** How the Layouts read in the refusal, so an author knows where to go. */
function describeLayouts(
  references: readonly LayoutComponentReference[]
): string {
  // By LAYOUT, not by reference: one Layout naming the component in two areas
  // is one place to go and edit, and listing it twice reads as two problems.
  const byLayout = new Map<string, LayoutComponentReference>();
  for (const reference of references) {
    if (!byLayout.has(reference.layoutId)) {
      byLayout.set(reference.layoutId, reference);
    }
  }
  const named = [...byLayout.values()].map(reference => {
    const title = reference.title === "" ? reference.layoutId : reference.title;
    return reference.variant === "draft" ? `${title} (draft)` : title;
  });
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
 * The same Layouts, each replaced by its PENDING edit where one exists.
 *
 * A published Layout edited since keeps its main row published and its changes
 * in a sidecar, and a list read never surfaces that — only a by-id read asking
 * for the draft does. So a component named only by an unsaved-to-live edit is
 * invisible to the list pass, and deleting it breaks the Layout the moment the
 * edit is published.
 *
 * `_isWorkingDraft` is what identifies an overlay, and it is checked rather
 * than assumed: the by-id read falls back to the LIVE row when there is no
 * sidecar, and taking that as a pending edit would report the published
 * references twice.
 *
 * One read per Layout, which is why this runs only on the draft pass and why
 * the scan is bounded: the population it multiplies is the one already assumed
 * small.
 */
async function withPendingEdits(
  nextly: LayoutGuardDirectApi,
  collection: string,
  items: readonly unknown[]
): Promise<unknown[]> {
  const resolved: unknown[] = [];
  for (const item of items) {
    const id = idOf(item);
    if (id === null) {
      resolved.push(item);
      continue;
    }
    const pending = await nextly.findByID({
      collection,
      id,
      draft: true,
      depth: 0,
      overrideAccess: true,
    });
    resolved.push(isPendingEdit(pending) ? pending : item);
  }
  return resolved;
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
