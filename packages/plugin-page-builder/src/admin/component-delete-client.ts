"use client";

/**
 * The delete dialog's side of the Delete component routes
 * (`component-delete/contract.ts`), and the reading of their answers that
 * every face of the dialog shares.
 *
 * Two calls: a dry run, which writes nothing, and a step, which starts the
 * caller's delete or carries it on by one bounded step. The dialog calls the
 * step again while the answer says the delete is under way, so it is the
 * dialog staying open that runs the delete.
 *
 * @module admin/component-delete-client
 */
import { isApiError, writePluginRoute } from "@nextlyhq/plugin-sdk/admin";

// The CONTRACT, not the route: the route reaches the store through
// server-only modules.
import {
  COMPONENT_DELETE_ROUTE_PATH,
  type ComponentDeleteResult,
  type DeletePlan,
  type DeleteProgress,
  type DocumentList,
  type NamedDocument,
} from "../component-delete/contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

import { refusalMessage } from "./save-pattern-client";

/** The canonical mutation envelope the routes answer with. */
interface Envelope {
  readonly message: string;
  readonly item: ComponentDeleteResult;
}

/** What one call came to. */
export type DeleteCall =
  | { readonly kind: "answer"; readonly result: ComponentDeleteResult }
  /** Someone else's delete is open (409), or a step lost a race. */
  | { readonly kind: "conflict"; readonly message: string }
  /** The caller may not delete this component (403). */
  | { readonly kind: "forbidden" }
  | { readonly kind: "failed"; readonly message: string };

/** The route's address for one component. */
function pathOf(componentId: string): string {
  return COMPONENT_DELETE_ROUTE_PATH.replace(
    ":id",
    encodeURIComponent(componentId)
  );
}

/** Said when a refusal carries no words of its own. */
const UNEXPLAINED = "The component could not be deleted. Try again.";

/** Said when the dry run could not be read. */
export const UNCHECKED = "Where the component is used could not be checked.";

/** One call: the dry run (`dryRun`) or one step of the delete. */
async function call(
  componentId: string,
  dryRun: boolean,
  unexplained: string
): Promise<DeleteCall> {
  try {
    const answer = await writePluginRoute<Envelope>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: pathOf(componentId),
      // `{}` starts or steps the delete; the route refuses any other key, so
      // nothing but `dryRun` is ever sent.
      body: dryRun ? { dryRun: true } : {},
    });
    if (answer?.item === undefined) {
      return { kind: "failed", message: unexplained };
    }
    return { kind: "answer", result: answer.item };
  } catch (error) {
    if (isApiError(error) && error.status === 403) return { kind: "forbidden" };
    const message =
      error instanceof Error ? refusalMessage(error, unexplained) : unexplained;
    if (isApiError(error) && error.status === 409) {
      return { kind: "conflict", message };
    }
    return { kind: "failed", message };
  }
}

/** What deleting would do, changing nothing. */
export function checkComponentDelete(componentId: string): Promise<DeleteCall> {
  return call(componentId, true, UNCHECKED);
}

/** Start the caller's delete, or carry it on by one step. */
export function stepComponentDelete(componentId: string): Promise<DeleteCall> {
  return call(componentId, false, UNEXPLAINED);
}

/** Whether an answer says the delete is still under way. */
export function underWay(result: ComponentDeleteResult): boolean {
  return result.status === "preflight" || result.status === "running";
}

/**
 * Whether the dry run's plan is whole. A plan still being counted, on a site
 * too large to count in one call, says `complete: false`; a plan that says
 * nothing of it is whole. Read here once, so no face takes a part-counted
 * plan for "nothing uses it".
 */
export function planComplete(plan: DeletePlan | undefined): boolean {
  if (plan === undefined) return true;
  const said = (plan as DeletePlan & { readonly complete?: unknown }).complete;
  return said !== false;
}

/** How many documents a list stands for: named, unreadable and beyond it. */
export function documentCount(list: DocumentList | undefined): number {
  if (list === undefined) return 0;
  return list.named.length + list.unreadable + list.more;
}

/** How many documents the delete has finished with, of how many. */
export function progressOf(progress: DeleteProgress | undefined): {
  readonly finished: number;
  readonly total: number;
} {
  if (progress === undefined) return { finished: 0, total: 0 };
  const finished = progress.converted + progress.unchanged + progress.left;
  return { finished, total: finished + progress.pending };
}

/** Where a named document opens in the admin. */
export function documentHref(document: NamedDocument): string {
  const slug = encodeURIComponent(document.slug);
  if (document.kind === "single") return `/admin/singles/${slug}`;
  return `/admin/collections/${slug}/${encodeURIComponent(document.id ?? "")}`;
}

/** A document's title as shown, never blank. */
export function documentTitle(document: NamedDocument): string {
  const title = document.title.trim();
  if (title !== "") return title;
  return document.kind === "single" ? document.slug : "Untitled";
}
