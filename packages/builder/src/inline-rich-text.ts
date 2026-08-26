/**
 * Which of a block's passages an author may edit on the canvas, and the op a
 * finished edit produces.
 *
 * The rich half of {@link module:inline-text}, and pure for the same reason:
 * whether a value is editable in place, and whether a finished edit changed
 * anything, are derivations — and a component test cannot separate a correct
 * answer from a plausible wrong one, because both render a caret.
 *
 * **The block decides, not this module.** A prop is offered here only when its
 * schema declares itself rich AND inline, which is the same pair the renderer
 * reads when it marks the element holding the value. Both halves must agree or
 * the value is simply not editable in place, which is the safe direction.
 *
 * @module inline-rich-text
 */

import {
  findNode,
  isRichTextValue,
  type BlockDocument,
  type BlockNode,
  type RichTextValue,
} from "@nextlyhq/blocks-engine";

import { inlinePropsOfKind } from "./inline-target";
import { propPatch } from "./inspector";
import type { BuilderOp } from "./ops";

/** One passage a canvas may let an author edit in place. */
export interface InlineRichTextTarget {
  readonly nodeId: string;
  readonly prop: string;
  /**
   * The passage as the document holds it, or `undefined` when it holds nothing
   * usable.
   *
   * Undefined rather than an empty passage, because what an EMPTY passage looks
   * like is the editor's answer and not this module's: inventing one here would
   * be a second statement of that shape, and the two would drift.
   */
  readonly value: RichTextValue | undefined;
}

function targetFor(node: BlockNode, prop: string): InlineRichTextTarget {
  const stored = (node.props as Record<string, unknown> | undefined)?.[prop];
  return {
    nodeId: node.id,
    prop,
    // Narrowed with the engine's own predicate rather than trusted from the
    // schema: the schema says what an editor OFFERS, and the document holds
    // whatever a migration, an import or a hand-edited row left there.
    value: isRichTextValue(stored) ? stored : undefined,
  };
}

/**
 * Every passage on this node that may be edited on the canvas, in the order the
 * block declared them.
 *
 * Empty for a LOCKED block, and for a node whose type is not registered. A lock
 * is what an author set to stop the block changing, and editing is a change —
 * honoured at every entry point or it is honoured at none, which is the state
 * where an author believes a block is protected.
 *
 * @param document - the document being edited
 * @param nodeId - the node to ask about
 * @returns the editable passages, empty when there are none
 */
export function richInlineTargets(
  document: BlockDocument,
  nodeId: string
): readonly InlineRichTextTarget[] {
  const found = inlinePropsOfKind(document, nodeId, "rich");
  if (found === null) return [];
  return found.entries.map(([name]) => targetFor(found.node, name));
}

/**
 * One named passage, or `null` when it is not editable on the canvas.
 *
 * Derived from {@link richInlineTargets} rather than repeating its rules, so a
 * block that is locked, unregistered or has not declared the prop answers the
 * same way to both.
 *
 * @param document - the document being edited
 * @param nodeId - the node to ask about
 * @param prop - the passage's name
 * @returns the target, or `null`
 */
export function richInlineTarget(
  document: BlockDocument,
  nodeId: string,
  prop: string
): InlineRichTextTarget | null {
  return richInlineTargets(document, nodeId).find(t => t.prop === prop) ?? null;
}

/**
 * Whether a finished edit actually changed the passage.
 *
 * Both sides must come from the SAME producer — the editor's own reading of the
 * passage when it opened, against its reading when it closed. Comparing what
 * the editor produced against what the DOCUMENT stored would report a change
 * for every passage merely opened and closed, because an editor normalises what
 * it loads: it fills in the version, direction and format fields its own
 * serializer always writes, and a value that reached storage from another
 * surface, an import or an older schema will not carry them identically.
 *
 * That difference is invisible to an author and would put an entry on the undo
 * stack that appears to do nothing — which reads as the history being broken
 * rather than as an empty change.
 *
 * Compared as serialized JSON, which is sound only because of that same
 * constraint: one producer emits one key order for one state, so two readings
 * of an untouched passage are identical strings.
 *
 * @param before - what the editor read when it opened the passage
 * @param after - what it read when the edit finished
 * @returns whether anything about the passage differs
 */
export function richTextChanged(before: unknown, after: unknown): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

/**
 * The op a finished edit produces, or `null` when there is nothing to write.
 *
 * `null` for an unchanged passage, for one the editor did not return as rich
 * text at all, and for a value that stopped being editable while the edit was
 * open — a node can be deleted or locked from the layers panel, from a keyboard
 * action, or by another surface entirely, and writing then would either address
 * a node that is gone or defeat a lock applied after the caret went in.
 *
 * @param document - the document as it stands NOW, not when the edit began
 * @param nodeId - the node being edited
 * @param prop - the passage being edited
 * @param next - what the editor read when the edit finished
 * @param before - what it read when the passage opened
 * @returns one op, or `null`
 */
export function richInlineTextOp(
  document: BlockDocument,
  nodeId: string,
  prop: string,
  next: unknown,
  before: unknown
): BuilderOp | null {
  const target = richInlineTarget(document, nodeId, prop);
  if (target === null) return null;
  // Refused rather than stored. A value the editor could not produce as a
  // passage is not one, and writing it would put a shape into the document that
  // every reader of the format would then have to survive.
  if (!isRichTextValue(next)) return null;
  if (!richTextChanged(before, next)) return null;
  const node = findNode(document.nodes, nodeId);
  if (node === undefined) return null;
  return { kind: "update", id: nodeId, patch: propPatch(node, prop, next) };
}
