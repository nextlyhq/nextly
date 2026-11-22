/**
 * What the canvas says over each Form block (`form-states.tsx`), worked out
 * from the document, the drawn page and each picked form's state, with no
 * React.
 *
 * - A picked form that is a **draft**: "Draft form: visitors can't send it
 *   until it's published".
 * - One that is **closed**: "This form is closed. Visitors see its closed
 *   message." with "Pick another form".
 * - One that was **deleted** (or that the author can no longer read):
 *   "This form was deleted." with "Pick another form", over the empty box
 *   the block draws in its place where an author is looking.
 * - A **simple form with nowhere to send answers** ("Send to" empty):
 *   "Answers have nowhere to go yet: add an address, or install the Forms
 *   plugin to save them".
 *
 * A form whose state could not be read is said nothing about: a failed read
 * is never told as a deleted form.
 *
 * @module canvas/form-states-model
 */
import {
  findNode,
  walkNodes,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { INSTANCE_ATTRIBUTE, NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";

import type { PickedFormState } from "../inspector/content/content-services";
import {
  answersGoNowhere,
  FORM_BLOCK,
  pickedFormOf,
  type PickedForm,
} from "../inspector/content/form-picked";

/** What the canvas says over one Form. */
export type FormNoticeKind = "draft" | "closed" | "deleted" | "nowhere";

/** One Form block the page draws and the document owns. */
export interface DrawnForm {
  readonly nodeId: string;
  readonly element: Element;
  /** Its picked form, or `undefined` for a simple form. */
  readonly picked: PickedForm | undefined;
  /** A simple form with no address to send its answers to. */
  readonly nowhere: boolean;
}

/** The Form node by its id, or `undefined` when it is not one. */
export function formNodeOf(
  document: BlockDocument,
  nodeId: string
): BlockNode | undefined {
  const node = findNode(document.nodes, nodeId);
  return node?.type === FORM_BLOCK ? node : undefined;
}

/**
 * The Forms the page draws that the document holds, each once. A Form drawn
 * inside a placed component, or in the Layout around the page, is set where
 * it is defined, so nothing is said over it here.
 */
export function drawnForms(
  elements: readonly Element[],
  document: BlockDocument
): DrawnForm[] {
  const forms = formsById(document);
  if (forms.size === 0) return [];
  const found: DrawnForm[] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    if (element.hasAttribute(INSTANCE_ATTRIBUTE)) continue;
    const nodeId = element.getAttribute(NODE_ID_ATTRIBUTE);
    if (nodeId === null || seen.has(nodeId)) continue;
    const node = forms.get(nodeId);
    if (node === undefined) continue;
    seen.add(nodeId);
    const picked = pickedFormOf(node.props.form);
    found.push({
      nodeId,
      element,
      picked,
      nowhere: answersGoNowhere(node.props),
    });
  }
  return found;
}

/**
 * Each id {@link formNodeOf} answers a Form for, with that Form, from one walk
 * of the document. The canvas measures on every edit and every change of
 * layout, and asking `formNodeOf` per drawn block walked the whole page once
 * for each of them. The first node an id names wins, as `findNode` finds it,
 * so an id whose first node is not a Form names none here either.
 */
function formsById(document: BlockDocument): Map<string, BlockNode> {
  const named = new Set<string>();
  const forms = new Map<string, BlockNode>();
  walkNodes(document.nodes, node => {
    if (named.has(node.id)) return;
    named.add(node.id);
    if (node.type === FORM_BLOCK) forms.set(node.id, node);
  });
  return forms;
}

/** The key a picked form's state is kept under. */
export function pickedFormKey(form: PickedForm): string {
  return JSON.stringify([form.provider, form.ref]);
}

/**
 * What the canvas says over `form`, given its picked form's state as read
 * (`undefined` while unread, or where the read failed): nothing for a
 * published form, nor for one whose state is not known.
 */
export function noticeOf(
  form: Pick<DrawnForm, "picked" | "nowhere">,
  state: PickedFormState | undefined
): FormNoticeKind | undefined {
  if (form.picked === undefined) return form.nowhere ? "nowhere" : undefined;
  switch (state) {
    case "draft":
      return "draft";
    case "closed":
      return "closed";
    case "missing":
      return "deleted";
    default:
      return undefined;
  }
}
