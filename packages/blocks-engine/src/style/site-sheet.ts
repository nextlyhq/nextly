// The stylesheet a whole site shares, compiled once.
//
// A page's own sheet carries what only that page knows: its settings and each node's own values.
// Everything above that — the design tokens, the self-hosted fonts, the named classes, the block
// types' defaults — is the same bytes on every page of the site. Inlining it per page repeats it
// on every request; compiling it once gives one cacheable artifact addressed by its content.
//
// The tiers here are emitted by `compilePageCss`, not by a second emitter written beside it. That
// is the load-bearing choice. The site sheet and a page's sheet have to agree exactly about what
// a class or a block default looks like — one specificity, one order, one set of bytes — and two
// emitters agree only until someone edits one of them. Feeding the page compiler a document that
// uses every type and styles nothing keeps the guarantee structural rather than remembered.
//
// @module style/site-sheet

import type { BlockDocument, BreakpointSet, NodeStyles } from "../document";
import type { ValidationIssue } from "../validation";

import { compilePageCss } from "./compile-page";
import type { MayFetchUrl } from "./css-value";
import { compileStyleValues, tokenCustomProperty } from "./declarations";
import type { NamedClass } from "./named-class";
import { CONTENT_WIDTH_CLASS, hashId, PAGE_ROOT_CLASS } from "./node-class";
import type { FontFaceDef, SiteToken, SiteTokenSet } from "./site-tokens";
import {
  emitFontFaces,
  emitTokenBlocks,
  resolveTokenPrefix,
  tokenIdentity,
} from "./site-tokens";

/** Everything the shared sheet is built from. All of it is site configuration, not document content. */
export interface SiteSheetInput {
  /** The site's design tokens, emitted as custom properties. */
  tokens?: SiteTokenSet;
  /** Self-hosted font faces. Remote sources are refused by `validateFontFace`, not here. */
  fonts?: readonly FontFaceDef[];
  /** The named-class library, emitted in library order. */
  classes?: readonly NamedClass[];
  /** Each block type's default look, keyed by type. */
  blockBases?: Readonly<Record<string, NodeStyles>>;
  /** The site's breakpoints, which decide the at-rules every tier is emitted under. */
  breakpoints: BreakpointSet;
  /** The custom-property prefix tokens are written under. */
  tokenPrefix?: string;
  /**
   * Which hosts this site will fetch from.
   *
   * The class and block-default tiers are emitted VERBATIM into every page of
   * the site, and a declaration is a fetching surface: one stored
   * `background-image: url(...)` is a request every visitor of every page
   * makes. A page's own sheet is compiled with this policy already; without it
   * here, the two sheets judged the same value differently, and the site sheet
   * is emitted FIRST — a page sheet that merely omits a declaration cannot
   * retract one.
   *
   * Left undefined, no host question is asked and the compile behaves as it
   * did before this existed. That is unasked rather than allowed: an empty
   * allowlist would be the opposite answer.
   *
   * No `fetchPolicyId` counterpart, unlike the page compile. That stamp exists
   * so a reader can tell whether a STORED sheet was compiled under other
   * rules; this artifact is compiled per render and addressed by the hash of
   * its own bytes, so a policy that changes what is emitted changes the hash
   * and cannot be mistaken for the old sheet.
   */
  mayFetchUrl?: MayFetchUrl;
  /**
   * Emit viewport breakpoints as container queries against this container, for
   * a surface previewing the page in a resizable box.
   *
   * Carried so this tier answers the breakpoint question the same way the page
   * tier does. See {@link BreakpointContextOptions.previewContainer}.
   */
  previewContainer?: string;
  /**
   * Emit each interaction state so a previewing surface can force one.
   *
   * Carried through for the same reason `previewContainer` is: a named class
   * and a block-type default are compiled HERE, not with the page, so an editor
   * that asked the page compile for forceable states and not this one gets a
   * selected block whose hover appearance comes from a class showing nothing at
   * all. The tiers split across two sheets; the option must not.
   */
  previewStates?: boolean;
}

/** The shared sheet and the name it is addressed by. */
export interface SiteSheetArtifact {
  css: string;
  /**
   * A stable name for these exact bytes.
   *
   * Same input, same hash, on every machine and every run: it is computed from the emitted CSS
   * rather than from the inputs, so a change that does not alter a single byte of output does not
   * invalidate a cache, and one that does cannot fail to.
   *
   * Not a cryptographic digest, and not used as one. A collision would serve a stale sheet, which
   * is a caching fault rather than a safety one, and 53 bits is far past what a site's lifetime
   * of revisions can reach.
   */
  contentHash: string;
  /** What was left out of the sheet, and why. */
  warnings: ValidationIssue[];
}

