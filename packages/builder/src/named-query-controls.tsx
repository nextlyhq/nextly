"use client";

/**
 * A collection list's custom source in the Content tab: its row in the
 * Source menu, the Inputs group with one control per input, the line saying
 * the query sets its own filters and order, and what is said about a stored
 * query this site no longer registers.
 *
 * Every sentence is the engine's `NAMED_QUERY_TEXT`, and every problem is
 * the engine's judgement of the inputs (`judgeNamedParams`, through
 * `named-query-model`), so the inspector and a save refuse alike, in one set
 * of words. An input is written as it is set, except where the whole set
 * cannot run yet: then the list keeps what it stores (see
 * `list-query-controls`).
 *
 * @module named-query-controls
 */
import {
  NAMED_QUERY_TEXT,
  namedQueryParamNeedsInput,
  type NamedParamProblem,
  type NamedQueryDeclaration,
  type NamedQueryParam,
  type NamedQueryParamValue,
} from "@nextlyhq/blocks-engine";
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { CalendarDays, ListFilter, TriangleAlert } from "lucide-react";
import * as React from "react";

import { SegmentedChoice, type ContentServices } from "./content-controls";
import { FieldCaution, FieldError, GroupTitle } from "./list-query-parts";
import {
  emptyWords,
  inputsNote,
  inputsOf,
  keptInputs,
  marksNeeded,
  needsInput,
  type StoredParams,
} from "./named-query-model";
import { RelationControl } from "./relation-control";

/** The mark a custom source wears in the Source control, beside a related one's. */
export const CUSTOM_SOURCE_MARK: React.JSX.Element = (
  <ListFilter aria-hidden="true" size={14} className="nx-list-query__icon" />
);

/**
 * A custom source's row in the Source menu: its label, which wraps rather
 * than being cut, and under it the developer's line, with the "Needs input"
 * tag at that line's end, so an author sees what each does while choosing.
 */
export function CustomSourceRow({
  declaration,
}: {
  declaration: NamedQueryDeclaration;
}): React.JSX.Element {
  const tagged = needsInput(declaration);
  return (
    <span className="nx-list-source">
      <span className="nx-list-source__label">{declaration.label}</span>
      {declaration.description === undefined && !tagged ? null : (
        <span className="nx-list-source__line">
          <span className="nx-list-source__description">
            {declaration.description}
          </span>
          {tagged ? (
            <span className="nx-list-source__tag">
              {NAMED_QUERY_TEXT.needsInput}
            </span>
          ) : null}
        </span>
      )}
    </span>
  );
}

/** What every input control is given. */
interface InputControlProps {
  readonly id: string;
  readonly param: NamedQueryParam;
  readonly value: NamedQueryParamValue | undefined;
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly describedBy: string | undefined;
  readonly services: ContentServices | undefined;
  readonly onInput: (value: NamedQueryParamValue | undefined) => void;
}

/** Text typed, set when the field is left or Enter pressed. */
function useTypedDraft(
  stored: string,
  onDone: (text: string) => void
): {
  draft: string;
  setDraft: (text: string) => void;
  send: () => void;
  keys: (event: React.KeyboardEvent) => void;
} {
  const [draft, setDraft] = React.useState(stored);
  React.useEffect(() => setDraft(stored), [stored]);
  const send = () => {
    if (draft !== stored) onDone(draft);
  };
  return {
    draft,
    setDraft,
    send,
    keys: event => {
      if (event.key === "Enter") {
        event.preventDefault();
        send();
      }
    },
  };
}

/** What a typed input reads of its props. */
type TypedProps = Pick<
  InputControlProps,
  "id" | "param" | "value" | "disabled" | "invalid" | "describedBy" | "onInput"
>;

/** A text input: the developer's placeholder, or its default, while empty. */
function TextInput(props: TypedProps): React.JSX.Element {
  const { id, param, value, disabled, invalid, describedBy, onInput } = props;
  const typed = useTypedDraft(typeof value === "string" ? value : "", text =>
    onInput(text.trim() === "" ? undefined : text)
  );
  return (
    <Input
      id={id}
      value={typed.draft}
      placeholder={emptyWords(param)}
      maxLength={param.type === "text" ? param.maxLength : undefined}
      disabled={disabled}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      onChange={event => typed.setDraft(event.target.value)}
      onBlur={typed.send}
      onKeyDown={typed.keys}
    />
  );
}

