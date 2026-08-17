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
 * label sits above the control it names. The alternative — wrapping each pair
 * in a `<label>` — needs a rule on a DESCENDANT to stack them, and the style
 * catalog compiles one selector per node; only a handful of catalog entries
 * (`linkColor` among them) reach inside a block at all, and none of them
 * reaches an arbitrary child. Flattening puts the whole layout on the one
 * selector that exists.
 *
 * What that costs is grouping: one `gap` separates a label from its control and
 * one field from the next, so the rows are evenly spaced rather than clustered
 * into fields. It is honest spacing rather than wrong spacing, and a site
 * stylesheet can tighten it. Inline styles are not an option and should not
 * be — see `root-inline-styles.test.tsx` for why a block may not write one.
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
 * still wrong: a token reference compiles to `var(--site-space-4)`, and
 * **nothing in this repository ever emits that variable.**
 *
 * Measured, three ways that agree: `compileSiteSheet` — the only thing that
 * writes token CSS — has ZERO consumers outside `blocks-engine`;
 * `emitTokenBlocks` is called only by that function, its own tests and a
 * benchmark; and the string `--site-` appears in no source file outside the
 * engine at all (positive control: `--nx-` appears in four). So
 * `defaultSiteTokens()` guarantees nothing today — it is a default nobody
 * applies.
 *
 * An undefined custom property makes the declaration invalid at computed-value
 * time, so `gap` fell back to `normal`, which for a grid is zero. The form
 * rendered with its fields touching, and every check passed: the property is in
 * `STYLE_CATALOG`, the declaration reached the compiled stylesheet, and the
 * test asserted exactly that. **Whether the `var()` RESOLVES is a third
 * question, and nothing asks it.**
 *
 * A length is correct until the site stylesheet is wired into the render path.
 * `1rem` because that is what `space.4` itself declares, so the value does not
 * change when this becomes a token again.
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
      gap: "1rem",
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
        <textarea key={id} id={id} name={name} required={required} rows={4} />
      ) : (
        <input key={id} id={id} name={name} type={type} required={required} />
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
      <button type="submit">{submitText}</button>
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
