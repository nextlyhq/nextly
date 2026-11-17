/**
 * `core/form` — a form a visitor can fill in and send with no JavaScript.
 *
 * Every form posts, as an ordinary HTML form post, to the page builder's
 * receiver (`ctx.forms.action`), which reads the form from the PUBLISHED
 * page and hands the answers on: to the form's provider when one is picked,
 * and otherwise to the simple form's "Send to" address, server to server.
 * The visitor comes back to the same cacheable page with the outcome in the
 * address's fragment, and a CSS `:target` rule shows the answer
 * (`form-draw.tsx`). The block itself ships no script.
 *
 * **Two modes, one drawing.** With a provider's form picked (`form`), the
 * block draws the provider's description of it; with none, its own fields.
 * Both go through one description of each field (`FormFieldDrawing`), with
 * the same markup and style parts, so the Style settings reach both, and a
 * simple form's answers are checked by the same rules its controls were
 * drawn with (`formFieldDrawings`).
 *
 * **Every form carries one hidden spam trap** ({@link FORM_HONEYPOT_FIELD}),
 * whoever receives it: a field no person fills and a bot does. Drawing it is
 * the block's part; treating a filled one as spam is the receiver's.
 *
 * A provider's form may need a script of the provider's own (a bot check);
 * the block draws that module only on a page that draws such a form.
 *
 * @module blocks/library/form
 */
import { type BlockDefinition, defineBlock } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type {
  BlockRenderArgs,
  FormDrawing,
  FormFieldDrawing,
  FormReference,
  PageContext,
} from "../context";

import { INTERACTIVE } from "./categories";
import {
  drawField,
  drawResults,
  FORM_REFUSALS,
  FORM_RESULT_CSS,
  FORM_RESULT_STYLE_KEY,
  FORM_SENT_MESSAGE,
} from "./form-draw";
import {
  FORM_FIELD_TYPES,
  formFieldDrawings,
  receiverKeepsName,
  type FormFieldSpec,
} from "./form-fields";
import { FORM_BASE_STYLES, FORM_PARTS } from "./form-parts";
import { LINK_PROPS, oneOf, text, url } from "./props";

export {
  FORM_FIELD_TYPES,
  formFieldDrawings,
  formFields,
  sentNameOf,
  type FormField,
  type FormFieldSpec,
  type FormFieldType,
} from "./form-fields";
export { FORM_BASE_STYLES } from "./form-parts";
export {
  FORM_FILE_NEEDS_SCRIPT,
  FORM_REFUSALS,
  FORM_SENT_MESSAGE,
} from "./form-draw";

/**
 * What a visitor sees once a send is accepted: the form's own setting (a
 * provider's form only), a message in the form's place, or another page.
 */
export type FormAfterSending = "form" | "message" | "page";

/** Every {@link FormAfterSending}, in the order they are offered. */
const FORM_AFTER_SENDING: readonly FormAfterSending[] = [
  "form",
  "message",
  "page",
];

export interface FormProps {
  /** A provider's form, picked in place of the block's own fields. */
  form?: FormReference;
  /** "Send to": where a simple form's answers are passed on, server to server. */
  action?: string;
  /** The button's words. */
  submitText?: string;
  /** A simple form's fields, in order. */
  fields?: FormFieldSpec[];
  /**
   * What a visitor sees once a send is accepted. Absent, a provider's form
   * follows its own setting and a simple form shows {@link message}.
   */
  afterSending?: FormAfterSending;
  /** The message shown in the form's place; {@link FORM_SENT_MESSAGE} when empty. */
  message?: string;
  /** "Go to a page": an address. */
  href?: string;
  /** "Go to a page": a page of the site, with {@link entryId}. */
  entryCollection?: string;
  entryId?: string;
}

/**
 * The name of the hidden spam trap every form carries.
 *
 * A person never sees or fills it, and a bot filling every input it finds
 * does, so whoever receives a post with it filled treats the post as spam:
 * answered as a success and passed on to nobody. Shared, because the one who
 * draws the trap and the one who reads it must agree on its name. `_hp` is
 * among the names the forms plugin already treats as a trap, so a form drawn
 * here and received there reads the same field.
 */
export const FORM_HONEYPOT_FIELD = "_hp";

