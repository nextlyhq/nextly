"use client";

/**
 * The repair of a page whose locked areas hold what their locks don't allow,
 * or whose blocks sit where the placement rule refuses them.
 *
 * A page stored before its locks or the placement rule were enforced, or
 * written by an import, can hold blocks a locked area may not, a design inside
 * an area locked to its content, or a block where it isn't allowed: a Button
 * inside a linked Card, say. The editor goes on editing such a page, refusing
 * only a new break, and a save refuses or warns; this offers to put it right.
 * It shows each step first, in words, and changes nothing until the author
 * confirms; the repair is then one edit, which undo takes back. No block the
 * author placed is removed: the engine's planner moves what an area may not
 * hold to just after it, and a misplaced block to the nearest place it is
 * allowed.
 *
 * @module repair-notice
 */
import {
  findNode,
  type RepairPlan,
  type RepairStep,
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

  // Nothing to say on a page every lock and the placement rule allow. A page
  // whose only breaks are ones the plan can't repair still says so, with
  // nothing to confirm: hiding the notice would read as a page the next save
  // accepts.
  if (!holdsAnything(plan)) return null;

  const confirm = () => {
    // The plan shown is this render's, made for the store as it stands: a
    // save or an edit since the review gives the store, and so this plan, a
    // new identity, and the list on screen with it. Planning again here would
    // mint new ids for every block an add step brings, so no plan could ever
    // match the one reviewed.
    const translated = repairOps(editor.document, plan, editor.limits);
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
        Repair this page
      </h2>
      <p className="nx-inspector__note">{introSentence(plan)}</p>
      {plan.steps.length === 0 ? (
        <UnrepairableNote plan={plan} />
      ) : reviewing ? (
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
      {/* Said before the author confirms, so a repair that leaves a break is
          never taken for one that fixes the page. */}
      <UnrepairableNote plan={plan} />
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

/**
 * That some breaks have no repair here, whatever else is repaired: one
 * sentence for the locks and one for the placements the plan leaves, each
 * only when it leaves some. Nothing when it leaves none.
 */
function UnrepairableNote({
  plan,
}: {
  plan: RepairPlan;
}): React.JSX.Element | null {
  const locks = plan.remaining.length > 0;
  const placements = plan.remainingPlacements.length > 0;
  if (!locks && !placements) return null;
  return (
    <>
      {locks ? (
        <p className="nx-inspector__note">
          Some locked areas can’t be repaired here: a block they hold has
          nowhere else it may go. Those stay as they are.
        </p>
      ) : null}
      {placements ? (
        <p className="nx-inspector__note">
          Some blocks can’t be repaired here: there is nowhere else on this page
          they may go. Those stay where they are.
        </p>
      ) : null}
    </>
  );
}

/** Whether the plan has anything to repair or to say it can't. */
function holdsAnything(plan: RepairPlan): boolean {
  return (
    plan.steps.length > 0 ||
    plan.remaining.length > 0 ||
    plan.remainingPlacements.length > 0
  );
}

/** A move the placement rule makes, as opposed to one a lock makes. */
function isPlacementMove(step: RepairStep): boolean {
  return step.kind === "move" && step.cause === "placement";
}

/**
 * What the page holds, naming locks and placements each only when the plan
 * repairs or leaves one of that kind.
 */
function introSentence(plan: RepairPlan): string {
  const locks =
    plan.remaining.length > 0 ||
    plan.steps.some(step => !isPlacementMove(step));
  const placements =
    plan.remainingPlacements.length > 0 || plan.steps.some(isPlacementMove);
  const lockWords =
    "Some locked areas on this page hold blocks or settings their lock doesn’t allow";
  if (locks && placements) {
    return `${lockWords}, and some blocks sit where they aren’t allowed.`;
  }
  if (placements)
    return "Some blocks on this page sit where they aren’t allowed.";
  return `${lockWords}.`;
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
