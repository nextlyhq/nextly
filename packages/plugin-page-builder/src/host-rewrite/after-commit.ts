/**
 * Re-queueing a host written while its component is fenced.
 *
 * The fence refuses a write that ADDS a reference, but a write that keeps one
 * already stored is allowed, and two such writes race the rewrite: an author's
 * save judged before the rewrite converted the host, and committed after it,
 * puts the reference back. Neither commit order may lose the author's edit, so
 * the rewrite does not fight it. After every committed write, a document still
 * holding a reference to a fenced component is marked pending in that run, and
 * the run goes back to its converting walk, which converts it again from what
 * the author saved.
 *
 * After commit, because only then is the stored value the one a later read
 * sees. A failure here is logged, never thrown: the write has committed, and
 * the run's final walk reads every document again regardless.
 *
 * @module host-rewrite/after-commit
 */
import {
  componentReferencesIn,
  isPlainRecord,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";

import { asDocument } from "../component-store-source";
import { SINGLE_HOOK_NAMESPACE } from "../write-target";

import { documentKeyOf } from "./contract";
import type { FenceStore } from "./fence";
import type { ProgressStore } from "./progress";

/** The plugin capabilities the report needs, named structurally. */
export interface FencedWriteReportContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: unknown) => unknown
    ): void;
  };
  logger: { error(message: string, meta?: Record<string, unknown>): void };
}

/** What the report is wired with. */
export interface FencedWriteReportArgs {
  readonly ctx: FencedWriteReportContext;
  readonly fence: () => Pick<FenceStore, "fenced">;
  readonly progress: () => Pick<ProgressStore, "requeue">;
  readonly limits: () => DocumentLimits;
}

/** Register the report on every committed create and update. */
export function registerFencedWriteReport(args: FencedWriteReportArgs): void {
  for (const phase of ["afterCreate", "afterUpdate"] as const) {
    args.ctx.hooks.on(phase, "*", context => reportWrite(args, context));
  }
}

/** One committed write, as a report after it reads it. */
interface CommittedWrite {
  /** The collection written, or the Single's hook namespace and slug. */
  readonly collection: string;
  /** Every blocks document the write holds, as values of its data. */
  readonly documents: readonly unknown[];
  /** Which document was written, as the walk keys it; unknown without an id. */
  readonly at: ReturnType<typeof hookDocumentOf>;
}

/**
 * What a committed create or update holds: `undefined` for a write carrying no
 * blocks document, which is most of them, so its report reads nothing.
 */
function committedWrite(context: unknown): CommittedWrite | undefined {
  const fields = context as { collection?: unknown; data?: unknown };
  const data = fields.data;
  if (typeof fields.collection !== "string" || !isPlainRecord(data)) {
    return undefined;
  }
  const documents = Object.values(data).flatMap(value => {
    const document = asDocument(value);
    return document === null ? [] : [document];
  });
  if (documents.length === 0) return undefined;
  return {
    collection: fields.collection,
    documents,
    at: hookDocumentOf(fields.collection, data),
  };
}

/** Re-queue the written document when it holds a fenced reference. */
async function reportWrite(
  args: FencedWriteReportArgs,
  context: unknown
): Promise<void> {
  const written = committedWrite(context);
  if (written === undefined) return;
  const { documents, at } = written;
  const fields = { collection: written.collection };
  try {
    const fenced = await args.fence().fenced();
    if (fenced.size === 0) return;
    const held = fencedReferences(documents, fenced, args.limits().maxNodes);
    if (held.length === 0 || at === undefined) return;
    await args.progress().requeue(held, documentKeyOf(at));
  } catch (error) {
    args.ctx.logger.error(
      `[page-builder] a write to "${fields.collection}" holding a component ` +
        "that is being deleted was not re-queued; the deletion's final check " +
        "reads it again.",
      { collection: fields.collection, error }
    );
  }
}

/** The fenced components these documents reference: all, where one is unreadable. */
function fencedReferences(
  documents: readonly unknown[],
  fenced: ReadonlySet<string>,
  maxNodes: number
): string[] {
  const held = new Set<string>();
  for (const document of documents) {
    const placed = componentReferencesIn(document, maxNodes);
    for (const id of placed.complete ? placed.ids : [...fenced]) {
      if (fenced.has(id)) held.add(id);
    }
  }
  return [...held];
}

/** Which document a hook's write is to, as the walk keys it. */
export function hookDocumentOf(
  collection: string,
  data: Record<string, unknown>
):
  | { kind: "single"; slug: string }
  | { kind: "collection"; slug: string; id: string }
  | undefined {
  if (collection.startsWith(SINGLE_HOOK_NAMESPACE)) {
    return {
      kind: "single",
      slug: collection.slice(SINGLE_HOOK_NAMESPACE.length),
    };
  }
  const id = data.id;
  if (typeof id === "string" && id !== "") {
    return { kind: "collection", slug: collection, id };
  }
  return typeof id === "number"
    ? { kind: "collection", slug: collection, id: String(id) }
    : undefined;
}
