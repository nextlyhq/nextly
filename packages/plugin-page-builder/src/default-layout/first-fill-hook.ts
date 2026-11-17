/**
 * Asking for the default's fill (`first-fill`) when a component is published
 * as a header or footer for the first time, from any screen: the builder, the
 * admin's form, the API or an import.
 *
 * ## What counts as the first time
 *
 * A committed create or update that leaves the component published (its live
 * row, not a draft beside it) and used as a header or footer, when before the
 * write it was not published as that. So the first publish of a new header
 * counts, and so does publishing a component made elsewhere and then marked
 * "Use as: Header" (a component made from a selection is created published,
 * with no use yet). A later publish of the same header does not: it was
 * published as a header already. Whatever the write, an area is filled at
 * most once (`fill-mark`), so no second header ever takes the first one's
 * place.
 *
 * ## After the commit, never failing the publish
 *
 * Run once the write is durable (`afterCommit`), so a publish a caller's
 * transaction rolls back fills nothing, and before the publish's call
 * resolves, so the screen it came from can ask what it filled. A fill that
 * fails is logged and the publish still succeeds: the component was
 * published as asked, and the fill is a convenience on top of it.
 *
 * @module default-layout/first-fill-hook
 */
import type { FirstFillDeps, PublishedAs } from "./first-fill";
import { fillDefaultOnFirstPublish } from "./first-fill";
import type { StarterArea } from "./seed-names";
import type { DefaultLayoutDirectApi } from "./store";

/** The plugin context this needs, named structurally. */
interface HookRegistry {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: unknown) => unknown
    ): void;
  };
}

/** The parts of a component write's hook context this reads. */
interface ComponentWriteContext {
  data?: unknown;
  originalData?: unknown;
  user?: { id?: unknown } | null;
  req?: { nextly?: unknown };
  afterCommit?: (effect: () => unknown) => Promise<void>;
}

/** The Direct API a write's request carried, when it carried one. */
export interface CarriedApi {
  readonly nextly?: DefaultLayoutDirectApi;
}

/** What the hook is wired with. */
export interface FirstFillHookArgs {
  readonly ctx: HookRegistry;
  /** The RESOLVED components collection. */
  readonly components: string;
  /**
   * What a fill needs, resolved when it runs, over the Direct API the write's
   * own request carries when it carries one.
   */
  readonly deps: (carried: CarriedApi) => Promise<FirstFillDeps>;
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
}

/** The area `row` is published as, or null when it is not a published header or footer. */
function publishedAreaOf(row: unknown): StarterArea | null {
  if (typeof row !== "object" || row === null) return null;
  const { status, area, _isWorkingDraft } = row as Record<string, unknown>;
  if (status !== "published" || _isWorkingDraft === true) return null;
  return area === "header" || area === "footer" ? area : null;
}

/**
 * The component a write has just published as a header or footer for the
 * first time, or null for any other write.
 */
export function firstPublishedAs(
  context: ComponentWriteContext
): PublishedAs | null {
  const area = publishedAreaOf(context.data);
  if (area === null) return null;
  if (publishedAreaOf(context.originalData) === area) return null;
  const id = (context.data as { id?: unknown }).id;
  if (typeof id !== "string" || id === "") return null;
  const by = context.user?.id;
  return { id, area, by: typeof by === "string" && by !== "" ? by : null };
}

/** Register the hook on the components collection's committed writes. */
export function registerFirstFillHook(args: FirstFillHookArgs): void {
  for (const phase of ["afterCreate", "afterUpdate"] as const) {
    args.ctx.hooks.on(phase, args.components, context =>
      onWrite(args, context as ComponentWriteContext)
    );
  }
}

/** Hand a first publish's fill to the write's commit; anything else is left. */
async function onWrite(
  args: FirstFillHookArgs,
  context: ComponentWriteContext
): Promise<void> {
  const published = firstPublishedAs(context);
  if (published === null) return;
  const nextly = context.req?.nextly;
  const carried: CarriedApi =
    typeof nextly === "object" && nextly !== null
      ? { nextly: nextly as DefaultLayoutDirectApi }
      : {};
  const fill = () => runFill(args, published, carried);
  await (context.afterCommit ? context.afterCommit(fill) : fill());
}

/** The fill, logged rather than thrown when it fails. */
async function runFill(
  args: FirstFillHookArgs,
  published: PublishedAs,
  carried: CarriedApi
): Promise<void> {
  try {
    if (await fillDefaultOnFirstPublish(await args.deps(carried), published)) {
      args.warn(
        `[page-builder] the first published ${published.area} now fills the default header & footer set`,
        { component: published.id, area: published.area }
      );
    }
  } catch (error) {
    args.warn(
      `[page-builder] a first published ${published.area} could not fill the default header & footer set; the set was left as it was`,
      {
        component: published.id,
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
}
