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
  optionLabel,
  richTextToPlainText,
  type BlockDocument,
  type FieldStoragePrimitive,
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

import { CollectionControl, SortControl } from "./collection-loop-controls";
import {
  CONTENT_CONTROL_TYPES,
  hasContentControl,
  type ContentControlType,
} from "./content-control-types";
import { EntryFieldControl } from "./entry-field-control";
import { propLabel, type EditableProp } from "./inspector";
import type { QueryField } from "./list-query-model";
import { loadLucideIcons } from "./lucide-icon-source";
import type { CustomSource } from "./named-query-model";
import type { OpenPassages } from "./open-passages";
import { useRecentIcons } from "./recent-icons";
import { RelationControl } from "./relation-control";
import { radioGroupStep } from "./roving-radios";
import type { PreferenceStore } from "./shell-state";
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

/** What a field shows of a chosen media item, read by its id. */
export interface MediaSummary {
  /** The file's name, as the author uploaded it. */
  readonly name?: string;
  /** An address to draw a small picture of it from. */
  readonly thumbnail?: string;
  /** Its alt text in the library, when it has one. */
  readonly alt?: string;
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

/** What the link control asks the host for: what a link can point at. */
export interface LinkTargetQuery {
  /** Pages and entries whose title holds this, ignoring case; empty for the first few. */
  readonly search: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

/** One page or entry the link control offers. */
export interface LinkTarget {
  readonly id: string;
  /** Its collection's slug, which a link to the entry stores. */
  readonly collection: string;
  /** The heading it is listed under: its collection's name ("Pages"). */
  readonly group: string;
  readonly title: string;
  /**
   * Where it is served on the site (`/pricing`), when the host knows. A
   * heading or a box links by this address; without one, only a block that
   * can hold an entry reference can link to it.
   */
  readonly path?: string;
}

/**
 * One field a collection list may filter by, and sort by unless it is a
 * relation: a field visitors can see, holding one value.
 */
export interface LoopListField extends QueryField {
  /** A date picked as a day, which a filter compares as that day. */
  readonly dateOnly?: boolean;
}

/** A to-many relation a related list can show the entries of. */
export interface LoopRelation {
  /** The relation field a list's `relation.field` stores. */
  readonly field: string;
  /** What the author calls it: "Categories". */
  readonly label: string;
  /** The collection its entries are in. */
  readonly collection: string;
}

/** One collection a loop can repeat over, as its controls offer it. */
export interface LoopCollection {
  /** The slug a loop stores. */
  readonly slug: string;
  /** Its name, as the admin shows it: "Blog posts". */
  readonly label: string;
  /** Its name for one entry: "Post". Its label where it has none. */
  readonly singular?: string;
  /**
   * The fields a list may filter and sort by, in the collection's order:
   * only those visitors can see, since the entries shown would otherwise
   * reveal a field no visitor may read.
   */
  readonly fields: readonly LoopListField[];
  /** Its to-many relations visitors can see, to a listed collection. */
  readonly relations?: readonly LoopRelation[];
  /**
   * Every field name it declares, so a stored filter on a field visitors
   * can't see is told apart from one on a field it no longer has.
   */
  readonly declared?: readonly string[];
  /**
   * Every field the public may read, as a save judges a list against them;
   * {@link fields} is the narrower view of these an author is offered.
   */
  readonly readable?: readonly {
    readonly name: string;
    /** What the admin calls it: "Cover image". */
    readonly label?: string;
    readonly type: string;
    readonly hasMany?: boolean;
    readonly relationTo?: string | readonly string[];
    /** A time of day, which no list filters or sorts by. */
    readonly timeOnly?: boolean;
    /** The primitive a plugin's field type is stored as, which gives its kind. */
    readonly storage?: FieldStoragePrimitive;
  }[];
}

/** A list's matching entries, and how many of them it shows. */
export interface ListEntriesCount {
  readonly matching: number;
  readonly shown: number;
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
   * The pages and entries a link can point at, read with the signed-in
   * author's own access and listed by collection, the site's own pages first.
   * Absent, a link control takes typed addresses only.
   */
  readonly findLinkTargets?: (
    query: LinkTargetQuery
  ) => Promise<readonly LinkTarget[]>;
  /**
   * The collections a collection loop can repeat over, read with the
   * signed-in author's own access, each with the fields visitors can see
   * and its to-many relations. Absent, a loop's collection and sort are
   * typed as text.
   */
  readonly listLoopCollections?: () => Promise<readonly LoopCollection[]>;
  /**
   * The custom sources a collection list may show: the named queries the
   * site registers, each without its run function, with the collections it
   * reads that visitors can read nothing of. Absent, the Source menu offers
   * collections and related entries only.
   */
  readonly listCustomSources?: () => Promise<readonly CustomSource[]>;
  /**
   * How many entries a list's stored query matches as the canvas reads them,
   * and how many of those its window shows, from one count read. Asked only
   * for the list selected in the editor. Undefined where one read cannot
   * count it, such as a list of an entry's related entries.
   */
  readonly countListEntries?: (
    props: Readonly<Record<string, unknown>>
  ) => Promise<ListEntriesCount | undefined>;
  /**
   * The collection the document being edited is an entry of, so a list on
   * it can show the entry's related entries. `null` where the document is
   * known to be no collection's entry, such as a Single, so a list there
   * showing the entry's related entries is refused as the save refuses it;
   * absent where that is not known.
   */
  readonly entryCollection?: string | null;
  /**
   * A media item by its id, read with the signed-in author's own access, so a
   * stored file is shown by its picture and name rather than as "a file".
   */
  readonly readMedia?: (mediaId: string) => Promise<MediaSummary | null>;
  /**
   * Where a rich-text field holds the passage it has open, so the host
   * finishes it before the document is stored.
   */
  readonly openPassages?: OpenPassages;
  /**
   * Where the icons this author chose last are kept, for the Icon control's
   * Recent row: the host's, so it is one per signed-in author. Absent, the
   * picker offers no Recent row.
   */
  readonly recentIcons?: PreferenceStore;
}

/**
 * The host's content services for a surface below the inspector that is not
 * a Content tab control, such as a component placement's exposed image, so
 * it reaches the same media library without a prop threaded through every
 * surface between.
 */
export const ContentServicesContext: React.Context<
  ContentServices | undefined
> = React.createContext<ContentServices | undefined>(undefined);

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
  /**
   * The block's other props as stored, read-only, for a control whose
   * choices depend on one: a loop's sort offers the fields of the collection
   * its `collectionProp` names. Absent inside a list's items.
   */
  readonly values?: Readonly<Record<string, unknown>> | undefined;
}

/** A content control: a label and the field it names. */
export type ContentControl = (props: ContentControlProps) => React.JSX.Element;

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
  const segmented =
    prop.schema.display !== "menu" &&
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
              {/* The value itself, muted, where the block asks for it: an
                  HTML tag reads as words, with the tag still there. */}
              {prop.schema.showOptionValue === true &&
              labels[index] !== option ? (
                <span className="nx-inspector__option-value">{option}</span>
              ) : null}
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
  return (
    <MediaField
      id={id}
      label={propLabel(prop.name, prop.schema)}
      stored={
        typeof prop.value === "string" && prop.value !== "" ? prop.value : null
      }
      accept={
        typeof prop.schema.accept === "string" ? prop.schema.accept : undefined
      }
      disabled={disabled}
      services={services}
      onChange={next => onCommit(prop.name, next)}
    />
  );
}