/**
 * The selector site tokens are declared on.
 *
 * `:root` rather than the page root, because tokens are read by everything on the document —
 * including admin surfaces and any markup outside a compiled page — and a custom property is
 * inherited from wherever it is declared. Scoping them to the page root would leave a token
 * unreadable to anything the compiler did not write.
 */
const TOKEN_SELECTOR = ":root";

/**
 * The token the content-width rule reads.
 *
 * Its KIND is no longer checked here. Asking whether a value is a `max-width`
 * is the compiler's question, and a token-kind check answered a narrower
 * version of it — a `dimension` may carry a bare identifier the property
 * refuses.
 */
const CONTENT_WIDTH_TOKEN = "content.width";

/**
 * Values that are legal for `max-width` and bound nothing.
 *
 * `none` says so outright; the CSS-wide keywords resolve to it or to whatever a
 * cascade decides, which a site stylesheet cannot promise on behalf of a page.
 */
const UNBOUNDED_WIDTHS = new Set([
  "none",
  // `max-width` is not an inherited property, so `inherit` takes the parent's
  // computed value — which is `none` unless something up the tree happened to
  // set one. A site stylesheet cannot promise that, and the failure is the same
  // as the others here.
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
  "auto",
]);

/**
 * A document that uses every block type and styles nothing itself.
 *
 * `compilePageCss` emits a type's default only for a type present in the document, which is right
 * for a page and wrong for a site sheet: the sheet is shared, so it carries every default the
 * caller supplied. One styleless node per type says exactly that, and contributes no rules of its
 * own — a node with no `styles` and no `visibility` emits nothing.
 */
function documentUsingEveryType(
  blockBases: Readonly<Record<string, NodeStyles>>
): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: Object.keys(blockBases)
      .sort()
      .map((type, index) => ({
        id: `site-sheet-${index}`,
        type,
        version: 1,
        props: {},
      })),
  } as unknown as BlockDocument;
}

/**
 * The rule behind the content-width class.
 *
 * `margin-inline` rather than `margin: 0 auto`, so the centring follows writing
 * direction and leaves any block-direction margin an author set alone.
 *
 * **No fallback width, deliberately.** A site whose token set omits
 * `content.width` gets no rule at all, which is the same posture the rest of
 * this compiler takes: what the merged style does not define is omitted rather
 * than invented. A literal here would hand a site that deliberately removed the
 * token a width from a place it cannot see.
 *
 * **The two declarations stand or fall together, which is why the CALLER gates
 * on the token rather than this function emitting an unusable half.** An
 * undeclared custom property invalidates its own declaration and nothing else,
 * so a rule written without the token would drop `max-width` and keep
 * `margin-inline: auto` — centring a contained node that has an authored width
 * of its own, in exactly the configuration documented as producing no
 * containment. Centring is not the smaller half of this rule; it is a separate
 * effect that only makes sense once a width bounds it.
 *
 * Wrapped in `:where()` so it weighs nothing. It is a default that must lose to
 * anything an author states, including a `max-width` on the node itself, and
 * zero specificity is what makes that true without depending on source order.
 */
/**
 * Whether one emitted token can actually bound the content width.
 *
 * ONE predicate rather than a list of conditions, and that is the point. The
 * rule it guards has been reached from five directions — the token absent, the
 * token refused by the emitter, the right identity with the wrong kind, the
 * right kind with a value that is not one, and now a value that is a legal
 * `max-width` yet bounds nothing. Each was patched as its own condition, and a
 * fifth said the shape was wrong rather than the list incomplete: every one of
 * them is the same question, which is whether `max-width` will end up with a
 * usable maximum.
 *
 * Asked once, it also covers cases nobody has hit yet. `none` is valid CSS and
 * removes the bound; `initial`, `unset` and `revert` resolve to `none` or to
 * whatever a cascade decides, which is not something a site stylesheet can
 * promise. All of them leave `margin-inline: auto` centring an element that has
 * an authored width and no maximum — the failure this whole gate exists to
 * refuse.
 */
function boundsTheContent(token: SiteToken): boolean {
  if (tokenIdentity(token) !== CONTENT_WIDTH_TOKEN) return false;
  const values = Object.values(token.values ?? {});
  if (values.length === 0) return false;
  return values.every(value => typeof value === "string" && boundsWidth(value));
}