/** A number input, with what it counts after it ("days"). */
function NumberInput(props: TypedProps): React.JSX.Element {
  const { id, param, value, disabled, invalid, describedBy, onInput } = props;
  const unit = param.type === "number" ? param.unit : undefined;
  const typed = useTypedDraft(
    typeof value === "number" ? String(value) : "",
    text => {
      const parsed = Number(text);
      // What is not a number is sent as typed, so the judgement names it.
      onInput(
        text.trim() === "" ? undefined : Number.isNaN(parsed) ? text : parsed
      );
    }
  );
  return (
    <div
      className="nx-list-query__bound"
      data-suffixed={unit === undefined ? undefined : ""}
    >
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        value={typed.draft}
        placeholder={emptyWords(param)}
        min={param.type === "number" ? param.min : undefined}
        max={param.type === "number" ? param.max : undefined}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={event => typed.setDraft(event.target.value)}
        onBlur={typed.send}
        onKeyDown={typed.keys}
      />
      {unit === undefined ? null : (
        <span className="nx-list-query__suffix" aria-hidden="true">
          {unit}
        </span>
      )}
    </div>
  );
}

/** A yes-or-no input: Yes and No, side by side, its default chosen. */
function BooleanInput(
  props: Pick<
    InputControlProps,
    "id" | "param" | "value" | "disabled" | "onInput"
  >
): React.JSX.Element {
  const { id, param, value, disabled, onInput } = props;
  const fallback = param.type === "boolean" ? param.default === true : false;
  const on = typeof value === "boolean" ? value : fallback;
  return (
    <SegmentedChoice
      id={id}
      labelledBy={`${id}-label`}
      options={["yes", "no"]}
      labels={["Yes", "No"]}
      value={on ? "yes" : "no"}
      disabled={disabled}
      // Its default is no edit: choosing it again stores nothing.
      onChoose={option => {
        const next = option === "yes";
        onInput(next === fallback ? undefined : next);
      }}
    />
  );
}

/** The menu value that empties an optional choice. */
const ANY_CHOICE = "any";

/**
 * The menu's own value for an option, by its place: an option's value may
 * be any text, the empty one included, which the menu cannot carry as is.
 */
function optionKey(index: number): string {
  return `option:${String(index)}`;
}

