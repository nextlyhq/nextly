"use client";

/**
 * What a Style tab field reads and writes: the selected block or a shared
 * style it wears, the styles and cascade of that target, whether it can be
 * edited, and the writes that set a value or move it to a shared style.
 *
 * @module style-field-target
 */
import {
  findNode,
  type NodeStyles,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import {
  batchStyleClearOps,
  batchStyleWriteOps,
  batchStyleWritesOps,
} from "./batch-style";
import { isElement } from "./dom-kind";
import type { EditorState } from "./editor-state";
import {
  designIsWritable,
  designReadOnlyReason,
  lockViewOf,
} from "./inspector";
import {
  moveToSharedStyleClear,
  planMoveToSharedStyle,
  sharedStyleChange,
  sharedStyleWrite,
} from "./shared-style-target";
import { useSurvivingReport } from "./shell/builder-notices";
import {
  type ProvenanceOf,
  StyleTargetContext,
  type CommitOutcome,
} from "./style-field-surroundings";
import type { StyleTarget } from "./style-target";
import {
  readStyleValue,
  type StyleAddress,
  type StylePolicy,
} from "./style-values";

/**
 * Apply one control's edit to the document, and say what happened to it.
 *
 * Lifted out of the field because it is a different question from drawing one:
 * the field owns what the author is looking at, and this owns the write — which
 * of two ops to build, which refusals are reportable, and which of the three
 * outcomes each produces.
 *
 * Read the node at COMMIT TIME rather than closing over one. A field committing
 * on blur can fire after another edit has already replaced the node, and
 * writing from the older copy would resurrect its styles.
 */
function writeStyleValue({
  editor,
  nodeId,
  address,
  policy,
  value,
  setIssue,
  also = [],
}: {
  editor: EditorState;
  nodeId: string;
  address: StyleAddress;
  policy: StylePolicy | undefined;
  /** `null` clears, which is not the same as writing an empty value. */
  value: StyleValue | null;
  setIssue: (message: string | null) => void;
  /**
   * Other addresses set to the same value in the same op: the sides of a
   * margin set together. A clear is of `address` alone.
   */
  also?: readonly StyleAddress[];
}): CommitOutcome {
  const current = findNode(editor.document.nodes, nodeId);
  if (current === undefined) return "refused";
  /*
   * Refused here as well as drawn read-only: the controls are disabled while a
   * lock holds, but a lock set from Layers after the panel drew must stop the
   * next write too, so the live document is asked at the moment of the write.
   */
  if (!designIsWritable(editor.document, nodeId, lockViewOf(editor))) {
    setIssue("This block's design is locked, so it can't be changed here.");
    return "refused";
  }
  /*
   * A ONE-NODE BATCH, and the single write path for a style edit in this
   * builder.
   *
   * Not because this panel needs batching — it edits one block — but because
   * the alternative is two implementations of "what ops set this address".
   * They agree the day they are written: `batchStyleWriteOps` was in fact
   * written from this function. Then one of them learns something — a policy
   * that varies, a refusal worded differently, a value the other still
   * accepts — and the surface an author reaches through a multi-selection
   * behaves unlike the one they reach through a single click, for a reason no
   * test names because each path passes its own.
   *
   * A group of one is exactly the single-op case: `applyAll(ops)` and
   * `apply(op)` are both `run(ops, "new")` in the store, so one op through
   * here costs one history entry and behaves identically. The batch layer is
   * therefore not a detour around the simple case — it IS the simple case,
   * with the count left open.
   */
  const write = styleWrite(current, address, also, value, policy);
  if (write.refused !== undefined) {
    setIssue(write.refused);
    return "refused";
  }
  setIssue(null);
  // No ops is the document already holding this value, which is the ordinary
  // case for a field blurred without being changed. Applying an empty group
  // would ask the op store for a history entry that undoes to no visible
  // effect, which it refuses.
  if (write.ops.length === 0) return "unchanged";
  // The store's own refusal, which the validator cannot anticipate: it judges
  // the edited leaf, while `applyOp` judges the whole document — a page at its
  // byte limit rejects an edit whose value is perfectly valid. Unreported, the
  // field goes on showing the draft and reads as saved while neither the
  // document nor the undo history moved.
  if (editor.applyAll(write.ops) === null) {
    setIssue("This edit could not be applied to the document.");
    return "refused";
  }
  return "applied";
}

/** The ops that write one address, or several to one value, or clear one. */
function styleWrite(
  current: Parameters<typeof batchStyleClearOps>[0][number],
  address: StyleAddress,
  also: readonly StyleAddress[],
  value: StyleValue | null,
  policy: StylePolicy | undefined
): ReturnType<typeof batchStyleClearOps> {
  if (value === null) return batchStyleClearOps([current], address, policy);
  if (also.length === 0) {
    return batchStyleWriteOps([current], address, value, policy);
  }
  return batchStyleWritesOps([current], [address, ...also], value, policy);
}

/** A shared style's name by its class name, from the styles the block wears. */
export function sharedStyleNamer(
  target: StyleTarget
): (slug: string) => string | undefined {
  return slug => target.worn.find(row => row.slug === slug)?.name;
}

/**
 * The provenance dots for the target: the block's, from the cascade, or none
 * for a shared target, whose values say where they come from in their own line.
 */
export function targetProvenance(
  target: StyleTarget,
  block: ProvenanceOf
): ProvenanceOf {
  return target.kind === "shared" ? () => undefined : block;
}

/**
 * Why the target's values can't be changed. The block's own locks for the
 * block; a shared target has its own reasons (locked, or no right to change
 * design), and the block's lock does not hold a site-wide style.
 */
export function targetReadOnly(
  target: StyleTarget,
  editor: EditorState,
  nodeId: string
): string | undefined {
  return target.kind === "shared"
    ? target.readOnly
    : designReadOnlyReason(editor.document, nodeId, lockViewOf(editor));
}

/**
 * The cascade the inspection judges which controls show by: the block's, or
 * none for a shared target, whose display is read from the style's own
 * styles, not from the block's cascade, which the block or a later style may
 * override.
 */
export function targetCascade<T>(
  target: StyleTarget,
  cascade: T
): T | undefined {
  return target.kind === "shared" ? undefined : cascade;
}

/** The values a shared target shows, or `undefined` while the block is the target. */
export function targetStyles(target: StyleTarget): NodeStyles | undefined {
  return target.kind === "shared" ? target.style.styles : undefined;
}

/** The block's own styles, and the styles a field shows for the target. */
export function fieldStyles(
  target: StyleTarget,
  editor: EditorState,
  nodeId: string
): { nodeStyles: NodeStyles | undefined; styles: NodeStyles | undefined } {
  const nodeStyles = findNode(editor.document.nodes, nodeId)?.styles;
  return { nodeStyles, styles: targetStyles(target) ?? nodeStyles };
}

/**
 * What one field edits (the block, or the shared style that is the target),
 * the value it shows, its refusal, and the writes it makes: a value (into the block, or into
 * the shared style), the block's Reset of an override, and Move to.
 */
/** Which target a write was made for: the block, or one shared style. */
export function targetKey(target: StyleTarget): string {
  return target.kind === "shared" ? `shared:${target.style.id}` : "block";
}

export function useFieldTarget({
  editor,
  nodeId,
  address,
  policy,
}: {
  editor: EditorState;
  nodeId: string;
  address: StyleAddress;
  policy: StylePolicy | undefined;
}): {
  target: StyleTarget;
  nodeStyles: NodeStyles | undefined;
  styles: NodeStyles | undefined;
  stored: StyleValue | undefined;
  issue: string | null;
  setIssue: (message: string | null) => void;
  /** The field's caption hold, spread onto its row. */
  caption: {
    "data-provenance-quiet": string | undefined;
    style: React.CSSProperties | undefined;
    onFocus: () => void;
    onBlur: (event: React.FocusEvent<HTMLElement>) => void;
  };
  commit: (value: StyleValue | null) => CommitOutcome;
  /**
   * This field's value written at other paths of its property as well, as one
   * edit: "Apply to: All sides" from a side of the spacing box.
   */
  commitSides: (
    paths: readonly (readonly string[])[],
    value: StyleValue
  ) => CommitOutcome;
  resetBlock: () => void;
  moveTo: (shared: Extract<StyleTarget, { kind: "shared" }>) => void;
} {
  const target = React.useContext(StyleTargetContext);
  // Read ONCE and shared by every lookup the field makes, so the control's
  // own value and its contrast partner cannot come from two different reads
  // of the document. A shared target's values are the style's own.
  const { nodeStyles, styles } = fieldStyles(target, editor, nodeId);
  const stored = readStyleValue(styles, address);
  const [issue, setIssue] = React.useState<string | null>(null);
  /*
   * Whether the provenance caption is held back. It is revealed while the
   * field has focus, and typing a value leaves focus there, so after a commit
   * the caption would linger over the row above; it waits for the field to be
   * focused again.
   */
  const [quiet, setQuiet] = React.useState(false);
  /*
   * Whether focus has left the field since the caption was held back. Only a
   * return after leaving is the author focusing it again: a pick or a clear
   * moves focus into the field by itself, and that must not bring the caption
   * back over the row above.
   */
  const left = React.useRef(false);
  const quieten = (): void => {
    left.current = false;
    setQuiet(true);
  };
  // Held back once the value here changes, however it changed: a pick, a
  // typed name, an undo or an edit from elsewhere, as well as a commit here.
  const opened = React.useRef(true);
  React.useEffect(() => {
    if (opened.current) {
      opened.current = false;
      return;
    }
    left.current = false;
    setQuiet(true);
  }, [stored]);
  // A refusal describes the draft that produced it, so it stops describing
  // anything the moment the document holds a different value here. Clearing on
  // the stored value rather than only on the next commit is what covers an undo
  // or an edit applied from elsewhere: the remount key changes with the
  // SELECTION, and neither of those changes the selection.
  React.useEffect(() => {
    setIssue(null);
  }, [stored]);
  const survive = useSurvivingReport();
  // The target and the editor as they are now, for a write that answers later.
  const current = React.useRef(target);
  current.current = target;
  const liveEditor = React.useRef(editor);
  liveEditor.current = editor;
  /*
   * A refusal of a write that answers later, for the target that made it:
   * said beside the field while the field is on screen AND still edits that
   * target, and through the shell otherwise. The field stays mounted across a
   * switch of target, and a refusal shown there would describe a write the new
   * target never made.
   */
  const reportFor =
    (submitted: StyleTarget) =>
    (reason: string): void =>
      survive(reason, () => {
        if (targetKey(current.current) !== targetKey(submitted)) return false;
        setIssue(reason);
        return true;
      });
  const writeBlock = (
    value: StyleValue | null,
    also?: readonly StyleAddress[]
  ): CommitOutcome =>
    writeStyleValue({
      editor,
      nodeId,
      address,
      policy,
      value,
      setIssue,
      ...(also === undefined ? {} : { also }),
    });
  return {
    target,
    nodeStyles,
    styles,
    stored,
    issue,
    setIssue,
    caption: {
      "data-provenance-quiet": quiet ? "" : undefined,
      // Read by the caption's reveal rule, which then draws nothing.
      style: quiet
        ? ({ "--nx-provenance-caption": "none" } as React.CSSProperties)
        : undefined,
      onFocus: () => {
        if (left.current) setQuiet(false);
      },
      onBlur: event => {
        // Leaving for somewhere outside the field, while what had focus is
        // still on the page: an element removed under focus, such as a
        // picked list closing, has not taken the author anywhere.
        const to = event.relatedTarget;
        const inside = isElement(to) && event.currentTarget.contains(to);
        if (!inside && isElement(event.target) && event.target.isConnected) {
          left.current = true;
        }
      },
    },
    commit: value => {
      quieten();
      return writeTarget(value);
    },
    commitSides: (paths, value) => {
      quieten();
      const also = paths
        .filter(path => path.join(".") !== address.path.join("."))
        .map(path => ({ ...address, path }));
      return writeTarget(value, also);
    },
    resetBlock: () => {
      writeBlock(null);
    },
    moveTo: shared =>
      moveToSharedStyle({
        editor,
        live: () => liveEditor.current,
        nodeId,
        target: shared,
        address,
        policy,
        setIssue,
        report: reportFor(shared),
      }),
  };
  function writeTarget(
    value: StyleValue | null,
    also: readonly StyleAddress[] = []
  ): CommitOutcome {
    if (target.kind !== "shared") return writeBlock(value, also);
    // A shared style is written by the host, one change at a time.
    let outcome: CommitOutcome = "unchanged";
    for (const at of [address, ...also]) {
      const one = writeSharedStyleValue({
        target,
        address: at,
        policy,
        value,
        setIssue,
        report: reportFor(target),
      });
      if (one === "refused") return one;
      if (one === "applied") outcome = one;
    }
    return outcome;
  }
}

/**
 * One control's value written into the shared style that is the target.
 *
 * Through the block's own write rule (`sharedStyleWrite`), judged under the
 * same policy, so the style may hold what a block may. The style is stored by
 * the host, over the network: the field answers at once and a refusal that
 * comes back later is reported where the author can still read it.
 */
function writeSharedStyleValue({
  target,
  address,
  policy,
  value,
  setIssue,
  report,
}: {
  target: Extract<StyleTarget, { kind: "shared" }>;
  address: StyleAddress;
  policy: StylePolicy | undefined;
  value: StyleValue | null;
  setIssue: (message: string | null) => void;
  report: (reason: string) => void;
}): CommitOutcome {
  // Refused here as well as drawn read-only, for a lock set after the
  // controls drew.
  if (target.readOnly !== undefined) {
    setIssue(target.readOnly);
    return "refused";
  }
  const write = sharedStyleWrite(target.style.styles, address, value, policy);
  if (write.kind === "refused") {
    setIssue(write.reason);
    return "refused";
  }
  setIssue(null);
  /*
   * Queued even when the read in hand already holds the value: an edit still
   * on its way may have changed it since, so whether this one changes
   * anything is the host's to decide against what it has queued. The change,
   * not the styles just computed, so none is lost.
   */
  void target.write(sharedStyleChange(address, value, policy)).then(refused => {
    if (refused !== undefined) report(refused);
  });
  return "applied";
}

/**
 * "Move to Card": the block's value at this control written into the style,
 * then cleared from the block once the style has it, so a refused style
 * leaves the block as it was.
 */
function moveToSharedStyle({
  editor,
  live,
  nodeId,
  target,
  address,
  policy,
  setIssue,
  report,
}: {
  editor: EditorState;
  /** The editor as it stands when the style's write answers. */
  live: () => EditorState;
  nodeId: string;
  target: Extract<StyleTarget, { kind: "shared" }>;
  address: StyleAddress;
  policy: StylePolicy | undefined;
  setIssue: (message: string | null) => void;
  report: (reason: string) => void;
}): void {
  const node = findNode(editor.document.nodes, nodeId);
  if (node === undefined) return;
  if (target.readOnly !== undefined) {
    setIssue(target.readOnly);
    return;
  }
  if (!designIsWritable(editor.document, nodeId, lockViewOf(editor))) {
    setIssue("This block's design is locked, so it can't be changed here.");
    return;
  }
  const plan = planMoveToSharedStyle(node, target.style, address, policy);
  if (!plan.ok) {
    setIssue(plan.reason);
    return;
  }
  setIssue(null);
  void target.write(plan.change).then(refused => {
    if (refused !== undefined) {
      report(refused);
      return;
    }
    /*
     * The block's value cleared at this one address, from the block as it
     * stands NOW: an edit made to it while the style's write was on its way
     * is kept, where a clear built before the write would put it back.
     */
    const now = live();
    const ops = moveToSharedStyleClear(
      findNode(now.document.nodes, nodeId),
      address,
      plan.moved,
      policy
    );
    if (ops.length > 0 && now.applyAll(ops) === null) {
      report(
        `${target.style.name} has the value, but it could not be cleared from this block.`
      );
    }
  });
}
