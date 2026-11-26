/**
 * The words the editor no longer says, each with the rule that finds it in
 * visible text and the word that replaces it.
 *
 * One word per idea: once an idea has its word in the glossary, every other
 * word for it is retired here. The repository's retired-words test reads the
 * shown text of the builder, the Page Builder plugin and the admin against
 * these rules on every pull request, so a retired word cannot come back on a
 * new screen.
 *
 * A rule matches the word where it means the retired idea, not wherever its
 * letters appear: "set" only beside a header or footer, "look" only as a
 * noun, "Space between" only as a name ("Space between paragraphs" and "Space
 * between the blocks inside" stay). Code names, search keywords and log
 * messages are never read as shown text, so no rule needs to spare them.
 *
 * It imports only the glossary's words, so the scripts suite loads it with
 * no build.
 *
 * @module glossary/retired-words
 */
import { EDITOR_WORDS } from "../editor-words";

import {
  ADD_PANEL_WORDS,
  CONNECT_WORDS,
  GAP_WORDS,
  HEADER_FOOTER_WORDS,
  PANEL_TOGGLE_WORDS,
  POSITION_WORDS,
  PROPERTY_WORDS,
  SCREEN_SIZE_WORDS,
} from "./words";

/** One retired word: what finds it, and what an author reads instead. */
export interface RetiredWord {
  /** A short, stable name, used by the list of texts still to rename. */
  readonly id: string;
  /** The word that replaces it, for the test's message. */
  readonly says: string;
  /**
   * The folders it is retired in, by repository-relative prefix. Absent:
   * the builder, the Page Builder plugin and the admin.
   */
  readonly where?: readonly string[];
  /** Whether a shown text uses the retired word. */
  readonly test: (text: string) => boolean;
}

/**
 * The British spellings and the US spelling each becomes. A spelling matches
 * with its usual endings ("colours", "centred", "customising").
 */
export const BRITISH_SPELLINGS: Readonly<Record<string, string>> = {
  colour: "color",
  centre: "center",
  behaviour: "behavior",
  grey: "gray",
  customise: "customize",
  organise: "organize",
  recognise: "recognize",
  optimise: "optimize",
  normalise: "normalize",
  minimise: "minimize",
  maximise: "maximize",
  summarise: "summarize",
  prioritise: "prioritize",
  finalise: "finalize",
  initialise: "initialize",
  personalise: "personalize",
  visualise: "visualize",
  synchronise: "synchronize",
  authorise: "authorize",
  categorise: "categorize",
  emphasise: "emphasize",
  realise: "realize",
  specialise: "specialize",
  standardise: "standardize",
  utilise: "utilize",
  capitalise: "capitalize",
  serialise: "serialize",
  localise: "localize",
  sanitise: "sanitize",
  memorise: "memorize",
  apologise: "apologize",
};

/** The endings a spelling is matched with, after its last letter is dropped. */
const ENDINGS: Readonly<Record<string, string>> = {
  // colour, colours, coloured, colouring, colourful
  colour: "colour(?:s|ed|ing|ful)?",
  // centre, centres, centred, centring
  centre: "centr(?:e|es|ed|ing)",
  behaviour: "behaviour(?:s|al)?",
  grey: "grey(?:s|ed|ing|ish)?",
};

/** A British spelling's pattern, US forms ("color") excluded. */
function britishPattern(british: string): RegExp {
  const ending = ENDINGS[british];
  if (ending === undefined) {
    // An -ise verb: customise, customises, customised, customising,
    // customisation.
    const stem = british.slice(0, -1);
    return new RegExp(`\\b${stem}(?:e|es|ed|ing|ation|ations)\\b`, "i");
  }
  return new RegExp(`\\b${ending}\\b`, "i");
}

/** A rule that is one pattern. */
function matching(pattern: RegExp): (text: string) => boolean {
  return text => pattern.test(text);
}

/** The builder and the Page Builder plugin, without the admin. */
const BUILDER_AND_PLUGIN = [
  "packages/builder/",
  "packages/plugin-page-builder/",
] as const;

/** "Header", "footer", "header & footer" and their plurals. */
const HEADER_OR_FOOTER = /\b(?:header|footer)s?\b/i;
/** "set" as a noun: "a set", "this set", "footer set", "sets". */
const SET_NOUN =
  /\b(?:header|footer|a|an|the|one|this|that|each|every|another|new|default|other|which|its|no|than one)\s+sets?\b|\bsets\b/i;

