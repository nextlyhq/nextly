/**
 * The labels check: a form field with no label, and an embed with no title.
 *
 * A screen reader reads a field's label when the field is reached, and an
 * embed's title to say what the frame holds; without either, people hear
 * only "edit text" or "frame". A form field with no label is sent under its
 * name, which is a worse label than one an author writes. A bound title is
 * the entry's to give, and an embed with no address draws nothing yet.
 *
 * @module page-checks/labels-check
 */
import { walkNodes, type BlockNode } from "@nextlyhq/blocks-engine";

import type { PageCheck, PageCheckResult } from "./page-checks";

/** A value's text, trimmed; anything that is not text reads as none. */
function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Each of the Form's fields with no label of its own. */
function formFindings(node: BlockNode): PageCheckResult[] {
  const fields = node.props.fields;
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field: unknown, index): PageCheckResult[] => {
    const label =
      typeof field === "object" && field !== null
        ? textOf((field as { label?: unknown }).label)
        : "";
    if (label !== "") return [];
    return [
      {
        nodeId: node.id,
        part: `field-${String(index)}`,
        what: `Form field ${String(index + 1)} has no label`,
        why: "Screen readers announce only the kind of field, so people can’t tell what to enter.",
        todo: "Give the field a Label, like “Your email”.",
        fix: { tab: "content", id: "fields" },
      },
    ];
  });
}

/** An Embed that shows something with no title to say what. */
function embedFindings(node: BlockNode): PageCheckResult[] {
  const shows =
    textOf(node.props.src) !== "" || node.bindings?.src !== undefined;
  if (
    !shows ||
    textOf(node.props.title) !== "" ||
    node.bindings?.title !== undefined
  ) {
    return [];
  }
  return [
    {
      nodeId: node.id,
      what: "Embed has no title",
      why: "Screen readers announce it as just “frame”, so people can’t tell what’s in it.",
      todo: "Say what the embed shows in Screen reader label, like “Product demo video”.",
      fix: { tab: "content", id: "title" },
    },
  ];
}

/** Every unlabelled form field and untitled embed on the page. */
export const LABELS_CHECK: PageCheck = {
  id: "labels",
  group: "accessibility",
  run: page => {
    const found: PageCheckResult[] = [];
    walkNodes(page.document.nodes, node => {
      if (node.type === "core/form") found.push(...formFindings(node));
      else if (node.type === "core/embed") found.push(...embedFindings(node));
    });
    return found;
  },
};
