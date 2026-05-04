// Why: General tab is the most-edited surface — Name, Label, Description,
// Placeholder, Required, Default value, and the type-specific editor below.
// System fields lock Name and Type but keep Label editable so users can
// rename "Title" to "Headline" in their admin UI without breaking the
// underlying column. readOnly mode disables every input so code-first
// collections can be inspected but not changed.
//
// Type-specific editor row (SelectOptionsEditor / RelationshipEditor /
// UploadEditor / Array / Group / Component) is delegated to the
// TypeSpecificEditor adapter, which translates the legacy per-property
// editor props to the unified BuilderField onChange contract. Adapters
// were added in PR 2 alongside the page-level mount of FieldEditorSheet.
import { Input, Label, Switch, Textarea } from "@revnixhq/ui";

import { toSnakeName } from "@admin/lib/builder";

import type { BuilderField } from "../types";

import { DefaultValueField } from "./DefaultValueField";
import { TypeSpecificEditor } from "./TypeSpecificEditor";

type Props = {
  field: BuilderField;
  /** Existing field names in the same parent scope — for uniqueness checks. */
  siblingNames: readonly string[];
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
  /** PR D: routed through to TypeSpecificEditor so the legacy Group /
   * Repeater editors can render an "+ Add field" button scoped to the
   * field being edited. */
  onAddNestedField?: (parentFieldId: string) => void;
};

const TYPES_WITH_PLACEHOLDER = new Set([
  "text",
  "textarea",
  "richText",
  "email",
  "password",
  "number",
  "code",
]);

const TYPES_WITH_TYPE_SPECIFIC_EDITOR = new Set([
  "select",
  "radio",
  "checkbox",
  "relationship",
  "upload",
  "repeater",
  "group",
  "component",
  "blocks",
]);

export function GeneralTab({
  field,
  readOnly = false,
  onChange,
  onAddNestedField,
}: Props) {
  const isSystem = field.isSystem === true;
  const nameDisabled = readOnly || isSystem;

  const set = <K extends keyof BuilderField>(key: K, value: BuilderField[K]) =>
    onChange({ ...field, [key]: value });

  const setValidation = (
    next: Partial<NonNullable<BuilderField["validation"]>>
  ) =>
    onChange({
      ...field,
      validation: { ...field.validation, ...next },
    });

  // Why: PR E1 -- typing in Label auto-derives Name (snake_case) until
  // the user manually edits Name. Same auto-derive-then-stop pattern
  // as the slug in BasicsTab. Override signal: the current name differs
  // from what an auto-derive of the OLD label would have produced.
  // System fields keep Name locked (nameDisabled) so the auto-derive
  // is a no-op there too.
  const setLabel = (label: string) => {
    if (nameDisabled) {
      onChange({ ...field, label });
      return;
    }
    const previousAutoName = toSnakeName(field.label);
    const isStillAutoName = !field.name || field.name === previousAutoName;
    onChange({
      ...field,
      label,
      name: isStillAutoName ? toSnakeName(label) : field.name,
    });
  };

  return (
    <div className="space-y-4">
      {/* PR H feedback 2.2: Label + Name in one 50/50 row (was two
          stacked rows). Auto-derive of Name from Label via setLabel
          (toSnakeName) is unchanged. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="field-label">Label</Label>
          <Input
            id="field-label"
            value={field.label}
            disabled={readOnly}
            onChange={e => setLabel(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            What content authors see in the record editor.
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="field-name">Name</Label>
          <Input
            id="field-name"
            value={field.name}
            disabled={nameDisabled}
            onChange={e => set("name", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Internal identifier. Used in the database column name and API
            response key. Auto-derived from Label until you edit it.
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="field-description">Description</Label>
        <Textarea
          id="field-description"
          rows={2}
          value={field.description ?? ""}
          disabled={readOnly}
          onChange={e => set("description", e.target.value)}
        />
      </div>

      {TYPES_WITH_PLACEHOLDER.has(field.type) && (
        <div className="space-y-1">
          <Label htmlFor="field-placeholder">Placeholder</Label>
          <Input
            id="field-placeholder"
            value={field.admin?.placeholder ?? ""}
            disabled={readOnly}
            onChange={e =>
              onChange({
                ...field,
                admin: { ...field.admin, placeholder: e.target.value },
              })
            }
          />
        </div>
      )}

      <div className="flex items-center gap-3">
        <Switch
          aria-label="Required"
          checked={field.validation?.required === true}
          disabled={readOnly}
          onCheckedChange={v => setValidation({ required: v })}
        />
        <Label>Required</Label>
      </div>

      <DefaultValueField
        field={field}
        readOnly={readOnly}
        onChange={v => {
          if (v === null) {
            // Why: PR E3 tri-state Unset (Q8 + brainstorm 2026-05-04
            // Option B): null from DefaultValueField means the user
            // picked "Unset". Strip the defaultValue key entirely so
            // every field type stores "no default" the same way (key
            // missing, not key present with null).
            const { defaultValue: _drop, ...rest } = field;
            void _drop;
            onChange(rest);
          } else {
            set("defaultValue", v);
          }
        }}
      />

      {TYPES_WITH_TYPE_SPECIFIC_EDITOR.has(field.type) && (
        <div className="border-t border-border pt-3 space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {field.type} options
          </div>
          <TypeSpecificEditor
            field={field}
            readOnly={readOnly}
            onChange={onChange}
            onAddNestedField={onAddNestedField}
          />
        </div>
      )}
    </div>
  );
}
