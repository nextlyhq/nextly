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
  migrateDocument,
  type BlockDocument,
  type LayersLockChange,
  type MigrationSource,
} from "@nextlyhq/blocks-engine";
import type {
  PluginFieldIssue,
  PluginFieldValidateArgs,
  PluginFieldValidationResult,
} from "@nextlyhq/plugin-sdk";

import {
  acceptedForms,
  lockTargetOf,
  openRemovalFor,
  type OpenRemovalReader,
} from "../breakpoint-removal/lock-acceptance";

import { documentOf, type LayersLockUnjudged } from "./blocks-composition";
import { isForest } from "./blocks-document";
import { LAYERS_LOCK_CHANGED, pageLockMessage } from "./layers-lock-wording";
import { readStoredForms } from "./lock-baselines";

/**
 * Whether a field path names a top-level field. A stored value can be read
 * only for one of those, so a blocks field inside a group or a repeater cannot
 * be judged, and the server log says so.
 */
export function isTopLevel(path: string): boolean {
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

/**
 * Inside a field rewrite the plugin makes, the copy being decided, as the one
 * stored form its new value replaces: a rewrite changes the live copy and each
 * draft from its own value, so the live copy is judged against the live value,
 * not the newer draft beside it. `undefined` anywhere else
 * (`host-rewrite/rewrite-scope`).
 */
async function copyInRewrite(
  field: string
): Promise<{ forms: BlockDocument[]; readable: boolean } | undefined> {
  // Imported at call time: it is server-only, and this module is not.
  const { rewriteBaseline } = await import("../host-rewrite/rewrite-scope");
  const baseline = rewriteBaseline(field);
  if (baseline === undefined) return undefined;
  const { stored } = baseline;
  return {
    forms: isForest(stored) ? [stored as BlockDocument] : [],
    readable: true,
  };
}

/** The issues each broken lock is refused with. */
function layersLockIssuesFor(
  changes: readonly LayersLockChange[],
  path: string,
  label: string
): PluginFieldIssue[] {
  return changes.map(change => ({
    path,
    code: LAYERS_LOCK_CHANGED,
    message: `${label}${change.path}: ${pageLockMessage(change)}`,
  }));
}

/**
 * The issues a write breaking a Layers lock is refused with; empty when it
 * keeps every lock or is a create. An emptied field (`null`) is judged too:
 * every locked block it held would be removed.
 *
 * While a breakpoint removal is open, a write whose locked blocks equal the
 * newest stored form with the removed breakpoints' values stripped is kept:
 * that strip is the removal's own write. While its undo is open, one equal to
 * that form with what the removal kept put back is kept the same way
 * (`breakpoint-removal/lock-acceptance`).
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
  onUnjudged?: (found: LayersLockUnjudged) => void,
  openRemoval?: OpenRemovalReader,
  /**
   * The site's block versions and upgrade steps. The write and the stored
   * form are compared with every block upgraded, as the editor holds them:
   * a block stored at an older version reaches the save upgraded by the
   * editor that opened it, and must not read as a locked block changed.
   */
  migration?: MigrationSource
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
  const stored =
    (await copyInRewrite(args.path)) ??
    (await readStoredForms(
      args.write,
      args.path,
      // The draft form alone: what an editor's preview reads, the working draft
      // where one is shown and the live row otherwise, so the newest stored form.
      [true],
      (args.field as { localized?: unknown }).localized === true
    ));
  if (!stored.readable) {
    onUnjudged?.({
      field: args.path,
      ...documentOf(args.write),
      reason: "language-not-ready",
    });
    return [];
  }
  const [held] = stored.forms;
  if (held === undefined) return [];
  const upgrade = upgradedBy(migration);
  const newest = upgrade(held);
  const written = upgrade(value);
  const changes = layersLockChanges(written, newest);
  if (changes.length === 0) return [];
  // Asked only once a lock is broken, so a write breaking none reads nothing.
  const work = await openRemovalFor(openRemoval, args.write);
  const accepted =
    work === null
      ? []
      : await acceptedForms(
          [newest],
          work,
          lockTargetOf(args.write, args.path)
        );
  if (accepted.some(form => layersLockChanges(written, form).length === 0)) {
    return [];
  }
  return layersLockIssuesFor(changes, args.path, label);
}

/**
 * A value with every block in it upgraded to its current version, for a
 * comparison only; never stored. A value that is not a document, and every
 * value when no migration source was given, is compared as it came.
 */
function upgradedBy(
  migration: MigrationSource | undefined
): <T>(value: T) => T {
  return value =>
    migration === undefined || !isForest(value)
      ? value
      : (migrateDocument(value as BlockDocument, migration)
          .doc as typeof value);
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
