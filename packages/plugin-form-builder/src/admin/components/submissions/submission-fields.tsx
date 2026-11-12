"use client";

/**
 * A submission's answers as staff edit them: one input per field type, and a
 * consent shown as given, never offered for editing.
 *
 * @module admin/components/submissions/submission-fields
 */

import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@nextlyhq/ui";
import { CircleCheck, CircleX, Lock } from "lucide-react";
import type { JSX } from "react";

import type { FormField } from "../../../types";
import { isConsentAnswer } from "../../../utils/consent";
import { formatExportValue } from "../../../utils/export-formats";

/**
 * A consent answer: the choice, and the text the visitor was shown, quoted as
 * stored. Read-only while editing as well, with the reason beside it, since a
 * consent keeps what the visitor agreed to and no edit may change it.
 */
export function ConsentValue({
  value,
  editing,
}: {
  value: unknown;
  editing: boolean;
}): JSX.Element {
  if (!isConsentAnswer(value)) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const Icon = value.agreed ? CircleCheck : CircleX;
  return (
    <div className="space-y-1">
      <p className="flex items-start gap-2 text-sm text-foreground">
        <Icon
          className={
            value.agreed
              ? "mt-0.5 h-4 w-4 shrink-0 text-success"
              : "mt-0.5 h-4 w-4 shrink-0 text-destructive"
          }
          aria-hidden="true"
        />
        <span className="min-w-0 wrap-break-word">
          <span className="font-medium">
            {value.agreed ? "Agreed" : "Not agreed"}
          </span>
          <span className="text-muted-foreground">
            {" "}
            to &ldquo;{value.text}&rdquo;
          </span>
        </span>
      </p>
      {editing && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />A consent
          cannot be edited
        </p>
      )}
    </div>
  );
}

/** What each input is given: its id, the field, the answer, and the change. */
interface InputProps {
  id: string;
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
}

const textValue = (value: unknown): string =>
  typeof value === "string" ? value : "";

function TextareaInput({ id, value, onChange }: InputProps): JSX.Element {
  return (
    <Textarea
      id={id}
      value={textValue(value)}
      onChange={e => onChange(e.target.value)}
      rows={3}
    />
  );
}

function CheckboxInput({ id, value, onChange }: InputProps): JSX.Element {
  return (
    <Switch
      id={id}
      checked={Boolean(value)}
      onCheckedChange={checked => onChange(checked)}
    />
  );
}

function ChoiceInput({ id, field, value, onChange }: InputProps): JSX.Element {
  const options = "options" in field ? (field.options ?? []) : [];
  return (
    <Select value={textValue(value)} onValueChange={onChange}>
      <SelectTrigger
        id={id}
        className="w-full bg-transparent border-input dark:bg-muted/50"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NumberInput({ id, value, onChange }: InputProps): JSX.Element {
  const shown =
    typeof value === "number" || typeof value === "string" ? String(value) : "";
  return (
    <Input
      id={id}
      type="number"
      value={shown}
      onChange={e =>
        onChange(e.target.value === "" ? "" : Number(e.target.value))
      }
    />
  );
}

/** A plain input of `type`: text, an email address, a date or a time. */
function plainInput(type: string) {
  return function PlainInput({ id, value, onChange }: InputProps): JSX.Element {
    return (
      <Input
        id={id}
        type={type}
        value={textValue(value)}
        onChange={e => onChange(e.target.value)}
      />
    );
  };
}

/**
 * The input for each field type staff may edit. Files are media references,
 * hidden fields machine values, and other types may hold structured data:
 * coercing any of them through a text input would corrupt them, so a type
 * not here stays read-only.
 */
const INPUTS: Readonly<Record<string, (props: InputProps) => JSX.Element>> = {
  textarea: TextareaInput,
  checkbox: CheckboxInput,
  select: ChoiceInput,
  radio: ChoiceInput,
  number: NumberInput,
  date: plainInput("date"),
  time: plainInput("time"),
  text: plainInput("text"),
  email: plainInput("email"),
  url: plainInput("text"),
  phone: plainInput("text"),
};

/** Whether staff may edit an answer of this field type here. */
export function canEditAnswer(type: string): boolean {
  return type in INPUTS;
}

/** One editable input per field type; unsupported types render read-only. */
export function FieldValueInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const Editor = INPUTS[field.type];
  if (Editor) {
    return (
      <Editor
        id={`submission-field-${field.name}`}
        field={field}
        value={value}
        onChange={onChange}
      />
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      {formatExportValue(value, field) || "—"}
    </p>
  );
}
