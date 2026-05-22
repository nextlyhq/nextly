import type { FieldConfig } from "nextly/config";
import type React from "react";

import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";

export interface FieldRowProps {
  /** Fields packed onto this row by `packFieldsIntoRows()`. */
  fields: FieldConfig[];
  /** Whether all fields should be disabled */
  disabled?: boolean;
  /** Whether all fields should be read-only */
  readOnly?: boolean;
  /** Base path for nested fields (e.g. from group parent) */
  basePath?: string;
}

/**
 * Returns the field's `admin.width` parsed to a number 0-100, or 100 when
 * absent/malformed. Mirrors the parser in pack-fields-into-rows.ts but
 * without the dependency to keep this file self-contained.
 */
export function fieldWeight(field: FieldConfig): number {
  const w = (field as { admin?: { width?: string } }).admin?.width;
  if (!w) return 100;
  const m = /^(\d+(?:\.\d+)?)%$/.exec(w.trim());
  if (!m) return 100;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return 100;
  return n;
}

/**
 * Renders one row of width-packed fields. Uses CSS grid with proportional
 * tracks (e.g. two 50% fields → `grid-template-columns: 50fr 50fr`, three
 * 33% fields → `33fr 33fr 33fr`, mixed 50%+30% → `50fr 30fr`). Gap-aware
 * via `gap-6`; tracks shrink to accommodate the gap, so widths and gap
 * compose without overflow.
 *
 * The descendant selector `[&>*]:!w-full` forces each grid item's child
 * (FieldWrapper) to span its track. FieldWrapper's `w-1/2` etc. classes
 * are correct for the legacy single-column path but would otherwise
 * shrink the field to half its track inside this grid.
 */
export function FieldRow({
  fields,
  disabled,
  readOnly,
  basePath,
}: FieldRowProps): React.ReactElement {
  const weights = fields.map(fieldWeight);
  const sum = weights.reduce((a, b) => a + b, 0);
  const cols =
    sum < 100
      ? [...weights, 100 - sum].map(w => `${w}fr`).join(" ")
      : weights.map(w => `${w}fr`).join(" ");

  return (
    <div
      className="grid gap-6 items-start [&>*]:!w-full"
      style={{ gridTemplateColumns: cols }}
    >
      {fields.map((field, i) => (
        <FieldRenderer
          key={getFieldKey(field, i)}
          field={field}
          basePath={basePath}
          disabled={disabled}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

function getFieldKey(field: FieldConfig, index: number): string {
  if ("name" in field && field.name) return field.name;
  return `${field.type}-${index}`;
}
