/**
 * What a document already holds, which a `"contentOnly"` lock lets it keep.
 *
 * A lock is measured against the blocks its slot starts with, and a block's
 * defaults can change after pages store it: a stored child then differs from
 * today's starting child with nobody having changed it. The engine keeps a
 * part a baseline already holds in the same place, so a save that leaves it,
 * or puts it back as it started, is not refused; only a third value is.
 *
 * Read only once a lock has been found broken, so a save breaking none reads
 * and composes nothing more than it did.
 *
 * @module lock-baselines
 */
import {
  COMPONENT_INSTANCE_TYPE,
  walkNodes,
  type BlockDocument,
  type DocumentLimits,
  type WorkAllowance,
} from "@nextlyhq/blocks-engine";
import type { PluginFieldWrite } from "@nextlyhq/plugin-sdk";

import {
  composeWithReads,
  type BoundedReader,
  type HeldLibrary,
} from "../composition-reading";

import { isForest } from "./blocks-document";

/**
 * The field's stored forms, the live one and the draft an editor's preview
 * reads, as the write reads them.
 *
 * Empty for a create, for a single, which has no entry id to read by, and
 * where a form cannot be read: each then measures the document against its
 * starting blocks alone, which refuses more and never less.
 */
export async function storedFormsOf(
  write: PluginFieldWrite | undefined,
  field: string
): Promise<BlockDocument[]> {
  if (write === undefined || write.kind !== "collection") return [];
  const id = write.id;
  if (id === undefined) return [];
  const forms: BlockDocument[] = [];
  for (const form of ["published", "draft"] as const) {
    try {
      const read = await write.readStored({
        collection: write.slug,
        id,
        field,
        form,
      });
      if (read.kind === "value" && isForest(read.value)) {
        forms.push(read.value as BlockDocument);
      }
    } catch {
      // Unreadable: measured against the starting blocks, as for a create.
    }
  }
  return forms;
}

/**
 * The composed documents a page's placements are measured against besides
 * their starting blocks: each stored form composed, and the page with every
 * placement as its component holds it. The second is what lets a page placing
 * a component for the first time keep what the component itself holds, which
 * the component's own save already judged.
 *
 * Composed with the same reader, library and allowance as the page itself.
 * Where the allowance runs out, what was composed is returned: a baseline
 * missing only measures more strictly.
 */
export async function lockBaselines(args: {
  document: BlockDocument;
  stored: readonly BlockDocument[];
  library: HeldLibrary;
  read: BoundedReader;
  limits: DocumentLimits;
  work: WorkAllowance;
}): Promise<unknown[]> {
  const { library, read, limits, work } = args;
  const hosts = [
    ...args.stored,
    placementsAsComponentsHoldThem(args.document, limits),
  ];
  const baselines: unknown[] = [];
  for (const host of hosts) {
    if (read.exhausted() || work.left <= 0) break;
    const composed = await composeWithReads({
      host,
      library,
      read,
      limits,
      work,
    });
    baselines.push(composed.composition.document);
  }
  return baselines;
}

/**
 * The document with each placement's own values and slot content removed, so
 * composing it draws every component as the component holds it.
 */
function placementsAsComponentsHoldThem(
  document: BlockDocument,
  limits: DocumentLimits
): BlockDocument {
  const copy = structuredClone(document);
  walkNodes(
    copy.nodes,
    node => {
      if (node.type !== COMPONENT_INSTANCE_TYPE) return;
      const own = node as unknown as Record<string, unknown>;
      const props = own.props;
      if (typeof props === "object" && props !== null) {
        delete (props as Record<string, unknown>).overrides;
      }
      delete own.slots;
    },
    { maxNodes: limits.maxNodes }
  );
  return copy;
}
