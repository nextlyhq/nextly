"use client";

/**
 * The test data as fields: one per declared variable, of the kind it holds.
 *
 * A list gets a row per item, which the author adds and removes; an object,
 * and each item of a list that declares its fields, gets a field per field.
 * What a field holds is the test data itself, so the preview and a test send
 * read exactly what is shown here; a value its type's control can't show (a
 * loaded record's or an example's) is said to be so rather than shown as
 * another value.
 */
import { Button, Input, Label, Switch } from "@nextlyhq/ui";
import { useId, type JSX } from "react";

import { Plus, Trash2 } from "@admin/components/icons";
import type {
  EmailTemplateVariableField,
  EmailTemplateVariableType,
} from "@admin/services/emailTemplateApi";

import { objectOf, type SampleDeclaration } from "./sample-data";

/** What a field is drawn from: a declaration, or one of its fields. */
interface FieldSpec {
  name: string;
  label?: string;
  description?: string;
  type?: EmailTemplateVariableType;
  fields?: EmailTemplateVariableField[];
}

export function DataFields({
  variables,
  data,
  onChange,
}: {
  variables: ReadonlyArray<SampleDeclaration & { description?: string }>;
  data: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
}): JSX.Element {
  const declared = firstOfEachName(
    variables.filter(v => v.name && !v.name.includes("."))
  );
  if (declared.length === 0) {
    return (
      <p className="rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground">
        No variables are declared. Declare one in Details, or edit the test data
        as JSON.
      </p>
    );
  }
  return (
    <div className="space-y-3" data-testid="data-fields">
      {declared.map(variable => (
        <ValueField
          key={variable.name}
          spec={{
            name: variable.name,
            description: variable.description,
            ...variable.presentation,
          }}
          value={data[variable.name]}
          onChange={value => onChange(variable.name, value)}
        />
      ))}
    </div>
  );
}

function labelOf(spec: FieldSpec): string {
  return spec.label || spec.name;
}

/** One value, drawn as its type. */
function ValueField({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
}): JSX.Element {
  if (!fitsType(spec.type, value)) {
    return <MisfitField spec={spec} value={value} />;
  }
  if (spec.type === "list") {
    return <ListField spec={spec} value={value} onChange={onChange} />;
  }
  if (spec.type === "object") {
    return (
      <fieldset className="space-y-2 rounded-md border border-border p-2.5">
        <legend className="px-1 text-xs font-medium">{labelOf(spec)}</legend>
        <ObjectFields
          fields={spec.fields ?? []}
          value={value}
          onChange={onChange}
        />
      </fieldset>
    );
  }
  return <ScalarField spec={spec} value={value} onChange={onChange} />;
}

