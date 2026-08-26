/**
 * Renders a rich-text comparison, block by block.
 *
 * The document keeps its own shape: one row per block, in document order, so a
 * reader recognises the page they wrote. A changed block shows its word-level
 * runs in place; an added or removed one carries a gutter stripe in the
 * semantic colour, which is what makes "a paragraph appeared" legible at a
 * glance rather than something to work out from the marks.
 *
 * A single column rather than before/after columns, deliberately. The engine
 * already resolves each block to one sequence of runs carrying both sides, so
 * splitting them would mean showing each block twice and leaving the reader to
 * pair them — the arrangement a before/after comparison uses precisely because
 * it has nothing better.
 *
 * @module components/features/versions/diff/RichTextDiff
 */

import type {
  RichTextAttrChange,
  RichTextBlockDiff,
  RichTextFieldDiff,
} from "@admin/services/versionApi";

import {
  FieldRow,
  NotComparable,
  StatusBadge,
  TextRuns,
} from "./diff-primitives";
import { defineFieldDiff } from "./field-diff-registry";

/**
 * The gutter stripe for a block's status. Only one-sided changes get one: a
 * stripe on every row is a stripe on none, and `changed` already reads from
 * its inline marks.
 */
const BLOCK_STRIPE: Record<string, string> = {
  added: "border-l-2 border-success pl-3",
  removed: "border-l-2 border-destructive pl-3",
  changed: "border-l-2 border-warning pl-3",
  unsupported: "border-l-2 border-border pl-3",
  unchanged: "border-l-2 border-transparent pl-3",
};

/**
 * A human name for a block type. Shown only where the block is not an ordinary
 * paragraph, so the common case stays quiet and a heading or a list says what
 * it is.
 */
const BLOCK_LABEL: Record<string, string> = {
  heading: "Heading",
  quote: "Quote",
  list: "List",
  listitem: "List item",
  code: "Code block",
  table: "Table",
  horizontalrule: "Divider",
};

/** A property value, in as few characters as it can honestly be shown in. */
function attrValue(value: unknown): string {
  if (value === undefined) return "none";
  if (typeof value === "string") return value === "" ? "empty" : value;
  return JSON.stringify(value) ?? "none";
}

/**
 * What changed about a block besides its words.
 *
 * Without this a block whose heading level or link target moved shows a
 * "Changed" badge above text that reads identically, which tells a reader that
 * something happened and not what — the least useful thing a comparison can
 * say. Shown only when the words did NOT carry the change on their own.
 */
function AttrChanges({
  changes,
}: {
  changes: readonly RichTextAttrChange[] | undefined;
}) {
  if (!changes || changes.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {changes.map(change => (
        <li key={change.name} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{change.name}</span>{" "}
          <del className="text-destructive">{attrValue(change.before)}</del>
          {" \u2192 "}
          <ins className="text-success no-underline">
            {attrValue(change.after)}
          </ins>
        </li>
      ))}
    </ul>
  );
}

function BlockRow({ block }: { block: RichTextBlockDiff }) {
  const stripe = BLOCK_STRIPE[block.status] ?? BLOCK_STRIPE.unchanged;
  const label = BLOCK_LABEL[block.blockType];
  return (
    <div className={`py-1.5 ${stripe}`}>
      {label || block.status !== "unchanged" ? (
        <div className="mb-1 flex items-center gap-2">
          {label ? (
            <span className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
          ) : null}
          {block.status !== "unchanged" ? (
            <StatusBadge status={block.status} />
          ) : null}
        </div>
      ) : null}
      {block.status === "unsupported" ? (
        <NotComparable what="block" />
      ) : (
        <>
          <TextRuns segments={block.segments ?? []} />
          <AttrChanges changes={block.attrChanges} />
        </>
      )}
    </div>
  );
}

export function RichTextDiff({ node }: { node: RichTextFieldDiff }) {
  return (
    <FieldRow label={node.label} status={node.status}>
      {node.blocks.length === 0 ? (
        <p className="text-xs text-muted-foreground">This field is empty.</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {node.blocks.map((block, index) => (
            // Index-keyed on purpose: a block has no identity of its own, and
            // the list is a rendering of one comparison rather than a
            // collection that reorders under the reader.
            <BlockRow key={index} block={block} />
          ))}
        </div>
      )}
    </FieldRow>
  );
}

defineFieldDiff(["richText"], node => (
  <RichTextDiff node={node as RichTextFieldDiff} />
));
