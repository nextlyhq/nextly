/**
 * A component's own save against the locks it holds: a variant that changes
 * a block the component locks in Layers, and an exposure this save adds that
 * drives something a `contentOnly` lock holds.
 *
 * Part of the blocks field's composition checks. `blocks-composition.ts` is
 * the entry, and its header explains the rules.
 *
 * @module fields/blocks-composition-component-locks
 */
import {
  contentOnlyExposures,
  registryBlockSource,
  registryNestingSource,
  variantLockChanges,
  variantNamesIn,
  type BlockDocument,
  type ComponentDocument,
  type DocumentLimits,
  type LockedExposure,
} from "@nextlyhq/blocks-engine";
import type {
  PluginFieldValidateArgs,
  PluginFieldWrite,
} from "@nextlyhq/plugin-sdk";

import type { ComponentStoreAddress } from "../component-cycle-guard";
import {
  heldLibrary,
  type BoundedReader,
  type HeldLibrary,
} from "../composition-reading";

import {
  lookupOf,
  type issueReport,
  type Report,
} from "./blocks-composition-faults";
import { readEveryPlacedDefinition } from "./blocks-composition-own-document";
import type { CompositionSetup } from "./blocks-composition-setup";
import { isForest } from "./blocks-document";
import { LAYERS_LOCK_CHANGED, variantLockMessage } from "./layers-lock-wording";
import { readStoredForms } from "./lock-baselines";

/**
 * Refuse a component save whose variant changes a block the component locks
 * in Layers (`variantLockChanges`), naming the block and the variant.
 *
 * Judged against the WRITTEN component's locks, so a lock this save adds holds
 * over a variant already stored, and a create is judged as well as an update.
 * Drawn with the library a full composition reads, surveyed through every
 * component the written and stored forms place, so a variant reaching a block
 * locked inside a nested component is seen. A variant the stored component
 * already drew the same way is kept. A localized field whose language store
 * is not ready is kept unjudged, as the page's own locks are.
 */
export async function judgeVariantLocks(args: {
  document: BlockDocument;
  args: Pick<PluginFieldValidateArgs, "path" | "write"> &
    Partial<Pick<PluginFieldValidateArgs, "field">>;
  setup: CompositionSetup;
  read: BoundedReader;
  report: Report;
}): Promise<void> {
  const { document, setup, read, report } = args;
  const { path, write, field } = args.args;
  if ((variantNamesIn(document) ?? []).length === 0) return;
  const stored = await readStoredForms(write, path, [true], isLocalized(field));
  if (!stored.readable) return;
  const [newest] = stored.forms;
  const library = await placedLibrary(
    [document, ...(newest === undefined ? [] : [newest])],
    read,
    setup.limits
  );
  const changes = variantLockChanges(document, newest, {
    limits: setup.limits,
    components: lookupOf(library),
  });
  const label = fieldLabel(field, path);
  for (const change of changes) {
    report.add(LAYERS_LOCK_CHANGED, `${label}: ${variantLockMessage(change)}`);
  }
}

/** Whether a field is kept per language. */
function isLocalized(
  field: Partial<Pick<PluginFieldValidateArgs, "field">>["field"]
): boolean {
  return (field as { localized?: unknown } | undefined)?.localized === true;
}

/** A field's label for an issue, or its path where it has none. */
function fieldLabel(
  field: Partial<Pick<PluginFieldValidateArgs, "field">>["field"],
  path: string
): string {
  return typeof field?.label === "string" && field.label !== ""
    ? field.label
    : path;
}

/** Every component the documents place, read into one library. */
async function placedLibrary(
  documents: readonly BlockDocument[],
  read: BoundedReader,
  limits: DocumentLimits
): Promise<HeldLibrary> {
  const library = heldLibrary();
  for (const placing of documents) {
    await readEveryPlacedDefinition(placing, library, read, limits);
  }
  return library;
}

/**
 * Refuse an exposure this save adds that drives something a `contentOnly` lock
 * holds, and report the ones the component already stored.
 *
 * Refused where it is MADE, so the designer meets the lock in the component
 * rather than on every page that places it. One the stored version already
 * held is kept: refusing it would make the component unsavable for an edit
 * unrelated to it. "Added" covers a lock that tightens around an exposure too,
 * by moving its node into a locked slot: before the save it was not among
 * these. A lock tightened by a block's own new definition reaches both sides
 * of the comparison, so it warns rather than refuses.
 */
export async function judgeLockedExposures(
  document: BlockDocument,
  write: PluginFieldWrite,
  setup: CompositionSetup,
  report: ReturnType<typeof issueReport>
): Promise<void> {
  const sources = {
    definitions: registryBlockSource(),
    nesting: registryNestingSource(),
  };
  const after = contentOnlyExposures(document as ComponentDocument, sources);
  if (after.length === 0) return;
  const stored = await storedOwnDocument(write, setup.store);
  const before = new Set(
    (stored === undefined
      ? []
      : contentOnlyExposures(stored as ComponentDocument, sources)
    ).map(exposureKey)
  );
  const kept = after.filter(entry => before.has(exposureKey(entry)));
  for (const entry of after) {
    if (before.has(exposureKey(entry))) continue;
    report.add(
      "COMPONENT_EXPOSURE_LOCKED",
      lockedExposureMessage(entry, write.id)
    );
  }
  if (kept.length > 0 && write.id !== undefined) {
    setup.onLockedExposures?.({ componentId: write.id, exposures: kept });
  }
}

/** An exposure as the comparison knows it: what it drives, wherever it is. */
function exposureKey(entry: LockedExposure): string {
  return [entry.exposureId, entry.nodeId, entry.propPath].join("\u0000");
}

/** The component's own document as stored before this save, if it has one. */
async function storedOwnDocument(
  write: PluginFieldWrite,
  store: ComponentStoreAddress
): Promise<BlockDocument | undefined> {
  if (write.id === undefined) return undefined;
  const read = await write.readStored({
    collection: store.collection,
    id: write.id,
    field: store.field,
    form: "draft",
  });
  return read.kind === "value" && isForest(read.value)
    ? (read.value as BlockDocument)
    : undefined;
}

/** The refusal for one exposure, naming what to do about it. */
function lockedExposureMessage(
  entry: LockedExposure,
  componentId?: string
): string {
  const component =
    componentId === undefined ? "This component" : `Component "${componentId}"`;
  return `${component} exposes "${entry.label}" (${entry.propPath}), which sits in the "${entry.slot}" slot of a "${entry.holderType}" locked "contentOnly", where only content can change. Expose a content field instead, remove this exposure, or loosen the lock on that slot.`;
}
