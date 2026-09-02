/**
 * `core/form` — a form that posts where the author says, with no runtime.
 *
 * Plain HTML: a `<form>`, labelled controls, a submit button. It stores
 * nothing, validates nothing beyond what the browser does for `required` and
 * `type`, and ships no client JavaScript. A form that collects submissions,
 * branches on answers, guards against spam and notifies somebody is a different
 * product, and it already exists as the form-builder plugin — which contributes
 * no block of its own, so the two do not compete for a name or for an author's
 * choice. This one is for the case that plugin is too much machinery for: a
 * contact form pointed at a route handler, a hosted form service, or `mailto:`.
 *
 * **Every element is a DIRECT child of the form, which is the layout.** The
 * root is a grid, so each label and each control becomes its own row and the
 * label sits above the control it names. Nothing is wrapped: a `<label>` around
 * each pair would be a second element per field, and the grouping it exists to
 * produce is available without one.
 *
 * **The grouping comes from TWO distances rather than one.** A single `gap`
 * spaced a label from the control it names exactly as far as from the next
 * question, so nothing read as belonging together. The `gap` is now the smaller
 * of the two — label to its own control — and each control states the larger one
 * below itself, which falls between fields and before the submit. Stating it
 * below the control rather than above the label is what keeps the FIRST label
 * flush with the top of the form instead of pushed down by a leading margin.
 *
 * The control's distance is a PART, which is how a block states a rule for an
 * element it renders inside its own root. Inline styles are not an option and
 * should not be — see `root-inline-styles.test.tsx` for why a block may not
 * write one.
 *
 * **Labels are associated explicitly, not by wrapping.** `htmlFor` and `id` are
 * the association that survives the flattening above, and the id is derived
 * from the NODE's id so two forms on one page cannot mint the same one.
 *
 * @module blocks/library/form
 */
import { defineBlock } from "@nextlyhq/blocks-engine";
import type { ReactElement, ReactNode } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { BUTTON_BASE_STYLES } from "./button";
import { INTERACTIVE } from "./categories";
import { flag, oneOf, text, url } from "./props";

/** The control types a field may declare. */
export const FORM_FIELD_TYPES = [
  "text",
  "email",
  "tel",
  "number",
  "url",
  "date",
  "textarea",
] as const;

/** One of the control types a field may declare. */
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/**
 * The methods a form may use.
 *
 * `post` first, because it is the default: a `get` form puts every answer in
 * the URL, where it reaches the server's logs and the visitor's history.
 */
export const FORM_METHODS = ["post", "get"] as const;

/** One of the methods a form may use. */
export type FormMethod = (typeof FORM_METHODS)[number];

/** One field in a form. */
export interface FormFieldSpec {
  /** The visible label. */
  label?: string;
  /** The `name` the value is submitted under. */
  name?: string;
  /** Which control is rendered. */
  type?: FormFieldType;
  /** Whether the browser should refuse an empty submission. */
  required?: boolean;
}

export interface FormProps {
  /** Where the form submits. Omitted posts back to the page's own URL. */
  action?: string;
  /** How the form submits. */
  method?: FormMethod;
  /** The submit button's label. */
  submitText?: string;
  /** The fields, in order. */
  fields?: FormFieldSpec[];
}

/**
 * How many fields are rendered from one stored array.
 *
 * The same reasoning `core/list` records for its own cap: a stored array has no
 * length of its own, so `fields` arrives at whatever length was written, and
 * past the renderer's inspection budget the normalizer refuses the WHOLE output
 * and the block becomes a placeholder — an accidentally long form would lose
 * every field rather than the ones past the end.
 *
 * Far lower than the list's thousand, because the shapes differ: a thousand-item
 * list is a plausible document and a thousand-field form is not one anybody
 * meant. This sits well above any form a person fills in and well below the
 * budget.
 */
const MAX_FIELDS = 100;

