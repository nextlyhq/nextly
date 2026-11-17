/**
 * The engine's public exports: the style system: the catalog, CSS values, the page compiler, site tokens and their DTCG files, colour, named classes, looks, breakpoints and document migration.
 *
 * Part of the package's root entry, `../index.ts`, which re-exports every
 * part in a fixed order. Nothing here imports that entry.
 */
export {
  STYLE_CATALOG,
  getStyleProperty,
  stylePropertiesInGroup,
  styleFlagsInGroup,
} from "../style/catalog";
export {
  APPLIES_WHEN,
  STYLE_GROUPS,
  STYLE_GROUP_DEFS,
  TOKEN_KINDS,
  isStyleLeaf,
  shapeLeaves,
} from "../style/catalog-types";
export { applies, type AppliesContext } from "../style/applies";
export type {
  AppliesWhen,
  ColorLeaf,
  CssValueLeaf,
  DimensionLeaf,
  KeywordExpansion,
  KeywordLeaf,
  LogicalCornersShape,
  LogicalSidesShape,
  NumberLeaf,
  ObjectShape,
  StyleGroup,
  StyleGroupDef,
  StyleLeaf,
  StyleProperty,
  StyleShape,
  TokenKind,
  UnionShape,
  UrlLeaf,
} from "../style/catalog-types";
export {
  checkColorValue,
  checkCssValue,
  checkDimensionValue,
  checkUrlValue,
  // Whether a word is one of the keywords legal on every property, which
  // stands only alone: a shorthand's editor needs it to refuse `underline
  // inherit`, a value the browser discards whole.
  isCssWideKeyword,
  // How CSS reads an identifier that carries escapes. Public for the same
  // reason as the namespacing rule: anything deciding what a name IS has to
  // decode it the same way, or `font\2d family` reads as a different property
  // here than it does in a browser.
  decodeIdentifier,
  referencesCustomProperty,
  // The custom properties a value reads through `var()`, by the same walk:
  // what counts a site's variable as used where CSS text names it, as a
  // shadow's colour does.
  customPropertiesReferenced,
  // A shadow's layers and their parts, as the token check reads them: the
  // builder's shadow fields read a shadow the same way, so the fields and
  // the check agree on what a part is.
  shadowLayerParts,
  // The other direction, public for the same reason. A caller that decoded a
  // name to compare it has to escape it again before writing it back, or a name
  // holding a space or a quote is emitted as tokens the parser reads apart.
  escapeIdentifier,
  // ASCII-only case folding, which is what CSS applies to keywords. JavaScript's
  // `toLowerCase` folds more than that: U+212A KELVIN SIGN becomes "k", so
  // `@\u212Aeyframes` reads as `@keyframes` to a check using it and as an unknown
  // at-rule to a browser. Public because every surface deciding what a keyword
  // IS has to fold it the same way.
  asciiLower,
  // What CSS discards around a value, which is NOT what `String.trim` discards:
  // JavaScript strips NBSP and the Unicode spaces and CSS does not, so an editor
  // trimming with the language's own function normalises spellings the engine
  // then refuses — or worse, converts one into a value it accepts.
  trimCssWhitespace,
  // The longest style value the compiler reads: anything past it is refused
  // before parsing, so a writer honours it and a reader keyed on what the sheet
  // contains stops reading where the compiler does.
  MAX_VALUE_LENGTH,
} from "../style/css-value";
export {
  collectStyleProperties,
  collectStyleTokens,
  documentTokenUsage,
  forEachStyleValues,
  onlySiteProperties,
  onlyVariableIdentities,
  styleEnvelopeProperties,
  styleEnvelopeTokens,
  styleSitePropertiesIn,
  styleVariablesIn,
  type TokenUsage,
} from "../style/document-token-usage";
export type {
  CssValueRejection,
  MayFetchUrl,
  ShadowPart,
  ShadowPartKind,
} from "../style/css-value";
export type { StyleValueOptions } from "../style/validate-style-value";
export {
  validateStyleValues,
  leafAcceptsValue,
  newStyleIssueBudget,
  MAX_STYLE_ISSUES,
  MAX_STYLE_ISSUE_PATH_BYTES,
  MAX_SITE_ISSUES,
  MAX_SITE_ISSUE_PATH_BYTES,
  MAX_SITE_LOOKUPS,
  tokenKindAllowedAt,
  tokenKindsForProperty,
  // Which arm of a union a stored value belongs to. Public because more than one
  // surface asks it: validation picks the arm it judges a value against, and an
  // editor picks the control to draw for it. A second answer drifts silently,
  // because both surfaces look right on their own — the disagreement is visible
  // only to an author holding a control for one arm while reading an error
  // written about another.
  //
  // `style/declarations.ts` still selects an arm its OWN way while emitting, by
  // taking the first that writes bytes. Measured, the two already disagree:
  // `fontWeight: 700` resolves here to the number arm and emits through the
  // keyword one, because `scalarText` reads no leaf kind. Nothing is visibly
  // wrong today only because both arms write `font-weight`.
  styleUnionVariant,
} from "../style/validate-style-value";
export type {
  StyleIssueBudget,
  StyleUnionVariantOptions,
} from "../style/validate-style-value";
export {
  compilePageCss,
  BASE_BREAKPOINT,
  // The width past which a stored record is not read. Exported for the same
  // reason as the breakpoints below: a reader keyed on what compilation emits
  // must stop reading where compilation stops, and a second constant would
  // drift from the one that decides the output.
  MAX_SCANNED_KEYS,
  // The normalised breakpoints, for a reader keyed on what the compiler emits
  // rather than on what was stored. Exported rather than restated because a
  // second copy of the dropping, sorting and capping rules would drift from the
  // one that decides the output, and would drift silently in both directions.
  breakpointContexts,
} from "../style/compile-page";
export type { BreakpointContext } from "../style/compile-page";
// The one rule for how a document-global CSS name wears its scope. Public
// because more than one place has to produce it and they must agree exactly:
// the compiler namespaces the names it emits, the custom-CSS sanitizer
// namespaces the names an author writes, and `findUnnamespacedGlobals` checks
// the result. Two spellings of "namespaced" would make that check pass on
// output the browser still resolves globally.
export {
  findUnnamespacedGlobals,
  namespacedGlobalName,
} from "../style/isolation";
// Site tokens and self-hosted fonts: the table a token name resolves in, and
// the faces a site serves. Public because the admin's tokens studio and the
// site-sheet compiler both build on these types.
export {
  DARK_MODE_ATTRIBUTE,
  TOKEN_MODES,
  defaultSiteTokens,
  resolveSiteTokens,
  cssString,
  emitFontFaces,
  emitTokenBlocks,
  isAuthorableTokenName,
  isTokenName,
  tokenNamingProblem,
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKEN_NAME_SEGMENTS,
  MAX_TOKEN_PREFIX_LENGTH,
  // A variable's plain name: the optional label, its check, and the label
  // derived from the code name when none is stored.
  MAX_TOKEN_LABEL_LENGTH,
  tokenDisplayLabel,
  tokenLabelIssue,
  // The one rule for whether a value fits its token's kind, and what to type
  // instead: an editor runs it before accepting a value, and a save runs it
  // again, so the two cannot disagree.
  checkTokenKind,
  tokenKindExample,
  // Both halves of token identity, public for the same reason the types are:
  // an editor that offers rename has to pin the identity the way this package
  // pins it, and one that cannot reach these has no way to do that except to
  // reimplement the rule or to write `name` directly — which moves the custom
  // property every compiled page references, silently.
  renameSiteToken,
  tokenIdentity,
  resolveTokenPrefix,
  validateFontFace,
} from "../style/site-tokens";
export type {
  DarkModeStrategy,
  FontFaceDef,
  FontSource,
  SiteToken,
  SiteTokenSet,
  TokenMode,
} from "../style/site-tokens";
// Light and dark across files: the DTCG theme (resolver) file, and one file
// per mode as Figma imports and exports variables.
export {
  RESOLVER_VERSION,
  modeFilesToTokens,
  resolverToTokens,
  tokensToFigma,
  tokensToResolver,
} from "../style/dtcg-modes";
export type { ModeFile } from "../style/dtcg-modes";
// Whether two tokens say the same thing: one answer for a stored override and
// for an editor's Reset.
export { sameJsonValue, sameSiteToken } from "../style/same-token";
// A colour written as a value rather than through a variable, which the
// inspector marks as not adapted to dark mode.
export { isRawColour } from "../style/raw-colour";
// Interop and judgement, both pure: the format other design-token tools read,
// and the contrast a person needs while a colour picker is open.
export {
  GENERIC_FONT_FAMILIES,
  NEXTLY_EXTENSION,
  dtcgToTokens,
  isKind,
  resolveAliases,
  tokensToDtcg,
  familyPartKind,
  readFamilyList,
  splitFamilyList,
} from "../style/dtcg";
export type {
  DtcgNode,
  FamilyListKind,
  FamilyListReading,
  FamilyPart,
  FamilyPartKind,
  ReadFamilyPart,
} from "../style/dtcg";
export {
  checkContrast,
  compositeOver,
  contrastRatio,
  parseColor,
  relativeLuminance,
} from "../style/contrast";
export type { ContrastLevel, ContrastResult, Rgb } from "../style/contrast";
// The one CSS-colour policy. Both surfaces that put a stored colour on a page
// read it from here: the React renderer, which may not import the CMS, and the
// CMS's own serializer, which lives where the renderer cannot reach.
export {
  cssColor,
  hasCssInjection,
  normalizeCssValue,
} from "../style/css-color";
// One reading of a rich-text inline style. The CMS serializer, the React
// renderer and the versions differ all ask this module rather than each other.
export {
  formatsDrawnByStyle,
  INLINE_STYLE_PROPERTIES,
  isInlineStyleProperty,
  readInlineStyle,
  sanitizeInlineStyle,
} from "../style/inline-style";
export type {
  CompiledPageCss,
  StyleCompileContext,
} from "../style/compile-page";
export {
  blockPartClassName,
  blockTypeClassName,
  // The digest itself, for a caller naming something other than a node from an
  // id — a per-document scope class, say. Exported so that caller reaches for
  // this rather than writing a second hash, which is how the two that existed
  // before came to disagree about the width a class needs.
  hashId,
  nodeClassName,
  nodeClassNames,
  BLOCK_TYPE_CLASS_PREFIX,
  // The opt-in a container wears to take the site's content width. Public
  // because two packages meet on it: the renderer puts it on an element and
  // this engine's site stylesheet writes the rule that matches. A selector in
  // one and a literal in the other would be one contract with two spellings,
  // and the half that drifted would simply stop matching rather than fail.
  CONTENT_WIDTH_CLASS,
  // The marker a container spacing its children wears: the compiler keys the
  // gap's rules on it, a block repeating its slot puts it on each wrapper, and
  // an editor takes it off to ask whether a margin is the gap.
  CHILD_GAP_CLASS,
  // What an Accordion section marks as its icon and its title, for the
  // Accordion's icon choices to reach.
  DISCLOSURE_ICON_CLASS,
  DISCLOSURE_TITLE_CLASS,
  NODE_CLASS_PREFIX,
  PAGE_ROOT_CLASS,
  PAGE_ROOT_SELECTOR,
} from "../style/node-class";
// A container's own content width: the prop the page compile reads it from,
// and the custom property it writes for the site sheet's rule to read.
export {
  CONTENT_WIDTH_PROP,
  CONTENT_WIDTH_PROPERTY,
  contentWidthTokenOf,
} from "../style/content-width";
export {
  compileStyleValues,
  scaledTokenText,
  tokenCustomProperty,
  DEFAULT_TOKEN_PREFIX,
  // The prefix tokens are actually written under, which is not the one that was
  // stored: unset, malformed and reserved prefixes all resolve to the default.
  // Exported so a reader keyed on the emitted custom-property names asks this
  // rather than the setting, which changes without the output changing.
  safeTokenPrefix,
  paintsBackgroundImage,
} from "../style/declarations";
export type { CompiledDeclarations, Declaration } from "../style/declarations";
/**
 * A background overlay's two custom properties, for an editor drawing their
 * controls.
 *
 * @experimental
 */
