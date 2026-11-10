// The Display tab: how the field is drawn in the record editor. Its
// placeholder where the type has a text box, whether it can be edited there,
// whether it is shown at all, then the type's own display settings (how a
// group is framed, how repeating rows are labelled).
//
// The Position setting is not offered: the record editor has one column, so a
// sidebar position would be stored and never drawn. Width is in General, with
// the settings every field has.
import { Input, Label, Switch } from "@nextlyhq/ui";
import type { JSX, ReactNode } from "react";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

type Props = {
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
  // The forms and user-fields surfaces' own text-like inputs.
  "url",
  "phone",
]);

export function DisplayTab({
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
      {TYPES_WITH_PLACEHOLDER.has(field.type) && (
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