/**
 * The grid that stacks the labels and controls.
 *
 * **`gap` is a LENGTH rather than a `{ $token }`, and the reason is a defect
 * this block shipped with.** It first read `{ $token: "space.4" }`, on the
 * argument that `container.tsx` wants spacing from a token and that `space.4`
 * is in `defaultSiteTokens()`. Both halves are true and the conclusion was
 * still wrong AT THE TIME: a token reference compiles to `var(--site-space-4)`,
 * and nothing in the repository then emitted that variable.
 *
 * An undefined custom property makes the declaration invalid at computed-value
 * time, so `gap` fell back to `normal`, which for a grid is zero. The form
 * rendered with its fields touching, and every check passed: the property is in
 * `STYLE_CATALOG`, the declaration reached the compiled stylesheet, and the
 * test asserted exactly that. **Whether the `var()` RESOLVES is a third
 * question, and nothing asked it.**
 *
 * **That emptiness is over, and this line still does not go back.**
 * `PageRenderer` compiles a site sheet by default, so a rendered page defines
 * `--site-space-4` and a reference would now resolve. The reason this stays a
 * length is therefore no longer the plumbing — it is the one below, and it
 * would hold even if it had never been the plumbing.
 *
 * The VALUE is no longer `space.4`, and that is a change of meaning rather than
 * of taste: this gap once carried the whole of the form's spacing, and now
 * carries only the distance from a label to the control it names. The field
 * separation moved to the control's own part, where the two together still come
 * to `1rem`. So a future token here is a label-to-control token, not `space.4`.
 *
 * Both `display` and `gap` are in `STYLE_CATALOG`. A property that is not is
 * dropped by the compiler rather than passed through, so the test asserts the
 * COMPILED CSS instead of this object: an object assertion passes on a
 * declaration that compiles to nothing.
 */
export const FORM_BASE_STYLES = {
  base: {
    base: {
      display: "grid",
      // The gap is now the distance from a label to the control it names, NOT
      // the distance between fields. One even gap spaced a label as far from
      // its own input as from the next question, so nothing grouped; the field
      // separation is stated by the control instead, which is the only element
      // that knows a field has ended.
      gap: "0.25rem",
    },
  },
} as const;

/**
 * The control a field's label names.
 *
 * Carried on the CONTROL rather than the label, and the difference is the whole
 * reason there is no leading gap inside the form: a margin above each label
 * separates fields equally well and also pushes the FIRST label down, which
 * reads as stray padding nobody asked for. Below the control the same distance
 * falls only between fields and before the submit, where it is wanted.
 */
const FORM_PARTS = {
  control: {
    baseStyles: {
      base: {
        base: {
          margin: { blockEnd: "0.75rem" },
          /*
           * The control has to LOOK like a control.
           *
           * A user agent draws a border and a background on an input; a host
           * reset takes both away, and Tailwind's Preflight — which the
           * scaffold ships — is one. This part existed and stated only
           * spacing, so a form rendered as a column of labels with nothing
           * under them: the field was there, focusable and submittable, and
           * invisible.
           *
           * Colours are tokens because a literal is wrong in whichever of
           * light and dark it was not chosen for. Spacing and the radius are
           * literals, which is safe for the same reason `core/card` gives.
           */
          boxSizing: "border-box",
          width: "100%",
          padding: {
            blockStart: "0.5rem",
            blockEnd: "0.5rem",
            inlineStart: "0.75rem",
            inlineEnd: "0.75rem",
          },
          backgroundColor: { $token: "color.background" },
          color: { $token: "color.text" },
          borderRadius: "6px",
          border: {
            // Per LOGICAL side, so it follows writing direction rather than
            // assuming left-to-right.
            width: {
              blockStart: "1px",
              blockEnd: "1px",
              inlineStart: "1px",
              inlineEnd: "1px",
            },
            style: "solid",
            color: { $token: "color.border" },
          },
        },
      },
    },
  },
  /**
   * The submit, wearing `core/button`'s own appearance.
   *
   * Reused rather than restated: a form's submit and a button block are the
   * same control to an author, and describing that twice is how one page comes
   * to carry two different-looking primary actions. `width: "fit-content"` is
   * the only addition — the form is a grid, so a stretched item would otherwise
   * run the full column width and stop reading as a button at all.
   *
   * The obvious spelling for that is `justify-self: start`, and it is NOT what
   * this uses. The catalog carries no grid ITEM properties, so the compiler
   * drops that declaration without a word; see the note on the addition itself.
   */
  submit: {
    /*
     * The WHOLE envelope, not its base leaf.
     *
     * Spreading `BUTTON_BASE_STYLES.base.base` copies today's base
     * declarations and silently drops every other state and breakpoint the
     * button might grow. The first hover or responsive default added to
     * `core/button` would reach the button block and not the form's submit,
     * and the two controls this part exists to keep identical would diverge
     * with nothing saying so.
     */
    baseStyles: {
      ...BUTTON_BASE_STYLES,
      base: {
        ...BUTTON_BASE_STYLES.base,
        base: {
          ...BUTTON_BASE_STYLES.base.base,
          /*
           * Sized to its words rather than to the column.
           *
           * The form is a grid and a grid item stretches, so without this the
           * submit runs the full width and stops reading as a button. The
           * obvious spelling is `justify-self: start` and the catalog does not
           * carry it — the compiler drops a property it does not know, so that
           * declaration would have been written, dropped, and invisible.
           */
          width: "fit-content",
        },
      },
    },
  },
} as const;

