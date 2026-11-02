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
  isRichTextValue,
  ITEM_SCHEMA_MAX_DEPTH,
  richTextToPlainText,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  Button,
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

import {
  CONTENT_CONTROL_TYPES,
  hasContentControl,
  type ContentControlType,
} from "./content-control-types";
import { optionLabel, propLabel, type EditableProp } from "./inspector";
import type { OpenPassages } from "./open-passages";
import { RelationControl } from "./relation-control";
import { radioGroupStep } from "./roving-radios";
import { useStoredDraft } from "./stored-draft";
import { fitsSideBySide, type SideBySideRoom } from "./style-numeric";
import type { InlineRichTextEditorLoader } from "./use-inline-rich-text";

export { CONTENT_CONTROL_TYPES };

/** One item the host's media picker returned. Only its id is ever stored. */
export interface PickedMedia {
  readonly id: string;
  readonly url?: string | null;
  readonly filename?: string;
}

/** What the content controls hand the host's media picker. */
export interface MediaPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (media: PickedMedia[]) => void;
  title?: string;
  /** The kinds of file it offers, as an `accept` list: `image/*`. */
  accept?: string;
  /** What is chosen when it opens: the file the prop stores, if any. */
  initialSelectedIds?: Set<string>;
}

/** What a relation control asks the host for: one collection's entries. */
export interface EntryQuery {
  readonly collection: string;
  /** Entries whose title holds this, ignoring case; empty for the first few. */
  readonly search?: string;
  /** These entries by id, to name the one a prop stores. */
  readonly ids?: readonly string[];
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

/** One entry as a relation control shows it: its id and its title, nothing else. */
export interface FoundEntry {
  readonly id: string;
  readonly title: string;
}

/**
 * What the host lends the Content tab: the parts of the admin this package
 * cannot reach itself. Each is optional, and a control whose service is absent
 * says so rather than offering a button that does nothing.
 *
 * @experimental Grows with the controls registry.
 */
export interface ContentServices {
  /** The admin's media library, as a dialog the control opens. */
  readonly MediaPicker?: React.ComponentType<MediaPickerProps>;
  /** The shared rich-text editor, loaded when a passage is first focused. */
  readonly loadRichTextEditor?: InlineRichTextEditorLoader;
  /**
   * A collection's entries, read with the signed-in author's own access, for
   * a prop that points at one of them.
   */
  readonly findEntries?: (query: EntryQuery) => Promise<readonly FoundEntry[]>;
  /**
   * Where a rich-text field holds the passage it has open, so the host
   * finishes it before the document is stored.
   */
  readonly openPassages?: OpenPassages;
}

/** What every content control is given. */
export interface ContentControlProps {
  /** The id its field takes, which its label points at. Unique per mount. */
  readonly id: string;
  readonly prop: EditableProp;
  /** Whether the prop may not be changed here: a lock, or a `contentOnly` area. */
  readonly disabled: boolean;
  /**
   * Set the prop, through the editor's one write path; `undefined` removes
   * it. Answers the document the write produced, when the caller knows it.
   */
  readonly onCommit: (
    name: string,
    value: unknown
  ) => BlockDocument | null | void;
  /** What the host lends, for the controls that need the admin. */
  readonly services?: ContentServices | undefined;
  /**
   * How many lists this control sits inside: 0 at the top of the tab. Lists
   * nest only as deep as the engine's `ITEM_SCHEMA_MAX_DEPTH`.
   */
  readonly depth?: number;
  /**
   * The label to show, when it is not the prop's own name: an item of a list
   * is labelled by its list and its position.
   */
  readonly label?: string | undefined;
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
    </div>
  );
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
    <div
      className="nx-inspector__field nx-inspector__field--inline"
      data-content-control="checkbox"
    >
      <Switch
        id={id}
        disabled={disabled}
        checked={(prop.value ?? prop.defaultValue) === true}
        onCheckedChange={checked => onCommit(prop.name, checked)}
      />
      <Label htmlFor={id}>{label ?? propLabel(prop.name, prop.schema)}</Label>
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
 * One of a declared set of options, committed the moment it is chosen. A set
 * whose words fit side by side is drawn as a row of buttons, so every choice
 * is on screen; a longer one is a menu.
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
  // A stored value outside the options is shown by the menu, which can say
  // what it is; a row of buttons would show none chosen and replace it.
  const segmented =
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
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          {prop.options.map((option, index) => (
            <SelectItem key={option} value={option}>
              {labels[index]}
            </SelectItem>
          ))}
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
function SegmentedChoice({
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

/**
 * A media item, chosen from the host's library. Only the id is stored: the
 * page resolves it to the file's current address when it draws, so a file
 * moved or renamed in the library stays right on the page.
 */
function MediaControl({
  id,
  prop,
  disabled,
  onCommit,
  services,
}: ContentControlProps): React.JSX.Element {
  // What the last pick was called, for this session; a stored id shows as set.
  const [picked, setPicked] = React.useState<PickedMedia | null>(null);
  const label = propLabel(prop.name, prop.schema);
  const stored =
    typeof prop.value === "string" && prop.value !== "" ? prop.value : null;
  const Picker = services?.MediaPicker;
  const name = picked?.id === stored ? picked?.filename : undefined;
  return (
    <div className="nx-inspector__field" data-content-control="media">
      <p className="nx-inspector__field-name" id={`${id}-label`}>
        {label}
      </p>
      <div
        className="nx-inspector__media"
        role="group"
        aria-labelledby={`${id}-label`}
      >
        <p className="nx-inspector__note">
          {stored === null
            ? "Nothing chosen."
            : (name ?? "A file from the media library.")}
        </p>
        {Picker === undefined ? (
          <p className="nx-inspector__note">
            The media library is not available here.
          </p>
        ) : (
          <MediaChoice
            Picker={Picker}
            label={label}
            stored={stored}
            accept={
              typeof prop.schema.accept === "string"
                ? prop.schema.accept
                : undefined
            }
            disabled={disabled}
            onChoose={first => {
              setPicked(first);
              onCommit(prop.name, first.id);
            }}
          />
        )}
        {stored === null ? null : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            aria-label={`Remove ${label}`}
            onClick={() => onCommit(prop.name, undefined)}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

/** The button that opens the host's media picker, and the picker while open. */
function MediaChoice({
  Picker,
  label,
  stored,
  accept,
  disabled,
  onChoose,
}: {
  Picker: React.ComponentType<MediaPickerProps>;
  label: string;
  stored: string | null;
  accept: string | undefined;
  disabled: boolean;
  onChoose: (media: PickedMedia) => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        aria-label={`Choose ${label}`}
        onClick={() => setOpen(true)}
      >
        {stored === null ? "Choose" : "Replace"}
      </Button>
      {/*
        Mounted only while open, so each opening starts from what the prop
        stores now rather than from the picker's last choice, which could
        belong to another block and be restored by a confirm.
      */}
      {open ? (
        <Picker
          open
          onOpenChange={setOpen}
          title={`Choose ${label.toLowerCase()}`}
          {...(accept === undefined ? {} : { accept })}
          initialSelectedIds={new Set(stored === null ? [] : [stored])}
          onSelect={media => {
            const first = media[0];
            // Closed here: the picker leaves closing to whoever opened it,
            // and left open it would sit over a choice already made.
            setOpen(false);
            if (first !== undefined) onChoose(first);
          }}
        />
      ) : null}
    </>
  );
}

/** The live attachment of the shared editor to this field, while focused. */
interface RichTextSession {
  focus(at?: number): void;
  read(): unknown;
  detach(): void;
  /** Keep this attachment against anything else asking for the editor. */
  hold(): void;
}

/**
 * A rich-text passage, edited in the inspector with the admin's one rich-text
 * editor.
 *
 * The editor is attached when the field is focused, loaded with the stored
 * passage, and what it reads is committed once when the field is left, so an
 * edit is one entry in the history. There is one editor for the whole admin:
 * while it is held on the canvas the field says so and writes nothing.
 *
 * Read-only is passed to the element itself: a disabled fieldset does not
 * stop typing in a `contenteditable`.
 */
function RichTextControl({
  id,
  prop,
  disabled,
  onCommit,
  services,
}: ContentControlProps): React.JSX.Element {
  const field = React.useRef<HTMLDivElement>(null);
  const session = React.useRef<RichTextSession | null>(null);
  // Whether the field still has focus, so an editor that finishes loading
  // after the author has moved on is not attached to a field nobody is in.
  const focused = React.useRef(false);
  const [loading, setLoading] = React.useState(false);
  const [refused, setRefused] = React.useState<
    "held" | "unsupported" | "unsaved" | null
  >(null);
  const label = propLabel(prop.name, prop.schema);
  const load = services?.loadRichTextEditor;
  const editable = !disabled && load !== undefined;

  // Loaded as soon as the field is drawn, so focusing it attaches at once
  // rather than after a fetch the author would type through.
  React.useEffect(() => {
    if (editable) load().catch(() => undefined);
  }, [editable, load]);

  // The host's hold on this passage while it is open; see `OpenPassages`.
  const release = React.useRef<(() => void) | null>(null);

  const attach = async (): Promise<void> => {
    const element = field.current;
    if (!editable || element === null || session.current !== null) return;
    setLoading(true);
    let editor: Awaited<ReturnType<typeof load>>;
    try {
      editor = await load();
    } catch {
      // The editor could not be loaded: the field stays as it is, read-only.
      return;
    } finally {
      setLoading(false);
    }
    if (!focused.current || session.current !== null) return;
    const attachment = editor.attach(element, prop.value);
    if (attachment.status === "refused") {
      setRefused(attachment.reason);
      return;
    }
    setRefused(null);
    session.current = attachment.session;
    // Finished through the latest render's `finish`, whose write path is the
    // current one.
    release.current =
      services?.openPassages?.hold(() => latestFinish.current()) ?? null;
    attachment.session.focus();
  };

  const finish = (): BlockDocument | null | void => {
    focused.current = false;
    const live = session.current;
    if (live === null) {
      release.current?.();
      release.current = null;
      return null;
    }
    // Read and written BEFORE letting go: the words exist in the editor alone.
    const written = onCommit(prop.name, live.read());
    if (written === null) {
      // Refused (a size cap, a lock that arrived): the passage stays open with
      // the author's words, held against anything else taking the editor,
      // until they shorten it or press Escape, as on the canvas.
      live.hold();
      setRefused("unsaved");
      return null;
    }
    letGo(live);
    return written;
  };

  /** End the attachment and the host's hold on it. */
  const letGo = (live: RichTextSession): void => {
    release.current?.();
    release.current = null;
    session.current = null;
    live.detach();
    setRefused(null);
  };

  // While no editor is attached, the field shows the passage's words, set on
  // the element rather than rendered as children: the editor takes the
  // element's contents over once attached, and React must not own them.
  const preview = isRichTextValue(prop.value)
    ? richTextToPlainText(prop.value)
    : "";
  React.useEffect(() => {
    if (session.current === null && field.current !== null) {
      field.current.textContent = preview;
    }
  }, [preview]);

  // A passage left open when the block changes or the panel goes is finished,
  // so nothing typed is lost and the shared editor is never left held. Read
  // through a ref so the cleanup commits with this render's write path.
  const latestFinish = React.useRef(finish);
  latestFinish.current = finish;
  React.useEffect(
    () => () => {
      latestFinish.current();
    },
    []
  );

  return (
    <div className="nx-inspector__field" data-content-control="richText">
      <p className="nx-inspector__field-name" id={`${id}-label`}>
        {label}
      </p>
      <div
        id={id}
        ref={field}
        className="nx-inspector__rich-text"
        role="textbox"
        aria-multiline="true"
        aria-labelledby={`${id}-label`}
        aria-readonly={!editable}
        aria-busy={loading}
        // Not editable until the shared editor attaches and makes it so:
        // keys typed into the bare element would be replaced by the stored
        // passage the moment the editor took the element over.
        tabIndex={0}
        onFocus={() => {
          focused.current = true;
          void attach();
        }}
        onBlur={finish}
        onKeyDown={event => {
          // Escape discards a change the document refused, deliberately.
          if (event.key !== "Escape" || refused !== "unsaved") return;
          const live = session.current;
          if (live === null) return;
          event.preventDefault();
          letGo(live);
        }}
      />
      {refused === null ? null : (
        <p className="nx-inspector__note" role="status">
          {refused === "held"
            ? "This passage is being edited on the canvas. Finish there first."
            : refused === "unsaved"
              ? "This change could not be saved, perhaps because the page is at its size limit. Shorten it, or press Escape to discard it."
              : "This passage can't be edited here."}
        </p>
      )}
      {load === undefined ? (
        <p className="nx-inspector__note">
          Rich text is edited on the canvas here.
        </p>
      ) : null}
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

/** Each type's control. Total over the list, so neither can gain a member alone. */
const CONTROLS: Readonly<Record<ContentControlType, ContentControl>> = {
  text: TextishControl,
  textarea: TextishControl,
  url: TextishControl,
  number: TextishControl,
  checkbox: CheckboxControl,
  select: SelectControl,
  media: MediaControl,
  richText: RichTextControl,
  array: ArrayControl,
  relation: RelationControl,
};

/**
 * The control for a prop type, or `undefined` when there is none. Asked of the
 * listed names only, so an inherited name such as `constructor` resolves to
 * nothing rather than to something that is not a control.
 */
export function contentControlFor(type: string): ContentControl | undefined {
  return hasContentControl(type) ? CONTROLS[type] : undefined;
}