/**
 * Whether one value would give `max-width` a usable maximum.
 *
 * Two questions with two authorities, rather than one weaker check standing in
 * for both.
 *
 * **Is it a `max-width` at all?** Asked of the COMPILER, by compiling the
 * declaration and seeing whether one came out. A parallel check here would be a
 * second statement of the property's grammar, and a narrower one — a token
 * declared `dimension` may carry a bare identifier like `wide`, which the
 * token-kind check passes because it cannot know what a dimension may say,
 * while `max-width` rejects it outright.
 *
 * **Does it bound anything?** Asked here, because that is not a grammar
 * question. `none` is a perfectly valid `max-width` and removes the maximum;
 * the CSS-wide keywords resolve to it or to whatever a cascade decides, which a
 * site stylesheet cannot promise on behalf of a page. Every one of them leaves
 * `margin-inline: auto` centring an element with an authored width and no
 * ceiling.
 */
function boundsWidth(value: string): boolean {
  const normalised = value.trim().toLowerCase();
  if (UNBOUNDED_WIDTHS.has(normalised)) return false;
  // A value that resolves in the browser cannot be judged here at all.
  // `var(--x, none)` compiles — it is valid CSS — and computes to `none` when
  // the referenced property is absent, which is the unbounded case arriving
  // through a door no static check can watch. Refused rather than guessed at,
  // for the same reason an undefined token is: what the merged style does not
  // establish is omitted rather than assumed.
  if (normalised.includes("var(")) return false;
  const { declarations } = compileStyleValues({ maxWidth: value }, "/maxWidth");
  return declarations.length > 0;
}

function emitContentWidth(
  declaredTokens: readonly SiteToken[],
  prefix: string | undefined
): string {
  // The decision lives here rather than at the call site so the caller pushes
  // unconditionally: whether this rule applies is a fact about what the token
  // emitter wrote, and every branch spent asking about it up there is one the
  // sheet compiler carries for a question it does not own.
  //
  // Matched on IDENTITY rather than on the display name, because those are
  // different fields and the custom property is built from the first. A site
  // that renames this token keeps the identity and therefore keeps
  // `--site-content-width`, so a name check would withdraw containment from
  // every opted-in section while the property it reads was still declared.
  //
  // The KIND is part of the question, not decoration. A token carrying this
  // identity with a colour kind is emitted happily — the emitter's job is to
  // declare what it was given — and `max-width: #ff0000` is invalid at
  // computed-value time, so it drops while `margin-inline: auto` beside it does
  // not. Same half-rule, arrived at from a third direction.
  const declared = declaredTokens.some(boundsTheContent);
  if (!declared) return "";

  // Resolved through the same function the token emitter uses, not read raw. A
  // prefix that fails validation is REPLACED with the default there rather than
  // rejected, so a reference built from the raw value would name a property
  // nothing declared — silently, because an unresolved custom property
  // invalidates its declaration instead of reporting.
  const property = tokenCustomProperty(
    CONTENT_WIDTH_TOKEN,
    resolveTokenPrefix(prefix).prefix
  );
  // Anchored to the page root, like every other default this engine emits.
  // `override-contract.md` states the invariant plainly — "nothing the builder
  // emits can match outside the page root" — and an unanchored `:where()`
  // matches anywhere in the document, so a host element or a second rendered
  // page wearing this class would be constrained by a sheet that is not its
  // own. One class in the anchor keeps the whole selector at 0-1-0, which is
  // the weight the contract gives an element or block-type default.
  return `.${PAGE_ROOT_CLASS} :where(.${CONTENT_WIDTH_CLASS}){max-width:var(${property});margin-inline:auto}`;
}

/**
 * The tiers that do not read `breakpoints`: font faces, tokens, content width.
 *
 * Separated because these three are compilable when the site's breakpoints are unknown and the
 * block-default tier below them is not. `emitTokenBlocks` declares its custom properties under
 * `:root` and the only at-rule it can reach for is `(prefers-color-scheme:dark)`, which is a
 * colour-scheme query rather than a width one — so no answer about breakpoints changes a byte of
 * what this emits. A caller holding only a compiled artifact can therefore still be handed the
 * declarations that artifact's `var()` references resolve against, which is the whole reason this
 * boundary is drawn here rather than left inside {@link compileSiteSheet}.
 */
