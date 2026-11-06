/**
 * How widely a variable is used, and what the Variables tab says about it:
 * the host's reads, the count at the end of each row, the editor's status
 * line, whether Remove may go ahead, and what a shared style using the
 * variable sets with it.
 *
 * Rules here, presentation in {@link variable-usage-view}, so each is tested
 * without a DOM.
 *
 * ## Places
 *
 * A variable is used in documents (pages, components, sections, layouts)
 * whose blocks or settings name it, in shared styles whose own styles name
 * it, and in block types whose default styles name it. The places it is used
 * are the three together. While some pages are
 * still being counted the documents are a floor, and so are the places.
 *
 * @module variable-usage
 */
import {
  isLook,
  isPlainRecord,
  isTokenRef,
  type NamedClass,
} from "@nextlyhq/blocks-engine";

import { storedContexts } from "./class-library";
import {
  listedWords,
  type SharedStyleKind,
  type SharedStylesCount,
  type SharedStyleUsesPage,
} from "./shared-style-library";

/**
 * How widely one variable is used across the site.
 *
 * @experimental Settles with the Variables tab's usage.
 */
export interface VariableReach {
  /** How many documents use it. */
  readonly documents: number;
  /** The same documents, by kind. */
  readonly byKind: Readonly<Record<SharedStyleKind, number>>;
  /** The ids of the shared styles whose own styles name it. */
  readonly sharedStyles: readonly string[];
  /**
   * The block types (`core/button`) whose own default styles name it: each
   * a place, though there is no document to open.
   */
  readonly blockDefaults: readonly string[];
  /** False makes `documents`, and so the places, a floor: "at least". */
  readonly complete: boolean;
}

/**
 * One read of how widely some variables are used.
 *
 * @experimental Settles with the Variables tab's usage.
 */
export interface VariablesUsage {
  /** Whether every page has been counted, so counts can be exact. */
  readonly whole: boolean;
  /** Whether counts that are not whole may still become whole. */
  readonly counting?: boolean;
  /** Whether this author may ask for the pages to be counted now. */
  readonly mayCount?: boolean;
  /** Each variable asked about, by identity (`tokenIdentity`). */
  readonly variables: ReadonlyMap<string, VariableReach>;
}

/**
 * Which kind of place a variable is used in: a document's kind, a shared
 * style, or a block type's default style.
 *
 * @experimental Settles with the Variables tab's usage.
 */
export type VariableUseKind =
  | SharedStyleKind
  | "shared-style"
  | "block-default";

/**
 * One place a variable is used.
 *
 * @experimental Settles with the Variables tab's usage.
 */
export interface VariableUse {
  /**
   * A document's id, unique within its collection; a shared style's id; or a
   * block type (`core/button`).
   */
  readonly id: string;
  readonly title: string;
  /** The collection holding the document, the site style's, or empty for a block type. */
  readonly collection: string;
  readonly kind: VariableUseKind;
  /**
   * For a shared style that is a block look, the block type it is bound to:
   * two types' own looks may share an id, so a look is named by the pair.
   */
  readonly blockType?: string;
  /**
   * Where a document opens, when the host can say. A shared style and a
   * block type's default style have none.
   */
  readonly href?: string;
}

/**
 * One page of the places a variable is used: the shared styles first, then
 * the documents this author may open.
 *
 * @experimental Settles with the Variables tab's usage.
 */
export interface VariableUsesPage extends Omit<SharedStyleUsesPage, "items"> {
  readonly items: readonly VariableUse[];
}

/**
 * The host's reads of how widely variables are used, and the way to a shared
 * style that uses one.
 *
 * @experimental Settles with the Variables tab's usage.
 */