/** What follows "look" when it is the verb: "look at", "looks right". */
const LOOK_VERB = String.raw`(?!\s+(?:at|for|like|up|into|through|over|right|wrong|empty|exactly|good|the same|different)\b)`;

/**
 * "look" as a noun naming a block style: "a look", "other looks", "Looks",
 * never the verb ("Look for", "a tab that looks empty").
 */
const LOOK_NOUN = new RegExp(
  String.raw`\b(?:a|an|the|this|its|each|every|new|saved|another|which|no|other|your)\s+looks?\b${LOOK_VERB}|^looks?\b${LOOK_VERB}`,
  "i"
);

/**
 * "Space between" as a layout name, the gap or a Spread choice. Not a
 * sentence about the space between named things: "Space between
 * paragraphs" and "Space between the blocks inside" stay.
 */
const SPACE_BETWEEN_NAME = /\bspace[ -]between\b(?!\s+(?:paragraphs|the)\b)/i;

/**
 * "Fields" naming a component's per-copy settings: the bare label, or
 * fields counted or spoken of beside a component.
 */
const COMPONENT_FIELDS =
  /^fields$|\bcomponent\b.*\bfields?\b|\bfields?\b.*\bcomponent\b|· \{…\} fields?\b|\b\d+ fields?\b/i;

/** A bare "Template" as a name; "Collection templates" stays. */
const BARE_TEMPLATE = /(?<![Cc]ollection )\bTemplates?\b/;

export const RETIRED_WORDS: readonly RetiredWord[] = [
  {
    id: "token",
    says: EDITOR_WORDS.variables,
    test: matching(/\btokens?\b/i),
  },
  {
    id: "breakpoint",
    says: SCREEN_SIZE_WORDS.screenSize,
    test: matching(/\bbreakpoints?\b/i),
  },
  {
    id: "bind",
    says: `${CONNECT_WORDS.connect} · ${CONNECT_WORDS.disconnect}`,
    test: matching(/\b(?:un)?bind(?:s|ing|ings)?\b|\bbound to\b|\bunbound\b/i),
  },
  {
    id: "insert",
    says: EDITOR_WORDS.add,
    test: matching(/\binsert(?:s|ed|ing)?\b/i),
  },
  {
    id: "inspector",
    says: PANEL_TOGGLE_WORDS.rightPanel,
    test: matching(/\binspectors?\b/i),
  },
  {
    id: "header-footer-set",
    says: HEADER_FOOTER_WORDS.headerAndFooter,
    test: text => HEADER_OR_FOOTER.test(text) && SET_NOUN.test(text),
  },
  {
    id: "look",
    where: BUILDER_AND_PLUGIN,
    says: `${EDITOR_WORDS.style} · ${EDITOR_WORDS.blockStyles} · ${EDITOR_WORDS.sharedStyles}`,
    test: matching(LOOK_NOUN),
  },
  {
    id: "element",
    says: "block",
    test: matching(/\belements?\b/i),
  },
  {
    id: "logical",
    says: "a plain side name: top, right, bottom, left",
    test: matching(/\blogical\b/i),
  },
  {
    id: "viewport",
    says: "window or screen",
    test: matching(/\bviewports?\b/i),
  },
  {
    id: "normal-flow",
    says: POSITION_WORDS.default,
    test: matching(/\bnormal flow\b/i),
  },
  {
    id: "layer-order",
    says: POSITION_WORDS.overlapOrder,
    test: matching(/\blayer order\b/i),
  },
  {
    id: "space-between",
    says: `${GAP_WORDS.gap}, or the Spread choice ${GAP_WORDS.spreadOut}`,
    test: matching(SPACE_BETWEEN_NAME),
  },
  {
    id: "component-fields",
    says: PROPERTY_WORDS.properties,
    where: BUILDER_AND_PLUGIN,
    test: matching(COMPONENT_FIELDS),
  },
  {
    id: "page-data",
    says: "Content this page loads",
    test: matching(/\bpage data\b/i),
  },
  {
    id: "bare-template",
    says: ADD_PANEL_WORDS.collectionTemplates,
    where: BUILDER_AND_PLUGIN,
    test: matching(BARE_TEMPLATE),
  },
  ...Object.entries(BRITISH_SPELLINGS).map(
    ([british, us]): RetiredWord => ({
      id: british,
      says: us,
      test: matching(britishPattern(british)),
    })
  ),
];