/**
 * The hidden fields a form posts beside its answers, as the receiver reads
 * them: the document defining the form, the form's node, the path to come
 * back to, the page's language, and, for a form a list draws once per entry,
 * which entry's copy was sent.
 */
export const FORM_POST_FIELDS: {
  readonly document: "_form";
  readonly node: "_node";
  readonly returnTo: "_return";
  readonly locale: "_locale";
  readonly item: "_item";
} = {
  document: "_form",
  node: "_node",
  returnTo: "_return",
  locale: "_locale",
  item: "_item",
};

/** The provider form `value` names, or `undefined` for the block's own fields. */
function pickedForm(value: unknown): FormReference | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { provider, ref } = value as Record<string, unknown>;
  // `simple` is the page builder's own provider: the block's own fields.
  if (
    typeof provider !== "string" ||
    provider === "" ||
    provider === "simple"
  ) {
    return undefined;
  }
  return { provider, ref: typeof ref === "string" ? ref : "" };
}

/**
 * The spam trap: one text input named {@link FORM_HONEYPOT_FIELD}, which a
 * person never meets and a bot filling every input does.
 *
 * Kept from people in every way they meet a form: drawn off screen by its
 * part (a stylesheet rule, not an inline style, so a content security policy
 * refusing inline styles cannot bring it back on screen), out of the tab
 * order, hidden from screen readers with its label, and closed to the
 * browser's autofill, whose filling it would otherwise read as a bot's. Not
 * `type="hidden"` or `display: none`: a bot skips those, and the trap only
 * works while it looks like any other field.
 */
function honeypot(nodeId: string, className: string): ReactElement {
  const id = `${nodeId}-trap`;
  return (
    <div key="trap" className={className} aria-hidden="true">
      <label htmlFor={id}>Leave this empty</label>
      <input
        id={id}
        name={FORM_HONEYPOT_FIELD}
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        defaultValue=""
      />
    </div>
  );
}

/** What one form is drawn from, whichever mode it is in. */
interface FormSpec {
  readonly fields: readonly FormFieldDrawing[];
  readonly submitText: string;
  readonly sentMessage: string;
  readonly multipart: boolean;
  readonly script?: FormDrawing["script"];
}

/**
 * Where the form posts and the hidden fields it posts beside its answers.
 * Where the page has no receiver (the editor's canvas, a standalone render)
 * it names no address but still posts: a browser's default is a GET, which
 * would write every answer into the URL, the history and the logs.
 */
function sending(
  ctx: PageContext,
  nodeId: string,
  multipart: boolean
): {
  readonly attributes: Record<string, string>;
  readonly hidden: ReactElement[];
} {
  const forms = ctx.forms;
  if (forms === undefined)
    return { attributes: { method: "post" }, hidden: [] };
  const values: [string, string | undefined][] = [
    [FORM_POST_FIELDS.document, forms.document],
    [FORM_POST_FIELDS.node, nodeId],
    [FORM_POST_FIELDS.returnTo, forms.returnTo],
    [FORM_POST_FIELDS.locale, ctx.locale],
    [FORM_POST_FIELDS.item, ctx.itemPosition],
  ];
  return {
    attributes: {
      action: forms.action,
      method: "post",
      ...(multipart ? { encType: "multipart/form-data" } : {}),
    },
    hidden: values.flatMap(([name, value]) =>
      value === undefined || value === ""
        ? []
        : [<input key={name} type="hidden" name={name} value={value} />]
    ),
  };
}

/** A provider's module, drawn only where its address is one a page may load. */
function providerScript(script: FormDrawing["script"]): ReactElement | null {
  const src = url(script?.module);
  if (src === undefined) return null;
  // `async` with a `src`: React hoists it and draws it once per page, however
  // many of the provider's forms the page holds.
  return <script key="script" type="module" src={src} async />;
}

