/**
 * Drawing a form's fields and its answers, from one description: the same
 * markup for a simple form and a provider's, so both take the block's
 * styles.
 *
 * **Everything a visitor needs works with no script.** The browser refuses
 * an empty required field or a malformed email with its own message, from
 * the attributes drawn here. A send the server answered comes back as a
 * fragment (`#form-<id>-sent`, `-invalid`, `-closed`, `-error`) naming one
 * of the messages drawn here, hidden, which a CSS `:target` rule shows,
 * hiding the fields for a sent one (`FORM_RESULT_CSS`). The page itself
 * never changes, so it stays cacheable.
 *
 * **Required fields say so twice**: a visible `*`, which is decoration and
 * hidden from screen readers, and " (required)" in the label, read by them
 * and taken off screen. "* Required" is said once above the fields.
 *
 * @module blocks/form-draw
 */
import type { ReactElement, ReactNode } from "react";

import type { FormFieldDrawing } from "../context";

/** What a send was answered with, as the fragment the visitor comes back to says. */
const FORM_OUTCOMES = ["sent", "invalid", "closed", "error"] as const;

/** One of {@link FORM_OUTCOMES}. */
type FormOutcome = (typeof FORM_OUTCOMES)[number];

/**
 * What a file field says, and what the receiver answers a post to a form
 * with one: a plain form post through the page builder carries no file, so
 * a file is never dropped without a word. One sentence for both.
 */
export const FORM_FILE_NEEDS_SCRIPT =
  "This form needs JavaScript to send a file.";

/** The words shown when a send is accepted and nothing else was chosen. */
export const FORM_SENT_MESSAGE = "Thanks, we got your message.";

/** The words for each refusal, as a visitor reads them above the form. */
export const FORM_REFUSALS: Readonly<
  Record<Exclude<FormOutcome, "sent">, string>
> = {
  invalid: "Some answers weren't accepted. Please check them and send again.",
  closed: "This form isn't taking answers right now.",
  error: "Something went wrong. Please try again.",
};

/**
 * The rules that show the message a send came back to, and hide the fields
 * once it was sent. Hoisted and deduped to one copy per page (`<style href>`
 * with `precedence`).
 *
 * The messages are drawn `hidden`, so a page without this sheet shows none
 * of them rather than all four. A message targeted by the address's
 * fragment is shown; a sent one hides every other part of its form, so the
 * message stands in the form's place.
 */
export const FORM_RESULT_CSS: string = [
  "[data-nx-form-result]:target{display:block}",
  'form:has(>[data-nx-form-result="sent"]:target)>:not([data-nx-form-result="sent"]){display:none}',
].join("");

/** The key the result rules are hoisted under, once per page. */
export const FORM_RESULT_STYLE_KEY = "nx-form-results";

/** The id of the message for `outcome`, which the receiver's fragment names. */
function formResultId(anchor: string, outcome: FormOutcome): string {
  return `form-${anchor}-${outcome}`;
}

/** What drawing one field needs beyond the field itself. */
export interface FieldDrawArgs {
  /** The id its control is drawn with; its help and error ids follow it. */
  readonly id: string;
  readonly partClass: (part: string) => string;
}

/** A `data-*` name a provider may write: lower case words, never ours. */
const PROVIDER_DATA = /^[a-z][a-z0-9-]{0,40}$/;

/** A provider's opaque values as `data-*` attributes, the page builder's own names refused. */
function providerData(
  field: FormFieldDrawing
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(field.provider ?? {})) {
    if (!PROVIDER_DATA.test(key) || key.startsWith("nx-")) continue;
    if (typeof value === "string") out[`data-${key}`] = value;
  }
  return out;
}

/** The label's words, with the required marks. */
function labelWords(
  field: FormFieldDrawing,
  partClass: FieldDrawArgs["partClass"]
): ReactNode {
  return (
    <>
      {field.label}
      {field.required === true ? (
        <>
          {/* Decoration: " (required)" says it to a screen reader. */}
          <span aria-hidden="true"> *</span>
          <span className={partClass("spoken")}> (required)</span>
        </>
      ) : null}
    </>
  );
}

/** The ids a control is described by: its help, a file's note and its error slot. */
function describedBy(field: FormFieldDrawing, id: string): string {
  return [
    ...(field.help === undefined || field.help === "" ? [] : [`${id}-help`]),
    ...(field.kind === "file" ? [`${id}-file`] : []),
    `${id}-error`,
  ].join(" ");
}

/** The help line and the error slot every field ends with. */
function fieldEnd(
  field: FormFieldDrawing,
  { id, partClass }: FieldDrawArgs
): ReactNode {
  return (
    <>
      {field.help === undefined || field.help === "" ? null : (
        <p id={`${id}-help`} className={partClass("help")}>
          {field.help}
        </p>
      )}
      {field.kind === "file" ? (
        <p id={`${id}-file`} className={partClass("help")}>
          {FORM_FILE_NEEDS_SCRIPT}
        </p>
      ) : null}
      {/*
        Empty and hidden: a provider's own script, sending without a reload,
        writes the reason it refused this field here and shows it. Named by the
        control's `aria-describedby`, so a screen reader reads it with it.
      */}
      <p
        id={`${id}-error`}
        className={partClass("error")}
        data-nx-form-error=""
        hidden
      />
    </>
  );
}