export { OVERLAY_COLOR, OVERLAY_STRENGTH } from "../style/overlay";
/**
 * "Animation when it appears": its parts' custom properties, for an editor
 * naming and drawing their controls, and the page's two gates, which a surface
 * that must show every block in its final state (the editor's canvas) closes.
 *
 * @experimental
 */
export {
  APPEAR_DELAY_PROPERTY,
  APPEAR_DURATION_PROPERTY,
  APPEAR_EFFECT_PROPERTY,
  APPEAR_LOAD_GATE,
  APPEAR_SCROLL_GATE,
  APPEAR_START_PROPERTY,
} from "../style/appear";
export {
  DISCLOSURE_ICON_PROPERTY,
  DISCLOSURE_ICONS,
  DISCLOSURE_POSITION_PROPERTY,
  DISCLOSURE_POSITIONS,
} from "../style/disclosure";
export { serializeRules } from "../style/serialize";
export type { CssRule } from "../style/serialize";
export {
  styleSupportDefinitions,
  stylePropertiesForSupports,
  supportsAllowStyleProperty,
  styleGroupKeys,
} from "../style/supports-map";

export {
  migrateDocument,
  migrateProps,
  findMigrationGaps,
  nodeAtPointer,
} from "../migration";
export type {
  BlockMigrationInfo,
  MigratedNode,
  MigrateFn,
  MigrateResult,
  MigrationFailure,
  MigrationMap,
  MigrationSource,
  PropsMigrationResult,
} from "../migration";

