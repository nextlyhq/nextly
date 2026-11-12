// The Display tab: how the field is drawn in the record editor. Its
// placeholder where the type has a text box, whether it can be edited there,
// whether it is shown at all, then the type's own display settings (how a
// group is framed, how repeating rows are labelled).
//
// The Position setting is not offered: the record editor has one column, so a
// sidebar position would be stored and never drawn. Width is in General, with
// the settings every field has.
import { Input, Label, Switch } from "@nextlyhq/ui";
import type { FieldSurface } from "nextly/field-catalog";
import type { JSX, ReactNode } from "react";

import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { isSurfaceBuiltInType } from "@admin/lib/builder/field-type-label";

type Props = {
  /** The surface the panel is on, which decides who owns a type's id. */
  surface: FieldSurface;
  field: BuilderField;
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
  /** Whether "Read only" and "Hidden" are offered; the surface decides. */
  switches?: boolean;
  /** The type's and the surface's own display settings. */
  children?: ReactNode;
};

/**
 * The types whose input shows a placeholder. A dropdown's placeholder is one
 * of its own settings, beside its options, so it is not listed here.
 */
const TYPES_WITH_PLACEHOLDER = new Set([
  "text",
  "textarea",
  "richText",
  "email",
  "password",
  "number",
  "code",
]);

/**
 * The text-like inputs some surfaces build in (forms and user fields). They
 * show a placeholder only where the surface builds them in: elsewhere the same
 * id is a plugin's, whose own settings decide what it has.
 */
const SURFACE_TYPES_WITH_PLACEHOLDER = new Set(["url", "phone"]);

/** Whether the field's input on this surface shows a placeholder. */
function hasPlaceholder(surface: FieldSurface, type: string): boolean {
  if (TYPES_WITH_PLACEHOLDER.has(type)) return true;
  return (
    SURFACE_TYPES_WITH_PLACEHOLDER.has(type) &&
    isSurfaceBuiltInType(surface, type)
  );
}

export function DisplayTab({
  surface,
  field,
  readOnly = false,
  onChange,
  switches = true,
  children,
}: Props): JSX.Element {
  const a = field.admin ?? {};
  const setA = (next: Partial<NonNullable<BuilderField["admin"]>>) =>
    onChange({ ...field, admin: { ...a, ...next } });

  return (
    <div className="space-y-4">
      {hasPlaceholder(surface, field.type) && (
        <div className="space-y-1">
          <Label htmlFor="field-placeholder">Placeholder</Label>
          <Input
            id="field-placeholder"
            value={a.placeholder ?? ""}
            disabled={readOnly}
            onChange={e => setA({ placeholder: e.target.value })}
          />
        </div>
      )}

      {switches && (
        <>
          <SwitchRow
            ariaLabel="Read only"
            label="Read only"
            help="Displayed but cannot be edited."
            checked={a.readOnly === true}
            disabled={readOnly}
            onChange={v => setA({ readOnly: v })}
          />
          <SwitchRow
            ariaLabel="Hidden"
            label="Hidden"
            help="Not shown in the record editor."
            checked={a.hidden === true}
            disabled={readOnly}
            onChange={v => setA({ hidden: v })}
          />
        </>
      )}

      {children}
    </div>
  );
}

function SwitchRow({
  ariaLabel,
  label,
  help,
  checked,
  onChange,
  disabled,
}: {
  ariaLabel: string;
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
      <div className="flex-1 min-w-0">
        <Label className="text-sm font-medium">{label}</Label>
        <div className="text-xs text-muted-foreground">{help}</div>
      </div>
    </div>
  );
}
