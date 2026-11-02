"use client";

/**
 * The repair of a page whose locked areas hold what their locks don't allow.
 *
 * A page stored before its locks were enforced, or written by an import, can
 * hold blocks a locked area may not, or a design inside an area locked to its
 * content. The editor goes on editing such a page, refusing only a new break,
 * and a save refuses the blocks a locked area may not hold; this offers to put
 * it right. It shows each step first, in words, and changes nothing
 * until the author confirms; the repair is then one edit, which undo takes
 * back. No block the author placed is removed: the engine's planner moves
 * what an area may not hold to just after it.
 *
 * @module repair-notice
 */
import {
  findNode,
  sameStoredValue,
  type RepairPlan,
} from "@nextlyhq/blocks-engine";
import { Button } from "@nextlyhq/ui";
import * as React from "react";

import type { EditorState } from "./editor-state";
import { blockLabel } from "./inserter";
import { repairStepSentence } from "./lock-refusal";
import { repairOps, type RepairRefusal } from "./repair-ops";

/**
 * The notice, shown only while the document holds something to repair.
 *
 * Planned again whenever the document changes, so an edit that fixes an area
 * by hand, or an undo that brings a break back, is reflected straight away.
 */
export function RepairNotice({
  editor,
}: {
  editor: EditorState;
}): React.JSX.Element | null {
  // The store's object changes with every document it holds, so this plans
  // once per document rather than once per render.
  const plan = React.useMemo(() => editor.planRepair(), [editor]);
  const [reviewing, setReviewing] = React.useState(false);
  const [refused, setRefused] = React.useState<string | undefined>();
  const headingId = React.useId();

  if (plan.steps.length === 0) return null;

  const confirm = () => {
    // Planned again at the moment of confirming, against the store's current
    // baseline: a save since the review may have changed what the page holds,
    // and the author confirms the steps they were shown or none.
    const fresh = editor.planRepair();
    if (!sameStoredValue(fresh.result.nodes, plan.result.nodes)) {
      setRefused(
        "The page has changed since this repair was planned. Review it again."
      );
      return;
    }
    const translated = repairOps(editor.document, fresh, editor.limits);
    if ("refused" in translated) {
      setRefused(refusalSentence(translated.refused, editor));
      return;
    }
    if (editor.applyAll(translated.ops) === null) {
      setRefused("This repair could not be applied here. Nothing was changed.");
      return;
    }
    setReviewing(false);
    setRefused(undefined);
  };

  return (
    <section className="nx-lock-repair" aria-labelledby={headingId}>
      <h2 id={headingId} className="nx-lock-repair__title">
        Locked areas
      </h2>
      <p className="nx-inspector__note">
        Some locked areas on this page hold blocks or settings their lock
        doesn’t allow.
      </p>
      {reviewing ? (
        <RepairReview
          plan={plan}
          editor={editor}
          refused={refused}
          onConfirm={confirm}
          onCancel={() => {
            setReviewing(false);
            setRefused(undefined);
          }}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setReviewing(true)}
        >
          Review the repair
        </Button>
      )}
    </section>
  );
}

/** The steps, in the order the repair takes them, and the choice. */
function RepairReview({
  plan,
  editor,
  refused,
  onConfirm,
  onCancel,
}: {
  plan: RepairPlan;
  editor: EditorState;
  refused: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <>
      <ol className="nx-lock-repair__steps">
        {plan.steps.map((step, index) => (
          // Steps have no identity of their own; a plan is replaced whole.
          <li key={index}>{repairStepSentence(step, editor.document)}</li>
        ))}
      </ol>
      <p className="nx-inspector__note">
        No block is removed, and nothing changes until you repair.
      </p>
      {plan.remaining.length === 0 ? null : (
        // Said before the author confirms, so a repair that leaves a break is
        // never taken for one that fixes the page.
        <p className="nx-inspector__note">
          Some locked areas can’t be repaired here: a block they hold has
          nowhere else it may go. Those stay as they are.
        </p>
      )}
      {refused === undefined ? null : (
        <p className="nx-inspector__note" role="alert">
          {refused}
        </p>
      )}
      <div className="nx-lock-repair__actions">
        <Button type="button" size="sm" onClick={onConfirm}>
          Repair
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}

/** Why the repair can't be applied, and what the author can do about it. */
function refusalSentence(refusal: RepairRefusal, editor: EditorState): string {
  if (refusal.reason === "unplaceable") {
    return "This repair could not be applied here. Nothing was changed.";
  }
  const node = findNode(editor.document.nodes, refusal.nodeId);
  const name = node === undefined ? "A block" : blockLabel(node.type);
  return `${name} is locked, and the repair moves it. Unlock it, then repair.`;
}
