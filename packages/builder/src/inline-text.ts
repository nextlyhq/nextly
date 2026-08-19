/**
 * Which of a block's values an author may type directly on the canvas, and the
 * op a finished edit produces.
 *
 * Pure, like every rule in this package, and for the same reason: whether a
 * value is editable in place, and whether a finished edit changed anything, are
 * derivations — and a component test in jsdom cannot separate a correct answer
 * from a plausible wrong one, because both render a caret.
 *
 * **The block decides, not this module.** A prop is offered here only when its
 * schema declares `inline`, which is the same declaration the renderer reads
 * when it marks the element holding the value. Two lists would be two answers
 * to one question, and the failure is quiet: an editor that offers a value the
 * canvas never marked leaves an author double-clicking text that never becomes
 * editable.
 *
 * @module inline-text
 */

import {
  findNode,
  getBlock,
  type BlockDocument,
  type BlockNode,
  type PropSchema,
} from "@nextlyhq/blocks-engine";

import { propPatch } from "./inspector";
import { isLocked } from "./locking";
import type { BuilderOp } from "./ops";

/** One value a canvas may let an author type into. */
export interface InlineTextTarget {
  readonly nodeId: string;
  readonly prop: string;
  /**
   * Whether the value may hold line breaks, which is what decides where Enter
   * goes: into the text for a paragraph, and out of the edit for a heading.
   *
   * Read from the schema's own `type` rather than from a list of prop names
   * kept here, so a block that changes a field from one to the other changes
   * this with it.
   */
  readonly multiline: boolean;
  /** The value as the document holds it, normalised to a string. */
  readonly value: string;
}

/**
 * A stored value as text.
 *
 * Anything that is not a string reads as empty rather than as `"undefined"` or
 * `"[object Object]"`. A stored document holds whatever a migration, an import
 * or a hand-edited row left there, and putting one of those spellings into an
 * editable element would let an author "keep" a value they never typed.
 */
function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Whether a schema opted this value into editing on the canvas. */
function declaresInline(schema: PropSchema | undefined): boolean {
  return schema?.inline === true;
}

function targetFor(
  node: BlockNode,
  prop: string,
  schema: PropSchema | undefined
): InlineTextTarget {
  return {
    nodeId: node.id,
    prop,
    multiline: schema?.type === "textarea",
    value: asText((node.props as Record<string, unknown> | undefined)?.[prop]),
  };
}

/**
 * Every value on this node that may be typed on the canvas, in the order the
 * block declared them.
 *
 * Empty for a LOCKED block, and for a node whose type is not registered. A lock
 * is what an author set to stop the block changing, and inline editing is a
 * change — the lock has to be honoured at every entry point or it is honoured
 * at none, which is the state where an author believes a block is protected.
 *
 * @param document - the document being edited
 * @param nodeId - the node to ask about
 * @returns the editable values, empty when there are none
 */
export function inlineTargets(
  document: BlockDocument,
  nodeId: string
): readonly InlineTextTarget[] {
  const node = findNode(document.nodes, nodeId);
  if (node === undefined || isLocked(node)) return [];
  const definition = getBlock(node.type);
  if (definition === undefined) return [];
  const props = definition.props ?? {};
  return Object.keys(props)
    .filter(name => declaresInline(props[name]))
    .map(name => targetFor(node, name, props[name]));
}

/**
 * One named value, or `null` when it is not editable on the canvas.
 *
 * Derived from {@link inlineTargets} rather than repeating its rules, so a
 * block that is locked, unregistered or has not declared the prop answers the
 * same way to both.
 *
 * @param document - the document being edited
 * @param nodeId - the node to ask about
 * @param prop - the value's name
 * @returns the target, or `null`
 */
export function inlineTarget(
  document: BlockDocument,
  nodeId: string,
  prop: string
): InlineTextTarget | null {
  return inlineTargets(document, nodeId).find(t => t.prop === prop) ?? null;
}

/**
 * The op a finished edit produces, or `null` when there is nothing to write.
 *
 * `null` for an unchanged value, deliberately: an author who enters an edit and
 * leaves without typing has made no edit, and recording one would put an entry
 * on the undo stack that appears to do nothing — which reads as the history
 * being broken rather than as an empty change.
 *
 * `null` also when the value stopped being editable while the edit was open. A
 * node can be deleted or locked from the layers panel, from a keyboard action,
 * or by another surface entirely, and writing the text back then would either
 * address a node that is gone or defeat a lock that was applied after the
 * caret went in.
 *
 * @param document - the document as it stands NOW, not when the edit began
 * @param nodeId - the node being edited
 * @param prop - the value being edited
 * @param next - the text the author left behind
 * @returns one op, or `null`
 */
export function inlineTextOp(
  document: BlockDocument,
  nodeId: string,
  prop: string,
  next: string
): BuilderOp | null {
  const target = inlineTarget(document, nodeId, prop);
  if (target === null || target.value === next) return null;
  const node = findNode(document.nodes, nodeId);
  if (node === undefined) return null;
  return { kind: "update", id: nodeId, patch: propPatch(node, prop, next) };
}
