"use client";

/**
 * An Accordion's Icon row in its Content tab: "+ / −", "Chevron" and "None"
 * as a row of radio buttons, each choice one step to undo
 * (`accordion-icon.ts`), held where a lock holds the accordion's design.
 *
 * @module accordion-icon-field
 */
import { findNode } from "@nextlyhq/blocks-engine";
import { TooltipProvider } from "@nextlyhq/ui";
import { RotateCcw } from "lucide-react";
import * as React from "react";

import {
  ACCORDION_BLOCK,
  ACCORDION_ICON_WORDS,
  ACCORDION_ICONS,
  accordionIconHoldsValue,
  accordionIconOf,
  planAccordionIcon,
  planAccordionIconReset,
  type AccordionIcon,
} from "./accordion-icon";
import { ChromeTooltip } from "./chrome-tooltip";
import { SegmentedChoice } from "./content-controls";
import type { EditorState } from "./editor-state";
import { HeldByLock } from "./held-by-lock";
import type { PanelSection } from "./panel-section";
import { SettingSlot } from "./settings-filter";

/** The section's name, and the row's. */
const ICON_WORDS = "Icon";

/** Whether a chosen option is one of the offered icons. */
function isIcon(option: string): option is AccordionIcon {
  return ACCORDION_ICONS.some(each => each === option);
}

/** The Icon row: the accordion's icon, chosen from three. */
export function AccordionIconField({
  editor,
  nodeId,
  heldBy,
}: {
  editor: Pick<EditorState, "document" | "apply">;
  nodeId: string;
  /** The id of the lock reason while a lock holds the design, else none. */
  heldBy: string | undefined;
}): React.JSX.Element | null {
  const id = React.useId();
  const node = findNode(editor.document.nodes, nodeId);
  if (node === undefined) return null;
  const held = heldBy !== undefined;
  return (
    <SettingSlot ids={["disclosureIcon"]}>
      <HeldByLock reasonId={heldBy}>
        <div
          className="nx-inspector__field"
          data-content-control="accordion-icon"
        >
          <p className="nx-inspector__field-name" id={`${id}-label`}>
            {ICON_WORDS}
          </p>
          <SegmentedChoice
            id={id}
            labelledBy={`${id}-label`}
            options={ACCORDION_ICONS}
            labels={ACCORDION_ICONS.map(each => ACCORDION_ICON_WORDS[each])}
            value={accordionIconOf(node)}
            disabled={held}
            onChoose={option => {
              if (held || !isIcon(option)) return;
              const op = planAccordionIcon(node, option);
              if (op !== null) editor.apply(op);
            }}
          />
          {/* The way back to what a shared style or the block's default
              sets, as the Style tab's rows offer: choosing + / − would
              write the plus as the accordion's own. Drawn as Style draws
              its reset, while the accordion holds an icon of its own. */}
          {held || !accordionIconHoldsValue(node) ? null : (
            <TooltipProvider delayDuration={300}>
              <ChromeTooltip content="Reset">
                <button
                  type="button"
                  className="nx-style-inspector__breakpoint-action"
                  data-action="reset"
                  aria-label={`Reset ${ICON_WORDS}`}
                  onClick={() => {
                    const op = planAccordionIconReset(node);
                    if (op !== null) editor.apply(op);
                  }}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                </button>
              </ChromeTooltip>
            </TooltipProvider>
          )}
        </div>
      </HeldByLock>
    </SettingSlot>
  );
}

/**
 * An Accordion's builder-drawn Content sections, by the names the inspector
 * gives them (`builderContentSectionsOf`), or none for any other block.
 */
export function accordionContentSections(
  context: {
    readonly editor: EditorState;
    readonly nodeId: string;
    readonly designHeldBy: string | undefined;
  },
  labels: readonly string[]
): PanelSection[] {
  const node = findNode(context.editor.document.nodes, context.nodeId);
  if (node?.type !== ACCORDION_BLOCK || !labels.includes(ICON_WORDS)) {
    return [];
  }
  return [
    {
      key: ICON_WORDS,
      label: ICON_WORDS,
      holdsValue: accordionIconHoldsValue(node),
      body: (
        <AccordionIconField
          editor={context.editor}
          nodeId={context.nodeId}
          heldBy={context.designHeldBy}
        />
      ),
    },
  ];
}
