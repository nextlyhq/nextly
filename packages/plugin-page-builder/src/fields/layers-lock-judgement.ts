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
 * only for one of those, so a blocks field inside a group or a repeater cannot
 * be judged, and the server log says so.
 */
function isTopLevel(path: string): boolean {
  return path !== "" && !/[.[\]]/.test(path);
}

/**
 * Whether a write's Layers locks are asked about at all: an update, with an
 * entry write behind it to read the stored value through. A nested field is
 * asked about too, so that it is reported unjudged rather than passed in
 * silence.
 */
export function judgesLayersLocks(args: PluginFieldValidateArgs): boolean {
  return args.mode === "update" && args.write !== undefined;
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
      ? `${block} is locked in Layers, and this write would remove it. A locked block, or a block holding one, can't be removed in the save that unlocks it: unlock it and save first, then remove it.`
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
 * The issues each broken lock is refused with. One wording for every path
 * that judges a write, the field's validation and the guard on an emptied
 * field alike.
 */
export function layersLockIssuesFor(
  changes: readonly LayersLockChange[],
  path: string,
  label: string
): PluginFieldIssue[] {
  return changes.map(change => issueFor(change, path, label));
}

/**
 * The issues a write breaking a Layers lock is refused with; empty when it
 * keeps every lock or is a create.
 *
 * Two values cannot be read, so their locks cannot be judged: a blocks field
 * inside a group or a repeater, and a translated field whose language store is
 * not ready. The write is kept, and `onUnjudged` is told so the server log says
 * which document went unprotected and why. Any other failure to read
 * propagates and fails the write, rather than passing a write unjudged.
 */
export async function layersLockIssues(
  value: unknown,
  args: PluginFieldValidateArgs,
  label: string,
  onUnjudged?: (found: LayersLockUnjudged) => void
): Promise<PluginFieldIssue[]> {
  if (!judgesLayersLocks(args) || args.write === undefined) return [];
  if (!isTopLevel(args.path)) {
    onUnjudged?.({
      field: args.path,
      ...documentOf(args.write),
      reason: "nested-field",
    });
    return [];
  }
  const stored = await readStoredForms(
    args.write,
    args.path,
    // The draft form alone: what an editor's preview reads, the working draft
    // where one is shown and the live row otherwise, so the newest stored form.
    [true],
    (args.field as { localized?: unknown }).localized === true
  );
  if (!stored.readable) {
    onUnjudged?.({
      field: args.path,
      ...documentOf(args.write),
      reason: "language-not-ready",
    });
    return [];
  }
  const [newest] = stored.forms;
  if (newest === undefined) return [];
  return layersLockIssuesFor(
    layersLockChanges(value, newest),
    args.path,
    label
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
