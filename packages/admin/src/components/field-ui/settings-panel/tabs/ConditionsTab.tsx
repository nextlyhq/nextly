// The Conditions tab: when the field is shown. On a surface whose conditions
// read a field beside this one (entries), one condition on a sibling, built
// with the shared condition row; with none set, a button adds one. On a
// surface whose fields carry no conditions, the tab says so rather than
// standing empty.
import { Button, Label } from "@nextlyhq/ui";
import type { JSX } from "react";

import type {
  BuilderField,
  FieldCondition,
} from "@admin/components/features/schema-builder/types";
import { brokenConditionOf } from "@admin/lib/builder/condition-identity";

import type { FieldSettingsSurface } from "../types";

import { ConditionBuilder } from "./ConditionBuilder";

type Props = {
  field: BuilderField;
  /** The fields beside it, which a condition may read. */
  siblings: readonly BuilderField[];
  /** The containers above it, outermost first: the path each source is named by. */
  ancestors?: readonly BuilderField[];
  /** The shared modes; a surface's own editor replaces this tab instead. */
  conditions: Extract<FieldSettingsSurface["conditions"], string>;
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
};

export function ConditionsTab({
  field,
  siblings,
  ancestors = [],
  conditions,
  readOnly = false,
  onChange,
}: Props): JSX.Element {
  if (conditions === "none") {
    return (
      <p className="text-sm text-muted-foreground">
        Fields here are always shown; they take no conditions.
      </p>
    );
  }

  const setCondition = (condition: FieldCondition | undefined) =>
    onChange({ ...field, admin: { ...field.admin, condition } });
  const condition = field.admin?.condition;
  // Judged against the same fields offered as its sources, so what this says
  // is what the outline marks and the save refuses.
  const broken = brokenConditionOf(field, siblings);

  return (
    <div className="space-y-2">
      <Label>Conditional visibility</Label>
      <p className="text-xs text-muted-foreground">
        Show this field only when a field beside it has a given value.
      </p>
      {broken && <p className="text-sm text-destructive">{broken.message}</p>}
      {condition !== undefined ? (
        <ConditionBuilder
          condition={condition}
          siblingFields={siblings.filter(f => f.id !== field.id)}
          ancestors={ancestors}
          readOnly={readOnly}
          onChange={setCondition}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readOnly}
          // An empty condition mounts the builder, where the source, operator
          // and value are then picked.
          onClick={() =>
            setCondition({ field: "", operator: "equals", value: "" })
          }
        >
          + Add condition
        </Button>
      )}
    </div>
  );
}
