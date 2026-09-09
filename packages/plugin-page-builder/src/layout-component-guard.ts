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
 * @module layout-component-guard
 */
import {
  layoutReferencesOf,
  type LayoutComponentReference,
  type LayoutPage,
} from "./layout-component-usage";

/** How many Layouts one page of the scan asks for. */
const SCAN_PAGE_SIZE = 100;

/** The Direct API surface this needs, named by what it uses. */
export interface LayoutGuardDirectApi {
  find(args: {
    collection: string;
    limit: number;
    page: number;
    status?: string;
    overrideAccess: boolean;
  }): Promise<{ docs?: unknown[]; hasNextPage?: boolean }>;
}

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
        overrideAccess: true,
      });
      return {
        items: answered.docs ?? [],
        hasNext: answered.hasNextPage === true,
      } satisfies LayoutPage;
    },
  });

  // An UNFINISHED scan refuses too. Its `references` is a prefix, so an empty
  // one says "no Layout names this" — the answer that permits exactly the
  // delete this exists to prevent. Refusing on a scan that could not finish
  // fails towards keeping a component, which is recoverable; the other
  // direction is not.
  if (!usage.complete) {
    throw new Error(
      `This component cannot be deleted: there are too many Layouts to check ` +
        `(more than ${String(SCAN_PAGE_SIZE)} pages), so whether one still uses ` +
        `it could not be established.`
    );
  }

  if (usage.references.length === 0) return;

  throw new Error(
    `This component cannot be deleted because ${describeLayouts(usage.references)}. ` +
      `A Layout appears on every page assigned to it, so removing a component ` +
      `it uses would leave a gap on all of them. Remove it from ${
        usage.references.length === 1 ? "that Layout" : "those Layouts"
      } first.`
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