/** The attributes a text-like control takes from its field. */
function constraints(field: FormFieldDrawing): Record<string, unknown> {
  return {
    ...(field.placeholder === undefined || field.placeholder === ""
      ? {}
      : { placeholder: field.placeholder }),
    ...(field.min === undefined ? {} : { min: field.min }),
    ...(field.max === undefined ? {} : { max: field.max }),
    ...(field.pattern === undefined || field.pattern === ""
      ? {}
      : { pattern: field.pattern }),
  };
}

/** A Choice, or a provider's group of checkboxes: a fieldset of options. */
function drawChoices(
  field: FormFieldDrawing,
  args: FieldDrawArgs
): ReactElement {
  const { id, partClass } = args;
  const type = field.kind === "radio" ? "radio" : "checkbox";
  return (
    <fieldset
      key={id}
      className={partClass("field")}
      aria-describedby={describedBy(field, id)}
      {...providerData(field)}
    >
      <legend>{labelWords(field, partClass)}</legend>
      {(field.options ?? []).map((option, index) => (
        <label key={`${id}-${index}`} className={partClass("choice")}>
          <input
            type={type}
            name={field.name}
            value={option.value}
            className={partClass("tick")}
            // One required radio makes the group required, which the browser
            // checks. A group of checkboxes cannot say "at least one" without
            // script, so its provider checks that on the server.
            required={type === "radio" && field.required === true}
          />
          {option.label}
        </label>
      ))}
      {fieldEnd(field, args)}
    </fieldset>
  );
}

/** A lone checkbox, its label beside it: a yes the visitor ticks. */
function drawCheckbox(
  field: FormFieldDrawing,
  args: FieldDrawArgs
): ReactElement {
  const { id, partClass } = args;
  return (
    <div key={id} className={partClass("field")}>
      <label className={partClass("choice")} htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          name={field.name}
          value="yes"
          className={partClass("tick")}
          required={field.required === true}
          aria-describedby={describedBy(field, id)}
          {...providerData(field)}
        />
        {labelWords(field, partClass)}
      </label>
      {fieldEnd(field, args)}
    </div>
  );
}

/** The control a labelled field draws: a select, a textarea or an input. */
function control(field: FormFieldDrawing, args: FieldDrawArgs): ReactElement {
  const { id, partClass } = args;
  const shared = {
    id,
    name: field.name,
    required: field.required === true,
    className: partClass("control"),
    "aria-describedby": describedBy(field, id),
    ...providerData(field),
  };
  if (field.kind === "select") {
    return (
      <select {...shared} defaultValue="">
        {/* Empty, so a required Dropdown left on it is refused by the browser. */}
        <option value="">Choose…</option>
        {(field.options ?? []).map((option, index) => (
          <option key={`${id}-${index}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === "textarea") {
    return <textarea {...shared} {...constraints(field)} rows={4} />;
  }
  return (
    <input
      {...shared}
      type={field.kind}
      {...constraints(field)}
      {...(field.kind === "file" && field.accept !== undefined
        ? { accept: field.accept }
        : {})}
    />
  );
}

/** One field, drawn for its kind. */
export function drawField(
  field: FormFieldDrawing,
  args: FieldDrawArgs
): ReactElement {
  const { id, partClass } = args;
  if (field.kind === "hidden") {
    return <input key={id} type="hidden" name={field.name} value="" />;
  }
  if (field.kind === "radio" || (field.kind === "checkbox" && field.options)) {
    return drawChoices(field, args);
  }
  if (field.kind === "checkbox") return drawCheckbox(field, args);
  return (
    <div key={id} className={partClass("field")}>
      <label htmlFor={id}>{labelWords(field, partClass)}</label>
      {control(field, args)}
      {fieldEnd(field, args)}
    </div>
  );
}

/**
 * The four messages a send can come back to, hidden until the address's
 * fragment names one. Each takes focus when it is the fragment's target
 * (`tabindex="-1"`), so a keyboard and a screen reader land on the answer.
 */
export function drawResults(args: {
  readonly anchor: string;
  readonly sentMessage: string;
  readonly partClass: (part: string) => string;
}): ReactElement[] {
  return FORM_OUTCOMES.map(outcome => (
    <div
      key={`result-${outcome}`}
      id={formResultId(args.anchor, outcome)}
      className={args.partClass("message")}
      data-nx-form-result={outcome}
      tabIndex={-1}
      hidden
    >
      {outcome === "sent" ? args.sentMessage : FORM_REFUSALS[outcome]}
    </div>
  ));
}
