/**
 * A passage the canvas edits in place, wherever it is stored: a node's own
 * rich text, or a component placement's exposed one, which the canvas shows
 * on a composed node the page document does not hold and which is stored on
 * the placement under its exposure.
 *
 * The rich surface asks three questions of a passage — what it holds now,
 * whether it changed while the editor was open, and what writing an edit
 * means — and the answers differ only by where it lives. Each is answered
 * here once, from the address, so the surface keeps one path.
 *
 * @module rich-passage
 */
import type { BlockDocument, SlotDefaultSource } from "@nextlyhq/blocks-engine";

import {
  exposedPassage,
  exposedRichOp,
  type ExposedRichTarget,
} from "./exposed-inline";
import {
  richInlineTarget,
  richInlineTextOp,
  richTextChanged,
  richTextMovedOn,
  type InlineRichTextTarget,
} from "./inline-rich-text";
import type { BuilderOp } from "./op-vocabulary";

/** Where a passage being edited lives. */
export interface RichPassageAddress {
  /** The node the element belongs to: the page's, or a composed one. */
  readonly nodeId: string;
  readonly prop: string;
  /**
   * The placement and exposure the passage is stored under, when it is a
   * component's exposed passage; absent for a node's own.
   */
  readonly exposure?: Pick<ExposedRichTarget, "placementId" | "exposureId">;
}

/** What the questions read: the page, its composition, and the lock rules. */
export interface RichPassageEditor {
  readonly document: BlockDocument;
  readonly composed?: () => BlockDocument | undefined;
  readonly lockDefinitions?: SlotDefaultSource;
}

/** The exposed target an address names, when it names one. */
function exposedTarget(
  address: RichPassageAddress
): ExposedRichTarget | undefined {
  return address.exposure === undefined
    ? undefined
    : {
        nodeId: address.nodeId,
        prop: address.prop,
        placementId: address.exposure.placementId,
        exposureId: address.exposure.exposureId,
      };
}

/** The passage as it stands now, or `null` once it is not editable in place. */
export function passageNow(
  editor: RichPassageEditor,
  address: RichPassageAddress
): InlineRichTextTarget | null {
  const exposed = exposedTarget(address);
  if (exposed === undefined) {
    return richInlineTarget(editor.document, address.nodeId, address.prop);
  }
  const now = exposedPassage(
    editor.document,
    editor.composed?.(),
    exposed,
    editor.lockDefinitions
  );
  return now === null
    ? null
    : { nodeId: address.nodeId, prop: address.prop, ...now };
}

/** Whether the stored passage changed since the editor opened it. */
export function passageMovedOn(
  editor: RichPassageEditor,
  address: RichPassageAddress,
  opened: unknown
): boolean {
  if (address.exposure === undefined) {
    return richTextMovedOn(
      editor.document,
      address.nodeId,
      address.prop,
      opened
    );
  }
  // As the node's own: one no longer editable is the write's to refuse.
  const now = passageNow(editor, address);
  return now !== null && richTextChanged(opened, now.stored);
}

/** The op a finished edit writes, or `null` when there is nothing to write. */
export function passageOp(
  editor: RichPassageEditor,
  address: RichPassageAddress,
  next: unknown,
  before: unknown,
  opened: unknown
): BuilderOp | null {
  const exposed = exposedTarget(address);
  return exposed === undefined
    ? richInlineTextOp(
        editor.document,
        address.nodeId,
        address.prop,
        next,
        before,
        opened
      )
    : exposedRichOp(
        editor.document,
        editor.composed?.(),
        exposed,
        next,
        before,
        opened,
        editor.lockDefinitions
      );
}

/**
 * The block whose selection keeps the passage open: the node itself, or, for
 * an exposed passage, its placement, which is what a click on a component
 * selects.
 */
export function passageKeptBy(address: RichPassageAddress): string {
  return address.exposure?.placementId ?? address.nodeId;
}
