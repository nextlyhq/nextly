/**
 * What a page hands its Form blocks (`PageContext.forms`): where the page's
 * forms post, and the shape a form is drawn from, the block's own fields and
 * a provider's alike.
 *
 * @module forms-context
 */

/**
 * What a page's forms post to, and how a form picked from a provider is
 * read (see `PageContext.forms`).
 *
 * @experimental Settles with the form provider contract.
 */
export interface PageForms {
  /** The address every form on the page posts to: the receiver's. */
  readonly action: string;
  /**
   * The document this render draws, as the receiver names it (`page:<id>`,
   * `template:<id>`, `component:<id>`), so a post says which stored form it
   * answers. Absent where the receiver reads no such document: a form drawn
   * there has nothing to post to.
   */
  readonly document?: string;
  /** The same-site path a visitor comes back to once a send is answered. */
  readonly returnTo: string;
  /**
   * A form picked from a provider, as the reader of this page sees it: the
   * public, on a live page. A form that cannot be read is answered as
   * `missing`, and the block then draws nothing.
   */
  describe(form: FormReference): Promise<FormDrawing | FormUnavailableDrawing>;
}

/**
 * A form a block picked from a provider: the provider's id and its own
 * reference to the form.
 *
 * @experimental Settles with the form provider contract.
 */
export interface FormReference {
  readonly provider: string;
  readonly ref: string;
}

/**
 * The controls a drawn form field may be: plain HTML controls.
 *
 * @experimental Settles with the form provider contract.
 */
export type FormFieldKind =
  | "text"
  | "email"
  | "tel"
  | "number"
  | "url"
  | "date"
  | "time"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "file"
  | "hidden";

/**
 * One field as the Form block draws it, whoever describes it. The block's
 * own fields and a provider's take this one shape, so both are drawn with
 * the same markup and style parts, and a simple form's answers are checked
 * by the rules it is drawn with.
 *
 * The plugin SDK's `FormFieldDescription` is this shape; the page builder
 * holds the two to agreeing with a type test.
 *
 * @experimental Settles with the form provider contract.
 */
export interface FormFieldDrawing {
  /**
   * The name its answer is sent under; unique within the form. A name
   * starting with `_` is the form receiver's own, and a form naming a field
   * with one is not drawn.
   */
  readonly name: string;
  readonly label: string;
  readonly kind: FormFieldKind;
  readonly required?: boolean;
  /** A line of help under the control. */
  readonly help?: string;
  readonly placeholder?: string;
  /** The choices of a `select`, `radio` or `checkbox` field. */
  readonly options?: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  /** The file types a `file` field takes. */
  readonly accept?: string;
  readonly min?: number;
  readonly max?: number;
  readonly pattern?: string;
  /** Opaque values the provider's own script reads, drawn as `data-*`. */
  readonly provider?: Readonly<Record<string, string>>;
}

/**
 * What a visitor sees once a send is accepted.
 *
 * @experimental Settles with the form provider contract.
 */
export type FormAfterSendingDrawing =
  | { readonly kind: "message"; readonly message: string }
  | { readonly kind: "page"; readonly href: string };

/**
 * A provider's form, as the Form block draws it.
 *
 * @experimental Settles with the form provider contract.
 */
export interface FormDrawing {
  readonly ref: string;
  readonly title: string;
  readonly fields: readonly FormFieldDrawing[];
  readonly submitText: string;
  readonly afterSending: FormAfterSendingDrawing;
  readonly encoding: "urlencoded" | "multipart";
  /** A module the provider's form needs, drawn only on pages that draw it. */
  readonly script?: { readonly module: string; readonly reason: string };
}

/**
 * Why a provider has no form to draw: it takes no answers now, or there is
 * none by that reference.
 *
 * @experimental Settles with the form provider contract.
 */
export interface FormUnavailableDrawing {
  readonly unavailable: "closed" | "missing";
  /** What a visitor reads in place of a closed form. */
  readonly message?: string;
}
