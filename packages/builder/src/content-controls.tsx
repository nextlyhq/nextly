"use client";

/**
 * The Content tab's controls, one per prop type, looked up by the type a
 * block's prop declares.
 *
 * A registry rather than a switch, so each value type has the control that
 * fits it and a new type is one entry here. The record is typed over
 * `CONTENT_CONTROL_TYPES`, the list the inspection reads to mark a prop
 * supported, so a type cannot be supported without a control or drawn
 * without being supported.
 *
 * **Every control draws its own label and the field the label names.** A
 * label pointing at an element that is not there is announced as a field
 * nobody can reach, so the label and its control are one unit here.
 *
 * **Text commits on blur, not on every keystroke.** Undo is built from op
 * inverses, so an op per character would make one undo remove one letter.
 * Discrete controls (a checkbox, a select) commit at once: there is no typing
 * to coalesce.
 *
 * @module content-controls
 */

import {
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@nextlyhq/ui";
import * as React from "react";

import {
  CONTENT_CONTROL_TYPES,
  hasContentControl,
  type ContentControlType,
} from "./content-control-types";
import { fieldLabel, type EditableProp } from "./inspector";
import { useStoredDraft } from "./stored-draft";

export { CONTENT_CONTROL_TYPES };

/** What every content control is given. */
export interface ContentControlProps {
  /** The id its field takes, which its label points at. Unique per mount. */
  readonly id: string;
  readonly prop: EditableProp;
  /** Whether the prop may not be changed here: a lock, or a `contentOnly` area. */
  readonly disabled: boolean;
  /** Set the prop, through the editor's one write path. */
  readonly onCommit: (name: string, value: unknown) => void;
}

/** A content control: a label and the field it names. */
export type ContentControl = (props: ContentControlProps) => React.JSX.Element;

/** A prop's value as editable text, or empty when it is not representable. */
function storedText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/**
 * A field the author types into: text, textarea, url, number.
 *
 * Holds its own value while focused so typing is responsive, and reports it on
 * blur. Reading straight from the node would make every keystroke a document
 * edit; reporting only on blur without local state would make the field refuse
 * to show what was typed.
 */
function TextishControl({
  id,
  prop,
  disabled,
  onCommit,
}: ContentControlProps): React.JSX.Element {
  // Only a primitive becomes text. `String({})` is "[object Object]", and a
  // field showing that would COMMIT it on blur — turning a prop the panel
  // cannot represent into a string that permanently replaces it. An
  // unrepresentable value shows empty and, because `send` compares against
  // this, an untouched field writes nothing.
  const stored = storedText(prop.value);
  const [draft, setDraft] = useStoredDraft(stored);

  const send = () => {
    if (draft === stored) return;
    if (prop.schema.type === "number") {
      const parsed = Number(draft);
      // A number field that cannot parse reverts rather than writing NaN, which
      // survives JSON as `null` and reaches the renderer as a missing prop.
      if (draft.trim() === "" || Number.isNaN(parsed)) {
        setDraft(stored);
        return;
      }
      onCommit(prop.name, parsed);
      return;
    }
    onCommit(prop.name, draft);
  };

  const shared = {
    id,
    disabled,
    value: draft,
    onBlur: send,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => setDraft(event.target.value),
  };

  return (
    <div
      className="nx-inspector__field"
      data-content-control={prop.schema.type}
    >
      <Label htmlFor={id}>{fieldLabel(prop.name)}</Label>
      {prop.schema.type === "textarea" ? (
        <Textarea {...shared} rows={3} />
      ) : (
        <Input
          {...shared}
          type={prop.schema.type === "number" ? "number" : "text"}
          inputMode={prop.schema.type === "url" ? "url" : undefined}
          // Enter commits as well as blur. A single-line field is where an
          // author expects Enter to mean "done", and waiting for them to click
          // elsewhere leaves the canvas stale after a deliberate action.
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              send();
            }
          }}
        />
      )}
    </div>
  );
}

/** A yes-or-no prop, committed the moment it changes. */
function CheckboxControl({
  id,
  prop,
  disabled,
  onCommit,
}: ContentControlProps): React.JSX.Element {
  return (
    <div
      className="nx-inspector__field nx-inspector__field--inline"
      data-content-control="checkbox"
    >
      <Checkbox
        id={id}
        disabled={disabled}
        checked={prop.value === true}
        onCheckedChange={checked => onCommit(prop.name, checked === true)}
      />
      <Label htmlFor={id}>{fieldLabel(prop.name)}</Label>
    </div>
  );
}

/** One of a declared set of options, committed the moment it is chosen. */
function SelectControl({
  id,
  prop,
  disabled,
  onCommit,
}: ContentControlProps): React.JSX.Element {
  return (
    <div className="nx-inspector__field" data-content-control="select">
      <Label htmlFor={id}>{fieldLabel(prop.name)}</Label>
      <Select
        disabled={disabled}
        value={typeof prop.value === "string" ? prop.value : undefined}
        onValueChange={next => onCommit(prop.name, next)}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          {prop.options.map(option => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Each type's control. Total over the list, so neither can gain a member alone. */
const CONTROLS: Readonly<Record<ContentControlType, ContentControl>> = {
  text: TextishControl,
  textarea: TextishControl,
  url: TextishControl,
  number: TextishControl,
  checkbox: CheckboxControl,
  select: SelectControl,
};

/**
 * The control for a prop type, or `undefined` when there is none. Asked of the
 * listed names only, so an inherited name such as `constructor` resolves to
 * nothing rather than to something that is not a control.
 */
export function contentControlFor(type: string): ContentControl | undefined {
  return hasContentControl(type) ? CONTROLS[type] : undefined;
}