/** A choice input: its options, and "Any city" first where it is optional. */
function ChoiceInput(props: TypedProps): React.JSX.Element {
  const { id, param, value, disabled, invalid, describedBy, onInput } = props;
  const options = param.type === "choice" ? param.options : [];
  const optional =
    param.type === "choice" &&
    param.required !== true &&
    param.default === undefined;
  const chosen = options.findIndex(option => option.value === value);
  return (
    <Select
      value={chosen < 0 ? "" : optionKey(chosen)}
      disabled={disabled}
      onValueChange={key =>
        onInput(
          key === ANY_CHOICE
            ? undefined
            : options.find((_, index) => optionKey(index) === key)?.value
        )
      }
    >
      <SelectTrigger
        id={id}
        size="sm"
        aria-labelledby={`${id}-label`}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        className="nx-list-input__choice"
      >
        <SelectValue placeholder={emptyWords(param)} />
      </SelectTrigger>
      <SelectContent>
        {optional ? (
          <SelectItem value={ANY_CHOICE}>{emptyWords(param)}</SelectItem>
        ) : null}
        {options.map((option, index) => (
          <SelectItem key={optionKey(index)} value={optionKey(index)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A day input: what empty means ("Today") until it is focused, then the
 * platform's own date field, as a date filter's is.
 */
function DayInput(props: TypedProps): React.JSX.Element {
  const { id, param, value, disabled, invalid, describedBy, onInput } = props;
  const stored = typeof value === "string" ? value : "";
  const [focused, setFocused] = React.useState(false);
  const typed = useTypedDraft(stored, text =>
    onInput(text === "" ? undefined : text)
  );
  const dated = focused || typed.draft !== "";
  return (
    <div className="nx-list-input__day" data-dated={dated ? "" : undefined}>
      <Input
        id={id}
        type={dated ? "date" : "text"}
        value={typed.draft}
        placeholder={emptyWords(param)}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onFocus={() => setFocused(true)}
        onChange={event => typed.setDraft(event.target.value)}
        onBlur={() => {
          setFocused(false);
          typed.send();
        }}
        onKeyDown={typed.keys}
      />
      {dated ? null : (
        <CalendarDays
          aria-hidden="true"
          size={14}
          className="nx-list-input__day-icon"
        />
      )}
    </div>
  );
}

/** An entry input: the entry picker, saying what empty means ("Any venue"). */
function EntryInput(
  props: Pick<
    InputControlProps,
    "id" | "param" | "value" | "disabled" | "services" | "onInput"
  >
): React.JSX.Element {
  const { id, param, value, disabled, services, onInput } = props;
  return (
    <div className="nx-list-input__entry">
      <RelationControl
        id={id}
        label={param.label}
        emptyWords={emptyWords(param)}
        prop={{
          name: "value",
          schema: {
            type: "relation",
            relationTo: param.type === "entry" ? param.collection : undefined,
          },
          value: value === undefined ? undefined : String(value),
          defaultValue: undefined,
          supported: true,
          options: [],
          offered: true,
          readOnly: false,
        }}
        disabled={disabled}
        services={services}
        onCommit={(_name, chosen) =>
          onInput(
            typeof chosen === "string" && chosen !== "" ? chosen : undefined
          )
        }
      />
    </div>
  );
}

/** The control for each type of input. */
const INPUT_CONTROLS: Readonly<
  Record<
    NamedQueryParam["type"],
    (props: InputControlProps) => React.JSX.Element
  >
> = {
  text: TextInput,
  number: NumberInput,
  boolean: BooleanInput,
  choice: ChoiceInput,
  day: DayInput,
  entry: EntryInput,
};

/** One input: its label, its control, and what is wrong with its value. */
function InputField({
  marked,
  problem,
  ...props
}: InputControlProps & {
  readonly marked: boolean;
  readonly problem: string | undefined;
}): React.JSX.Element {
  const Control = INPUT_CONTROLS[props.param.type];
  // The entry picker labels itself, stacked, as it does in a filter.
  if (props.param.type === "entry") {
    return (
      <div className="nx-list-input" data-input-type="entry">
        <Control {...props} />
        {problem === undefined ? null : (
          <FieldError id={`${props.id}-error`}>{problem}</FieldError>
        )}
      </div>
    );
  }
  return (
    <div
      className="nx-inspector__field nx-list-input"
      data-content-control="namedInput"
      data-input-type={props.param.type}
    >
      <Label id={`${props.id}-label`} htmlFor={props.id}>
        {props.param.label}
        {marked ? (
          <span className="nx-list-input__needed" aria-label="needed">
            {" "}
            •
          </span>
        ) : null}
      </Label>
      <Control {...props} />
      {problem === undefined ? null : (
        <FieldError id={`${props.id}-error`}>{problem}</FieldError>
      )}
    </div>
  );
}

/**
 * The Inputs group: one note naming what the query needs, then one control
 * per input, each refused inline as a save would refuse it, and a caution
 * for a stored input the query no longer takes.
 */
export function InputsGroup({
  id,
  declaration,
  params,
  problems,
  unknown,
  disabled,
  services,
  onInput,
}: {
  id: string;
  declaration: NamedQueryDeclaration;
  /** The inputs shown: what is stored, or the draft over it. */
  params: StoredParams;
  problems: readonly NamedParamProblem[];
  unknown: readonly string[];
  disabled: boolean;
  services: ContentServices | undefined;
  onInput: (key: string, value: NamedQueryParamValue | undefined) => void;
}): React.JSX.Element | null {
  const inputs = inputsOf(declaration);
  if (inputs.length === 0 && unknown.length === 0) return null;
  const titleId = `${id}-title`;
  const marked = marksNeeded(declaration);
  return (
    <section className="nx-list-query__group" aria-labelledby={titleId}>
      <GroupTitle id={titleId}>Inputs</GroupTitle>
      {inputs.length === 0 ? null : (
        <p className="nx-inspector__note nx-list-query__hint">
          {inputsNote(declaration, problems)}
        </p>
      )}
      {inputs.map(([key, param]) => {
        const problem = problems.find(each => each.param === key)?.message;
        const inputId = `${id}-${key}`;
        return (
          <InputField
            key={key}
            id={inputId}
            param={param}
            value={params[key]}
            disabled={disabled}
            invalid={problem !== undefined}
            describedBy={problem === undefined ? undefined : `${inputId}-error`}
            services={services}
            marked={marked && namedQueryParamNeedsInput(param)}
            problem={problem}
            onInput={value => onInput(key, value)}
          />
        );
      })}
      {unknown.map(key => (
        <FieldCaution key={key}>
          <TriangleAlert aria-hidden="true" size={12} />
          {NAMED_QUERY_TEXT.paramUnknown(declaration.label, key)}
        </FieldCaution>
      ))}
    </section>
  );
}

/**
 * The Inputs group of a stored query this site no longer registers: what
 * the list keeps, said once, until another source is chosen.
 */
export function KeptInputsGroup({
  id,
  params,
}: {
  id: string;
  params: StoredParams;
}): React.JSX.Element {
  const titleId = `${id}-title`;
  return (
    <section className="nx-list-query__group" aria-labelledby={titleId}>
      <GroupTitle id={titleId}>Inputs</GroupTitle>
      <p className="nx-inspector__note nx-list-query__hint">
        {NAMED_QUERY_TEXT.inputsKept(keptInputs(params))}
      </p>
    </section>
  );
}

/**
 * Filters and sort under a custom source: one read-only line where their
 * controls would be, since the query decides which entries show and in what
 * order, so an author looking for them finds why they are not there.
 */
export function FiltersSetBy({
  id,
  declaration,
}: {
  id: string;
  declaration: NamedQueryDeclaration;
}): React.JSX.Element {
  const titleId = `${id}-title`;
  return (
    <section className="nx-list-query__group" aria-labelledby={titleId}>
      <GroupTitle id={titleId}>Filters and sort</GroupTitle>
      <p className="nx-inspector__note nx-list-query__hint">
        {NAMED_QUERY_TEXT.filtersSetBy(declaration.label)}
      </p>
    </section>
  );
}