export interface VariablesAccess {
  /** How widely each of these variables is used: at most fifty per read. */
  readonly usage: (
    identities: readonly string[],
    signal: AbortSignal
  ) => Promise<VariablesUsage>;
  /** One page, from 1, of the places a variable is used. */
  readonly uses: (
    identity: string,
    page: number,
    signal: AbortSignal
  ) => Promise<VariableUsesPage>;
  /**
   * Count the site's pages now, for a bounded time, rather than waiting for
   * the site's background jobs. Optional: without it the tab says the jobs
   * count them.
   */
  readonly count?: () => Promise<SharedStylesCount>;
  /**
   * Open a shared style in the Design panel's Shared styles tab. Optional:
   * without it a shared style using a variable is named, not opened.
   */
  readonly openSharedStyle?: (classId: string) => void;
  /**
   * Edit a block look in the inspector: a look is a shared style bound to
   * one block type, which the Shared styles tab does not list. Optional:
   * without it a look using a variable is named, not opened.
   */
  readonly openLook?: (look: {
    readonly id: string;
    readonly blockType: string;
  }) => void;
}

/**
 * One reach for the variables a row stands for, or a removal takes away
 * together: a type size and its line height. Each variable's places are
 * counted, so a block naming both counts once for each; shared styles and
 * block types are named by id, so each counts once. A floor when any part
 * is; nothing until every part is read.
 */
export function combinedReach(
  reaches: readonly (VariableReach | undefined)[]
): VariableReach | undefined {
  const read = reaches.filter(
    (reach): reach is VariableReach => reach !== undefined
  );
  if (read.length === 0 || read.length !== reaches.length) return undefined;
  const [only] = read;
  if (read.length === 1) return only;
  const sum = (count: (reach: VariableReach) => number): number =>
    read.reduce((total, reach) => total + count(reach), 0);
  return {
    documents: sum(reach => reach.documents),
    byKind: {
      pages: sum(reach => reach.byKind.pages),
      components: sum(reach => reach.byKind.components),
      patterns: sum(reach => reach.byKind.patterns),
      layouts: sum(reach => reach.byKind.layouts),
    },
    sharedStyles: [...new Set(read.flatMap(reach => reach.sharedStyles))],
    blockDefaults: [...new Set(read.flatMap(reach => reach.blockDefaults))],
    complete: read.every(reach => reach.complete),
  };
}

/**
 * How many places use a variable: its documents, its shared styles, and the
 * block types whose default styles name it.
 */
function variablePlaces(reach: VariableReach): number {
  return (
    reach.documents + reach.sharedStyles.length + reach.blockDefaults.length
  );
}

/** "1 place", "14 places". */
function placesWords(count: number): string {
  return `${String(count)} ${count === 1 ? "place" : "places"}`;
}

/** What a floor adds: why the number is a minimum. */
const NOT_COUNTED_YET = "Some pages aren't counted yet.";

/** A row's count: what it shows, what it says, and how it is drawn. */
export interface VariableCount {
  /** What the row shows: "14", "2+", or words for a zero not counted yet. */
  readonly text: string;
  /** What it says on hover and to a screen reader. */
  readonly words: string;
  /** Drawn muted: nothing found. */
  readonly zero: boolean;
  /** A floor: "at least". */
  readonly floor: boolean;
}

/**
 * A row's count: a bare number of places, "2+" while that is a floor. A zero
 * that is a floor says "Not counted yet", as a shared style's row does,
 * rather than "0+", a number that says nothing.
 */
export function variableCount(reach: VariableReach): VariableCount {
  const places = variablePlaces(reach);
  if (!reach.complete) {
    if (places === 0) {
      return {
        text: "Not counted yet",
        words: `No uses counted yet. ${NOT_COUNTED_YET}`,
        zero: true,
        floor: true,
      };
    }
    return {
      text: `${String(places)}+`,
      words: `Used in at least ${placesWords(places)}. ${NOT_COUNTED_YET}`,
      zero: false,
      floor: true,
    };
  }
  return {
    text: String(places),
    words: places === 0 ? NOT_USED : `Used in ${placesWords(places)}`,
    zero: places === 0,
    floor: false,
  };
}

/** What an unused variable's row and editor say. */
const NOT_USED = "Not used anywhere";

/**
 * What Remove does for a variable the site added: go ahead behind the
 * confirm (`free`), refuse while it is used (`in-use`), or wait for the
 * pages to be counted (`not-whole`). `unread` while nothing has been read,
 * when Remove confirms as it always has and the save refuses a use.
 */
