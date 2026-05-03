// Why: General tab is the most-edited surface — Name, Label, Description,
// Placeholder, Required, Default value, and the type-specific editor below.
// System fields lock Name and Type but keep Label editable so users can
// rename "Title" to "Headline" in their admin UI without breaking the
// underlying column. readOnly mode disables every input so code-first
// collections can be inspected but not changed.
//
// PR 1 scope note: the type-specific editor row (SelectOptionsEditor /
// RelationshipEditor / UploadEditor / Array+Group+Component+Blocks) is
// rendered as a placeholder. The legacy editors take per-property props
// and need adapter wrappers to map onto the unified BuilderField onChange
// contract — that wiring lands in PR 2 alongside the page-level mount of
// FieldEditorSheet, so the adapters live next to the page code that needs
// them.
import { Input, Label, Switch, Textarea } from "@revnixhq/ui";

import type { BuilderField } from "../types";

type Props = {
  field: BuilderField;
  /** Existing field names in the same parent scope — for uniqueness checks. */
  siblingNames: readonly string[];
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
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

export function GeneralTab({ field, readOnly = false, onChange }: Props) {
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

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="field-name">Name</Label>
        <Input
          id="field-name"
          value={field.name}
          disabled={nameDisabled}
          onChange={e => set("name", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Internal identifier. Used in the database column name and API response
          key.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="field-label">Label</Label>
        <Input
          id="field-label"
          value={field.label}
          disabled={readOnly}
          onChange={e => set("label", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          What content authors see in the record editor.
        </p>
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

      {TYPES_WITH_TYPE_SPECIFIC_EDITOR.has(field.type) && (
        <div className="border-t border-border pt-3 space-y-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {field.type} options
          </div>
          <p className="text-xs text-muted-foreground italic">
            Type-specific editor wired in PR 2 (Collections page mount).
          </p>
        </div>
      )}
    </div>
  );
}