// Named classes: reusable style presets a node applies by id.
export type { NamedClass } from "../style/named-class";
export {
  // A block type's own look, and the edits to its base a site's library holds.
  // `@experimental` (with `blockOwnLooks` and `overlaidStyles`) until the
  // editor that changes an own look ships.
  blockDefaultsOf,
  classNameOf,
  isDefaultLook,
  isLook,
  isUsableNamedClass,
  ownLooksRead,
  // Which style is each block type's ★ default, as the compiler reads it.
  // `@experimental` until the Styles tab that moves ★ settles.
  starredLooksOf,
  LOOK_CLASS_PREFIX,
  namedClassName,
  orderedNamedClasses,
  // How long a class id or slug may be before the compiler discards the class.
  // Exported so a reader that walks the same library bounds its reads where the
  // compiler bounds its own, rather than copying megabytes of a name the
  // compiler rejected by length before it looked at anything else.
  MAX_NAMED_CLASS_NAME_LENGTH,
  // Which classes a library actually RESOLVES to, ordering and claim rules
  // included. The compiler writes exactly this list and the renderer is handed
  // exactly this list, so a caller that needs to tell an author whether the
  // class they wrote will render asks this rather than modelling it: the
  // ordering is `orderIndex` then `id`, and a slug or id already claimed drops
  // the later entry, which is four separate rules to get right by hand.
  usableNamedClasses,
  usableNamedClassPositions,
  // The part of a library the compiler reads, before those rules run.
  namedClassesRead,
  NAMED_CLASS_PREFIX,
  NAMED_CLASS_SLUG_RE,
} from "../style/named-class";
/**
 * @experimental A block type's looks (its named variants: a button's Outline), as the shared
 * styles a site receives, bound to the block type and written before every other shared style.
 */
