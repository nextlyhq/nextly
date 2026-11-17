/**
 * A Form block's picked form: the provider and the provider's own reference,
 * as the block stores them in `form`, and the words the panel and the canvas
 * say about one.
 *
 * @module form-picked
 */

/** The Form block, whose `form` this is. */
export const FORM_BLOCK = "core/form";

/** The page builder's own provider, which a block with no picked form uses. */
const SIMPLE_PROVIDER = "simple";

/** A form a block picked from a provider. */
export interface PickedForm {
  readonly provider: string;
  readonly ref: string;
}

/**
 * The picked form `value` names, or `undefined` for a simple form: the rule
 * the Form block draws by, so the panel and the canvas agree with the page.
 */
export function pickedFormOf(value: unknown): PickedForm | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { provider, ref } = value as Record<string, unknown>;
  if (
    typeof provider !== "string" ||
    provider === "" ||
    provider === SIMPLE_PROVIDER
  ) {
    return undefined;
  }
  return { provider, ref: typeof ref === "string" ? ref : "" };
}

/** Whether two picked forms are the same one. */
export function sameForm(
  a: PickedForm | undefined,
  b: PickedForm | undefined
): boolean {
  return a?.provider === b?.provider && a?.ref === b?.ref;
}

/** What the Form block's panel and canvas say, in one place. */
export const FORM_WORDS = {
  pickLabel: "Form",
  pickPlaceholder: "Pick a form",
  edit: "Edit this form ↗",
  comesFrom: (label: string): string =>
    `Fields, emails, spam protection and saved responses come from ${label}.`,
  useSimple: "or use a simple form",
  installHint:
    "Want saved responses, emails and spam protection? Install the Forms plugin. This block will then let you pick a form.",
  listFailed: "Your forms couldn't be listed. Reopen the form to try again.",
  draft: "Draft form: visitors can't send it until it's published",
  closed: "This form is closed. Visitors see its closed message.",
  deleted: "This form was deleted.",
  pickAnother: "Pick another form",
  nowhere:
    "Answers have nowhere to go yet: add an address, or install the Forms plugin to save them",
  /** How a listed form's state is marked in the picker. */
  stateMark: { draft: "Draft", closed: "Closed" } as Readonly<
    Record<string, string>
  >,
} as const;
