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
 * This module holds the text, checkbox, select, list, icon and unsupported
 * controls and the lookup, and is the entry for the rest: the host's services
 * and what every control takes are in `content-services.ts`, the media
 * control in `media-controls.tsx`, and the rich text control in
 * `rich-text-control.tsx`.
 *
 * @module content-controls
 */

import {
  isOneParagraphProp,
  ITEM_SCHEMA_MAX_DEPTH,
  optionLabel,
  type PropSchema,
} from "@nextlyhq/blocks-engine";
import {
  Button,
  IconField,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@nextlyhq/ui";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import * as React from "react";

import { propWrites } from "./code-hints";
import { CollectionControl, SortControl } from "./collection-loop-controls";
import {
  CONTENT_CONTROL_TYPES,
  hasContentControl,
  type ContentControlType,
} from "./content-control-types";
import type { ContentControl, ContentControlProps } from "./content-services";
import { CssHint } from "./css-hint";
import { EntryFieldControl } from "./entry-field-control";
import { propLabel, type EditableProp } from "./inspector";
import { loadLucideIcons } from "./lucide-icon-source";
import { MediaControl } from "./media-controls";
import { useRecentIcons } from "./recent-icons";
import { RelationControl } from "./relation-control";
import { RichTextControl } from "./rich-text-control";
import { radioGroupStep } from "./roving-radios";
import { useStoredDraft } from "./stored-draft";
import { fitsSideBySide, type SideBySideRoom } from "./style-numeric";

// The host's services and what every control takes, the media controls and
// the rich text control live in modules of their own beside it; every name
// this module exported still is.
// Part of this module's exported names; no importer in the package reads it.
// fallow-ignore-next-line unused-type
export type { LoopRelation } from "./content-services";
export {
  type ContentControl,
  type ContentControlProps,
  type ContentServices,
  ContentServicesContext,
  type EntryQuery,
  type FoundEntry,
  type FoundMedia,
  type LinkTarget,
  type LinkTargetQuery,
  type ListEntriesCount,
  type LoopCollection,
  type LoopListField,
  type MediaPickerProps,
  type MediaSummary,
  type PickedMedia,
} from "./content-services";
export {
  ChosenMedia,
  MediaChoice,
  MediaField,
  useMediaSummary,
} from "./media-controls";
export { RichTextField } from "./rich-text-control";

export { CONTENT_CONTROL_TYPES };

/**
 * The words a block gives a prop to explain it (`hint`), shown under its
 * control and read as its description, or `undefined` for none.
 */
function propHint(prop: EditableProp): string | undefined {
  return typeof prop.schema.hint === "string" && prop.schema.hint !== ""
    ? prop.schema.hint
    : undefined;
}

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
  label,
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

  const hint = propHint(prop);
  const shared = {
    id,
    disabled,
    value: draft,
    ...(hint === undefined ? {} : { "aria-describedby": `${id}-hint` }),
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
      <Label htmlFor={id}>{label ?? propLabel(prop.name, prop.schema)}</Label>
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
      {hint === undefined ? null : (
        <p className="nx-inspector__note" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * A `text` prop: typed, unless its block asks for a control that offers the
 * values it can hold (`display: "collection"` or `display: "sort"`), which
 * fall back to typing where the host cannot list them.
 */
function TextControl(props: ContentControlProps): React.JSX.Element {
  const typed = <TextishControl {...props} />;
  const display = props.prop.schema.display;
  if (display === "collection") {
    return <CollectionControl {...props} fallback={typed} />;
  }
  if (display === "sort") {
    return <SortControl {...props} fallback={typed} />;
  }
  return typed;
}

/**
 * A yes-or-no prop, as a switch whose label says what "on" does ("Open by
 * default"), committed the moment it changes.
 */
function CheckboxControl({
  id,
  prop,
  disabled,
  onCommit,
  label,
}: ContentControlProps): React.JSX.Element {
  return (
    // As every other row is: the label in the label column, the switch in the
    // control column, where a switch drawn before its label broke the column.
    <div className="nx-inspector__field" data-content-control="checkbox">
      <Label htmlFor={id}>{label ?? propLabel(prop.name, prop.schema)}</Label>
      <Switch
        id={id}
        disabled={disabled}
        checked={(prop.value ?? prop.defaultValue) === true}
        onCheckedChange={checked => onCommit(prop.name, checked)}
      />
    </div>
  );
}

/**
 * How much room the Content tab's control column has for a row of options:
 * the Level of a heading (H1 to H6) and "This tab · A new tab" fit; a set of
 * long names does not, and stays a menu.
 */
const CONTENT_ROW: SideBySideRoom = { maxCount: 6, maxEach: 9, maxTotal: 18 };

/**
 * The option a switch turns on and the one it turns off, for a select whose
 * block asks for a switch (`display: "switch"`, `switchOn: "<option>"`), or
 * `undefined` where the declaration is not one a switch can draw (anything
 * but exactly two options, one of them `switchOn`) or `stored` is neither.
 */
function switchPairOf(
  prop: EditableProp,
  stored: string | undefined
): readonly [on: string, off: string] | undefined {
  const on = prop.schema.switchOn;
  if (prop.schema.display !== "switch" || typeof on !== "string") {
    return undefined;
  }
  if (prop.options.length !== 2 || !prop.options.includes(on)) return undefined;
  const off = prop.options.find(option => option !== on);
  if (off === undefined) return undefined;
  return stored === undefined || stored === on || stored === off
    ? [on, off]
    : undefined;
}

/**
 * A pair of options as one switch, named by the words of the option it turns
 * on, with the block's `hint`, when it gives one, as its description.
 */
function PairSwitch({
  id,
  prop,
  pair: [on, off],
  on: checked,
  disabled,
  onCommit,
}: Pick<ContentControlProps, "id" | "prop" | "disabled" | "onCommit"> & {
  pair: readonly [on: string, off: string];
  on: boolean;
}): React.JSX.Element {
  const hint = propHint(prop);
  return (
    <div
      className="nx-inspector__field"
      data-content-control="select"
      data-display="switch"
    >
      <Label htmlFor={id}>{optionLabel(prop.schema, on)}</Label>
      <Switch
        id={id}
        disabled={disabled}
        checked={checked}
        {...(hint === undefined ? {} : { "aria-describedby": `${id}-hint` })}
        onCheckedChange={next => onCommit(prop.name, next ? on : off)}
      />
      {hint === undefined ? null : (
        <p className="nx-inspector__note" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * One of a declared set of options, committed the moment it is chosen. A set
 * whose words fit side by side is drawn as a row of buttons, so every choice
 * is on screen; a longer one is a menu, and a pair the block asks to show as
 * a switch is one.
 */
function SelectControl({
  id,
  prop,
  disabled,
  onCommit,
  label,
}: ContentControlProps): React.JSX.Element {
  const name = label ?? propLabel(prop.name, prop.schema);
  const labels = prop.options.map(option => optionLabel(prop.schema, option));
  // The stored choice, or the block's default while none is stored.
  const shown = prop.value ?? prop.defaultValue;
  const stored = typeof shown === "string" ? shown : undefined;
  // Two options and a block asking for a switch: one yes-or-no row, named by
  // the words of the option it turns on. A stored value that is neither is
  // left to the menu below, which can show it, rather than read as "off" and
  // replaced at the first click.
  const pair = switchPairOf(prop, stored);
  if (pair !== undefined) {
    return (
      <PairSwitch
        id={id}
        prop={prop}
        pair={pair}
        on={stored === pair[0]}
        disabled={disabled}
        onCommit={onCommit}
      />
    );
  }
  // A stored value outside the options is shown by the menu, which can say
  // what it is; a row of buttons would show none chosen and replace it.
  // A block can ask for a menu with `display: "menu"`, so one prop reads the
  // same on every block whatever options each offers. Read through the
  // schema's open option keys rather than a declared field, so a block
  // already using `display` for something of its own keeps type-checking;
  // only the value "menu" means anything here.
  // A menu, too, where the block declares what each choice writes: the menu
  // is where that code is shown beside the words.
  const segmented =
    prop.schema.display !== "menu" &&
    !prop.options.some(
      option => optionCode(prop.schema, option) !== undefined
    ) &&
    fitsSideBySide(labels, CONTENT_ROW) &&
    (stored === undefined || prop.options.includes(stored));
  if (segmented) {
    return (
      <div className="nx-inspector__field" data-content-control="select">
        <p className="nx-inspector__field-name" id={`${id}-label`}>
          {name}
        </p>
        <SegmentedChoice
          id={id}
          labelledBy={`${id}-label`}
          options={prop.options}
          labels={labels}
          value={stored}
          disabled={disabled}
          onChoose={next => onCommit(prop.name, next)}
        />
      </div>
    );
  }
  return (
    <div className="nx-inspector__field" data-content-control="select">
      <Label htmlFor={id}>{name}</Label>
      <Select
        disabled={disabled}
        value={stored}
        onValueChange={next => onCommit(prop.name, next)}
      >
        {/* What the chosen option writes, on hover or keyboard focus. */}
        <CssHint writes={propWrites(prop.schema, stored)}>
          <SelectTrigger id={id}>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
        </CssHint>
        <SelectContent>
          {prop.options.map((option, index) => {
            const written = shownCode(prop.schema, option, labels[index]);
            return (
              <SelectItem key={option} value={option}>
                {labels[index]}
                {/* What the choice writes, muted, where the block says: an
                    HTML tag reads as words, with the tag still there. The
                    closed menu draws the chosen item's text, so it reads the
                    same. */}
                {written === undefined ? null : (
                  <code className="nx-inspector__option-value">{written}</code>
                )}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * A choice of one among a few options, as a row of radio buttons: the arrow
 * keys move the choice, as in any radio group, and only the chosen one (or the
 * first, with none chosen) is in the tab order.
 */
export function SegmentedChoice({
  id,
  labelledBy,
  options,
  labels,
  value,
  disabled,
  onChoose,
}: {
  id: string;
  labelledBy: string;
  options: readonly string[];
  labels: readonly string[];
  value: string | undefined;
  disabled: boolean;
  onChoose: (option: string) => void;
}): React.JSX.Element {
  const buttons = React.useRef<Array<HTMLButtonElement | null>>([]);
  const chosen = value === undefined ? -1 : options.indexOf(value);
  const stop = chosen === -1 ? 0 : chosen;
  return (
    <div
      id={id}
      className="nx-style-inspector__toggle"
      role="radiogroup"
      aria-labelledby={labelledBy}
    >
      {options.map((option, index) => (
        <button
          key={option}
          ref={element => {
            buttons.current[index] = element;
          }}
          type="button"
          role="radio"
          aria-checked={index === chosen}
          tabIndex={index === stop ? 0 : -1}
          disabled={disabled}
          onClick={() => onChoose(option)}
          onKeyDown={event => {
            const step = radioGroupStep(event.key);
            if (step === null) return;
            event.preventDefault();
            const next = (index + step + options.length) % options.length;
            buttons.current[next]?.focus();
            onChoose(options[next] ?? option);
          }}
        >
          {labels[index]}
        </button>
      ))}
    </div>
  );
}

/** An item field as a control sees it: a prop of its own, read from one record. */
function itemProp(
  name: string,
  schema: EditableProp["schema"],
  value: unknown
): EditableProp {
  const options = Array.isArray(schema.options)
    ? schema.options.filter(
        (option): option is string => typeof option === "string"
      )
    : [];
  return {
    name,
    schema,
    value,
    supported: hasContentControl(schema.type),
    options,
    // An item's fields are drawn whole: the rules that leave a block's prop
    // out read the block's other props, which an item does not have.
    offered: true,
    // The parent array control's `disabled` already holds the item fields.
    readOnly: false,
  };
}

/** A record's own fields, or none for a value that is not a plain record. */
function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** An item schema's fields, when the prop declares one. */
function itemSchemaOf(
  schema: EditableProp["schema"]
): readonly [string, EditableProp["schema"]][] | undefined {
  const item = schema.item;
  if (typeof item !== "object" || item === null || Array.isArray(item))
    return undefined;
  const fields = Object.entries(item).filter(
    (entry): entry is [string, EditableProp["schema"]] =>
      typeof entry[1] === "object" &&
      entry[1] !== null &&
      typeof entry[1].type === "string"
  );
  return fields.length > 0 ? fields : undefined;
}

/**
 * A list: of plain text (`of: "text"`), or of records an item schema
 * describes (`of: "object"` with `item`). Each item is edited with the
 * registry's own controls, and every change — an edit, an add, a removal, a
 * move — writes the whole list once, so each is one entry in the history.
 */
function ArrayControl({
  id,
  prop,
  disabled,
  onCommit,
  services,
  depth = 0,
}: ContentControlProps): React.JSX.Element {
  // Items past the engine's bound are not drawn, so nothing is offered that
  // the readers bounded the same way (a relation search) would refuse.
  if (depth >= ITEM_SCHEMA_MAX_DEPTH) return <UnsupportedField prop={prop} />;
  return (
    <ArrayItems
      id={id}
      prop={prop}
      disabled={disabled}
      onCommit={onCommit}
      services={services}
      depth={depth}
    />
  );
}

/** A list's items and its actions, inside the bound {@link ArrayControl} keeps. */
function ArrayItems({
  id,
  prop,
  disabled,
  onCommit,
  services,
  depth,
}: ContentControlProps & { depth: number }): React.JSX.Element {
  const label = propLabel(prop.name, prop.schema);
  const list = Array.isArray(prop.value) ? prop.value : [];
  const records = prop.schema.of === "object";
  const fields = records ? itemSchemaOf(prop.schema) : undefined;
  // The list as last written, not as this render drew it. Clicking an
  // action blurs the item being typed in first, and that blur commits it; an
  // action built from the drawn list would then write over the words just
  // committed. Every write goes through here and every action reads from it.
  const latest = React.useRef(list);
  latest.current = list;
  const write = (next: unknown[]) => {
    // Advanced only when the write lands: a refused one (a cap, a lock that
    // arrived) changed nothing, and the next action must not start from it.
    if (onCommit(prop.name, next) !== null) latest.current = next;
  };
  const position = (index: number) => `${label}, item ${index + 1}`;
  const move = (index: number, by: -1 | 1) => {
    const next = [...latest.current];
    const [taken] = next.splice(index, 1);
    next.splice(index + by, 0, taken);
    write(next);
  };

  return (
    <div
      className="nx-inspector__field nx-inspector__field--stacked"
      data-content-control="array"
    >
      <p className="nx-inspector__field-name" id={`${id}-label`}>
        {label}
      </p>
      <div
        className="nx-inspector__array"
        role="group"
        aria-labelledby={`${id}-label`}
      >
        {records && fields === undefined ? (
          <p className="nx-inspector__note">
            These items can&apos;t be edited here.
          </p>
        ) : (
          <>
            {list.map((item, index) => (
              <div
                // Positions are what identify an item: a list holds no ids.
                key={index}
                className="nx-inspector__array-item"
                role="group"
                aria-label={position(index)}
              >
                <div className="nx-inspector__array-fields">
                  {fields === undefined ? (
                    <TextishControl
                      id={`${id}-${index}`}
                      prop={itemProp(
                        `${prop.name}.${index}`,
                        { type: "text" },
                        item
                      )}
                      label={position(index)}
                      disabled={disabled}
                      onCommit={(_, value) =>
                        write(
                          latest.current.map((each, at) =>
                            at === index ? value : each
                          )
                        )
                      }
                    />
                  ) : (
                    fields.map(([name, schema]) => {
                      const Control = contentControlFor(schema.type);
                      const record = recordOf(item);
                      return Control === undefined ? (
                        <UnsupportedField key={name} prop={{ name, schema }} />
                      ) : (
                        <Control
                          key={name}
                          id={`${id}-${index}-${name}`}
                          depth={depth + 1}
                          prop={itemProp(name, schema, record[name])}
                          disabled={disabled}
                          services={services}
                          onCommit={(field, value) =>
                            write(
                              latest.current.map((each, at) => {
                                if (at !== index) return each;
                                const next = { ...recordOf(each) };
                                if (value === undefined) delete next[field];
                                else next[field] = value;
                                return next;
                              })
                            )
                          }
                        />
                      );
                    })
                  )}
                </div>
                <div className="nx-inspector__array-actions">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={disabled || index === 0}
                    aria-label={`Move ${position(index)} up`}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={disabled || index === list.length - 1}
                    aria-label={`Move ${position(index)} down`}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={`Remove ${position(index)}`}
                    onClick={() =>
                      write(latest.current.filter((_, at) => at !== index))
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              aria-label={`Add to ${label}`}
              onClick={() => write([...latest.current, records ? {} : ""])}
            >
              Add
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A prop this panel has no control for, listed rather than omitted, at the
 * top level and inside a list's items alike. A block declaring a prop the
 * panel cannot draw is still a block with that prop, and hiding it presents
 * an incomplete block as a complete one: an author would conclude the field
 * does not exist rather than that it is edited elsewhere.
 *
 * Named in plain text, not by a label: a label names a control, and one
 * pointing at nothing reads to a screen reader as a field nobody can reach.
 */
export function UnsupportedField({
  prop,
}: {
  prop: Pick<EditableProp, "name" | "schema">;
}): React.JSX.Element {
  return (
    <div className="nx-inspector__field" data-unsupported="">
      <p className="nx-inspector__field-name">
        {propLabel(prop.name, prop.schema)}
      </p>
      <p className="nx-inspector__note">
        Not editable here ({prop.schema.type}).
      </p>
    </div>
  );
}

/**
 * An `icon` prop: the chosen icon, drawn with its name and set, as one button
 * that opens a search-first picker, and a clear button. The picker offers the
 * author's recent icons first, from the host's store. The set loads when
 * the control first draws an icon or opens its picker. A chosen icon commits
 * at once, as one undo step; clearing removes the prop. An id the set no
 * longer draws is shown with a warning and kept until another is chosen.
 */
function IconControl({
  id,
  prop,
  disabled,
  onCommit,
  label,
  services,
}: ContentControlProps): React.JSX.Element {
  const name = label ?? propLabel(prop.name, prop.schema);
  const store = services?.recentIcons;
  // One list per store, which every Icon control on screen draws: a choice
  // made in another is here too, at once.
  const [recent, remember] = useRecentIcons(store);
  return (
    <div className="nx-inspector__field" data-content-control="icon">
      <Label htmlFor={id}>{name}</Label>
      <IconField
        id={id}
        label={name}
        value={
          typeof prop.value === "string" && prop.value !== ""
            ? prop.value
            : null
        }
        disabled={disabled}
        loadIcons={loadLucideIcons}
        {...(store === undefined ? {} : { recentIcons: recent })}
        onChange={next => {
          if (next !== null) remember(next);
          onCommit(prop.name, next ?? undefined);
        }}
      />
    </div>
  );
}

/**
 * A `textarea` prop: typed words, or, for a value restricted to one paragraph
 * with bold, italic and links (`oneParagraph`, a Text's), the rich-text
 * field held to that.
 */
function TextareaControl(props: ContentControlProps): React.JSX.Element {
  return isOneParagraphProp(props.prop.schema) ? (
    <RichTextControl {...props} />
  ) : (
    <TextishControl {...props} />
  );
}

/** Each type's control. Total over the list, so neither can gain a member alone. */
const CONTROLS: Readonly<Record<ContentControlType, ContentControl>> = {
  text: TextControl,
  textarea: TextareaControl,
  url: TextishControl,
  number: TextishControl,
  checkbox: CheckboxControl,
  select: SelectControl,
  media: MediaControl,
  icon: IconControl,
  richText: RichTextControl,
  array: ArrayControl,
  relation: RelationControl,
  entryField: EntryFieldControl,
};

/**
 * The control for a prop type, or `undefined` when there is none. Asked of the
 * listed names only, so an inherited name such as `constructor` resolves to
 * nothing rather than to something that is not a control.
 */
export function contentControlFor(type: string): ContentControl | undefined {
  return hasContentControl(type) ? CONTROLS[type] : undefined;
}

/**
 * The code to show beside a choice's words, or `undefined` where there is none
 * or the words already are it. Compared without regard to case, so "Section"
 * and `section` show the tag once, not as "Section section".
 */
function shownCode(
  schema: PropSchema,
  option: string,
  words: string | undefined
): string | undefined {
  const written = optionCode(schema, option);
  if (written === undefined) return undefined;
  return words?.toLowerCase() === written.toLowerCase() ? undefined : written;
}

/**
 * What one of a select's choices writes to the page, as the block declares it
 * in its `code`, one string per option value. `undefined` where it declares
 * none for that choice.
 */
function optionCode(schema: PropSchema, option: string): string | undefined {
  const code = schema.code;
  if (code === null || typeof code !== "object") return undefined;
  const written = (code as Readonly<Record<string, unknown>>)[option];
  return typeof written === "string" && written !== "" ? written : undefined;
}
