/**
 * The editor's lock answers, kept per document version and per edit.
 *
 * Whether the locks allow an edit is answered by trying the edit on a copy of
 * the page, which costs a walk of the whole page. The toolbar's menu, the
 * block's context menu, the Layers row menu and a keystroke can each ask the
 * same question of the same page, so the answer is kept against the document
 * it was asked of and the ops it was asked about: one version is tried at most
 * once per edit, whichever surface asks first.
 *
 * Kept by the document object itself. Documents are immutable values in the
 * editor, so an edit makes a new one and the answers for the old one are never
 * read again; they go with it when it is garbage collected. Anything else the
 * answer reads (the saved page, the lock sources, the component definitions)
 * is handed in as `scope`, and a different scope starts afresh.
 *
 * @module kept-lock-answers
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";

import type { LockRefusalFacts } from "./lock-refusal";
import type { BuilderOp } from "./op-vocabulary";

/** One answer kept: `undefined` facts are kept too, as "no lock refuses it". */
interface Kept {
  readonly facts: LockRefusalFacts | undefined;
}

/** The lock answers for one editor, kept until what they read changes. */
export interface KeptLockAnswers {
  /**
   * The answer for `ops` on `document`, worked out by `work` the first time it
   * is asked under this `scope`, and read back after that.
   */
  answer(
    document: BlockDocument,
    ops: readonly BuilderOp[],
    scope: readonly unknown[],
    work: () => LockRefusalFacts | undefined
  ): LockRefusalFacts | undefined;
}

/** An empty set of kept answers. */
export function keptLockAnswers(): KeptLockAnswers {
  let byDocument = new WeakMap<BlockDocument, Map<string, Kept>>();
  let keptScope: readonly unknown[] = [];
  return {
    answer(document, ops, scope, work) {
      if (!sameScope(keptScope, scope)) {
        byDocument = new WeakMap();
        keptScope = [...scope];
      }
      let answers = byDocument.get(document);
      if (answers === undefined) {
        answers = new Map();
        byDocument.set(document, answers);
      }
      // The ops as written: two asks about the same edit spell it the same.
      const key = JSON.stringify(ops);
      const kept = answers.get(key);
      if (kept !== undefined) return kept.facts;
      const facts = work();
      answers.set(key, { facts });
      return facts;
    },
  };
}

/** Whether two scopes hold the same values, compared by identity. */
function sameScope(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