/** One form, drawn from `spec`. */
function drawForm(
  spec: FormSpec,
  { node, ctx, className, partClass }: BlockRenderArgs<FormProps>
): ReactElement {
  const { attributes, hidden } = sending(ctx, node.id, spec.multipart);
  // A list draws one copy per entry, all one node: the entry's position keeps
  // each copy's ids its own, and is the fragment a send comes back to.
  const stem =
    ctx.itemPosition === undefined ? node.id : `${node.id}-${ctx.itemPosition}`;
  return (
    <form className={className} {...attributes}>
      {/* Hoisted and deduped by React: one copy per page. */}
      <style href={FORM_RESULT_STYLE_KEY} precedence="default">
        {FORM_RESULT_CSS}
      </style>
      {drawResults({
        anchor: stem,
        sentMessage: spec.sentMessage,
        partClass,
      })}
      {spec.fields.some(field => field.required === true) ? (
        // Each required field says "required" to a screen reader itself, so
        // this line is for the eye only.
        <p className={partClass("note")} aria-hidden="true">
          * Required
        </p>
      ) : null}
      {spec.fields.map((field, index) =>
        drawField(field, { id: `${stem}-field-${index}`, partClass })
      )}
      {honeypot(stem, partClass("trap"))}
      {hidden}
      <button className={partClass("submit")} type="submit">
        {spec.submitText}
      </button>
      {providerScript(spec.script)}
    </form>
  );
}

/** The words of a button, `fallback` where none were stored. */
function words(value: unknown, fallback: string): string {
  const written = text(value).trim();
  return written === "" ? fallback : written;
}

/** The message a provider's form shows once sent, the block's choice first. */
function providerSentMessage(props: FormProps, drawing: FormDrawing): string {
  const chosen = oneOf(props.afterSending, FORM_AFTER_SENDING, "form");
  if (chosen === "message") return words(props.message, FORM_SENT_MESSAGE);
  return drawing.afterSending.kind === "message"
    ? words(drawing.afterSending.message, FORM_SENT_MESSAGE)
    : FORM_SENT_MESSAGE;
}

/**
 * The attribute on the box a picked form that is gone draws where an author
 * is looking, so the editor can say so over it.
 */
export const FORM_UNAVAILABLE_ATTRIBUTE = "data-nx-form-unavailable";

/**
 * What a picked form that is gone draws: nothing on a page a visitor is
 * served; where an author is looking (`diagnostics`), an empty box in the
 * block's own classes, the place the editor says "This form was deleted."
 * over, so the block is not lost from the canvas.
 */
function gone(ctx: PageContext, className: string): ReactElement | null {
  if (ctx.diagnostics !== true) return null;
  return (
    <div
      className={className}
      {...{ [FORM_UNAVAILABLE_ATTRIBUTE]: "missing" }}
    />
  );
}

/**
 * A provider's form, as the page's reader sees it: drawn from its
 * description; its closed message where it takes no answers now; nothing
 * where it is gone (an empty box where an author is looking), or where this
 * page cannot read it.
 */
async function renderPicked(
  picked: FormReference,
  args: BlockRenderArgs<FormProps>
): Promise<ReactElement | null> {
  const { ctx, props, className, partClass } = args;
  // Nowhere to read it from: the canvas reads one through the editor's own
  // route, as the person editing.
  if (ctx.forms === undefined) return null;
  let drawing: Awaited<
    ReturnType<NonNullable<PageContext["forms"]>["describe"]>
  >;
  try {
    drawing = await ctx.forms.describe(picked);
  } catch {
    // A provider that fails draws nothing, never an error on the page.
    return null;
  }
  // A field under a name the receiver keeps would turn its answer into the
  // receiver's own (the document it came from, the spam trap), refusing or
  // losing every send: such a description is drawn as a failing one is.
  if (
    "fields" in drawing &&
    drawing.fields.some(field => receiverKeepsName(field.name))
  )
    return null;
  if ("unavailable" in drawing) {
    if (drawing.unavailable !== "closed") return gone(ctx, className);
    return (
      <div className={className}>
        <p className={partClass("message")}>
          {words(drawing.message, FORM_REFUSALS.closed)}
        </p>
      </div>
    );
  }
  return drawForm(
    {
      fields: drawing.fields,
      submitText: words(drawing.submitText, "Send"),
      sentMessage: providerSentMessage(props, drawing),
      multipart: drawing.encoding === "multipart",
      ...(drawing.script === undefined ? {} : { script: drawing.script }),
    },
    args
  );
}

/**
 * Draw the form. A simple form is drawn at once; a provider's waits for its
 * description, so only a page holding one renders this block asynchronously.
 */
export function renderForm(
  args: BlockRenderArgs<FormProps>
): ReactElement | Promise<ReactElement | null> {
  const picked = pickedForm(args.props.form);
  if (picked !== undefined) return renderPicked(picked, args);
  const { props } = args;
  return drawForm(
    {
      fields: formFieldDrawings(props),
      submitText: words(props.submitText, "Send"),
      sentMessage: words(props.message, FORM_SENT_MESSAGE),
      multipart: false,
    },
    args
  );
}

