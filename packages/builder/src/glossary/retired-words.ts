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
  /**
   * Whether a shown text uses the retired word, in the file at `path`
   * (repository-relative, with "/"), for a word retired in one sense whose
   * sense a place decides.
   */
  readonly test: (text: string, path: string) => boolean;
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
  colour: "colour(?:s|ed|ing|ful|less)?",
  // centre, centres, centred, centring
  centre: "centr(?:e|es|ed|ing)",
  behaviour: "behaviour(?:s|al)?",
  grey: "grey(?:s|ed|ing|ish|scale)?",
};

/** A British spelling's pattern, US forms ("color") excluded. */
function britishPattern(british: string): RegExp {
  const ending = ENDINGS[british];
  if (ending === undefined) {
    // An -ise verb and its forms: customise, customises, customised,
    // customising, customisation, customiser, customisable.
    const stem = british.slice(0, -1);
    return new RegExp(
      `\\b${stem}(?:e|es|ed|ing|ation|ations|er|ers|able)\\b`,
      "i"
    );
  }
  return new RegExp(`\\b${ending}\\b`, "i");
}

/** A rule that is one pattern. */
function matching(pattern: RegExp): (text: string) => boolean {
  return text => pattern.test(text);
}

/** Whether a repository-relative path is one of `places` or beneath one. */
function inPlaces(path: string, places: readonly string[]): boolean {
  return places.some(place =>
    place.endsWith("/") || place.endsWith("-")
      ? path.startsWith(place)
      : path === place
  );
}

/** The builder and the Page Builder plugin, without the admin. */
const BUILDER_AND_PLUGIN = [
  "packages/builder/",
  "packages/plugin-page-builder/",
] as const;

/** "Header", "footer", "header & footer" and their plurals. */
const HEADER_OR_FOOTER = /\b(?:header|footer)s?\b/i;
/**
 * "set" as a noun: "a set", "this set", "footer sets", "{…} set", never
 * the verb ("Set a width", "the header sets the title").
 */
const SET_NOUN =
  /\bfooter\s+set\b|\bfooter\s+sets\b(?!\s+(?:its|the|a|an|their|how|what|which|up)\b)|\b(?:a|an|the|one|this|each|every|another|new|default|other|which|its|no|than one|untitled)\s+sets?\b|\{…\}\s+sets?\b|\bthis set's\b/i;

/**
 * The header & footer screens, where "set" means a header & footer even when
 * the text doesn't say which.
 */
const HEADER_FOOTER_PLACES = [
  "packages/plugin-page-builder/src/admin/editor/set-",
  "packages/plugin-page-builder/src/admin/editor/new-set-dialog.tsx",
  "packages/plugin-page-builder/src/admin/editor/region-card.tsx",
  "packages/plugin-page-builder/src/admin/editor/header-footer-group.tsx",
  "packages/plugin-page-builder/src/admin/editor/editor-top-bar.tsx",
  "packages/plugin-page-builder/src/admin/layout-area-client.ts",
  "packages/plugin-page-builder/src/admin/layout-writes-client.ts",
  "packages/plugin-page-builder/src/layout-writes-route.ts",
  "packages/plugin-page-builder/src/layout-removal/",
  "packages/plugin-page-builder/src/default-layout/",
] as const;

/** What follows "look" when it is the verb: "looks right", "look at". */
const LOOK_VERB = String.raw`(?!\s+(?:at|for|like|up|into|through|over|right|wrong|empty|exactly|good|fine|best|better|great|ok|okay|off|as|the same|different|nice|bad)\b)`;

/**
 * "look" as a noun naming a block style: "a look for buttons", "other
 * looks", "Default look", "Button look", "Looks". Never the verb: "Look
 * for", "This looks fine", "Which looks best?", "a block that looks right".
 */
const LOOK_NOUN = new RegExp(
  [
    String.raw`(?<!\b(?:have|has|had|take|takes|took|give|gives|gave|get|quick)\s+)\b(?:a|an|the|its|each|every|new|saved|another|no|other|your|default|built-in|rename|delete|edit)\s+looks?\b(?!\s+(?:at|tells)\b)`,
    String.raw`\b(?:this|which)\s+look\b(?!\s+(?:at|for|like|up)\b)`,
    String.raw`(?:\bblock|\bbutton|\{…\}['’]?s?)\s+looks?\b${LOOK_VERB}`,
    String.raw`^looks?\b${LOOK_VERB}`,
  ].join("|"),
  "i"
);

/**
 * "Space between" as a layout name, the gap or a Spread choice: a name
 * starts with it ("Space between", "Space between blocks, 20px"). "Space
 * between paragraphs" names no gap, and "Space between the blocks inside" is
 * the gap's own hint; both stay, as does a sentence about the space between
 * things ("The space between the paragraphs of rich text.").
 */
const SPACE_BETWEEN_NAME =
  /^space[ -]between\b(?!\s+(?:paragraphs|the blocks inside)\b)/i;

/**
 * The screens of a component's per-copy settings, where "field" means one of
 * them even when the text doesn't say "component".
 */
const COMPONENT_PROPERTY_PLACES = [
  "packages/builder/src/inspector/component-fields-panel.tsx",
  "packages/builder/src/inspector/component-variants-panel.tsx",
  "packages/builder/src/inspector/instance-inspector-panel.tsx",
  "packages/builder/src/panels/components/component-fields.ts",
  "packages/builder/src/panels/components/component-variants.ts",
  "packages/builder/src/shell/exposure-picker.tsx",
] as const;

/** A content field a property is connected to: "Connect to a field". */
const CONNECTING = /\bconnect(?:ed)? to\b|\bdisconnect\b/i;

/** Fields spoken of beside a component, or counted on one ("· 2 fields"). */
const COMPONENT_FIELDS =
  /\bcomponent(?:['’]s)?\b.*\bfields?\b|\bfields?\b.*\bcomponent\b|· \{…\} fields?\b/i;

/** The Page settings tab of a page's own extra fields, now "More details". */
const PAGE_SETTINGS_DIALOG =
  "packages/plugin-page-builder/src/admin/editor/settings-dialog.tsx";

/**
 * "bind" and its forms; "Upper bound", "lower bound" and "bound by" are
 * not.
 */
const BIND =
  /\b(?:un)?bind(?:s|ing|ings)?\b|(?<!\b(?:upper|lower) )\b(?:un)?bound\b(?!\s+by\b)/i;

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
    test: matching(BIND),
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
    test: (text, path) =>
      SET_NOUN.test(text) &&
      (HEADER_OR_FOOTER.test(text) || inPlaces(path, HEADER_FOOTER_PLACES)),
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
    test: (text, path) =>
      inPlaces(path, COMPONENT_PROPERTY_PLACES)
        ? /\bfields?\b/i.test(text) && !CONNECTING.test(text)
        : COMPONENT_FIELDS.test(text),
  },
  {
    id: "fields-tab",
    says: PROPERTY_WORDS.moreDetails,
    where: [PAGE_SETTINGS_DIALOG],
    test: matching(/^fields$/i),
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