/** Whether a stored array member is shaped like a field at all. */
function isFieldSpec(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function renderForm({
  props,
  node,
  className,
  partClass,
}: BlockRenderArgs<FormProps>): ReactElement {
  // A stored array can hold anything: a migration, a hand edit, or an older
  // version of this block can all leave a member that is not a field. Sliced
  // BEFORE the walk so an oversized array is never read in full.
  const stored: unknown = props.fields;
  const fields = Array.isArray(stored) ? stored.slice(0, MAX_FIELDS) : [];

  // `url()` refuses any scheme that executes rather than navigates, which is
  // the whole reason this goes through it: an `action` reaches an attribute the
  // browser follows on submit, so a stored `javascript:` value would run.
  const action = url(props.action);
  const method = oneOf(props.method, FORM_METHODS, "post");
  // `text()` maps a missing value AND an authored empty string to `""`, and a
  // submit button with no words on it is unusable either way, so the fallback
  // is applied to the result rather than passed to `text()`.
  const submitted = text(props.submitText);
  const submitText = submitted === "" ? "Submit" : submitted;

  const rows: ReactNode[] = [];
  fields.forEach((raw, index) => {
    const field = isFieldSpec(raw) ? raw : {};
    const type = oneOf(field.type, FORM_FIELD_TYPES, "text");
    const required = flag(field.required);
    // Derived from the NODE's id, so two forms on one page cannot collide. An
    // id that collides silently re-points a label at the earlier form's field.
    const id = `${node.id}-field-${index}`;
    const storedName = text(field.name);
    const name = storedName === "" ? `field-${index}` : storedName;
    // A label with no text announces nothing, so the submitted name stands in.
    // It is a worse label than one an author wrote and a far better one than
    // silence.
    const labelled = text(field.label);
    const label = labelled === "" ? name : labelled;

    rows.push(
      <label key={`${id}-label`} htmlFor={id}>
        {label}
        {/* The `required` attribute already carries this to assistive
            technology, so the marker is decoration and is hidden from it
            rather than announced a second time as "asterisk". */}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>,
      type === "textarea" ? (
        <textarea
          key={id}
          id={id}
          name={name}
          required={required}
          rows={4}
          className={partClass("control")}
        />
      ) : (
        <input
          key={id}
          id={id}
          name={name}
          type={type}
          required={required}
          className={partClass("control")}
        />
      )
    );
  });

  return (
    <form
      className={className}
      method={method}
      {...(action === undefined ? {} : { action })}
    >
      {rows}
      <button className={partClass("submit")} type="submit">
        {submitText}
      </button>
    </form>
  );
}

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const form = defineBlock<FormProps, PageContext>({
  name: "core/form",
  version: 1,
  description:
    "A plain HTML form that posts to a URL you choose. Stores nothing and ships no JavaScript; the form-builder plugin is the one that collects submissions.",
  // Palette metadata. The category is imported rather than spelled here so
  // nineteen blocks cannot drift into nineteen headings; keywords are what
  // let a search for a word the description never uses still find this.
  editor: {
    label: "Form",
    icon: "form",
    category: INTERACTIVE,
    keywords: ["contact", "input", "submit", "fields"],
  },
  props: {
    action: { type: "url" },
    method: { type: "select", options: [...FORM_METHODS] },
    fields: { type: "array", of: "object" },
    submitText: { type: "text" },
  },
  defaultProps: { method: "post", submitText: "Submit", fields: [] },
  example: {
    props: {
      method: "post",
      submitText: "Send",
      fields: [
        { label: "Name", name: "name", type: "text", required: true },
        { label: "Email", name: "email", type: "email", required: true },
        { label: "Message", name: "message", type: "textarea" },
      ],
    },
  },
  baseStyles: FORM_BASE_STYLES,
  parts: FORM_PARTS,
  supports: {
    typography: true,
    color: true,
    spacing: true,
    layout: true,
    dimensions: true,
    background: true,
    border: true,
    effects: true,
    position: true,
  },
  render: renderForm,
});