/**
 * Version 1 to 2: forms always post to the page builder's receiver, so
 * `method` goes. A version 1 form drew "Submit" on a button with no words
 * stored, so that is what it keeps; everything else it stored is kept as it
 * is, "Send to" among it.
 */
function fromVersion1(props: Record<string, unknown>): Record<string, unknown> {
  const { method: _method, ...rest } = props;
  const upgraded = Array.isArray(rest.fields)
    ? { ...rest, fields: rest.fields.map(namedAsVersion1) }
    : rest;
  return text(upgraded.submitText).trim() === ""
    ? { ...upgraded, submitText: "Submit" }
    : upgraded;
}

/**
 * A version 1 field with the name it was sent under written down: one with
 * none was sent as `field-<n>`, and a receiving address may expect exactly
 * that, where a field added now is named from its label.
 */
function namedAsVersion1(field: unknown, index: number): unknown {
  if (typeof field !== "object" || field === null || Array.isArray(field)) {
    return field;
  }
  const record = field as Record<string, unknown>;
  return text(record.name).trim() === ""
    ? { ...record, name: `field-${index}` }
    : record;
}

/** The words each field type is offered under. */
const FIELD_TYPE_LABELS: Readonly<Record<string, string>> = {
  text: "Text",
  email: "Email",
  tel: "Phone",
  number: "Number",
  url: "Link",
  date: "Date",
  textarea: "Long text",
  select: "Dropdown",
  checkbox: "Checkbox",
  radio: "Choice",
};

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const form: BlockDefinition<FormProps, PageContext> = defineBlock({
  name: "core/form",
  version: 2,
  migrate: { 1: fromVersion1 },
  // What an author reads, in the Add panel and the block card: one plain line.
  description:
    "A form visitors fill in and send, with a message once it's sent.",
  editor: {
    label: "Form",
    icon: "form",
    category: INTERACTIVE,
    keywords: ["contact", "input", "submit", "fields"],
  },
  props: {
    // Each field's own settings, so the inspector can draw a control for
    // each. Description only: the stored shape is the same list of records.
    fields: {
      label: "Fields",
      section: "Fields",
      type: "array",
      of: "object",
      item: {
        label: { label: "Label", type: "text" },
        type: {
          label: "Field type",
          type: "select",
          options: [...FORM_FIELD_TYPES],
          optionLabels: FIELD_TYPE_LABELS,
        },
        required: { label: "Required", type: "checkbox" },
        options: { label: "Options", type: "array", of: "text" },
        name: { label: "Name sent with the form", type: "text" },
      },
    },
    afterSending: {
      // Its own name, not the section's again right under the section title.
      label: "Then",
      section: "After sending",
      type: "select",
      options: [...FORM_AFTER_SENDING],
      optionLabels: {
        form: "Use the form's own setting",
        message: "Show a message",
        page: "Go to a page",
      },
    },
    message: {
      label: "Message",
      hint: 'Shown in the form\'s place. Left empty, it says "Thanks, we got your message."',
      section: "After sending",
      role: "content",
      type: "text",
    },
    href: { ...LINK_PROPS.href, label: "Page", section: "After sending" },
    entryCollection: {
      ...LINK_PROPS.entryCollection,
      section: "After sending",
    },
    entryId: { ...LINK_PROPS.entryId, section: "After sending" },
    action: { label: "Send to", type: "url" },
    submitText: { label: "Button text", role: "content", type: "text" },
  },
  // What a new Form starts with: the three fields almost every contact form
  // asks, and a button that says what it does.
  defaultProps: {
    submitText: "Send",
    fields: [
      { label: "Name", type: "text", required: true },
      { label: "Email", type: "email", required: true },
      { label: "Message", type: "textarea" },
    ],
  },
  example: {
    props: {
      submitText: "Send",
      fields: [
        { label: "Name", type: "text", required: true },
        { label: "Email", type: "email", required: true },
        { label: "Message", type: "textarea" },
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
  // Its fields and its button are interactive, and it is a form.
  contentModel: () => ({ is: ["flow", "form", "interactive"] }),
  render: renderForm,
});