export type VariableRemoval = "free" | "in-use" | "not-whole" | "unread";

export function variableRemoval(
  reach: VariableReach | undefined
): VariableRemoval {
  if (reach === undefined) return "unread";
  if (variablePlaces(reach) > 0) return "in-use";
  return reach.complete ? "free" : "not-whole";
}

/** The editor's line beside Remove: how widely the variable is used. */
export function variableStatus(reach: VariableReach | undefined): string {
  if (reach === undefined) return "";
  const places = variablePlaces(reach);
  if (places > 0) {
    return `Used in ${reach.complete ? "" : "at least "}${placesWords(places)}`;
  }
  return reach.complete ? NOT_USED : "Counting where it's used…";
}

/** "It's used in 14 places, and they would lose this colour:". */
export function variableLossSentence(
  reach: VariableReach,
  loss: string
): string {
  const floor = reach.complete ? "" : "at least ";
  return `It's used in ${floor}${placesWords(variablePlaces(reach))}, and they would lose this ${loss}:`;
}

/**
 * What a shared style sets with a variable, in the author's words, by the
 * style property that names it. A property not listed is said as "uses it".
 */
const PROPERTY_WORDS: Readonly<Record<string, string>> = {
  color: "text colour",
  linkColor: "link colour",
  linkColorHover: "hovered link colour",
  backgroundColor: "background colour",
  background: "background",
  backgroundGradient: "background gradient",
  border: "border",
  borderRadius: "corner radius",
  boxShadow: "shadow",
  textShadow: "text shadow",
  padding: "padding",
  margin: "margin",
  gap: "gap",
  rowGap: "row gap",
  columnGap: "column gap",
  width: "width",
  height: "height",
  minWidth: "minimum width",
  minHeight: "minimum height",
  maxWidth: "maximum width",
  maxHeight: "maximum height",
  fontFamily: "font",
  fontSize: "text size",
  fontWeight: "font weight",
  lineHeight: "line height",
  letterSpacing: "letter spacing",
  wordSpacing: "word spacing",
  transition: "transition",
};

/** Whether a style value names this variable, inside a structured value too. */
function namesVariable(value: unknown, identity: string): boolean {
  if (isTokenRef(value)) return value.$token === identity;
  if (!isPlainRecord(value)) return false;
  return Object.values(value).some(inner => namesVariable(inner, identity));
}

/**
 * The style properties of a shared style that name a variable, under any
 * state or breakpoint, each once, in the order first met.
 */
function propertiesNaming(style: NamedClass, identity: string): string[] {
  const found = new Set<string>();
  for (const { values } of storedContexts(style.styles)) {
    for (const [property, value] of Object.entries(values)) {
      if (namesVariable(value, identity)) found.add(property);
    }
  }
  return [...found];
}

/** The block type a class is a look of, or nothing for a shared style. */
function lookTypeOf(entry: NamedClass): string | undefined {
  return isLook(entry) && typeof entry.blockType === "string"
    ? entry.blockType
    : undefined;
}

/**
 * What a shared style does with a variable, said in a list of places:
 * "sets text colour", "sets padding and margin", or "uses it" when the style
 * is not in hand or names it only in properties without plainer words.
 */
export function sharedStyleSets(
  classes: readonly NamedClass[] | undefined,
  classId: string,
  identity: string,
  /** A look's block type: two types' own looks may share an id. */
  blockType?: string
): string {
  const style = classes?.find(
    entry => entry.id === classId && lookTypeOf(entry) === blockType
  );
  if (style === undefined) return "uses it";
  const words = [
    ...new Set(
      // Read as own entries: a property key is stored data, and
      // `__proto__` must not read the table's prototype.
      propertiesNaming(style, identity).flatMap(property =>
        Object.hasOwn(PROPERTY_WORDS, property)
          ? [PROPERTY_WORDS[property] ?? ""]
          : []
      )
    ),
  ];
  return words.length === 0 ? "uses it" : `sets ${listedWords(words)}`;
}
