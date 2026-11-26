/**
 * The editor's glossary: every word an author reads for one of its ideas,
 * spelled once, and the words it no longer says.
 *
 * Three parts. `editor-words` names the editor's places (the rail, the
 * panels, the tabs). `words` names its settings and the things an author
 * makes. `retired-words` lists every other word for those ideas, with the
 * rule that finds it in shown text; the repository's retired-words test
 * reads the builder, the Page Builder plugin and the admin against it on
 * every pull request.
 *
 * The plugin's admin screens read these words through the package entry.
 * The admin may not import the builder, so its strings keep their own copy
 * of the words, and the retired-words test reads them there.
 *
 * Plain tooltips for the style properties the panel draws belong here too,
 * keyed by catalog property, apart from the engine catalog's notes, which
 * stay developer documentation.
 *
 * @module glossary
 */
export {
  CONVERSION_WORDS,
  DESIGN_ACTION_WORDS,
  EDITOR_WORDS,
  type EditorWord,
} from "../editor-words";
export {
  ADD_PANEL_WORDS,
  BOX_DESCRIPTION,
  CHOICE_WORDS,
  CONNECT_WORDS,
  GAP_WORDS,
  HEADER_FOOTER_WORDS,
  IMAGE_FIT_WORDS,
  INDUSTRY_KEYWORDS,
  LINK_WORDS,
  MESSAGE_WORDS,
  PANEL_TOGGLE_WORDS,
  POSITION_WORDS,
  PROPERTY_WORDS,
  SAVED_SECTION_SIZE_WORDS,
  SCREEN_SIZE_WORDS,
  SIZE_WORDS,
  VARIABLE_WORDS,
  VERB_WORDS,
  changeForThis,
  connectedTo,
  contentThisPageLoads,
  headerAndFooterNamed,
  letEachPageChange,
  propertyCount,
} from "./words";
export { RETIRED_WORDS } from "./retired-words";
