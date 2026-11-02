/**
 * A blocks field's write, judged against the Layers locks of the document it
 * would replace.
 *
 * The editor refuses an edit to a locked block before it happens, op by op. A
 * write through the API or by an agent carries a whole document and no ops, so
 * the save compares it with what is stored: a node locked there may not change,
 * move or disappear unless the same write unlocks it (`layersLockChanges`).
 * The lock is a convenience anyone who may edit the document can lift, never a
 * permission; this guards against the accidental change, and access is still
 * the collection's rules' to decide.
 *
 * Judged against the NEWEST stored form, the working draft where there is one
 * and the live row otherwise, because that is the document the author last
 * saw and locked. Read in the language the write is judged in.
 *
 * @module fields/layers-lock-judgement
 */
import {
  layersLockChanges,
  type LayersLockChange,
} from "@nextlyhq/blocks-engine";
import type {
  PluginFieldIssue,
  PluginFieldValidateArgs,
  PluginFieldValidationResult,
} from "@nextlyhq/plugin-sdk";

import { documentOf, type LayersLockUnjudged } from "./blocks-composition";
import { readStoredForms } from "./lock-baselines";

/** The issue code a write breaking a Layers lock is refused with. */
export const LAYERS_LOCK_CHANGED = "layers-lock-changed";

/**
 * Whether a field path names a top-level field. A stored value can be read
 * only for one of those, so a blocks field inside a group or a repeater is not
 * judged here.
 */
function isTopLevel(path: string): boolean {
  return path !== "" && !/[.[\]]/.test(path);
}

/**
 * Whether a write's Layers locks are judged at all: an update of a top-level
 * field, with an entry write behind it to read the stored value through.
 */
export function judgesLayersLocks(args: PluginFieldValidateArgs): boolean {
  return (
    args.mode === "update" && args.write !== undefined && isTopLevel(args.path)
  );
}

/** What one broken lock is refused with, naming the block and the way on. */
function issueFor(
  change: LayersLockChange,
  path: string,
  label: string
): PluginFieldIssue {
  const block = `"${change.label}"`;
  const message =
    change.kind === "removed"
      ? `${block} is locked in Layers, and this write would remove it. Unlock it and save, then remove it.`
      : `${block} is locked in Layers, and this write would ${
          change.kind === "moved" ? "move it" : "change it or a block inside it"
        }. Send it unlocked in the same write to change it.`;
  return {
    path,
    code: LAYERS_LOCK_CHANGED,
    message: `${label}${change.path}: ${message}`,
  };
}

/**
 * The issues a write breaking a Layers lock is refused with; empty when it
 * keeps every lock, is a create, or names a nested field.
 *
 * A translated field whose language store is not ready cannot be read, so its
 * locks cannot be judged: the write is kept, and `onUnjudged` is told so the
 * server log says which document went unprotected. Any other failure to read
 * propagates and fails the write, rather than passing a write unjudged.
 */
export async function layersLockIssues(
  value: unknown,
  args: PluginFieldValidateArgs,
  label: string,
  onUnjudged?: (found: LayersLockUnjudged) => void
): Promise<PluginFieldIssue[]> {
  if (!judgesLayersLocks(args) || args.write === undefined) return [];
  const stored = await readStoredForms(
    args.write,
    args.path,
    // The draft form alone: what an editor's preview reads, the working draft
    // where one is shown and the live row otherwise, so the newest stored form.
    [true],
    (args.field as { localized?: unknown }).localized === true
  );
  if (!stored.readable) {
    onUnjudged?.({ field: args.path, ...documentOf(args.write) });
    return [];
  }
  const [newest] = stored.forms;
  if (newest === undefined) return [];
  return layersLockChanges(value, newest).map(change =>
    issueFor(change, args.path, label)
  );
}

/**
 * A verdict with the Layers lock's issues added, keeping `true` only when
 * neither found a problem.
 */
export function withLockIssues(
  verdict: PluginFieldValidationResult,
  locks: readonly PluginFieldIssue[],
  path: string
): PluginFieldValidationResult {
  if (locks.length === 0) return verdict;
  if (verdict === true) return [...locks];
  if (typeof verdict === "string") {
    return [{ path, message: verdict }, ...locks];
  }
  return [...verdict, ...locks];
}
