"use client";

/**
 * A Section's Padding, drawn above the spacing box in Style › Spacing:
 * Compact, Normal or Roomy, each sized by the site's spacing variables, and
 * "Custom" while a side of the box holds a value of its own.
 *
 * The preset is one of the block's own settings, not a style: one value on
 * every device, written to the block whatever the Style target says. So it
 * is held, as Content width is, while a shared style or a state other than
 * Normal is being edited.
 *
 * @module section-padding-fields
 */
import {
  findNode,
  PADDING_PRESET_PROP,
  type PropSchema,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import { inspectSelection, lockViewOf } from "../inspector";
import { withSectionFold } from "../panel-folds";
import { usePanelFolds } from "../panel-folds-context";
import { SegmentChoices } from "../segment-choices";

import { CONTENT_WIDTH_HELD } from "./content-width-control";
import { SectionHeld } from "./section-held";
import {
  PADDING_CHOICES,
  PADDING_LABELS,
  paddingReading,
  planPadding,
  type PaddingChoice,
} from "./section-padding";
import {
  StyleTargetContext,
  type StyleFieldSurroundings,
} from "./style-field-surroundings";

/** What the choices do, under them. */
const PADDING_HINT = "Space inside the section, from the site's settings";

/** What "Custom" says, in place of the hint, while a side has its own value. */
const CUSTOM_HINT =
  "Custom: a side below has its own value. Choosing one clears it.";

/**
 * The Style section the control is drawn in, by the label its fold is kept
 * under.
 */
const SPACING_SECTION = "Spacing";

/** What each choice writes, from the setting's own `code`, for its tooltip. */
function writesOf(
  schema: PropSchema
): Readonly<Record<PaddingChoice, string>> | undefined {
  const code = schema.code;
  if (code === undefined || typeof code === "string") return undefined;
  return Object.fromEntries(
    PADDING_CHOICES.map(choice => [choice, code[choice] ?? ""])
  ) as Record<PaddingChoice, string>;
}

/**
 * Padding at the top of a Section's Spacing section, or nothing for a block
 * that does not declare it.
 */
export function SectionPaddingFields({
  surroundings,
}: {
  surroundings: StyleFieldSurroundings;
}): React.JSX.Element | null {
  const labelId = React.useId();
  const target = React.useContext(StyleTargetContext);
  const sectionHeld = React.useContext(SectionHeld);
  const { change } = usePanelFolds();
  const { editor, nodeId, state } = surroundings;
  const row = inspectSelection(editor.document, nodeId, lockViewOf(editor))
    ?.sections.styleProps.find(section => section.key === "spacing")
    ?.rows.find(each => each.name === PADDING_PRESET_PROP);
  const node = findNode(editor.document.nodes, nodeId);
  if (row === undefined || node === undefined) return null;
  const held =
    sectionHeld || row.readOnly || target.kind !== "block" || state !== "base";
  const reading = paddingReading(node);
  const choose = (choice: PaddingChoice) => {
    // Refused here as well as disabled there: a control reaching a write
    // while held must still not change the block.
    if (held) return;
    const op = planPadding(node, choice);
    if (op === null) return;
    // Kept open as the author's own fold: clearing the last own padding
    // would otherwise close the section opened for holding it, under the
    // control being used.
    change(folds => withSectionFold(folds, "style", SPACING_SECTION, true));
    editor.apply(op);
  };
  const ownHeld =
    !sectionHeld && !row.readOnly && held ? CONTENT_WIDTH_HELD : undefined;
  return (
    <fieldset
      className="nx-section-padding"
      data-control="section-padding"
      disabled={held}
    >
      <div className="nx-inspector__field">
        <span className="nx-inspector__field-name" id={labelId}>
          Padding
        </span>
        <SegmentChoices
          options={PADDING_CHOICES}
          on={reading === "custom" ? undefined : reading}
          labels={PADDING_LABELS}
          labelId={labelId}
          onChoose={choose}
          writes={writesOf(row.schema)}
        />
      </div>
      <p className="nx-inspector__note">
        {ownHeld ?? (reading === "custom" ? CUSTOM_HINT : PADDING_HINT)}
      </p>
    </fieldset>
  );
}