export { blockLooks, blockOwnLooks, lookClassId } from "../style/block-looks";
export type { BreakpointAxis } from "../style/breakpoint-axes";

// Where each emitted declaration came from, for an editor that has to tell an author which of
// several tiers they are looking at. Produced only when `StyleCompileContext.trace` asks for it.
// Every bound on a string the compiler can emit, as DATA rather than as prose.
// A consumer that digests these inputs must keep enough of each string to tell
// two apart whenever they compile differently, and this is the set that decides
// how much "enough" is.
export { EMITTABLE_STRING_BOUNDS } from "../style/emittable-string-bounds";
// `previewStateClass` is published because it is a CONTRACT between the
// compiler and a previewing surface: the compiler writes it into a selector
// and the surface puts it on an element. A name spelled in two places can be
// spelled differently, which is why `NODE_ID_ATTRIBUTE` is published too.
export {
  MAX_SCOPE_LENGTH,
  previewStateClass,
  statePropagatesToAncestors,
} from "../style/compile-page";
export type { EmittableStringBound } from "../style/emittable-string-bounds";
export type { StyleOrigin, StyleTraceEntry } from "../style/style-trace";
export type { StyleQuery, StyleSubject } from "../style/style-origin";

// The stylesheet every page of a site shares, compiled once and addressed by its content.
export type { SiteSheetArtifact, SiteSheetInput } from "../style/site-sheet";
export { compileSiteSheet, compileSiteTokenSheet } from "../style/site-sheet";
// `outranksEntry` is published beside `styleOrigin` because that function
// cannot answer every form of the question it answers: it is asked once per
// STATE, so comparing two states' winners falls to the caller. Published, that
// caller ranks THROUGH the compiler's own weighting instead of keeping a
// second idea of what beats what — which is how the builder came to rank a
// block default's `a:hover` above a node's own `a` after the default tiers
// stopped weighing what the authored ones do.
export { outranksEntry, styleOrigin } from "../style/style-origin";
export { BREAKPOINT_AXES } from "../style/breakpoint-axes";
/*
 * What a stored breakpoint set MEANS, which the type does not say.
 *
 * Exported because more than one package now asks: the editor reads them to
 * build its dialog and its switcher, and a preview surface outside the builder
 * derives device presets from the same set. Reimplemented on either side, the
 * two would agree about what a breakpoint IS and disagree about which rows an
 * author defined and in what order they apply.
 */
export { authoredBreakpoints, inCascadeOrder } from "../style/breakpoint-set";

/**
 * The value a size made with Fluid… takes, for a site's fluid range. Public
 * because both the editor that writes it and a save that merges two authors'
 * edits must write the same value from the same sizes and range.
 */
export {
  DEFAULT_FLUID_RANGE,
  fluidValue,
  type FluidRangeWidths,
  type FluidSizes,
} from "../style/fluid-value";
