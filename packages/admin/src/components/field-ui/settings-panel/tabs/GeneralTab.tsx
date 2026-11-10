// The General tab: the settings that make a field its type first, then what
// every field has (label, name, description, required, default value, width).
//
// A field's name follows its label only until the field is first saved. After
// that the name is its column and API key, so relabelling it must not rename
// it; renaming is a deliberate act, not a side effect of a cosmetic edit. A
// surface may also fix the name outright (a saved user field's), in which case
// the input is disabled and says why. System fields (title, slug) keep their
// name whatever the surface says, and read-only disables every input so a
// code-first entity can be inspected but not changed.
import {
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Switch,
  Textarea,
} from "@nextlyhq/ui";
import type { JSX, ReactNode } from "react";
import { useId } from "react";

import {
  FIELD_WIDTH_OPTIONS,
  type BuilderField,
  type FieldWidth,
} from "@admin/components/features/schema-builder/types";
import { toSnakeName } from "@admin/lib/builder";

import { DefaultValueField } from "./DefaultValueField";

type Props = {
  field: BuilderField;
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
  /** Whether the field has been saved; a saved field's name no longer follows its label. */
  saved?: boolean;
  /** The name a label gives a field. */
  deriveName?: (label: string) => string;
  /** Why the surface fixes the name, when it does. */
  nameFixedReason?: string;
  /** The path the API returns the field by, shown under its name. */
  apiPath?: string;
  /** The type's defining settings, drawn before everything else. */
  defining?: ReactNode;
  /** What the defining settings are called, as a group ("Dropdown settings"). */
  definingLabel?: string;
  /** Drawn after the common settings: the type's and the surface's own. */
  children?: ReactNode;
};

/**
 * The name a field has after its label is edited. It follows the label while
 * it is still the one the label gave it, under either the current derivation
 * or the one before punctuation runs collapsed, compared exactly so a
 * hand-written name is never taken for a derived one. A saved field's name,
 * or one the field may not change, never follows, whatever it looks like.
 */
function nameAfterRelabel(
  field: Pick<BuilderField, "name" | "label">,
  label: string,
  {
    saved,
    nameLocked,
    deriveName,
  }: {
    saved: boolean;
    nameLocked: boolean;
    deriveName: (label: string) => string;
  }
): string {
  if (saved || nameLocked) return field.name;
  const derived =
    field.name === deriveName(field.label) ||
    field.name === toSnakeName(field.label, "pre-collapse");
  return !field.name || derived ? deriveName(label) : field.name;
}

/** What the name's help line says: why it is fixed, or when it follows. */
function nameHelpText(saved: boolean, nameFixedReason?: string): string {
  if (nameFixedReason !== undefined) return nameFixedReason;
  return saved
    ? "Its column and API key. Editing the label never changes it."
    : "Its column and API key. Follows the label until the field is saved.";
}

export function GeneralTab({
  field,
  readOnly = false,
  onChange,
  saved = false,
  deriveName = toSnakeName,
  nameFixedReason,
  apiPath,
  defining,
  definingLabel,
  children,
}: Props): JSX.Element {
  const set = <K extends keyof BuilderField>(key: K, value: BuilderField[K]) =>
    onChange({ ...field, [key]: value });

  const setValidation = (
    next: Partial<NonNullable<BuilderField["validation"]>>
  ) =>
    onChange({
      ...field,
      validation: { ...field.validation, ...next },
    });

  const setAdmin = (next: Partial<NonNullable<BuilderField["admin"]>>) =>
    onChange({ ...field, admin: { ...field.admin, ...next } });

  return (
    <div className="space-y-4">
      {defining && (
        <div role="group" aria-label={definingLabel} className="space-y-2">
          {defining}
        </div>
      )}

      <LabelAndName
        field={field}
        readOnly={readOnly}
        saved={saved}
        deriveName={deriveName}
        nameFixedReason={nameFixedReason}
        apiPath={apiPath}
        onChange={onChange}
      />

      <div className="space-y-1">
        <Label htmlFor="field-description">Description</Label>
        <Textarea
          id="field-description"
          rows={2}
          value={field.admin?.description ?? ""}
          disabled={readOnly}
          onChange={e => setAdmin({ description: e.target.value })}
        />
      </div>

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
            const { defaultValue: _drop, ...rest } = field;
            void _drop;
            onChange(rest);
          } else {
            set("defaultValue", v);
          }
        }}
      />

      <WidthChoice
        value={field.admin?.width ?? "100%"}
        readOnly={readOnly}
        onChange={width => setAdmin({ width })}
      />

      {children}
    </div>
  );
}

/** The label, the name it gives, and the path the API returns the field by. */
function LabelAndName({
  field,
  readOnly,
  saved,
  deriveName,
  nameFixedReason,
  apiPath,
  onChange,
}: {
  field: BuilderField;
  readOnly: boolean;
  saved: boolean;
  deriveName: (label: string) => string;
  nameFixedReason?: string;
  apiPath?: string;
  onChange: (next: BuilderField) => void;
}): JSX.Element {
  const nameHelpId = useId();
  const pathId = useId();
  // System fields (title, slug) keep their name whatever the surface says.
  const nameDisabled =
    readOnly || field.isSystem === true || nameFixedReason !== undefined;
  const describedBy = apiPath ? `${nameHelpId} ${pathId}` : nameHelpId;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="field-label">Label</Label>
          <Input
            id="field-label"
            value={field.label}
            disabled={readOnly}
            onChange={e =>
              onChange({
                ...field,
                label: e.target.value,
                name: nameAfterRelabel(field, e.target.value, {
                  saved,
                  nameLocked: nameDisabled,
                  deriveName,
                }),
              })
            }
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
            aria-describedby={describedBy}
            onChange={e => onChange({ ...field, name: e.target.value })}
          />
          <p id={nameHelpId} className="text-xs text-muted-foreground">
            {nameHelpText(saved, nameFixedReason)}
          </p>
        </div>
      </div>

      {apiPath && (
        <p id={pathId} className="text-xs text-muted-foreground">
          API path: <code className="text-foreground">{apiPath}</code>
        </p>
      )}
    </>
  );
}

/**
 * The field's width in the entry form, one of the widths stored schemas use.
 * A radio group, so the chosen width is announced as chosen and arrow keys
 * move between widths.
 */
function WidthChoice({
  value,
  readOnly,
  onChange,
}: {
  value: FieldWidth;
  readOnly: boolean;
  onChange: (next: FieldWidth) => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label id={`${id}-label`}>Width</Label>
      <RadioGroup
        aria-labelledby={`${id}-label`}
        value={value}
        disabled={readOnly}
        onValueChange={next => {
          const width = FIELD_WIDTH_OPTIONS.find(o => o.value === next);
          if (width) onChange(width.value);
        }}
        className="flex flex-wrap gap-x-4 gap-y-2"
      >
        {FIELD_WIDTH_OPTIONS.map(option => (
          <div key={option.value} className="flex items-center gap-1.5">
            <RadioGroupItem value={option.value} id={`${id}-${option.value}`} />
            <Label htmlFor={`${id}-${option.value}`} className="font-normal">
              {option.label}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}
