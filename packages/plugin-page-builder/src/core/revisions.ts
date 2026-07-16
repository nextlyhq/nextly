/**
 * Revisions & autosave (spec §J). React-free. Pure snapshot/prune helpers; persistence
 * rides a plugin-owned collection and restore reuses the reducer's REPLACE action.
 * Timestamps/ids are passed in (the isomorphic core has no clock/RNG).
 */
import type { BlockDocument } from "./types";

export interface Revision {
  id: string;
  label: string;
  createdAt: string;
  tree: BlockDocument;
}

export function createRevision(
  doc: BlockDocument,
  label: string,
  id: string,
  createdAt: string
): Revision {
  return { id, label, createdAt, tree: structuredClone(doc) };
}

/** Keep at most `max` revisions, dropping the oldest. */
export function pruneRevisions(list: Revision[], max: number): Revision[] {
  if (max <= 0) return [];
  return list.length <= max ? list : list.slice(list.length - max);
}
