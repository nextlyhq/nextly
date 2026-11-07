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
  type DeleteProgress,
  type DocumentList,
  type LeftDocument,
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

/** One call: a slice of the dry run, or one step of the delete. */
async function call(
  componentId: string,
  body: object,
  unexplained: string
): Promise<DeleteCall> {
  try {
    const answer = await writePluginRoute<Envelope>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: pathOf(componentId),
      // `{}` starts or steps the delete; the route refuses any key but
      // `dryRun` and `after`, so a typo can never start one.
      body,
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

/**
 * One slice of what deleting would do, changing nothing: the first slice, or
 * the one starting at `after`, the cursor the last slice answered.
 */
export function checkComponentDelete(
  componentId: string,
  after: string | null
): Promise<DeleteCall> {
  return call(
    componentId,
    after === null ? { dryRun: true } : { dryRun: true, after },
    UNCHECKED
  );
}

/** Start the caller's delete, or carry it on by one step. */
export function stepComponentDelete(componentId: string): Promise<DeleteCall> {
  return call(componentId, {}, UNEXPLAINED);
}

/** Whether an answer says the delete is still under way. */
export function underWay(result: ComponentDeleteResult): boolean {
  return result.status === "preflight" || result.status === "running";
}

/**
 * The dry run's slices, added up. Each slice answers only its own documents,
 * so the dialog's account of what the delete would do is the sum of the
 * slices read so far, and whole once a slice says it reached the last
 * document.
 */
export interface DeleteTally {
  readonly convert: DocumentList;
  readonly drafts: DocumentList;
  readonly mayBeRefused: number;
  readonly layouts: DocumentList;
  readonly left: readonly LeftDocument[];
  /** Whether every document has been read. */
  readonly complete: boolean;
}

const NO_DOCUMENTS: DocumentList = { named: [], unreadable: 0, more: 0 };

/** Nothing read yet. */
export const EMPTY_TALLY: DeleteTally = {
  convert: NO_DOCUMENTS,
  drafts: NO_DOCUMENTS,
  mayBeRefused: 0,
  layouts: NO_DOCUMENTS,
  left: [],
  complete: false,
};

/** A named document's identity, so one counted twice is listed once. */
function keyOf(document: NamedDocument): string {
  return JSON.stringify([document.kind, document.slug, document.id ?? null]);
}

/** Two slices' lists as one. */
function joined(a: DocumentList, b: DocumentList | undefined): DocumentList {
  if (b === undefined) return a;
  const seen = new Set(a.named.map(keyOf));
  return {
    named: [
      ...a.named,
      ...b.named.filter(document => !seen.has(keyOf(document))),
    ],
    unreadable: a.unreadable + b.unreadable,
    more: a.more + b.more,
  };
}

/** The tally with one more slice's answer added. */
export function addSlice(
  tally: DeleteTally,
  result: ComponentDeleteResult
): DeleteTally {
  const plan = result.plan;
  return {
    convert: joined(tally.convert, plan?.convert),
    drafts: joined(tally.drafts, plan?.drafts),
    mayBeRefused: tally.mayBeRefused + (plan?.mayBeRefused ?? 0),
    layouts: joined(tally.layouts, result.layouts),
    left: [...tally.left, ...(result.left ?? [])],
    // A dry run that answers no plan has nothing more to read.
    complete: plan === undefined || plan.complete,
  };
}

/** Whether what was read so far stops the delete: it cannot be undone by more. */
export function tallyRefuses(tally: DeleteTally): boolean {
  return tally.left.length > 0 || documentCount(tally.layouts) > 0;
}

/**
 * The documents that use it, as read so far: those whose copies are turned
 * into plain blocks and those holding unpublished changes, as one list. A
 * document in both is named once. The ones only counted (unreadable, or past
 * what a list names) cannot be matched across the two lists, so where both
 * count some, the larger count stands and the total is only a floor.
 */
export function usingDocuments(tally: DeleteTally): {
  readonly list: DocumentList;
  /** Whether the count may be short of the true one. */
  readonly floor: boolean;
} {
  const { convert, drafts } = tally;
  const seen = new Set(convert.named.map(keyOf));
  const unnamed = (a: number, b: number): number =>
    a > 0 && b > 0 ? Math.max(a, b) : a + b;
  return {
    list: {
      named: [
        ...convert.named,
        ...drafts.named.filter(document => !seen.has(keyOf(document))),
      ],
      unreadable: unnamed(convert.unreadable, drafts.unreadable),
      more: unnamed(convert.more, drafts.more),
    },
    floor:
      (convert.unreadable > 0 && drafts.unreadable > 0) ||
      (convert.more > 0 && drafts.more > 0),
  };
}

/** How many documents use it, as read so far: {@link usingDocuments} counted. */
export function tallyUses(tally: DeleteTally): number {
  return documentCount(usingDocuments(tally).list);
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