/** The fields of an object value, each one its own field. */
function ObjectFields({
  fields,
  value,
  onChange,
}: {
  fields: readonly EmailTemplateVariableField[];
  value: unknown;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const object = isRecord(value) ? value : {};
  return (
    <>
      {fields.map(field => (
        <ValueField
          key={field.name}
          spec={field}
          value={object[field.name]}
          onChange={next => onChange({ ...object, [field.name]: next })}
        />
      ))}
    </>
  );
}

/** A list: a row per item, added and removed by the author. */
function ListField({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const items = Array.isArray(value) ? value : [];
  const fields = spec.fields ?? [];
  const label = labelOf(spec);
  const setItem = (index: number, item: unknown) =>
    onChange(items.map((current, i) => (i === index ? item : current)));
  return (
    <fieldset className="space-y-2 rounded-md border border-border p-2.5">
      <legend className="px-1 text-xs font-medium">{label}</legend>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No rows.</p>
      ) : null}
      {items.map((item, index) => (
        <div
          // Rows have no identity of their own; their place is what they are.
          key={index}
          className="space-y-2 rounded-md bg-muted/40 p-2"
          data-testid={`row-${spec.name}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Row {index + 1}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5"
              aria-label={`Remove row ${index + 1} of ${label}`}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          {fields.length > 0 ? (
            <ObjectFields
              fields={fields}
              value={item}
              onChange={next => setItem(index, next)}
            />
          ) : (
            <ScalarField
              spec={{
                name: `${spec.name}-${index}`,
                label: `Item ${index + 1}`,
              }}
              value={item}
              onChange={next => setItem(index, next)}
            />
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() =>
          onChange([...items, fields.length > 0 ? objectOf(fields) : ""])
        }
      >
        <Plus className="h-3.5 w-3.5" />
        Add a row to {label}
      </Button>
    </fieldset>
  );
}

/** A value that is not a list or an object, with the input its type takes. */
function ScalarField({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const label = labelOf(spec);
  const hint = spec.description ? (
    <p id={hintId} className="text-xs text-muted-foreground">
      {spec.description}
    </p>
  ) : null;

  if (spec.type === "boolean") {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={id} className="text-xs">
            {label}
          </Label>
          <Switch
            id={id}
            checked={value === true}
            onCheckedChange={checked => onChange(checked)}
            aria-describedby={hint ? hintId : undefined}
          />
        </div>
        {hint}
      </div>
    );
  }

  const numeric = spec.type === "number" || spec.type === "money";
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type={inputTypeOf(spec.type)}
        // Money is shown to the cent; any other number as typed.
        step={spec.type === "money" ? "0.01" : undefined}
        inputMode={numeric ? "decimal" : undefined}
        value={displayed(value)}
        onChange={event => {
          const text = event.target.value;
          onChange(numeric && text !== "" ? Number(text) : text);
        }}
        aria-describedby={hint ? hintId : undefined}
        className="h-8 text-xs"
      />
      {hint}
    </div>
  );
}

/**
 * A value its type's control can't show, said to be so: shown in a field of
 * its kind, it would read as another value while the preview receives this
 * one. It is changed in JSON.
 */
function MisfitField({
  spec,
  value,
}: {
  spec: FieldSpec;
  value: unknown;
}): JSX.Element {
  return (
    <div className="space-y-1" data-testid={`misfit-${spec.name}`}>
      <p className="text-xs font-medium">{labelOf(spec)}</p>
      <p className="rounded-md border border-warning-border bg-warning-surface p-2 text-xs text-foreground">
        Holds <code className="font-mono">{JSON.stringify(value)}</code>, which
        isn&apos;t {articleOf(spec.type)}. Change it in JSON.
      </p>
    </div>
  );
}

/** What a value of `type` is called, with its article. */
function articleOf(type: EmailTemplateVariableType | undefined): string {
  switch (type) {
    case "number":
      return "a number";
    case "money":
      return "an amount";
    case "date":
      return "a date";
    case "boolean":
      return "a yes or no";
    case "list":
      return "a list";
    case "object":
      return "an object";
    default:
      return "text";
  }
}

/** A date as a date input holds one: `YYYY-MM-DD`. */
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether the control drawn for `type` shows `value` as it is. Nothing yet
 * (undefined) fits every type: the field starts empty.
 */
function fitsType(
  type: EmailTemplateVariableType | undefined,
  value: unknown
): boolean {
  if (value === undefined) return true;
  switch (type) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
    case "money":
      return (
        value === "" || (typeof value === "number" && Number.isFinite(value))
      );
    case "date":
      return (
        typeof value === "string" && (value === "" || DATE_VALUE.test(value))
      );
    case "list":
      return Array.isArray(value);
    case "object":
      return isRecord(value);
    default:
      return (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      );
  }
}

/** Each name's first declaration: a name declared twice is one value. */
function firstOfEachName<T extends { name: string }>(
  declarations: readonly T[]
): T[] {
  const seen = new Set<string>();
  return declarations.filter(declaration => {
    if (seen.has(declaration.name)) return false;
    seen.add(declaration.name);
    return true;
  });
}

function inputTypeOf(type: EmailTemplateVariableType | undefined): string {
  switch (type) {
    case "number":
    case "money":
      return "number";
    case "date":
      return "date";
    case "link":
      return "url";
    default:
      return "text";
  }
}

/** A value as an input shows it: text as it is, anything else written out. */
function displayed(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
