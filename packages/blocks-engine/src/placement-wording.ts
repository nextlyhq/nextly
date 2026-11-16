/**
 * How a placement refusal is said, in the editor and from the server alike.
 *
 * One implementation, because an author who is refused a drop on the canvas
 * and then refused the same placement on save (from the API, an import, or a
 * second tab) should read the same sentence both times. The server's wording
 * used to be its own, and it said a slot refusal backwards.
 */
import type { ContentKind } from "./content-model";
import type { PlacementRefused } from "./placement";

/** A sentence, and what the author can do about it when the rule says. */
export interface PlacementWording {
  /** Why the placement will not happen, in one sentence. */
  readonly headline: string;
  /** What would work instead, or null when the rule names nothing. */
  readonly remedy: string | null;
}

/** What the wording needs beyond the verdict itself. */
export interface WordingContext {
  /** The label an author knows a block type by. */
  readonly labelOf: (type: string) => string;
  /** The block being placed, when it differs from the one the rule refused. */
  readonly movingType?: string;
  /** The container being placed into, when the caller can name it. */
  readonly regionType?: string;
}

/**
 * A block type's label: its declared editor label, or its name made readable.
 *
 * The namespace is dropped because it answers "who shipped this", which a
 * palette groups by rather than repeats on every row. Separators become spaces
 * and only the first letter is capitalised, so "core/collection-loop" reads
 * "Collection loop" rather than a proper noun.
 */
export function blockLabelFrom(
  type: string,
  definition: { readonly editor?: { readonly label?: string } } | undefined
): string {
  const declared = definition?.editor?.label;
  if (typeof declared === "string" && declared !== "") return declared;
  const local = type
    .slice(type.indexOf("/") + 1)
    .replace(/[-_]+/g, " ")
    .trim();
  if (local === "") return type;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/**
 * "a" or "an", decided by the LABEL, since the label is what the sentence
 * shows: "core/image" begins with a consonant and would produce "a Image".
 */
function article(label: string): string {
  return /^[aeiou]/i.test(label) ? "an" : "a";
}

/** An allow-list entry as an author reads it; a namespace reads as "any". */
export function permittedLabel(
  entry: string,
  labelOf: (type: string) => string
): string {
  if (!entry.endsWith("/*")) return labelOf(entry);
  const namespace = entry.slice(0, -2);
  return namespace === "" ? "any block" : `any ${namespace} block`;
}

/** "A", "A and B", "A, B and C". */
export function asPermittedList(
  labels: readonly string[],
  joiner: string
): string {
  if (labels.length === 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} ${joiner} ${labels[1]}`;
  const last = labels[labels.length - 1];
  return `${labels.slice(0, -1).join(", ")} ${joiner} ${last}`;
}

/**
 * Why HTML refuses a kind beneath an ancestor, in plain words. Keyed by the
 * kind refused, because that is what the author has to change.
 */
const CONTENT_REASONS: Readonly<Record<ContentKind, string>> = {
  interactive: "Nothing clickable can sit inside a link or a button.",
  header: "A header can't sit inside a header or a footer.",
  footer: "A footer can't sit inside a header or a footer.",
  main: "The main area can only sit inside plain boxes.",
  form: "A form can't sit inside another form.",
  flow: "Only text-level blocks can sit there.",
  phrasing: "That block can't sit there.",
};

/** Why this placement will not happen, and what would. */
export function placementRefusalWording(
  verdict: PlacementRefused,
  context: WordingContext
): PlacementWording {
  const { labelOf } = context;
  const refused = labelOf(verdict.blockType);
  const moving =
    context.movingType !== undefined && context.movingType !== verdict.blockType
      ? labelOf(context.movingType)
      : undefined;
  // When the rule refused something INSIDE the block being placed, the
  // sentence names both, or the author is told about a block they never
  // touched.
  const subject =
    moving === undefined
      ? `${article(refused)} ${refused}`
      : `${article(moving)} ${moving} holding ${article(refused)} ${refused}`;
  const Subject = capitalised(subject);
  const region =
    context.regionType === undefined ? undefined : labelOf(context.regionType);

  // The name rules say the same plain sentence on the canvas, in Layers and
  // from the keyboard: what can't go here, and what does.
  const goesInside = (list: string) =>
    `${capitalised(withArticle(refused))} goes inside ${list}.`;
  switch (verdict.reason) {
    case "restricted-at-root":
      return {
        // Not "choose another container": there is none on screen that would
        // take it, so the only remedy is to create the nesting.
        headline: `${Subject} has to go inside a container.`,
        remedy: remedyFor(verdict.permitted, goesInside, labelOf),
      };
    case "wrong-parent":
      return {
        headline:
          region === undefined
            ? `${Subject} can't go here.`
            : `${Subject} can't go inside this ${region}.`,
        remedy: remedyFor(verdict.permitted, goesInside, labelOf),
      };
    case "not-allowed-in-slot":
      return {
        // The spot refuses, not the block's parent: naming the parent here
        // would send the author to change the wrong thing.
        headline: `${Subject} can't go here.`,
        remedy: remedyFor(
          verdict.permitted,
          list => `This spot takes ${list}.`,
          labelOf
        ),
      };
    case "holds-no-blocks":
      return {
        headline: `${labelOf(verdict.parentType)} can't hold blocks.`,
        remedy: null,
      };
    case "undeclared-slot":
      return {
        headline: `${labelOf(verdict.parentType)} has no place for blocks there.`,
        remedy: null,
      };
    case "phrasing-only":
      return {
        headline: `${labelOf(verdict.parentType)} only takes text-level blocks, not ${subject}.`,
        remedy: null,
      };
    case "content-model":
      return {
        headline: `${Subject} can't go inside this ${labelOf(verdict.refusedBy.type)}.`,
        remedy: CONTENT_REASONS[verdict.kind],
      };
  }
}

/**
 * The second line naming what is permitted, or null when nothing is named.
 *
 * Each block with its article and the choices joined by "or", "a Column or a
 * Row", since any one of them would do; a namespace stays "any acme block".
 */
function remedyFor(
  permitted: readonly string[],
  sentence: (list: string) => string,
  labelOf: (type: string) => string
): string | null {
  if (permitted.length === 0) return null;
  return sentence(
    asPermittedList(
      permitted.map(entry =>
        entry.endsWith("/*")
          ? permittedLabel(entry, labelOf)
          : withArticle(permittedLabel(entry, labelOf))
      ),
      "or"
    )
  );
}

/** A label with its article: "a Column", "an Image". */
function withArticle(label: string): string {
  return `${article(label)} ${label}`;
}

/** A phrase with its first letter capitalised, to open a sentence. */
function capitalised(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** The wording as one line, for a validation issue's message. */
export function placementRefusalMessage(
  verdict: PlacementRefused,
  context: WordingContext
): string {
  const { headline, remedy } = placementRefusalWording(verdict, context);
  if (remedy === null) return headline;
  return /[.!?]$/.test(remedy)
    ? `${headline} ${remedy}`
    : `${headline} ${remedy}.`;
}