/**
 * A media field: the chosen file, the button that opens the host's picker,
 * and Remove. Shared by the media control and an image's source, which
 * writes the same id alongside the props it keeps in step.
 */
export function MediaField({
  id,
  label,
  stored,
  accept,
  disabled,
  services,
  showAlt = true,
  onChange,
}: {
  id: string;
  label: string;
  /** The stored id, or `null` for none. */
  stored: string | null;
  accept: string | undefined;
  disabled: boolean;
  services: ContentServices | undefined;
  /** Whether to show the library's alt text under the file's name. */
  showAlt?: boolean;
  /** Store an id, or `undefined` to remove it. */
  onChange: (mediaId: string | undefined) => void;
}): React.JSX.Element {
  // What the last pick was called, for this session; a stored id shows as set.
  const [picked, setPicked] = React.useState<PickedMedia | null>(null);
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
        <ChosenMedia
          mediaId={stored}
          read={services?.readMedia}
          pickedName={name}
          fallback="A file from the media library."
          showAlt={showAlt}
        />
        {Picker === undefined ? (
          <p className="nx-inspector__note">
            The media library is not available here.
          </p>
        ) : (
          <MediaChoice
            Picker={Picker}
            label={label}
            stored={stored}
            accept={accept}
            disabled={disabled}
            onChoose={first => {
              setPicked(first);
              onChange(first.id);
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
            onClick={() => onChange(undefined)}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * A chosen media item as a field shows it: its thumbnail, its name and its
 * alt text, read by its id. Shared with a placement's exposed image, so a
 * stored file reads the same in both. Until it is read, or where it cannot
 * be, the name of the last pick, else a plain sentence that a file is chosen.
 */
export function ChosenMedia({
  mediaId,
  read,
  pickedName,
  fallback,
  showAlt = true,
}: {
  mediaId: string | null;
  read: ContentServices["readMedia"];
  pickedName: string | undefined;
  fallback: string;
  /** Whether to show its library alt text, where a row of its own does not. */
  showAlt?: boolean;
}): React.JSX.Element {
  const summary = useMediaSummary(read, mediaId);
  if (mediaId === null) {
    return <p className="nx-inspector__note">Nothing chosen.</p>;
  }
  const name = summary?.name ?? pickedName ?? fallback;
  return (
    <div className="nx-inspector__media-chosen">
      {summary?.thumbnail === undefined ? null : (
        // Decorative: the name beside it says which file it is.
        <img
          className="nx-inspector__media-thumb"
          src={summary.thumbnail}
          alt=""
        />
      )}
      <div className="nx-inspector__media-text">
        <p className="nx-inspector__media-name" title={name}>
          {name}
        </p>
        {summary?.alt === undefined || !showAlt ? null : (
          // Named as the library's: a page's own Alt text, where the block
          // has one, wins over it, and this is only the fallback.
          <p className="nx-inspector__note">Library alt text: {summary.alt}</p>
        )}
      </div>
    </div>
  );
}

/**
 * The summary of `mediaId`, read once per id; `undefined` until it is read,
 * and for the id it was read for only, so a summary never shows beside
 * another file's id.
 */
export function useMediaSummary(
  read: ContentServices["readMedia"],
  mediaId: string | null
): MediaSummary | null | undefined {
  const [found, setFound] = React.useState<{
    id: string;
    summary: MediaSummary | null;
  }>();
  React.useEffect(() => {
    if (read === undefined || mediaId === null) return;
    let live = true;
    const settle = (summary: MediaSummary | null) => {
      if (live) setFound({ id: mediaId, summary });
    };
    read(mediaId).then(settle, () => settle(null));
    return () => {
      live = false;
    };
  }, [read, mediaId]);
  return found?.id === mediaId ? found.summary : undefined;
}

/**
 * The button that opens the host's media picker, and the picker while open.
 * Shared with a component placement's exposed image, so both choose a file
 * the same way.
 */
export function MediaChoice({
  id,
  Picker,
  label,
  stored,
  accept,
  disabled,
  onChoose,
}: {
  /** The button's id, for a field label that names it. */
  id?: string;
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
        {...(id === undefined ? {} : { id })}
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
 * A passage as one string, to tell one stored passage from another; empty
 * for one that cannot be written out (a cycle), which no stored one is.
 */
function passageKey(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/** The Content tab's rich-text prop: its name, and the passage under it. */
function RichTextControl({
  id,
  prop,
  disabled,
  onCommit,
  services,
}: ContentControlProps): React.JSX.Element {
  return (
    <div className="nx-inspector__field" data-content-control="richText">
      <p className="nx-inspector__field-name" id={`${id}-label`}>
        {propLabel(prop.name, prop.schema)}
      </p>
      <RichTextField
        id={id}
        labelledBy={`${id}-label`}
        value={prop.value}
        disabled={disabled}
        onCommit={value => onCommit(prop.name, value)}
        services={services}
      />
    </div>
  );
}

/**
 * A rich-text passage, edited in the inspector with the admin's one rich-text
 * editor. Shared by every surface that edits one: the Content tab's prop and a
 * placement's exposed field, each with its own label and write path.
 *
 * The editor is attached when the field is focused, loaded with the stored
 * passage, and what it reads is committed once when the field is left, so an
 * edit is one entry in the history. There is one editor for the whole admin:
 * while it is held on the canvas the field says so and writes nothing.
 *
 * Read-only is passed to the element itself: a disabled fieldset does not
 * stop typing in a `contenteditable`.
 */
export function RichTextField({
  id,
  labelledBy,
  value,
  disabled,
  onCommit,
  services,
}: {
  id: string;
  /** The id of the element naming the field. */
  labelledBy: string;
  /** The passage stored, or `undefined` for none. */
  value: unknown;
  disabled: boolean;
  /**
   * Write the passage the editor reads; `null` when the write was refused,
   * which keeps the passage open with the author's words.
   */
  onCommit: (value: unknown) => BlockDocument | null | void;
  services: ContentServices | undefined;
}): React.JSX.Element {
  const field = React.useRef<HTMLDivElement>(null);
  const session = React.useRef<RichTextSession | null>(null);
  // Whether the field still has focus, so an editor that finishes loading
  // after the author has moved on is not attached to a field nobody is in.
  const focused = React.useRef(false);
  const [loading, setLoading] = React.useState(false);
  const [refused, setRefused] = React.useState<
    "held" | "unsupported" | "unsaved" | null
  >(null);
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
    const attachment = editor.attach(element, value);
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
    const written = onCommit(live.read());
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
  const preview = isRichTextValue(value) ? richTextToPlainText(value) : "";
  // A stored passage that changes under words the document refused (a Reset,
  // an undo) is what the page now holds: the refused draft is let go and the
  // field shows the stored one, rather than the draft and its notice sitting
  // over a value that has moved on. Keyed on the whole passage, so a change
  // its plain text would not show is still seen.
  const storedKey = passageKey(value);
  const refusedNow = React.useRef(refused);
  refusedNow.current = refused;
  const latestLetGo = React.useRef(letGo);
  latestLetGo.current = letGo;
  React.useEffect(() => {
    const live = session.current;
    if (live !== null && refusedNow.current === "unsaved") {
      latestLetGo.current(live);
    }
    if (session.current === null && field.current !== null) {
      field.current.textContent = preview;
    }
  }, [storedKey, preview]);

  // A passage left open when the block changes or the panel goes is finished,
  // so nothing typed is lost and the shared editor is never left held. Read
  // through a ref so the cleanup commits with this render's write path.
  const latestFinish = React.useRef(finish);
  latestFinish.current = finish;
  React.useEffect(
    () => () => {
      latestFinish.current();
      // A passage the document refused stays open while its field is on
      // screen, where the author can shorten it or press Escape. Once the
      // field is gone it has no one to finish it, so it is let go rather
      // than left holding the shared editor and the unsaved state.
      const refused = session.current;
      if (refused !== null) {
        release.current?.();
        release.current = null;
        session.current = null;
        refused.detach();
      }
    },
    []
  );

  return (
    <>
      <div
        id={id}
        ref={field}
        className="nx-inspector__rich-text"
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelledBy}
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
    </>
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

/** Each type's control. Total over the list, so neither can gain a member alone. */
const CONTROLS: Readonly<Record<ContentControlType, ContentControl>> = {
  text: TextControl,
  textarea: TextishControl,
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
