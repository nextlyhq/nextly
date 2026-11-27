"use client";

/**
 * The text inside a repeater, a group or a component: each row under its own
 * name, with the texts in it and the levels inside. Nothing of the structure is
 * offered: rows are added, moved and removed in the editor, for every language
 * at once.
 *
 * @module components/features/translations/page/NestedTextLevel
 */

import { useId, type JSX, type ReactNode } from "react";
import { useWatch } from "react-hook-form";

import {
  conditionSourcePath,
  effectiveFieldGate,
  fieldAdminGates,
  type FieldGate,
} from "@admin/components/features/entries/fields/field-admin-gates";

import type { NestedText, TextLevel } from "./nested-text";
import { OutOfDateMark } from "./OutOfDateMark";
import { CardHeading } from "./TranslationCards";

export interface NestedTextLevelProps {
  level: TextLevel;
  /** What the level inherits from what is around it. */
  inherited: FieldGate;
  /** Draws one text, under the gate it inherits. */
  drawText: (text: NestedText, gate: FieldGate) => ReactNode;
  /** Whether the source changed since the text inside was made from it. */
  outOfDate?: boolean;
  /** How far inside its container the level stands. */
  depth?: number;
}

/** The form's own decision about the level's container; a row has none. */
function useLevelGate(level: TextLevel, inherited: FieldGate): FieldGate {
  const { field, basePath } = level;
  const condition =
    field === undefined
      ? undefined
      : conditionSourcePath(fieldAdminGates(field).condition, basePath);
  const conditionValue: unknown = useWatch({
    name: condition ?? "",
    disabled: condition === undefined,
  });
  return field === undefined
    ? inherited
    : effectiveFieldGate(field, inherited, conditionValue);
}

export function NestedTextLevel({
  level,
  inherited,
  drawText,
  outOfDate = false,
  depth = 0,
}: NestedTextLevelProps): JSX.Element | null {
  const labelId = useId();
  const gate = useLevelGate(level, inherited);
  if (!gate.shown) return null;
  const contents = (
    <>
      {level.texts.map(text => drawText(text, gate))}
      {level.levels.map(inside => (
        <NestedTextLevel
          key={inside.key}
          level={inside}
          inherited={gate}
          drawText={drawText}
          // A group that only lays fields out is no step further in.
          depth={level.label === undefined ? depth : depth + 1}
        />
      ))}
    </>
  );
  if (level.label === undefined) return contents;
  return (
    <div role="group" aria-labelledby={labelId} data-slot="translation-nested">
      <CardHeading
        id={labelId}
        depth={depth}
        mark={outOfDate ? <OutOfDateMark /> : undefined}
      >
        {level.label}
      </CardHeading>
      {contents}
    </div>
  );
}