function compileBreakpointIndependentTiers(
  input: Omit<SiteSheetInput, "breakpoints">
): {
  blocks: string[];
  warnings: ValidationIssue[];
  // Carried out rather than re-derived by the caller: this file resolves the prefix once
  // precisely so the half that DECLARES `--site-*` and the half that REFERENCES it cannot
  // disagree, and a second `input.tokenPrefix ?? input.tokens?.prefix` beside it would be the
  // drift that guard exists to prevent.
  tokenPrefix: string | undefined;
} {
  const warnings: ValidationIssue[] = [];
  const blocks: string[] = [];

  const fonts = emitFontFaces(input.fonts ?? []);
  warnings.push(...fonts.issues);
  if (fonts.css !== "") blocks.push(fonts.css);

  // ONE prefix, used to declare the custom properties and to reference them.
  //
  // The two halves read it from different places — `emitTokenBlocks` from the token set, the
  // style compiler from its context — and a site that set one and not the other declared
  // `--site-color-primary` while its pages asked for `var(--brand-color-primary)`. Nothing
  // errors: the reference resolves to nothing and the value silently does not apply. Deriving it
  // once here is what makes that impossible rather than merely unlikely.
  const tokenPrefix = input.tokenPrefix ?? input.tokens?.prefix;

  // What the token emitter actually WROTE, carried forward rather than
  // re-derived. `emitTokenBlocks` refuses a token on five separate conditions
  // and reports the survivors for exactly this reason: a second statement of
  // those conditions agrees today and drifts the first time one changes.
  let declaredTokens: readonly SiteToken[] = [];

  if (input.tokens !== undefined) {
    const tokens = emitTokenBlocks(
      {
        ...input.tokens,
        ...(tokenPrefix === undefined ? {} : { prefix: tokenPrefix }),
      },
      TOKEN_SELECTOR
    );
    warnings.push(...tokens.issues);
    if (tokens.css !== "") blocks.push(tokens.css);
    declaredTokens = tokens.emitted;
  }

  // After the tokens that declare the property it reads, and before the block
  // defaults, which is where a structural rule belongs in this cascade: it must
  // lose to a block's own default and to everything after it.
  //
  // Pushed unconditionally; the rule withholds ITSELF when the width token it
  // reads is undeclared. The engine's default set carries `content.width`, but
  // those defaults are layered a tier above this function, so a caller
  // compiling a set that omits it arrives here with the property undeclared —
  // and half of this rule is worse than none of it.
  blocks.push(emitContentWidth(declaredTokens, tokenPrefix));

  return { blocks, warnings, tokenPrefix };
}

/**
 * Compile the token declarations a stored artifact's `var()` references resolve against.
 *
 * For a consumer that compiles a page once, stores the CSS and hands it back: that artifact still
 * carries every `var(--site-*)` it was compiled with, and a custom property nothing declares makes
 * its declaration invalid at computed-value time, so the property falls to its INITIAL value
 * rather than to the site's. The two initial values differ in kind — `background-color` is
 * `transparent`, `border-color` is `currentColor` — so the omission does not merely mute a block,
 * it repaints it in the text colour.
 *
 * The block-default and named-class tiers are deliberately absent: both are emitted under the
 * at-rules the site's breakpoints imply, and a caller on this path has stated none.
 */
export function compileSiteTokenSheet(
  input: Omit<SiteSheetInput, "breakpoints">
): SiteSheetArtifact {
  const { blocks, warnings } = compileBreakpointIndependentTiers(input);
  const css = blocks.filter(block => block !== "").join("\n");
  return { css, contentHash: hashId(css), warnings };
}

/**
 * Compile the stylesheet every page of a site shares.
 *
 * Order is the cascade, so it is fixed: font faces, then tokens, then the block-type defaults,
 * then the named classes. A page's own sheet is appended after this one, which is what lets a
 * node's own value beat a class and a class beat a block default.
 */
export function compileSiteSheet(input: SiteSheetInput): SiteSheetArtifact {
  const { blocks, warnings, tokenPrefix } =
    compileBreakpointIndependentTiers(input);

  const blockBases = input.blockBases ?? {};
  const tiers = compilePageCss(documentUsingEveryType(blockBases), {
    breakpoints: input.breakpoints,
    blockBases,
    namedClasses: input.classes ?? [],
    ...(tokenPrefix === undefined ? {} : { tokenPrefix }),
    ...(input.mayFetchUrl === undefined
      ? {}
      : { mayFetchUrl: input.mayFetchUrl }),
    // The SAME breakpoint emission the page tier uses. Compiled without it, the
    // shared classes and block defaults answer the published question while the
    // node-local declarations beside them answer the preview one — so a
    // container-axis rule from this sheet can match a real authored container
    // while the node's own rule at that breakpoint is aimed at a name nothing
    // carries. One document, two answers to one breakpoint.
    ...(input.previewContainer === undefined
      ? {}
      : { previewContainer: input.previewContainer }),
    ...(input.previewStates === true ? { previewStates: true } : {}),
  });
  warnings.push(...tiers.warnings);
  if (tiers.css !== "") blocks.push(tiers.css);

  // Empty entries are dropped here rather than guarded at each push, so a
  // section that decides it has nothing to say can simply say nothing.
  const css = blocks.filter(block => block !== "").join("\n");
  return { css, contentHash: hashId(css), warnings };
}
